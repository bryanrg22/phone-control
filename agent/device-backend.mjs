// device-backend.mjs — device actuation transports for agent.mjs.
//
// Extracted from agent.mjs (D2 refactor, 2026-07-17). Three transports:
//   • MaestroMCP            — `maestro mcp` JSON-RPC child process (slow simulator baseline)
//   • createDirectHttpDriver — direct HTTP to Maestro's XCTest runner (phone-direct on :6001
//                              via maestro-ios-device, or direct-http-sim on :22087)
//   • captureRawScreenshot   — raw screenshot bytes (phone via runner, simulator via simctl)
//
// NO top-level side effects, NO module-global mutable state, NO npm dependencies —
// everything is parameterized ({ driverHost, driverPort, phoneDeviceId, simUdid,
// getCurrentAppId }). agent.mjs keeps owning currentAppId and passes a getter, so
// the transport always scopes flows/typing to the app the agent last launched.

import { exec, spawn } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export function runShell(cmd, timeout = 30000) {
  return new Promise((resolve, reject) => {
    // 50 MB stdout cap. Default is 1 MB, which silently truncates
    // large outputs like `pymobiledevice3 apps list` on phones with
    // 100+ apps installed (the JSON for ~150 apps is ~1.2 MB) and
    // surfaces as "stdout maxBuffer length exceeded" in the catch.
    exec(cmd, { timeout, maxBuffer: 50 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error(error.message.slice(0, 200)));
      else resolve(stdout);
    });
  });
}

// ─── Maestro MCP Server (maestro-cli backend — slow simulator baseline) ───
export class MaestroMCP {
  constructor({ simUdid = 'booted' } = {}) {
    this.simUdid = simUdid;
    this.process = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.deviceId = null;
    this.ready = false;
  }

  async start() {
    return new Promise((resolve, reject) => {
      // Bind Maestro to the SAME sim as our simctl ops. Without --udid, `maestro mcp`
      // self-selects a device — with >1 sims booted, screenshots (simctl, pinned to
      // simUdid) could come from one sim while Maestro taps another.
      const maestroArgs = this.simUdid !== 'booted' ? ['--udid', this.simUdid, 'mcp'] : ['mcp'];
      this.process = spawn('maestro', maestroArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.process.stderr.on('data', () => {}); // suppress warnings

      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || ''; // keep incomplete line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line.trim());
            if (msg.id && this.pending.has(msg.id)) {
              this.pending.get(msg.id)(msg);
              this.pending.delete(msg.id);
            }
          } catch {}
        }
      });

      this.process.on('error', reject);

