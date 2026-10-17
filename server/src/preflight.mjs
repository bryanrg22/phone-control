// preflight.mjs — turn the host's view of a phone into one sentence a person
// can act on, and start automation when a task needs it.
//
// The supervisor (device/supervisor.mjs --status) measures a phone's state; each
// state below was produced on a real phone on 2026-10-11/12, so each gets its
// own answer instead of a generic "not connected":
//
//   ready              the runner answers
//   waking             a start is in flight
//   waiting_on_phone   …and it is stuck on something only the owner can do
//                      (unlock / the "Enable UI Automation" passcode prompt)
//   unreachable        nothing answers: off, flat, restarted and not unlocked
//   needs_wifi         on cellular with no warm tunnel — a start needs Wi-Fi
//   needs_attention    the last start failed for a reason the owner can fix
//   needs_setup        registered, but never paired with this server
//   needs_wake         startable, but this server is set not to start it
//
// describePhoneState is pure. createSupervisorClient is the only part that
// touches the host, and it runs a handful of fixed commands.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { openSync, closeSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const execFileP = promisify(execFile);

const CELLULAR_NOTE = ' It is on cellular: that works now, but if the connection drops, starting again will need Wi-Fi.';
const STOPPED_NOTE = 'Automation was stopped on the phone itself. ';
// A failure older than this says nothing about the phone as it is now.
const FAILURE_IS_FRESH_SECONDS = 180;

/**
 * @param {object|null} s  supervisor --status JSON, or null if it could not be read
 * @returns {{ state: string, ready: boolean, startable: boolean, message: string }}
 */
export function describePhoneState(s) {
  const out = (state, message, extra = {}) => ({ state, ready: false, startable: false, message, ...extra });
  if (!s || typeof s !== 'object') {
    return out('unknown', 'I could not check the phone just now. Ask me again in a moment.');
  }

  if (s.runnerHealthy) {
    return out('ready', `The phone is connected and ready.${s.phoneNet === 'cellular' ? CELLULAR_NOTE : ''}`, { ready: true });
  }

  const arm = s.arm || null;
  if (arm && arm.inFlight) {
    if (arm.phase === 'waiting-on-phone') {
      return out('waiting_on_phone', 'Your phone needs you: unlock it and, if it asks for your passcode to allow automation, enter it. I will carry on as soon as you do.');
    }
    if (arm.phase === 'mounting') {
      return out('waking', 'Starting automation on your phone. Keep it unlocked for a moment — this step needs it. Ask me again in a few seconds.');
    }
    return out('waking', 'Starting automation on your phone. This can take up to a minute; ask me again in a few seconds.');
  }

  // Setup that was never finished. Decided from the host's own files, so it is
  // known before anything is tried — and trying cannot fix it. A tunnel that IS
  // up proves a record exists somewhere, so that case is left alone.
  if (s.pairingRecord === false && s.tunnelState !== 'live') {
    return out('needs_setup', 'This phone is registered, but it has not been paired with the server yet, so I cannot do anything on it. Pairing is a one-time setup step for whoever runs the server.');
  }

  if (s.phoneNet === 'unreachable') {
    return out('unreachable', 'I cannot reach your phone. It may be switched off, out of battery, or restarted and not unlocked yet. Unlock it once, make sure its VPN is on, then ask me again.');
  }

  const fresh = arm && arm.phase === 'failed' && arm.ageSec !== null && arm.ageSec <= FAILURE_IS_FRESH_SECONDS;
  if (fresh && arm.reason === 'waiting-on-phone') {
    return out('needs_attention', 'Your phone did not respond in time. Unlock it, enter your passcode if it asks to allow automation, then ask me again.', { startable: true });
  }
  if (fresh && arm.reason === 'session-failed') {
    return out('needs_attention', 'Automation would not start on your phone. Make sure it is unlocked and awake, then ask me again.', { startable: true });
  }
  if (fresh && arm.reason === 'tunnel-failed') {
    return out('needs_attention', 'I could reach your phone, but it would not accept the server\'s connection. Make sure it is unlocked and on Wi-Fi, then ask me again. If it keeps happening, the phone\'s pairing with the server has to be redone by whoever runs the server.', { startable: true });
  }
  if (fresh && arm.reason === 'locked') {
    return out('needs_attention', 'Your phone restarted and has to be unlocked before automation can start. Unlock it, then ask me again.', { startable: true });
  }

  const stopped = s.lastSession && s.lastSession.endedOnDevice ? STOPPED_NOTE : '';

  // A warm tunnel can be reattached from any network; a new one needs Wi-Fi.
  if (s.tunnelState === 'live' || s.phoneNet === 'wifi') {
    return out('needs_wake', `${stopped}Automation is not running on the phone right now.`, { startable: true });
  }
  if (s.phoneNet === 'cellular') {
    return out('needs_wifi', `${stopped}Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular.`);
  }
  return out('unknown', 'I could not tell what state the phone is in. Ask me again in a moment.');
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Operator overrides for where a user's phone lives, keyed by uid or email:
 *   CONNECTOR_DEVICE_OVERRIDES='{"you@example.com":{"address":"100.64.0.20"}}'
 * Rarely needed — the registry already holds each phone's address — but handy
 * to redirect one person's phone without editing the registry.
 */
export function parseDeviceOverrides(text) {
  if (!text) return {};
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('CONNECTOR_DEVICE_OVERRIDES is not valid JSON'); }
  const out = {};
  for (const [who, v] of Object.entries(raw || {})) {
    const address = String(v?.address || '');
    const m = address.match(IPV4);
    if (!m || m.slice(1).some((n) => Number(n) > 255)) throw new Error(`CONNECTOR_DEVICE_OVERRIDES: "${address}" for ${who} is not an IPv4 address`);
    out[who.toLowerCase()] = { address };
  }
  return out;
}

