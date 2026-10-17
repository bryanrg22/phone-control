#!/usr/bin/env node
// supervisor.mjs — everything the host does TO a phone, one short-lived command
// at a time. The server runs it; a person can run it by hand to see what the
// server sees.
//
//   --status         --address IP --udid ID   → the phone's state, one JSON object on stdout
//   --once           --address IP --udid ID   → start automation; prints RUNNER_URL=<url>; exit 0 | 43
//   --tunnel-only    --address IP --udid ID   → build the tunnel, do not start the runner
//   --suspend        --address IP --udid ID   → stop the runner, LEAVE the tunnel warm; JSON
//   --screen-state   --address IP --udid ID   → what the phone's own screen says (locked? Wi-Fi?); JSON
//   --prepare-screen --address IP --udid ID   → swipe away another app's banner covering the top; JSON
//   --launch-app ID  --address IP --udid ID   → bring an app to the front through the runner; JSON
//
// How automation starts (docs/architecture.md has the long version):
//   1. tunnel.py builds a CoreDevice tunnel to the phone's address. A tunnel can
//      only be BORN while the phone is on Wi-Fi; once up it survives a move to
//      cellular, because it is addressed to the phone's VPN address.
//   2. If the developer disk image is not mounted (after every restart), mount it.
//      The phone must be unlocked for that.
//   3. go-ios launches the XCUITest runner and stays alive as its ANCHOR: the
//      runner lives exactly as long as that process. Stop it and the runner
//      stops, the "Automation Running" banner clears, and the tunnel stays up.
//   4. The runner answers HTTP on the phone at :22087.
//
// Runs as the user that owns the pairing records (root in the reference
// deployment): pymobiledevice3 looks for them under that user's home directory.
//
// No dependencies beyond Node's built-ins.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { connect as netConnect } from 'node:net';
import { hostname, platform, homedir } from 'node:os';
import { mkdirSync, writeFileSync, readFileSync, openSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScreenState, findBanner, bannerSwipe } from './screen-state.mjs';

const execFileP = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const LOG_DIR = process.env.SUPERVISOR_LOG_DIR || join(process.env.PHONE_CONTROL_STATE_DIR || join(REPO, 'var'), 'logs');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
function flag(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
}

// ─── configuration (flags first, then environment — never a built-in phone) ──
const UDID = flag('--udid', process.env.PHONE_UDID || '');
const ADDRESS = flag('--address', process.env.PHONE_ADDRESS || '');
// Stamped into the runner's launch environment as ARMED_FOR_SLOT when given, so
// whatever is on the phone can tell which registration started the session.
const ARMED_FOR_SLOT = flag('--slot', process.env.ARMED_FOR_SLOT || '');

// One endpoint file per phone, keyed by its address: it records the tunnel's
// RSD address:port so a later command can reattach to a WARM tunnel (~2 s)
// instead of rebuilding one (~12 s). A single shared file would hand one
// phone another phone's tunnel.
const ENDPOINT_FILE = process.env.ENDPOINT_FILE || join(LOG_DIR, `endpoint-${ADDRESS || 'none'}.json`);

const GO_IOS = process.env.GO_IOS || join(HERE, 'bin', 'go-ios');
const TUNNEL_PY = process.env.TUNNEL_PY || join(HERE, 'tunnel.py');
// Process patterns SCOPED to this phone AND to this installation. go-ios's argv
// carries --udid=… and the tunnel helper's is `<script> <udid> <address>`, so
// the UDID tells phones apart — an unscoped pattern would stop every phone's
// session. The helper is matched by its FULL script path, not by its file
// name: another program on the same host may hold its own tunnel to the same
// phone from a script that is also called something-tunnel.py, and that one is
// not ours to count or to stop. (UDIDs are [0-9A-F-], regex-inert.)
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ANCHOR_PATTERN = `ios[^ ]* runtest.*--udid=${UDID}`;
const TUNNEL_PATTERN = `${escapeRegex(TUNNEL_PY)} ${UDID}`;
const RUNNER_PORT = Number(process.env.RUNNER_PORT || '22087');
const RSD_LISTEN_PORT = Number(process.env.RSD_LISTEN_PORT || '49152'); // answers only on Wi-Fi
// How long a tunnel gets to answer before it is called dead. A live one
// answered in 65–101 ms over a Tailscale relay (DERP; ping 90–116 ms; measured
// 2026-10-17). It was 3 s, paid twice by every cold start (--status, then
// --once), which made a dead tunnel cost 6 s just to notice.
const TUNNEL_PROBE_MS = Math.max(200, Number(process.env.TUNNEL_PROBE_MS) || 1500);
// Off Wi-Fi a tunnel called dead cannot be rebuilt, so a short probe that got
// no answer is checked again with the old long wait before anything is torn down.
const TUNNEL_CONFIRM_MS = 4000;
// Test seam (lifecycle tests only): on loopback a tunnel answers in ~1 ms, so
// the short probe never misses there; this makes it miss, to exercise the check below.
const SHORT_PROBE_MISSES = process.env.SIM_SHORT_PROBE_MISSES === '1';
const shortProbe = () => (SHORT_PROBE_MISSES ? Promise.resolve(false) : tunnelLive(TUNNEL_PROBE_MS));
// The developer disk image, once seen mounted on a tunnel, is trusted on that
// same live tunnel for this long without asking the phone again (a Python
// call, ~3.3 s). Only a restart was seen to unmount it while a tunnel lived on,
// and a restart also kills the tunnel. If the session then reports the testing
// service missing, it is checked and mounted after all. 0 = always check.
const DDI_TRUST_SECONDS = Math.max(0, Number(process.env.DDI_TRUST_SECONDS ?? 900));
// Mounting downloads and signs the image (15–17 s measured). The keep-warm job
// passes a shorter limit so a phone that cannot answer does not hold it for long.
const MOUNT_TIMEOUT_SECONDS = Math.max(10, Number(process.env.MOUNT_TIMEOUT_SECONDS) || 180);
// MUST be Python 3.13+: the tunnel is TLS-PSK and only 3.13+ ships
// ssl.set_psk_client_callback. On 3.12 the fallback fails against OpenSSL 3.0
// AFTER "handshake completed" — i.e. it looks like a trust failure.
const TUNNEL_PYTHON = process.env.TUNNEL_PYTHON || 'python3';
// The XCUITest runner as it is signed for this installation. No default: the
// bundle id is the signer's, and guessing one fails in a confusing way.
const BUNDLE = process.env.RUNNER_BUNDLE || '';
const XCTEST_CFG = process.env.XCTEST_CFG || 'maestro-driver-iosUITests.xctest';
const TEST_TO_RUN = process.env.TEST_TO_RUN || 'maestro_driver_iosUITests/testHttpServer';
const TAILSCALE = process.env.TAILSCALE_BIN || 'tailscale';
// Where pymobiledevice3 keeps the record that makes the phone trust this host.
// It is created once, with the phone in hand (docs/install-phone.md); without
// it no tunnel can be built, and no amount of retrying changes that. Only its
// EXISTENCE is ever looked at here. (Run under sudo, pymobiledevice3 looks in
// the invoking user's home instead; the service runs as root directly.)
const PAIRING_RECORD = join(homedir(), '.pymobiledevice3', `remote_${UDID}.plist`);