      // Initialize MCP protocol
      this._call('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mobile-use', version: '1.0' },
      }).then(() => {
        this.ready = true;
        resolve();
      }).catch(reject);
    });
  }

  _call(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP timeout: ${method}`));
      }, 60000);

      this.pending.set(id, (msg) => {
        clearTimeout(timeout);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      });

      this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async callTool(name, args) {
    const result = await this._call('tools/call', { name, arguments: args });
    const content = result?.content?.[0];
    if (content?.type === 'image') {
      return { type: 'image', data: content.data, mimeType: content.mimeType };
    }
    const text = content?.text || '';
    // Check for success/failure
    if (text.includes('"success":true') || text.includes('success')) return { type: 'text', text };
    if (text.includes('Failed') || text.includes('Error')) throw new Error(text.slice(0, 200));
    return { type: 'text', text };
  }

  async detectDevice(preferPhysical = false) {
    const result = await this.callTool('list_devices', {});
    const devices = JSON.parse(result.text);
    const dev = preferPhysical
      ? devices.devices?.find(d => d.connected && d.type !== 'simulator') || devices.devices?.find(d => d.connected)
      : devices.devices?.find(d => d.connected && d.type === 'simulator') || devices.devices?.find(d => d.connected);
    if (dev) {
      this.deviceId = dev.device_id;
      return dev;
    }
    throw new Error('No connected device found');
  }

  async tap(text) {
    return this.callTool('tap_on', { device_id: this.deviceId, text });
  }

  async tapById(id) {
    return this.callTool('tap_on', { device_id: this.deviceId, id });
  }

  async inputText(text) {
    return this.callTool('input_text', { device_id: this.deviceId, text });
  }

  async screenshot() {
    return this.callTool('take_screenshot', { device_id: this.deviceId });
  }

  async viewHierarchy() {
    return this.callTool('inspect_view_hierarchy', { device_id: this.deviceId });
  }

  async back() {
    return this.callTool('back', { device_id: this.deviceId });
  }

  async launchApp(appId) {
    return this.callTool('launch_app', { device_id: this.deviceId, appId });
  }

  async runFlow(yaml) {
    return this.callTool('run_flow', { device_id: this.deviceId, flow_yaml: yaml });
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

// ─── Direct-HTTP driver (phone-direct + direct-http-sim backends) ───
// Same client code for both phone-direct (port 6001 via maestro-ios-device) and
// direct-http-sim (port 22087 direct to Maestro's runner inside the simulator).
// driverHost defaults to localhost; can be overridden with --driver-host to talk
// to a remote runner (Tailscale virtual IP, LAN IP for cross-network control).
export function createDirectHttpDriver({ driverHost, driverPort, phoneDeviceId, getCurrentAppId }) {
  const XCTEST_URL = `http://${driverHost}:${driverPort}`;

  // Helper for XCTest HTTP calls
  async function xctest(method, path, body = null) {
    const opts = { method, signal: AbortSignal.timeout(30000) };
    if (body !== null) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(`${XCTEST_URL}${path}`, opts);
    if (!resp.ok && resp.status !== 200) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`XCTest ${path} failed (${resp.status}): ${errText.slice(0, 150)}`);
    }
    return resp;
  }

  // Driver object using direct HTTP (no JVM, ~100ms per call)
  return {
    deviceId: phoneDeviceId,
    async runFlow(yaml) {
      // runFlow is only used as fallback — for direct HTTP, use specific methods
      const flowPath = join(tmpdir(), `maestro-flow-${Date.now()}.yaml`);
      writeFileSync(flowPath, yaml);
      const cmd = `maestro --driver-host-port ${driverPort} --device ${phoneDeviceId} test ${flowPath}`;
      return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 60000 }, (error, stdout) => {
          try { unlinkSync(flowPath); } catch {}
          if (error) reject(new Error(`Maestro: ${error.message.slice(0, 200)}`));
          else resolve({ type: 'text', text: stdout || 'ok' });
        });
      });
    },
    async launchApp(appId) {
      await xctest('POST', '/launchApp', { bundleId: appId });
      return { type: 'text', text: 'ok' };
    },
    async inputText(text) {
      const currentAppId = getCurrentAppId();
      const appIds = currentAppId ? [currentAppId] : ['com.apple.springboard'];
      await xctest('POST', '/inputText', { text, appIds });
      return { type: 'text', text: 'ok' };
    },
    async tap(text) {
      // Text-based tap via Maestro CLI fallback (direct HTTP doesn't have text search)
      const flowPath = join(tmpdir(), `maestro-flow-${Date.now()}.yaml`);
      const currentAppId = getCurrentAppId();
      const header = currentAppId ? `appId: ${currentAppId}\n---\n` : 'appId: any\n---\n';
      writeFileSync(flowPath, `${header}- tapOn:\n    text: "${text.replace(/"/g, '\\"')}"`);
      const cmd = `maestro --driver-host-port ${driverPort} --device ${phoneDeviceId} test ${flowPath}`;
      return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 60000 }, (error) => {
          try { unlinkSync(flowPath); } catch {}
          if (error) reject(new Error(`Maestro tap failed: ${error.message.slice(0, 150)}`));
          else resolve({ type: 'text', text: 'ok' });
        });
      });
    },
    async touchPoint(x, y, duration = 0.1) {
      await xctest('POST', '/touch', { x, y, duration });
      return { type: 'text', text: 'ok' };
    },
    async pressKey(key) {
      await xctest('POST', '/pressKey', { key });
      return { type: 'text', text: 'ok' };
    },
    // Hardware buttons route separately from keyboard keys in the runner:
    // /pressKey only accepts {delete,return,enter,tab,space,escape} (see
    // vendor/.../PressKeyRequest.swift) and 400s on anything else, while
    // home/lock live on /pressButton (PressButtonRequest.swift). Without this
    // method, pressKey('home') silently 400'd on the direct-HTTP path.
    async pressButton(button) {
      await xctest('POST', '/pressButton', { button });
      return { type: 'text', text: 'ok' };
    },
    async swipe(startX, startY, endX, endY, duration = 0.3) {
      // swipeV2: v1 skips ScreenSizeHelper.orientationAwarePoint (which /touch
      // and /drag apply), so v1 swipes are wrong in landscape. Same body.
      await xctest('POST', '/swipeV2', { startX, startY, endX, endY, duration });
      return { type: 'text', text: 'ok' };
    },
    async drag(startX, startY, endX, endY, holdDuration = 0.5, dragDuration = 1.0) {
      await xctest('POST', '/drag', { startX, startY, endX, endY, holdDuration, dragDuration });
      return { type: 'text', text: 'ok' };
    },
    async viewHierarchy() {
      const currentAppId = getCurrentAppId();
      const appIds = currentAppId ? [currentAppId] : ['com.apple.springboard'];
      const resp = await xctest('POST', '/viewHierarchy', { appIds, excludeKeyboardElements: false });
      const text = await resp.text();
      return { type: 'text', text };
    },
    /// Truth from the runner: XCUIApplication.keyboards.firstMatch.exists.
    async keyboardVisible() {
      const currentAppId = getCurrentAppId();
      const appIds = currentAppId ? [currentAppId] : ['com.apple.springboard'];
      const resp = await xctest('POST', '/keyboard', { appIds });
      const j = await resp.json().catch(() => ({}));
      return j.isKeyboardVisible === true;
    },
    /// A point above the keyboard the hierarchy says is empty, or null. Same
    /// candidates as the Swift twin: left margin, 30–55% down.
    async emptySpotAboveKeyboard() {
      const { text } = await this.viewHierarchy();
      let root; try { root = JSON.parse(text); } catch { return null; }
      const di = await (await xctest('GET', '/deviceInfo')).json().catch(() => ({}));
      const W = di.widthPoints || 393, H = di.heightPoints || 852;
      const PRESSABLE = new Set([9, 75, 40, 42, 49, 43, 44, 12, 21, 27]);
      const frames = [];
      (function walk(n) {
        if (!n) return;
        const f = n.frame;
        if (f && f.Width > 0 && f.Height > 0 && f.Width < W * 0.95 && PRESSABLE.has(n.elementType)) frames.push(f);
        for (const c of n.children || []) walk(c);
      })(root.axElement || root);
      for (let frac = 0.30; frac <= 0.55; frac += 0.05) {
        const x = 8, y = frac * H;
        if (!frames.some((f) => x >= f.X - 6 && x <= f.X + f.Width + 6 && y >= f.Y - 6 && y <= f.Y + f.Height + 6)) return { x, y: Math.round(y) };
      }
      return null;
    },
    async screenshot() {
      const resp = await xctest('GET', '/screenshot');
      const arrayBuf = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      return { type: 'image', data: buffer.toString('base64') };
    },
    async eraseText(chars) {
      const currentAppId = getCurrentAppId();
      const appIds = currentAppId ? [currentAppId] : ['com.apple.springboard'];
      await xctest('POST', '/eraseText', { charactersToErase: chars, appIds });
      return { type: 'text', text: 'ok' };
    },
    async deviceInfo() {
      const resp = await xctest('GET', '/deviceInfo');
      return await resp.json();
    },
    stop() {},
  };
}

// Raw screenshot bytes for the observe step: phone via the runner's /screenshot,
// simulator via `simctl io <udid> screenshot`. Rotation/compression/grid overlay
// stay in agent.mjs (they depend on run flags + sharp).
export async function captureRawScreenshot({ isPhone, maestro, simUdid }) {
  if (isPhone) {
    const ssResult = await maestro.screenshot();
    return Buffer.from(ssResult.data, 'base64');
  }
  const p = join(tmpdir(), `screen-${Date.now()}.png`);
  await runShell(`xcrun simctl io ${simUdid} screenshot "${p}"`, 10000);
  const buffer = readFileSync(p);
  try { unlinkSync(p); } catch {}
  return buffer;
}
