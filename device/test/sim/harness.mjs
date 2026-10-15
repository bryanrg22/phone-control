// harness.mjs — runs the REAL device/supervisor.mjs against a simulated phone.
//
// The supervisor is run exactly as the server runs it: one short-lived command
// per call. Everything it shells out to is replaced through the seams it already
// has (GO_IOS, TUNNEL_PY, TUNNEL_PYTHON, a fake `ip` and `tailscale` on PATH),
// and its log directory and HOME point into a temp dir — so this is safe to run
// on a machine that is also serving a real phone:
//
//   • every simulated UDID starts with "SIM", and the supervisor's kill patterns
//     are UDID-scoped, so nothing here can match a real session;
//   • each harness gets its own UDIDs and cleans up only those, so harnesses
//     running at the same time (parallel eval runs) cannot kill each other's
//     sessions — a fixed UDID did exactly that on 2026-10-15;
//   • the phone lives on loopback addresses and throwaway ports.
//
// The fakes are kept in ./fakes as .cjs and installed, under the names the
// supervisor's process patterns expect, OUTSIDE the repo: the repo is
// "type": "module", and an extensionless or .py file run by node is only
// CommonJS when no such package.json sits above it.
//
// SIM_DEVICE_DIR points the suite at ANOTHER copy of device/ — used to prove a
// scenario fails when the behaviour it guards is deliberately broken.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, chmodSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimWorld, Blackhole } from './phone.mjs';

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const DEVICE_DIR = process.env.SIM_DEVICE_DIR || join(HERE, '..', '..');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha12 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