mkdirSync(LOG_DIR, { recursive: true });
// Diagnostics go to STDERR only: stdout must carry exactly one JSON value or the
// RUNNER_URL line, because the caller parses it.
const err = (m) => process.stderr.write(`[${new Date().toISOString()}] ${m}\n`);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

// ─── arm progress: what a bring-up is doing RIGHT NOW ─────────────────────────
// A bring-up runs for 10 s to several minutes, and for most of that time the
// caller used to know nothing — not whether the request was sent, nor whether
// the phone was sitting on a prompt only its owner can answer. --once now
// records each stage here, and --status reports it, so "starting", "waiting for
// you on the phone" and "failed, because…" are different answers.
const PROGRESS_FILE = join(LOG_DIR, `arm-progress-${ADDRESS || 'none'}.json`);
const ARM_STARTED_AT = new Date().toISOString();
function progress(phase, extra = {}) {
  try {
    writeFileSync(PROGRESS_FILE, JSON.stringify({ phase, at: new Date().toISOString(), startedAt: ARM_STARTED_AT, pid: process.pid, udid: UDID, ...extra }));
  } catch { /* best effort — never fail an arm over its own diary */ }
}
function readProgress() {
  let p;
  try { p = JSON.parse(readFileSync(PROGRESS_FILE, 'utf8')); } catch { return null; }
  const terminal = ['armed', 'failed', 'suspended', 'tunnel-only'].includes(p.phase);
  let alive = false;
  if (!terminal && p.pid) { try { process.kill(p.pid, 0); alive = true; } catch { alive = false; } }
  return {
    // A non-terminal phase whose process is gone is a bring-up that died
    // mid-way (the server restarting under it, a crash) — say so.
    phase: !terminal && !alive ? 'interrupted' : p.phase,
    inFlight: alive,
    reason: p.reason ?? null,
    attempt: p.attempt ?? null,
    startedAt: p.startedAt ?? null,
    ageSec: p.at ? Math.max(0, Math.round((Date.now() - Date.parse(p.at)) / 1000)) : null,
  };
}

let rsdAddress = process.env.RSD_ADDRESS || '';
let rsdPort = process.env.RSD_PORT || '';
let phoneIP = ADDRESS;

// ─── primitives ──────────────────────────────────────────────────────────────

/**
 * TCP connect probe that keeps the THREE outcomes apart:
 *   'open'      something accepted
 *   'refused'   the far end answered and said no — it is THERE
 *   'no-answer' nothing came back (timeout, or the network said unreachable)
 * Folding the last two together is what made a dead phone read as "cellular".
 */
function tcpProbe(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const sock = netConnect({ host, port: Number(port) });
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; sock.destroy(); resolve(v); } };
    sock.setTimeout(timeoutMs, () => done('no-answer'));
    sock.on('connect', () => done('open'));
    sock.on('error', (e) => done(e && e.code === 'ECONNREFUSED' ? 'refused' : 'no-answer'));
  });
}

/** TCP connect probe. The only honest test of "does this actually route". */
const tcpOpen = (host, port, timeoutMs = 4000) => tcpProbe(host, port, timeoutMs).then((r) => r === 'open');

async function httpOk(url, timeoutMs = 6000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch { return false; }
}

const probeRunner = () => (phoneIP ? httpOk(`http://${phoneIP}:${RUNNER_PORT}/deviceInfo`) : Promise.resolve(false));

/**
 * Is our tunnel client address configured on some interface? Uses `ip -6 addr`
 * (iproute2, always present) rather than the Mac path's `ifconfig` — net-tools
 * is not installed by default on Ubuntu. Interface existence ONLY; see
 * tunnelLive() for whether it routes.
 */