/**
 * The host side: read a phone's state, and start a bring-up.
 *
 * Every command is the bundled supervisor with fixed flags plus the phone's
 * address and UDID from the registry — nothing a caller sends reaches a shell.
 */
export function createSupervisorClient({ supervisorPath, env = process.env, node = process.execPath, log = () => {}, spawnFn = spawn, execFn = execFileP, logDir = null, killGroup = (pid, sig) => process.kill(-pid, sig) }) {
  if (!supervisorPath) throw new Error('createSupervisorClient requires supervisorPath');
  const inFlight = new Map();   // address → child, so two questions cannot start two bring-ups
  const warming = new Map();    // address → keep-warm child (tunnel and disk image only, never the runner)

  const ids = ({ address, udid }) => ['--address', address, ...(udid ? ['--udid', udid] : [])];

  async function inspect({ address, udid }) {
    try {
      const { stdout } = await execFn(node, [supervisorPath, '--status', ...ids({ address, udid })], { env, timeout: 45000, maxBuffer: 4 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (e) {
      log(`preflight: status failed for ${address}: ${String(e.message || e).split('\n')[0].slice(0, 160)}`);
      return null;
    }
  }

  function startArm({ address, udid, slot }) {
    if (inFlight.has(address)) return { started: false, alreadyRunning: true };
    // A task outranks the keep-warm job. Stop it, with any Python it started,
    // and let the bring-up redo whatever it had not finished: a tunnel it left
    // half-built is reaped and rebuilt, a mount it cut short is retried.
    stopWarm(address);
    // Keep the supervisor's own account of the bring-up. It narrates every
    // decision on stderr (adopted a warm tunnel / found a ghost / rebuilt /
    // waited on the phone); thrown away, a slow or surprising start cannot be
    // explained afterwards — which is exactly what happened on 2026-10-12.
    let fd = null;
    if (logDir) {
      try {
        mkdirSync(logDir, { recursive: true });
        const file = join(logDir, 'bringup.log');
        appendFileSync(file, `\n=== ${new Date().toISOString()} bring-up for ${address} ===\n`);
        fd = openSync(file, 'a');
      } catch { fd = null; }
    }
    const child = spawnFn(node, [supervisorPath, '--once', ...ids({ address, udid }), ...(slot ? ['--slot', slot] : [])],
      { env, stdio: fd === null ? 'ignore' : ['ignore', 'ignore', fd] });
    if (fd !== null) { try { closeSync(fd); } catch { /* the child holds its own copy */ } }
    inFlight.set(address, child);
    const done = (why) => { if (inFlight.get(address) === child) inFlight.delete(address); log(`preflight: bring-up for ${address} ${why}`); };
    child.once('exit', (code) => done(code === 0 ? 'armed' : `ended (code ${code})`));
    child.once('error', (e) => done(`could not start: ${e.message}`));
    log(`preflight: bring-up started for ${address}`);
    return { started: true };
  }

  /**
   * Abandon a bring-up that is still in flight. Without this, a task stopped
   * while automation was STARTING would be cleaned up, and then the bring-up
   * would finish anyway and leave the banner on a phone nobody is using.
   * The caller suspends afterwards, which clears any anchor it had launched.
   */
  async function cancelArm({ address }) {
    const child = inFlight.get(address);
    if (!child) return false;
    const gone = new Promise((resolve) => { child.once('exit', resolve); child.once('error', resolve); });
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    await Promise.race([gone, new Promise((r) => setTimeout(r, 5000))]);
    return true;
  }

  function stopWarm(address) {
    const w = warming.get(address);
    if (!w) return;
    warming.delete(address);
    try { killGroup(w.pid, 'SIGTERM'); } catch { try { w.kill('SIGTERM'); } catch { /* already gone */ } }
    log(`preflight: keep-warm for ${address} stopped for a task`);
  }

  /**
   * Keep a phone ready without touching its screen: rebuild a dead tunnel (on
   * Wi-Fi) and mount the developer disk image if iOS dropped it (phone
   * unlocked). Never starts the runner, so no banner. Resolves to
   * { ran, code, ms, lines } once the supervisor exits; { ran: false } when a
   * bring-up or another keep-warm for this phone is already running.
   */
  function keepWarm({ address, udid }, { mountTimeoutSeconds = 60 } = {}) {
    if (inFlight.has(address) || warming.has(address)) return Promise.resolve({ ran: false });
    const t0 = Date.now();
    const child = spawnFn(node, [supervisorPath, '--tunnel-only', ...ids({ address, udid })], {
      env: { ...env, MOUNT_TIMEOUT_SECONDS: String(mountTimeoutSeconds) },
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,               // its own process group, so a task can stop it with its Python children
    });
    warming.set(address, child);
    let text = '';
    child.stderr?.on('data', (d) => { text += d; });
    return new Promise((resolve) => {
      const finish = (code) => {
        if (warming.get(address) === child) warming.delete(address);
        const lines = text.split('\n').filter(Boolean);
        if (logDir && lines.length) {
          try { mkdirSync(logDir, { recursive: true }); appendFileSync(join(logDir, 'keepwarm.log'), `\n=== ${new Date(t0).toISOString()} keep-warm for ${address} (exit ${code}) ===\n${lines.join('\n')}\n`); } catch { /* best effort */ }
        }
        resolve({ ran: true, code, ms: Date.now() - t0, lines });
      };
      child.once('exit', (code) => finish(code));
      child.once('error', () => finish(null));
    });
  }

  /** Put automation down: the runner stops, the banner clears, the tunnel stays warm. */
  async function suspend({ address, udid }) {
    const { stdout } = await execFn(node, [supervisorPath, '--suspend', ...ids({ address, udid })], { env, timeout: 45000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  }

  /** What the phone's own screen says (locked? Wi-Fi?). null if it cannot be read. */
  async function screenState({ address, udid }) {
    try {
      const { stdout } = await execFn(node, [supervisorPath, '--screen-state', ...ids({ address, udid })], { env, timeout: 45000, maxBuffer: 4 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch { return null; }
  }

  /** Swipe away another app's banner covering the top of the screen. null if it could not be tried. */
  async function prepareScreen({ address, udid }) {
    try {
      const { stdout } = await execFn(node, [supervisorPath, '--prepare-screen', ...ids({ address, udid })], { env, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch { return null; }
  }

  /** Bring an app to the front on the phone. null if it could not be tried. */
  async function launchApp({ address, udid }, bundleId) {
    try {
      const { stdout } = await execFn(node, [supervisorPath, '--launch-app', String(bundleId), ...ids({ address, udid })], { env, timeout: 45000, maxBuffer: 1024 * 1024 });
      return JSON.parse(stdout);
    } catch { return null; }
  }

  return { inspect, startArm, cancelArm, keepWarm, suspend, screenState, prepareScreen, launchApp, _inFlight: inFlight, _warming: warming };
}