/** Poll until fn() is truthy; returns its value, or throws with `what`. */
export async function waitFor(fn, what, timeoutMs = 10000, stepMs = 100) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out after ${timeoutMs}ms waiting for: ${what}`);
    await sleep(stepMs);
  }
}

export async function pgrep(pattern) {
  try {
    const { stdout } = await execFileP('pgrep', ['-f', pattern], { timeout: 5000 });
    return stdout.split('\n').filter(Boolean).map(Number);
  } catch { return []; }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export async function createHarness({ graceMs = 3000, keep = false } = {}) {
  const isLinux = platform() === 'linux';
  const root = mkdtempSync(join(tmpdir(), 'phone-sim-'));
  const fakes = join(root, 'fakes');
  const state = join(root, 'state');
  const home = join(root, 'home');
  const logDir = join(root, 'logs');
  for (const d of [fakes, join(state, 'ifaces'), home, logDir]) mkdirSync(d, { recursive: true });

  const supervisorScript = join(DEVICE_DIR, 'supervisor.mjs');
  const underTest = { 'supervisor.mjs': sha12(supervisorScript), 'screen-state.mjs': sha12(join(DEVICE_DIR, 'screen-state.mjs')) };

  // ── the fakes, under the names the supervisor's patterns expect ────────────
  const install = (from, to) => { copyFileSync(join(HERE, 'fakes', from), join(fakes, to)); chmodSync(join(fakes, to), 0o755); };
  install('simlib.cjs', 'simlib.cjs');
  install('ip.cjs', 'ip');
  install('tailscale.cjs', 'tailscale');
  install('go-ios.cjs', 'go-ios');        // "…ios" so `ios[^ ]* runtest` matches its argv
  install('python.cjs', 'simpy');
  // Only its PATH matters (argv must read "tunnel.py <UDID>"); simpy does the work.
  writeFileSync(join(fakes, 'tunnel.py'), '# placeholder — the fake interpreter (python.cjs) plays the tunnel helper\n');

  // ── ports and addresses ────────────────────────────────────────────────────
  const runnerPort = await freePort();
  const rsdListenPort = await freePort();
  // Linux routes all of 127/8 to loopback, so every phone and every tunnel gets
  // its own address — which is what lets two phones share the supervisor's
  // single RUNNER_PORT / RSD_LISTEN_PORT, exactly as two real phones do.
  // Elsewhere only 127.0.0.1 exists: one phone, and tunnels differ by port only.
  let tunnelSeq = 0;
  // Can an unreachable phone be modelled honestly here — with connects that
  // TIME OUT instead of being refused? Needs python3 and a kernel that drops
  // SYNs on a full accept queue. Without it "unreachable" degrades to refusing,
  // and the scenarios that depend on the difference are skipped, not faked.
  const canBlackhole = await Blackhole.supported(isLinux ? '127.0.0.11' : '127.0.0.1').catch(() => false);
  const world = new SimWorld({
    runnerPort, rsdListenPort, graceMs, canBlackhole,
    allocateRsdAddress: () => (isLinux ? `127.77.${100 + (++tunnelSeq % 150)}.1` : '127.0.0.1'),
  });
  const ctrlPort = await world.start();

  // UDID shape as a real one (8 + 16 characters); the 10-hex instance tag makes it this harness's own.
  const instance = randomBytes(5).toString('hex').toUpperCase();
  const phoneA = await world.addPhone({ name: 'A', ip: isLinux ? '127.0.0.11' : '127.0.0.1', udid: `SIM0A000-${instance}000A11` });
  const phoneB = isLinux ? await world.addPhone({ name: 'B', ip: '127.0.0.12', udid: `SIM0B000-${instance}000B22` }) : null;

  // The host's side of pairing: one record per phone, where pymobiledevice3
  // keeps them. Only its existence matters to the code under test, so the
  // content is a placeholder. A scenario removes it to model "never paired".
  const pairingRecord = (udid) => join(home, '.pymobiledevice3', `remote_${udid}.plist`);
  const setPaired = (udid, paired) => {
    mkdirSync(dirname(pairingRecord(udid)), { recursive: true });
    if (paired) writeFileSync(pairingRecord(udid), 'placeholder — not a real pairing record\n', { mode: 0o600 });
    else rmSync(pairingRecord(udid), { force: true });
  };
  for (const p of [phoneA, phoneB]) if (p) setPaired(p.udid, true);

  const env = {
    ...process.env,
    PATH: `${fakes}:${process.env.PATH}`,
    HOME: home,
    GO_IOS: join(fakes, 'go-ios'),
    TUNNEL_PY: join(fakes, 'tunnel.py'),
    TUNNEL_PYTHON: join(fakes, 'simpy'),
    TAILSCALE_BIN: join(fakes, 'tailscale'),
    RUNNER_BUNDLE: 'sim.runner.xctrunner',
    RUNNER_PORT: String(runnerPort),
    RSD_LISTEN_PORT: String(rsdListenPort),
    SUPERVISOR_LOG_DIR: logDir,
    // Real-phone waits, shortened: 2 attempts of 8 s, "waiting on the phone" after 3 s.
    RUNTEST_ATTEMPTS: '2',
    RUNTEST_ATTEMPT_SECONDS: '8',
    WAITING_ON_PHONE_AFTER_SECONDS: '3',
    SIM_CTRL_PORT: String(ctrlPort),
    SIM_STATE_DIR: state,
  };
  for (const k of ['ENDPOINT_FILE', 'RSD_ADDRESS', 'RSD_PORT', 'ARMED_FOR_SLOT', 'PHONE_UDID', 'PHONE_ADDRESS']) delete env[k];

  const ids = (phone) => ['--address', phone.ip, '--udid', phone.udid];

  /** Run one supervisor command. Never throws: returns its exit code, stdout and stderr. */
  async function sup(args, { extraEnv = {}, timeout = 240000 } = {}) {
    try {
      const { stdout, stderr } = await execFileP(process.execPath, [supervisorScript, ...args], { env: { ...env, ...extraEnv }, timeout, maxBuffer: 4 * 1024 * 1024 });
      return { code: 0, stdout, stderr };
    } catch (e) {
      return { code: e.code ?? null, stdout: String(e.stdout || ''), stderr: String(e.stderr || e.message || '') };
    }
  }

  /** Start automation. `detail` is the tail of what the supervisor said, as a caller would relay it. */
  async function arm(phone, { slot = '' } = {}) {
    const r = await sup(['--once', ...ids(phone), ...(slot ? ['--slot', slot] : [])]);
    const url = r.stdout.match(/^RUNNER_URL=(\S+)$/m);
    return { armed: r.code === 0, exitCode: r.code, runnerURL: url ? url[1] : null, detail: r.stderr.split('\n').filter(Boolean).slice(-5).join(' | '), stderr: r.stderr };
  }

  async function suspend(phone) { return JSON.parse((await sup(['--suspend', ...ids(phone)])).stdout); }
  async function status(phone) { const r = await sup(['--status', ...ids(phone)], { timeout: 45000 }); return { ...JSON.parse(r.stdout), stderr: r.stderr }; }
  /** Any of the one-shot JSON modes: --screen-state, --prepare-screen, --launch-app ID. */
  async function mode(phone, ...modeArgs) { return JSON.parse((await sup([...modeArgs, ...ids(phone)], { timeout: 60000 })).stdout); }

  const anchorPids = (phone) => pgrep(`ios[^ ]* runtest.*--udid=${phone.udid}`);
  const tunnelPids = (phone) => pgrep(`tunnel\\.py ${phone.udid}`);

  async function runnerAnswers(phone) {
    try { const r = await fetch(`http://${phone.ip}:${runnerPort}/deviceInfo`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
  }
  async function hostInfo(phone) {
    const r = await fetch(`http://${phone.ip}:${runnerPort}/hostInfo`, { signal: AbortSignal.timeout(1500) });
    return (await r.json()).env;
  }

  async function killSimProcesses() {
    const patterns = [`runtest.*--udid=SIM0[AB]000-${instance}`, `tunnel\\.py SIM0[AB]000-${instance}`];
    for (const pat of patterns) { try { await execFileP('pkill', ['-f', pat], { timeout: 5000 }); } catch { /* none */ } }
    try {
      await waitFor(async () => (await pgrep(patterns[0])).length + (await pgrep(patterns[1])).length === 0, 'sim processes to exit', 5000);
    } catch {
      for (const pat of patterns) { try { await execFileP('pkill', ['-9', '-f', pat], { timeout: 5000 }); } catch { /* none */ } }
    }
  }

  /** Every scenario starts from: healthy phones on Wi-Fi, nothing running, no memory of a tunnel. */
  async function reset() {
    await killSimProcesses();
    for (const p of world.phones.values()) await p.reset();
    for (const f of readdirSync(join(state, 'ifaces'))) rmSync(join(state, 'ifaces', f), { force: true });
    for (const f of readdirSync(logDir)) rmSync(join(logDir, f), { force: true });
    for (const p of world.phones.values()) setPaired(p.udid, true);
  }

  async function close({ failed = false } = {}) {
    await killSimProcesses();
    await world.close();
    if (keep || failed) return { kept: root };
    rmSync(root, { recursive: true, force: true });
    return { kept: null };
  }

  return {
    isLinux, root, logDir, env, world, phoneA, phoneB, underTest, graceMs, runnerPort, rsdListenPort, canBlackhole,
    deviceDir: DEVICE_DIR, setPaired, sup, arm, suspend, status, mode, anchorPids, tunnelPids, runnerAnswers, hostInfo, reset, close, alive,
  };
}