async function tunnelUp() {
  return rsdAddress ? ifaceHas(rsdAddress) : false;
}

/** Is the client side of the tunnel to this RSD address configured on an interface? */
async function ifaceHas(rsd) {
  const client = rsd.replace(/::1$/, '::2');
  try {
    const { stdout } = await execFileP('ip', ['-6', 'addr'], { timeout: 5000 });
    return stdout.includes(client);
  } catch { return false; }
}

/**
 * AUTHORITATIVE liveness: does the tunnel actually reach the phone's RSD server?
 * An orphaned interface (helper SIGKILLed, or a roam that reset the CoreDevice
 * session) stays configured while routing nothing — adopting such a ghost is the
 * bug that caused the reattach-over-a-dead-pipe loop.
 */
const tunnelLive = (ms = 4000) => (rsdAddress && rsdPort ? tcpOpen(rsdAddress, rsdPort, ms) : Promise.resolve(false));

// When the testing service was last seen in this tunnel's service map (ISO), or null.
let ddiVerifiedAt = null;

function saveEndpoint(kind) {
  if (!rsdAddress || !rsdPort) return;
  // Keep an earlier verification only if it was made over this same tunnel.
  const prev = readEndpoint();
  const verified = ddiVerifiedAt || (prev?.rsdAddress === rsdAddress && String(prev?.rsdPort) === String(rsdPort) ? prev.ddiVerifiedAt ?? null : null);
  try {
    writeFileSync(ENDPOINT_FILE, JSON.stringify({
      rsdAddress, rsdPort: String(rsdPort), at: new Date().toISOString(), kind: kind || null,
      ddiVerifiedAt: verified,
      // Stamped so any reader can verify WHOSE tunnel this records.
      address: ADDRESS || null, udid: UDID,
    }));
  } catch { /* best effort */ }
}

function readEndpoint() {
  try {
    const j = JSON.parse(readFileSync(ENDPOINT_FILE, 'utf8'));
    // A file stamped for a DIFFERENT phone means ENDPOINT_FILE was pointed at a
    // shared path — refuse rather than adopt someone else's tunnel.
    if (j?.address && ADDRESS && j.address !== ADDRESS) {
      err(`ignoring endpoint file stamped for ${j.address} (this command is for ${ADDRESS})`);
      return null;
    }
    return j;
  } catch { return null; }
}

/**
 * A fresh process (--status / --suspend / a reattach --once) never built the
 * tunnel, so it must adopt one. GHOST REJECTION: only adopt if the endpoint both
 * still exists on an interface AND answers a TCP probe. If it cannot be proven
 * live, leave rsdAddress EMPTY so callers treat the tunnel as down and rebuild
 * rather than reattach to a corpse.
 */
// Set when we refuse a ghost whose INTERFACE is still configured. Distinguishes
// "an orphaned utun is lying around, a Wi-Fi rebuild will clear it" (stale) from
// "there is no tunnel at all" (down) — the app words those differently and the
// user's next action differs.
let ghostInterfacePresent = false;
// The RSD address of the ghost refused above, so a reap can wait for its interface to go.
let ghostRsd = '';
// True once THIS process proved the adopted tunnel live; ensureTunnel need not probe it again.
let adoptedLive = false;

/**
 * A short probe got no answer. On Wi-Fi that is the verdict (a dead tunnel is
 * rebuilt in ~3 s); off Wi-Fi a tunnel cannot be rebuilt, so look again with
 * the long wait before calling it dead.
 */
async function confirmLiveOffWifi() {
  lastNet = await phoneNet();
  if (lastNet === 'wifi') return false;
  err(`no answer from the tunnel within ${TUNNEL_PROBE_MS} ms and the phone is ${lastNet === 'cellular' ? 'on cellular' : 'not answering'}, where it could not be rebuilt — checking again for ${TUNNEL_CONFIRM_MS} ms`);
  return tunnelLive(TUNNEL_CONFIRM_MS);
}

async function discoverLiveTunnel() {
  if (rsdAddress) return;
  const saved = readEndpoint();
  if (!saved?.rsdAddress || !saved?.rsdPort) return;
  const prevA = rsdAddress, prevP = rsdPort;
  rsdAddress = saved.rsdAddress; rsdPort = String(saved.rsdPort);
  const ifacePresent = await tunnelUp();
  if (ifacePresent && (await shortProbe() || await confirmLiveOffWifi())) {
    err(`adopted live tunnel RSD ${rsdAddress}:${rsdPort}`);
    adoptedLive = true;
    return;
  }
  ghostInterfacePresent = ifacePresent;
  ghostRsd = ifacePresent ? rsdAddress : '';
  err(`NOT adopting ${rsdAddress}:${rsdPort} — ${ifacePresent ? 'interface up but does NOT route (ghost)' : 'interface missing'}`);
  rsdAddress = prevA; rsdPort = prevP;
}

/** Runner anchors FOR THIS DEVICE. execFile (no shell) so the pattern can
 *  never self-match. */
async function anchorPids() {
  try {
    const { stdout } = await execFileP('pgrep', ['-f', ANCHOR_PATTERN], { timeout: 5000 });
    return stdout.split('\n').filter(Boolean);
  } catch { return []; } // pgrep exits 1 when nothing matches
}
async function tunnelHelperPids() {
  try {
    const { stdout } = await execFileP('pgrep', ['-f', TUNNEL_PATTERN], { timeout: 5000 });
    return stdout.split('\n').filter(Boolean);
  } catch { return []; }
}

