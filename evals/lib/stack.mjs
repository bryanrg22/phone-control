// stack.mjs — one complete, isolated phone-control stack for one eval trial.
//
//   const stack = await startStack({ phone: { locked: true }, scenario });
//   const tools = await stack.mcp.listTools();
//   const result = await stack.mcp.callTool('get_phone_status', {});
//   ...
//   await stack.stop();
//
// What is real: server/src/server.mjs (started as a process, exactly as
// systemd starts it), device/supervisor.mjs, OAuth sign-in, the MCP endpoint.
// What is simulated: the iPhone (device/test/sim) and the phone agent, which is
// replaced by a scenario-driven stand-in (evals/connector/phone-agent-stub) so
// an assistant eval measures the ASSISTANT, not whether a model can drive a
// phone. Every trial gets its own phone, server, state directory and token,
// so nothing leaks from one trial into the next.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

import { createHarness, waitFor } from '../../device/test/sim/harness.mjs';
import { run as phonectl } from '../../server/bin/phonectl.mjs';
import { loadDevices, saveDevices } from '../../server/src/devices.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STUB_ROOT = join(REPO, 'evals', 'connector', 'phone-agent-stub');
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
export const OWNER = 'owner@example.com';

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

/**
 * @param {object} opts
 * @param {object} [opts.phone]      { locked, wifi=true, paired=true, vpn=true }
 * @param {object} [opts.scenario]   what the stand-in phone agent does (see phone-agent-stub)
 * @param {string} [opts.defaultModel]  the server's CONNECTOR_DEFAULT_MODEL
 */
export async function startStack({ phone = {}, scenario = { steps: [{ done: 'Done.' }] }, defaultModel = 'gpt-6-luna' } = {}) {
  const h = await createHarness({ graceMs: 6000 });
  const A = h.phoneA;
  const dir = mkdtempSync(join(tmpdir(), 'phone-control-eval-'));
  const paths = { devicesPath: join(dir, 'etc', 'devices.json'), storePath: join(dir, 'etc', 'connector.json') };
  const scenarioFile = join(dir, 'scenario.json');
  writeFileSync(scenarioFile, JSON.stringify(scenario));

  phonectl(['device', 'add', '--email', OWNER, '--address', A.ip, '--udid', '00008130-000A1B2C3D4E5F60', '--name', 'iPhone'], paths);
  // Simulated UDIDs start with "SIM" so the supervisor's process patterns can
  // never match a real session; phonectl rightly refuses them, so write it in.
  const registry = loadDevices(paths.devicesPath);
  registry.devices[0].udid = A.udid;
  saveDevices(registry, paths.devicesPath);

  if (phone.locked) A.lock();
  if (phone.wifi === false) await A.setWifi(false);
  if (phone.paired === false) h.setPaired(A.udid, false);
  if (phone.vpn === false) await A.setVpn(false);

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let output = '';
  const server = spawn(process.execPath, [join(REPO, 'server', 'src', 'server.mjs')], {
    env: {
      ...h.env,
      CONNECTOR_PUBLIC_URL: base,
      CONNECTOR_PORT: String(port),
      CONNECTOR_BIND: '127.0.0.1',
      CONNECTOR_ALLOW_HTTP: '1',
      CONNECTOR_STORE: paths.storePath,
      CONNECTOR_DEVICES: paths.devicesPath,
      CONNECTOR_RUNNER_PORT: String(h.runnerPort),
      CONNECTOR_AGENT_ROOT: STUB_ROOT,
      CONNECTOR_DEFAULT_MODEL: defaultModel,
      PHONE_CONTROL_STATE_DIR: join(dir, 'var'),
      // The stand-in agent never calls a model; these only make every model
      // in server/src/models.mjs selectable, as on a fully configured server.
      OPENAI_API_KEY: 'eval-stand-in-not-a-key',
      ANTHROPIC_API_KEY: 'eval-stand-in-not-a-key',
      GEMINI_API_KEY: 'eval-stand-in-not-a-key',
      PHONE_AGENT_STUB_SCENARIO: scenarioFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { output += d; });
  server.stderr.on('data', (d) => { output += d; });

  const http = (p, opts = {}) => fetch(base + p, { redirect: 'manual', ...opts });
  const post = (p, body, form = false) => http(p, {
    method: 'POST',
    headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });

  try {
    await waitFor(async () => { try { return (await http('/healthz')).ok; } catch { return false; } }, 'the server to listen', 15000);
  } catch (e) {
    server.kill('SIGTERM'); await h.close({ failed: true });
    throw new Error(`${e.message}\n${output}`);
  }

  // Sign in exactly as an assistant does: register, consent with a connect code, PKCE.
  const client = await (await post('/oauth/register', { client_name: 'Claude', redirect_uris: [REDIRECT] })).json();
  const code = phonectl(['link-code', '--email', OWNER], paths)[0].replace('Connect code: ', '');
  const verifier = randomBytes(32).toString('base64url');
  const redirected = await post('/oauth/authorize', {
    client_id: client.client_id, redirect_uri: REDIRECT, state: 's', response_type: 'code', link_code: code,
    code_challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url'), code_challenge_method: 'S256',
  }, true);
  const issued = new URL(redirected.headers.get('location')).searchParams.get('code');
  const { access_token: token } = await (await post('/oauth/token', {
    grant_type: 'authorization_code', code: issued, client_id: client.client_id, code_verifier: verifier, redirect_uri: REDIRECT,
  }, true)).json();
  if (!token) throw new Error('sign-in did not produce a token');

  let rpcId = 0;
  async function mcpCall(method, params) {
    const res = await http('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    if (res.status !== 200) throw new Error(`MCP ${method} → HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`MCP ${method} → ${body.error.message}`);
    return body.result;
  }

  const mcp = {
    /** tools/list, as the server serves it to an assistant. */
    async listTools() { return (await mcpCall('tools/list', {})).tools; },
    /** tools/call → { text, isError, json } where json is the parsed text when it is JSON. */
    async callTool(name, args) {
      const result = await mcpCall('tools/call', { name, arguments: args });
      const text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { text, isError: result.isError === true, json };
    },
  };

  /** The server's own record of what it did: its log lines since start. */
  const serverLog = () => {
    const file = join(dir, 'var', 'logs', 'server.log');
    return existsSync(file) ? readFileSync(file, 'utf8') : output;
  };

  /** Every start of the phone agent: the task text, model and provider it was given. */
  const stubCalls = () => {
    const file = `${scenarioFile}.calls.jsonl`;
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  };

  /** What is true on the simulated phone right now. */
  async function phoneState() {
    return {
      automationRunning: await h.runnerAnswers(A),
      anchors: (await h.anchorPids(A)).length,
      foregroundApp: A.foregroundApp,
      counters: A.snapshot(),
    };
  }

  async function stop() {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }

  return { base, token, mcp, serverLog, stubCalls, phoneState, stop, phone: A, harness: h };
}