/**
 * Wi-Fi, cellular, or not there at all? The phone's RSD listener (:49152) is
 * served ONLY while Wi-Fi is associated — so how it
 * answers is the network discriminator, and it is exactly what a cold-start
 * needs. Three answers, each measured on the real phone over one unchanged
 * relay path (2026-10-11/12):
 *   accepts  → 'wifi'
 *   refuses  → 'cellular'      the phone is reachable and said no (ECONNREFUSED in ~2 s)
 *   silence  → 'unreachable'   powered off, flat battery, restarted and not yet
 *                              unlocked, or its VPN is down (timeout, mesh peer offline)
 * This used to return 'cellular' for silence too, which told the user to find
 * Wi-Fi when the phone was switched off.
 */
async function phoneNet() {
  if (!phoneIP) return null;
  const r = await tcpProbe(phoneIP, RSD_LISTEN_PORT, 4000);
  return r === 'open' ? 'wifi' : (r === 'refused' ? 'cellular' : 'unreachable');
}

async function meshPath() {
  if (!phoneIP) return null;
  try {
    const { stdout } = await execFileP(TAILSCALE, ['status'], { timeout: 8000 });
    const line = stdout.split('\n').find((l) => l.startsWith(phoneIP));
    if (!line) return { type: 'unknown', detail: null };
    const type = /relay "/.test(line) ? 'relay' : (/direct /.test(line) ? 'direct' : 'unknown');
    // The mesh's own opinion of whether the phone is there. It LAGS (seen ~30 s
    // behind a power-off), so it corroborates phoneNet; it does not replace it.
    return { type, online: !/\boffline\b/.test(line), detail: line.trim() };
  } catch { return null; }
}

// ─── stage 1: the tunnel ─────────────────────────────────────────────────────

/**
 * Build a tunnel against the phone's MESH IP. Mesh-addressing is what makes the
 * tunnel survive a Wi-Fi→cellular roam; an mDNS/Wi-Fi-addressed tunnel dies the
 * instant Wi-Fi drops. We never use mDNS here.
 * Detached + unref'd so the utun outlives this short-lived process.
 */
async function buildTunnel() {
  if (!phoneIP) { err('no phone mesh IP — cannot build'); return false; }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Device in the filename: with N phones arming concurrently, timestamp-only
  // names made it guesswork whose tunnel a log belonged to.
  const outPath = join(LOG_DIR, `tunnel-${stamp}-${UDID}.out`);
  const errPath = join(LOG_DIR, `tunnel-${stamp}-${UDID}.err`);
  const out = openSync(outPath, 'a');
  const errFd = openSync(errPath, 'a');
  err(`building tunnel to ${phoneIP} (explicit address, no mDNS) …`);
  const child = spawn(TUNNEL_PYTHON, [TUNNEL_PY, UDID, phoneIP],
    { detached: true, stdio: ['ignore', out, errFd] });
  child.unref();

  for (let i = 0; i < 90; i++) {
    await sleep(1);
    let text = '';
    try { text = readFileSync(outPath, 'utf8'); } catch { /* not yet */ }
    const m = text.match(/^RSD (\S+) (\d+)$/m);
    if (m) {
      rsdAddress = m[1]; rsdPort = m[2];
      err(`tunnel endpoint: RSD ${rsdAddress}:${rsdPort}`);
      // Routability gate: the interface appearing is not enough — the session
      // launch dials the ::1 endpoint and races route installation.
      for (let w = 0; w < 20; w++) {
        if (await tunnelUp() && await tunnelLive(2000)) {
          saveEndpoint('cold-build');
          err('tunnel routing — endpoint persisted');
          return true;
        }
        await sleep(1);
      }
      err('tunnel printed an endpoint but never became routable');
      return false;
    }
    try {
      if (readFileSync(errPath, 'utf8').includes('FAIL handshake')) {
        err(`handshake failed — verbatim: ${readFileSync(errPath, 'utf8').trim().split('\n').slice(-2).join(' | ')}`);
        return false;
      }
    } catch { /* ignore */ }
  }
  err('no RSD endpoint after 90s');
  return false;
}

// What phoneNet() said the last time ensureTunnel had to ask. null = never asked.
let lastNet = null;

async function ensureTunnel() {
  await discoverLiveTunnel();
  if (rsdAddress && (adoptedLive || await shortProbe() || await confirmLiveOffWifi())) {
    err(`tunnel already live (RSD ${rsdAddress}:${rsdPort}) — reattach path, no rebuild`);
    return 'warm';
  }
  // Stale/ghost or absent: reap orphaned helpers first, or two overlapping fd…::1
  // subnets race and the dial fails with "can't assign requested address".
  const orphans = await tunnelHelperPids();
  if (orphans.length) {
    err(`reaping ${orphans.length} orphaned tunnel helper(s) for ${UDID} before rebuild`);
    try { await execFileP('pkill', ['-f', TUNNEL_PATTERN], { timeout: 5000 }); } catch { /* none */ }
    // Wait until the helper is gone and has taken its interface down, rather
    // than a fixed 2 s: two overlapping fd…::1 subnets make the next dial fail.
    // Never longer than the old 2 s.
    const t0 = Date.now();
    while (Date.now() - t0 < 2000 && ((await tunnelHelperPids()).length || (ghostRsd && await ifaceHas(ghostRsd)))) await sleep(0.1);
    err(`orphaned helper gone after ${Date.now() - t0} ms`);
  }
  rsdAddress = ''; rsdPort = '';
  // A tunnel can only be BORN through the Wi-Fi-gated front door. Ask before
  // building: against a phone that is not answering, the helper would sit in
  // its handshake and we would report nothing for the full 90 s wait.
  lastNet = await phoneNet();
  if (lastNet !== 'wifi') {
    err(`not building: the phone's front door (:${RSD_LISTEN_PORT}) is ${lastNet === 'cellular' ? 'refusing (cellular)' : 'not answering (unreachable)'}`);
    return false;
  }
  return (await buildTunnel()) ? 'cold' : false;
}

// ─── stage 2: DDI / service map ──────────────────────────────────────────────

/**
 * The runner talks to com.apple.dt.testmanagerd.remote, which the phone only
 * serves while the DDI is mounted — and a phone REBOOT unmounts it. Without it
 * go-ios resolves port :0 and dies with "can't assign requested address" over a
 * perfectly healthy tunnel.
 */
async function ensureTestManagerd() {
  const pmd3 = [TUNNEL_PYTHON, ['-m', 'pymobiledevice3', 'remote', 'rsd-info', '--rsd', rsdAddress, String(rsdPort)]];
  let map = '';
  try {
    const { stdout } = await execFileP(pmd3[0], pmd3[1], { timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
    map = stdout;
  } catch (e) { err(`rsd-info failed: ${e.message}`); return false; }
  if (map.includes('com.apple.dt.testmanagerd.remote')) { ddiVerifiedAt = new Date().toISOString(); return true; }

  err('testmanagerd ABSENT (DDI not mounted) — attempting auto-mount (phone must be UNLOCKED) …');
  progress('mounting');
  try {
    await execFileP(TUNNEL_PYTHON,
      ['-m', 'pymobiledevice3', 'mounter', 'auto-mount', '--rsd', rsdAddress, String(rsdPort)],
      { timeout: MOUNT_TIMEOUT_SECONDS * 1000, maxBuffer: 8 * 1024 * 1024 });
  } catch (e) { err(`auto-mount failed: ${String(e.stderr || e.message).split('\n').slice(-2).join(' | ')}`); }
  try {
    const { stdout } = await execFileP(pmd3[0], pmd3[1], { timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
    const mounted = stdout.includes('com.apple.dt.testmanagerd.remote');
    if (mounted) ddiVerifiedAt = new Date().toISOString();
    return mounted;
  } catch { return false; }
}

// ─── stage 3: the session ────────────────────────────────────────────────────

// Tunable so the lifecycle tests do not have to sit through real-phone waits.
const RUNTEST_ATTEMPTS = Math.max(1, Number(process.env.RUNTEST_ATTEMPTS) || 3);
const RUNTEST_ATTEMPT_SECONDS = Math.max(4, Number(process.env.RUNTEST_ATTEMPT_SECONDS) || 60);
// How long "authorised, but no runner yet" may last before we say the phone
// needs its owner. Real starts go authorised → runner in 0–7 s (eight sessions,
// 2026-10-11/12). The two that took longer were a passcode prompt (12 s once
// answered; never, when dismissed) and a 55 s start on a phone that had been
// idle — so past ~10 s the honest reading is "locked or asking for the passcode".
const WAITING_ON_PHONE_AFTER_SECONDS = Math.max(1, Number(process.env.WAITING_ON_PHONE_AFTER_SECONDS) || 10);
let sawWaitingOnPhone = false;
// Set when go-ios could not find the testing service (the disk image is not mounted).
let servicesMissing = false;

/**
 * @param {object} [o]
 * @param {boolean} [o.stopOnMissingServices]  the disk image was trusted, not
 *   checked: if go-ios cannot find the testing service, stop at once so the
 *   caller can check and mount, instead of retrying attempts that cannot work.
 */
async function ensureSession({ stopOnMissingServices = false } = {}) {
  if (await probeRunner()) { err('runner already healthy'); return true; }
  if (!rsdAddress || !rsdPort) { err('no RSD endpoint — cannot launch'); return false; }
  if (!BUNDLE) { err('RUNNER_BUNDLE is not set — it must be the bundle id the XCUITest runner was signed with (see deploy/example.env)'); return false; }

  // LEFTOVER ANCHORS. The runner is not answering, so any anchor still running
  // for this phone is dead weight. An anchor only learns its session ended if
  // the phone can tell it: after a hard power-off it was still alive 8 minutes
  // later, survived the tunnel under it being rebuilt, and the next start left
  // TWO anchors for one phone (2026-10-12). Clear them before starting another.
  const leftover = await anchorPids();
  if (leftover.length) {
    err(`removing ${leftover.length} leftover anchor(s) for ${UDID} (runner is not answering)`);
    try { await execFileP('pkill', ['-f', ANCHOR_PATTERN], { timeout: 5000 }); } catch { /* raced */ }
    await sleep(1);
  }

  const argsList = [
    'runtest',
    `--bundle-id=${BUNDLE}`, `--test-runner-bundle-id=${BUNDLE}`,
    `--xctest-config=${XCTEST_CFG}`, `--test-to-run=${TEST_TO_RUN}`,
    `--udid=${UDID}`, `--address=${rsdAddress}`, `--rsd-port=${rsdPort}`,
    // Stamped into the runner's launch env and served at /hostInfo, so the phone
    // shows which host armed it with zero phone-side configuration.
    `--env=HOST_NAME=${hostname()}`,
    `--env=HOST_PLATFORM=${platform()}`,
    `--env=HOST_ARMED_ISO=${new Date().toISOString()}`,
    // Only stamp the slot when we actually know it — an empty --env would make
    // /hostInfo report armedFor:"" the same as an old supervisor, which is the
    // correct degraded reading anyway, but omitting it keeps the env clean.
    ...(ARMED_FOR_SLOT ? [`--env=ARMED_FOR_SLOT=${ARMED_FOR_SLOT}`] : []),
  ];
  // PATIENT reattach: over a relay the RsdCheckin handshake can stall at lockdown
  // and the process EXITS without the runner coming up. One fixed window is not
  // enough.
  for (let attempt = 1; attempt <= RUNTEST_ATTEMPTS; attempt++) {
    err(`runtest attempt ${attempt}/${RUNTEST_ATTEMPTS} …`);
    progress('session', { attempt });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    // Device in the filename, same reason as the tunnel logs above.
    const logPath = join(LOG_DIR, `runtest-${stamp}-${UDID}.log`);
    const fd = openSync(logPath, 'a');
    const child = spawn(GO_IOS, argsList, { detached: true, stdio: ['ignore', fd, fd] });
    child.unref();
    let authorisedAt = 0;
    let flagged = false;
    for (let i = 0; i < Math.ceil(RUNTEST_ATTEMPT_SECONDS / 2); i++) {
      await sleep(2);
      if (await probeRunner()) { err(`session armed on attempt ${attempt}`); return true; }
      if (child.exitCode !== null) {
        err(`runtest exited (code ${child.exitCode}) before the runner answered`);
        // The second way a phone that is LOCKED OR ASLEEP shows up: go-ios gives
        // up by itself with "cannot initiate a IDE session: Timed out waiting
        // for response" and exits 0 (three attempts in a row, phone locked,
        // 2026-10-12 08:45 UTC). Same meaning as "authorised, then silence".
        let text = '';
        try { text = readFileSync(logPath, 'utf8'); } catch { /* nothing written */ }
        // Port 0 is the signature: without the disk image go-ios resolves the
        // testing service to :0. A dead tunnel also fails "can't assign
        // requested address", but on a real port, so that alone is not enough.
        if (/port :0|\]:0: /.test(text)) {
          servicesMissing = true;
          err('go-ios could not find the testing service (the developer disk image is not mounted)');
          if (stopOnMissingServices) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } return false; }
        }
        if (/cannot initiate a IDE session|Timed out waiting for response/.test(text)) {
          sawWaitingOnPhone = true;
          err('the phone did not answer the session request — it is probably locked or asleep');
          progress('waiting-on-phone', { attempt });
        }
        break;
      }
      if (!flagged) {
        let text = '';
        try { text = readFileSync(logPath, 'utf8'); } catch { /* not written yet */ }
        if (!authorisedAt && text.includes('"msg":"authorized"')) authorisedAt = Date.now();
        if (authorisedAt && !text.includes('_XCT_didFormPlanWithData') && Date.now() - authorisedAt >= WAITING_ON_PHONE_AFTER_SECONDS * 1000) {
          flagged = true; sawWaitingOnPhone = true;
          err('session authorised but the runner has not started — the phone is probably locked or showing "Enter iPhone Passcode for XCTest"');
          progress('waiting-on-phone', { attempt });
        }
      }
    }
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    if (attempt < RUNTEST_ATTEMPTS) await sleep(2);
  }
  if (sawWaitingOnPhone) {
    err('NO ANSWER FROM THE PHONE — the session was authorised but the runner never started. Unlock the phone and, if it asks, enter the passcode to enable UI Automation; then retry.');
  }
  return false;
}

// ─── modes ───────────────────────────────────────────────────────────────────

async function buildStatus() {
  await discoverLiveTunnel();
  const tun = await tunnelUp();
  const live = tun ? await tunnelLive() : null;
  const runner = await probeRunner();
  const saved = readEndpoint();
  const ageSec = saved?.at ? Math.max(0, Math.round((Date.now() - Date.parse(saved.at)) / 1000)) : null;
  return {
    phoneIP: phoneIP || null,
    address: ADDRESS || null,
    // Never mDNS on this path: we always address the phone by its mesh IP, which
    // is reachable on ANY network (mDNS answers only on Wi-Fi).

    runnerURL: runner ? `http://${phoneIP}:${RUNNER_PORT}` : null,
    runnerHealthy: runner,
    // A rejected ghost leaves rsdAddress empty (so tunnelUp() is false), but an
    // orphaned interface IS lying around — report that as "stale", not "down".
    tunnelUp: tun,
    tunnelLive: live,
    tunnelState: tun ? (live ? 'live' : 'stale') : (ghostInterfacePresent ? 'stale' : 'down'),
    rsd: rsdAddress ? `${rsdAddress}:${rsdPort}` : null,
    runtestAnchors: String((await anchorPids()).length),
    lastArm: { kind: saved?.kind ?? 'none', rsd: saved?.rsdAddress ?? null, at: saved?.at ?? null },
    meshPath: await meshPath(),
    phoneNet: await phoneNet(),
    tunnelAgeSec: ageSec,
    hostPlatform: platform(),
    // Has this phone ever been paired with this host? False = setup was never
    // finished, which is a different problem from anything the phone is doing.
    pairingRecord: existsSync(PAIRING_RECORD),
    // The bring-up in flight (or the last one): its stage, and why it failed.
    arm: readProgress(),
    // How the last session ended — "the phone ended it" is a different event
    // from "the host put it down", and the user should be told which.
    lastSession: lastSession(),
  };
}

/**
 * The newest session log for this phone. When the phone ends a session itself
 * (both volume buttons held, the runner crashing) go-ios logs "lost connection
 * to testmanagerd" and exits — seen live 2026-10-12. A host-side suspend kills
 * the anchor instead, so its log simply stops.
 */
function lastSession() {
  try {
    const files = readdirSync(LOG_DIR).filter((f) => f.startsWith('runtest-') && f.endsWith(`-${UDID}.log`)).sort();
    if (!files.length) return null;
    const log = files[files.length - 1];
    const tail = readFileSync(join(LOG_DIR, log), 'utf8').slice(-4000);
    return { log, endedOnDevice: tail.includes('lost connection to testmanagerd') };
  } catch { return null; }
}

/** One JSON POST to the runner on the phone. Throws on a non-2xx answer. */
async function runnerPost(path, body, timeoutMs = 20000) {
  if (!phoneIP) throw new Error('requires --address / PHONE_ADDRESS');
  const r = await fetch(`http://${phoneIP}:${RUNNER_PORT}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`runner answered HTTP ${r.status} for ${path}`);
  return r;
}

/**
 * Clear the top of the screen before an agent starts: if another app's banner
 * (the Claude app's "Claude's reply" Live Activity) is expanded there, swipe it
 * up. Deterministic on purpose — one fixed gesture, checked afterwards, at most
 * three tries. Finds nothing → touches nothing.
 */
async function modePrepareScreen() {
  const out = { runnerHealthy: true, bannerFound: false, swipes: 0, cleared: null, text: null };
  try {
    for (let i = 0; i < 3; i++) {
      const tree = await (await runnerPost('/viewHierarchy', { appIds: [], excludeKeyboardElements: true })).json();
      const banner = findBanner(tree);
      if (!banner) { out.cleared = out.bannerFound ? true : null; break; }
      out.bannerFound = true; out.text = banner.text; out.frame = banner.frame;
      await runnerPost('/swipeV2', bannerSwipe(banner.frame));
      out.swipes += 1;
      out.cleared = false;
      await sleep(0.7);
    }
    if (out.bannerFound && out.cleared === false) {
      const tree = await (await runnerPost('/viewHierarchy', { appIds: [], excludeKeyboardElements: true })).json();
      out.cleared = !findBanner(tree);
    }
  } catch (e) {
    out.runnerHealthy = false; out.error = String(e.message || e).slice(0, 160);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

/** Bring an app to the front (the runner's /launchApp), then report what is in front. */
async function modeLaunchApp(bundleId) {
  const out = { runnerHealthy: true, bundleId, launched: false, foreground: null };
  try {
    if (!/^[A-Za-z0-9.-]{3,200}$/.test(String(bundleId || ''))) throw new Error('--launch-app needs a bundle id');
    await runnerPost('/launchApp', { bundleId });
    out.launched = true;
    await sleep(1.5);
    const r = await runnerPost('/runningApp', { appIds: [bundleId] });
    out.foreground = (await r.json()).runningAppBundleId || null;
  } catch (e) {
    if (!out.launched) out.runnerHealthy = false;
    out.error = String(e.message || e).slice(0, 160);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

/**
 * What the phone's own screen says. Needs the runner up; with it down there is
 * nothing to ask, and the answer says so rather than guessing.
 */
async function modeScreenState() {
  let out;
  try {
    if (!phoneIP) throw new Error('--screen-state requires --address / PHONE_ADDRESS');
    const r = await fetch(`http://${phoneIP}:${RUNNER_PORT}/viewHierarchy`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appIds: [], excludeKeyboardElements: true }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`runner answered HTTP ${r.status}`);
    out = { runnerHealthy: true, ...parseScreenState(await r.json()) };
  } catch (e) {
    out = { runnerHealthy: false, locked: null, lockSignals: [], wifi: null, cellular: null, error: String(e.message || e).slice(0, 160) };
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

async function modeStatus() {
  process.stdout.write(JSON.stringify(await buildStatus(), null, 2) + '\n');
}

async function modeSuspend() {
  await discoverLiveTunnel();
  const pids = await anchorPids();
  if (pids.length) {
    try { await execFileP('pkill', ['-f', ANCHOR_PATTERN], { timeout: 5000 }); } catch { /* raced */ }
  }
  await sleep(2); // let the anchor die and the runner notice
  // A failed start stays the last word on this phone. Every task ends with
  // this suspend, and overwriting the failure here made the very next status
  // check report the phone ready, so the assistant tried again (found by the
  // connector evals, case state-locked). A failure older than a few minutes
  // is ignored when the phone is described, so it cannot linger.
  if (ADDRESS && readProgress()?.phase !== 'failed') progress('suspended');
  const tun = await tunnelUp();
  const live = tun ? await tunnelLive() : null;
  const runner = await probeRunner();
  process.stdout.write(JSON.stringify({
    suspended: !runner,
    killedAnchors: pids.length,
    tunnelUp: tun,
    tunnelLive: live,
    tunnelState: !tun ? 'down' : (live ? 'live' : 'stale'),
    runnerHealthy: runner,
    rsd: rsdAddress ? `${rsdAddress}:${rsdPort}` : null,
    note: !tun
      ? 'runner killed but tunnel is DOWN — reattach will need Wi-Fi (cold rebuild)'
      : live
        ? 'runner killed, tunnel LEFT UP (live) — reattach over the warm tunnel from any network'
        : 'runner killed, tunnel interface up but STALE (not routing) — reattach will rebuild on Wi-Fi',
  }, null, 2) + '\n');
}

/// `--once` builds a tunnel AND starts the runner. `--tunnel-only` stops after
/// the tunnel: setting a phone up needs a tunnel to talk through, and must not
/// light the "Automation Running" banner as a side effect.
async function modeOnce({ tunnelOnly = false } = {}) {
  if (!phoneIP) {
    err(`${tunnelOnly ? '--tunnel-only' : '--once'} requires --address / PHONE_ADDRESS`);
    return 43;
  }
  if (await probeRunner()) {
    // Deliberately also the tunnel-only answer: a healthy runner proves a
    // working tunnel, and re-establishing one under a LIVE session risks
    // disturbing it. Nothing to do either way.
    err('runner already healthy — nothing to do');
    if (!tunnelOnly) progress('armed');
    process.stdout.write(`RUNNER_URL=http://${phoneIP}:${RUNNER_PORT}\n`);
    return 0;
  }
  progress('tunnel');
  const kind = await ensureTunnel();
  if (!kind) {
    const net = lastNet ?? await phoneNet();
    if (net === 'cellular') {
      // Documented wall, not a bug: the RSD listener is Wi-Fi-gated, so a tunnel
      // cannot be BORN on cellular. A warm one roams fine.
      err('COLD-START ON CELLULAR IS IMPOSSIBLE — the phone\'s RSD listener (:49152) is Wi-Fi-gated. Reconnect Wi-Fi to build a tunnel; a warm tunnel would have reattached.');
      progress('failed', { reason: 'needs-wifi' });
    } else if (net === 'unreachable') {
      err(`PHONE UNREACHABLE — nothing answers at ${phoneIP}. It is switched off, out of battery, restarted and not unlocked yet, or its VPN is off.`);
      progress('failed', { reason: 'unreachable' });
    } else {
      // The phone answered on Wi-Fi and still no tunnel: it does not accept this
      // host. Either it was never paired, or the pairing no longer matches.
      err(existsSync(PAIRING_RECORD)
        ? 'TUNNEL REFUSED — the phone is reachable on Wi-Fi but would not complete the handshake. If this persists, the pairing no longer matches (phone reset, or this host\'s hostname changed): pair again.'
        : `NOT PAIRED — no pairing record at ${PAIRING_RECORD}. This phone has not been set up with this host (docs/install-phone.md).`);
      progress('failed', { reason: 'tunnel-failed' });
    }
    return 43;
  }
  progress('services');
  // On a live tunnel, a recent sighting of the testing service is enough (see
  // DDI_TRUST_SECONDS). Never for --tunnel-only: the keep-warm job is what
  // keeps that sighting fresh.
  const saved = readEndpoint();
  const seenAgo = saved?.ddiVerifiedAt && saved.rsdAddress === rsdAddress ? (Date.now() - Date.parse(saved.ddiVerifiedAt)) / 1000 : Infinity;
  const trusted = !tunnelOnly && kind === 'warm' && seenAgo < DDI_TRUST_SECONDS;
  if (trusted) {
    err(`testing service seen on this tunnel ${Math.round(seenAgo)} s ago — not asking again`);
  } else if (!await ensureTestManagerd()) {
    err('testmanagerd absent and auto-mount did not fix it — unlock the phone and retry (a reboot unmounts the DDI)');
    progress('failed', { reason: 'locked' });
    return 43;
  }
  // The endpoint file is written BEFORE the arm, not after, because it is the
  // tunnel's record and callers test it to decide whether a tunnel exists.
  // Writing it only on the far side of `ensureSession` made "no tunnel could be
  // built" the failure message for an ARM failure.
  saveEndpoint(kind === 'warm' ? 'warm-reattach' : 'cold-build');
  if (tunnelOnly) {
    err('--tunnel-only: tunnel is up; NOT arming the runner');
    progress('tunnel-only');
    return 0;
  }
  let armed = await ensureSession({ stopOnMissingServices: trusted });
  if (!armed && trusted && servicesMissing) {
    err('the trusted disk image is gone after all — checking and mounting it');
    progress('services');
    if (!await ensureTestManagerd()) {
      err('testmanagerd absent and auto-mount did not fix it — unlock the phone and retry (a reboot unmounts the DDI)');
      progress('failed', { reason: 'locked' });
      return 43;
    }
    saveEndpoint('warm-reattach');
    servicesMissing = false;
    armed = await ensureSession();
  }
  if (!armed) {
    progress('failed', { reason: sawWaitingOnPhone ? 'waiting-on-phone' : 'session-failed' });
    return 43;
  }
  progress('armed');
  process.stdout.write(`RUNNER_URL=http://${phoneIP}:${RUNNER_PORT}\n`);
  return 0;
}

async function main() {
  if (!UDID) {
    err('no --udid / PHONE_UDID — refusing to guess which phone this is for');
    return 2;
  }

  if (has('--status')) { await modeStatus(); return 0; }
  if (has('--suspend')) { await modeSuspend(); return 0; }
  if (has('--screen-state')) { await modeScreenState(); return 0; }
  if (has('--prepare-screen')) { await modePrepareScreen(); return 0; }
  if (has('--launch-app')) { await modeLaunchApp(flag('--launch-app', '')); return 0; }
  if (has('--tunnel-only')) return await modeOnce({ tunnelOnly: true });
  if (has('--once')) return await modeOnce();
  process.stderr.write('usage: supervisor.mjs (--status | --once | --tunnel-only | --suspend | --screen-state | --prepare-screen | --launch-app ID) --address IP --udid ID\n');
  return 2;
}

main().then((c) => process.exit(c)).catch((e) => { err(`fatal: ${e.stack || e.message}`); process.exit(43); });
