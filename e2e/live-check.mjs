#!/usr/bin/env node
// live-check.mjs — the lifecycle scenarios against a REAL phone.
//
// Run it ON THE SERVER, as the user the service runs as, with the phone's owner
// holding the phone:
//
//   node e2e/live-check.mjs --email you@example.com            every step, in order
//   node e2e/live-check.mjs --email you@example.com --step baseline,start
//   node e2e/live-check.mjs --list
//
// It is the live twin of device/test/lifecycle.test.mjs: the same situations,
// but the phone is real, so a person does the physical part (Wi-Fi off, lock,
// restart) and this script collects what the server can see. It uses the same
// commands the server uses — device/supervisor.mjs — and nothing else.
//
// It starts and stops automation on the phone. Do not run it while a task is
// running. It never reads or prints a key, a credential or a pairing record.
//
//   --email E         which registered phone (see `phonectl device list`)
//   --address A --udid U   or name the phone directly
//   --settings F      the service's settings (default /etc/phone-control/phone-control.env)
//   --return-app ID   app the launch step brings forward (default com.anthropic.claude)
//   --yes             do not wait for a person: every instruction is treated as done
//                     and every yes/no as unanswered. For rehearsing against a simulator.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connect } from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDevices, findDeviceByEmail } from '../server/src/devices.mjs';

const execFileP = promisify(execFile);
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString().slice(11, 19);

// ─── settings: the service's own, so this sees what the server sees ──────────

function readEnvFile(path) {
  const out = {};
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
const ENV = { ...readEnvFile(flag('--settings', '/etc/phone-control/phone-control.env')), ...process.env };
const SUPERVISOR = ENV.CONNECTOR_SUPERVISOR || join(REPO, 'device', 'supervisor.mjs');
const FRONT_DOOR = Number(ENV.RSD_LISTEN_PORT || 49152);
const RETURN_APP = flag('--return-app', ENV.CONNECTOR_RETURN_APP || 'com.anthropic.claude');
const UNATTENDED = has('--yes');

function pickPhone() {
  if (flag('--address', '') && flag('--udid', '')) return { address: flag('--address'), udid: flag('--udid'), who: flag('--address') };
  const email = flag('--email', '');
  const d = email ? findDeviceByEmail(loadDevices(ENV.CONNECTOR_DEVICES || undefined), email) : null;
  if (!d) {
    console.error(email ? `No phone is registered for ${email} (phonectl device list).` : 'Name the phone: --email E, or --address A --udid U.');
    process.exit(2);
  }
  return { address: d.address, udid: d.udid, who: d.email };
}

// ─── what the server can see (all read-only) ─────────────────────────────────

function tcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const s = connect({ host, port });
    let done = false;
    const fin = (v) => { if (!done) { done = true; s.destroy(); resolve(v); } };
    s.setTimeout(timeoutMs, () => fin('no answer'));
    s.on('connect', () => fin('open'));
    s.on('error', (e) => fin(e.code === 'ECONNREFUSED' ? 'refused' : (e.code || 'error')));
  });
}

/** One supervisor command. Never throws. */
async function sup(phone, mode, { timeoutMs = 60000, extra = [] } = {}) {
  const args = [SUPERVISOR, mode, ...extra, '--address', phone.address, '--udid', phone.udid];
  try {
    const { stdout, stderr } = await execFileP(process.execPath, args, { env: ENV, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, stdout, stderr };
  } catch (e) {
    return { ok: false, code: e.code, stdout: String(e.stdout || ''), stderr: String(e.stderr || e.message || '') };
  }
}
const json = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };
const lastLine = (r) => r.stderr.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 220) || '(no output)';

async function snapshot(phone) {
  const [door, st] = await Promise.all([tcp(phone.address, FRONT_DOOR), sup(phone, '--status', { timeoutMs: 45000 })]);
  const s = json(st) || {};
  return {
    frontDoor: door, runner: s.runnerHealthy ?? null, tunnel: s.tunnelState ?? null, net: s.phoneNet ?? null,
    lastArm: s.lastArm?.kind ?? null, reachable: s.meshPath?.online ?? null, arm: s.arm ?? null, lastSession: s.lastSession ?? null,
  };
}
const line = (s) => `Wi-Fi door :${FRONT_DOOR} ${s.frontDoor} · network ${s.net} · tunnel ${s.tunnel} · automation ${s.runner ? 'RUNNING' : 'off'} · last start ${s.lastArm ?? 'none'}`;

// ─── the person holding the phone ────────────────────────────────────────────

const rl = UNATTENDED ? null : createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));
class Quit extends Error {}
/** Returns false when the person skips the step. */
async function doThis(instructions) {
  console.log(`\n  ▶ ON THE PHONE: ${instructions}`);
  if (UNATTENDED) return true;
  const a = (await ask('    [Enter] when done · s = skip this step · q = quit: ')).toLowerCase();
  if (a === 'q') throw new Quit();
  return a !== 's';
}
/** true / false, or null when nobody is there to answer. */
async function yesNo(q) {
  if (UNATTENDED) return null;
  return /^y/i.test(await ask(`    ${q} (y/n): `));
}

const report = [];
function record(step, verdict, detail) {
  report.push({ step, verdict, detail, at: new Date().toISOString() });
  console.log(`  ${{ PASS: '✓', FAIL: '✗', INFO: '•', SKIP: '–' }[verdict]} [${now()}] ${verdict}  ${detail}`);
}
/** A yes/no from the person becomes a verdict; no answer becomes a note. */
function judge(step, answer, wantYes, text) {
  if (answer === null) return record(step, 'INFO', `${text}: nobody was asked (--yes)`);
  return record(step, answer === wantYes ? 'PASS' : 'FAIL', `${text}: the owner says ${answer ? 'yes' : 'no'}`);
}

async function start(phone, step) {
  const t0 = Date.now();
  const r = await sup(phone, '--once', { timeoutMs: 300000 });
  record(step, r.ok ? 'PASS' : 'FAIL', r.ok ? `automation started in ${((Date.now() - t0) / 1000).toFixed(0)}s` : `did not start: ${lastLine(r)}`);
  return r.ok;
}
async function putDown(phone, step) {
  const s = json(await sup(phone, '--suspend'));
  record(step, s?.suspended ? 'PASS' : 'FAIL', s ? `automation put down · tunnel ${s.tunnelState}` : 'suspend gave no answer');
  return s;
}

// ─── steps ───────────────────────────────────────────────────────────────────
// In order, each leaves the phone the way the next one expects it.

const STEPS = [
  ['baseline', 'What the server sees before touching anything', async (phone) => {
    const s = await snapshot(phone);
    record('baseline', 'INFO', line(s));
    record('baseline', s.reachable === false ? 'FAIL' : 'INFO', `VPN says the phone is ${s.reachable === null ? 'unknown' : s.reachable ? 'online' : 'OFFLINE'}`);
  }],

  ['looking', 'Asking about the phone must not start anything on it', async (phone) => {
    if (!await doThis('Unlock the phone, on Wi-Fi, on the home screen. Make sure no "Automation Running" banner is showing.')) return record('looking', 'SKIP', 'skipped');
    const before = await snapshot(phone);
    if (before.runner) return record('looking', 'SKIP', 'automation is already running; put it down first');
    for (let i = 0; i < 3; i++) await sup(phone, '--status', { timeoutMs: 45000 });
    const after = await snapshot(phone);
    record('looking', after.runner ? 'FAIL' : 'PASS', `after four status checks automation is ${after.runner ? 'RUNNING' : 'still off'}`);
    judge('looking', await yesNo('Is the "Automation Running" banner showing?'), false, 'banner showing');
  }],

  ['start', 'Start on Wi-Fi, then put it down: the banner appears and clears', async (phone) => {
    if (!await doThis('Stay unlocked on Wi-Fi. If the phone asks for its passcode to "Enable UI Automation", enter it.')) return record('start', 'SKIP', 'skipped');
    if (!await start(phone, 'start')) return;
    record('start', 'INFO', line(await snapshot(phone)));
    judge('start', await yesNo('Is the "Automation Running" banner showing now?'), true, 'banner showing while running');
    await putDown(phone, 'start');
    judge('start', await yesNo('Is the banner gone?'), true, 'banner gone after put-down');
  }],

  ['cellular', 'Leave Wi-Fi: the warm tunnel survives and a start reuses it', async (phone) => {
    const pre = await snapshot(phone);
    if (pre.tunnel !== 'live') record('cellular', 'INFO', `the tunnel is ${pre.tunnel}, not warm — expect a refusal that says Wi-Fi is needed, not a start`);
    if (!await doThis('Turn Wi-Fi OFF so the phone is on cellular. Keep it unlocked.')) return record('cellular', 'SKIP', 'skipped');
    await sleep(8000);
    const roamed = await snapshot(phone);
    record('cellular', roamed.frontDoor !== 'open' ? 'PASS' : 'FAIL', `Wi-Fi door is ${roamed.frontDoor} (must not be open on cellular) · network reported as ${roamed.net}`);
    record('cellular', roamed.tunnel === pre.tunnel ? 'PASS' : 'FAIL', `tunnel after leaving Wi-Fi: ${roamed.tunnel} (was ${pre.tunnel})`);
    const started = await start(phone, 'cellular');
    const s = await snapshot(phone);
    if (pre.tunnel === 'live') record('cellular', s.lastArm === 'warm-reattach' ? 'PASS' : 'FAIL', `start kind: ${s.lastArm} (want warm-reattach)`);
    else record('cellular', !started && s.arm?.reason === 'needs-wifi' ? 'PASS' : 'FAIL', `refusal reason: ${s.arm?.reason ?? 'none recorded'} (want needs-wifi)`);
    if (started) await putDown(phone, 'cellular');
    await doThis('Turn Wi-Fi back ON.');
  }],

  ['lock', 'Locking mid-session does not end it, and the server can tell', async (phone) => {
    if (!await doThis('Unlock the phone, on Wi-Fi.')) return record('lock', 'SKIP', 'skipped');
    if (!await start(phone, 'lock')) return;
    const open = json(await sup(phone, '--screen-state'));
    record('lock', open?.locked === false ? 'PASS' : 'FAIL', `unlocked phone reads as locked=${open?.locked}`);
    if (!await doThis('Press the side button once to lock the phone.')) { await putDown(phone, 'lock'); return record('lock', 'SKIP', 'skipped'); }
    await sleep(3000);
    const shut = json(await sup(phone, '--screen-state'));
    record('lock', shut?.locked === true ? 'PASS' : 'FAIL', `locked phone reads as locked=${shut?.locked} (${(shut?.lockSignals || []).join(', ') || 'no signals'})`);
    record('lock', shut?.runnerHealthy ? 'PASS' : 'FAIL', `automation ${shut?.runnerHealthy ? 'is still running' : 'ENDED'} while locked`);
    await putDown(phone, 'lock');
  }],

  ['locked-start', 'A locked phone cannot start a session, and says why', async (phone) => {
    if (!await doThis('Leave the phone LOCKED with the screen off.')) return record('locked-start', 'SKIP', 'skipped');
    const r = await sup(phone, '--once', { timeoutMs: 300000 });
    const s = await snapshot(phone);
    record('locked-start', !r.ok ? 'PASS' : 'FAIL', r.ok ? 'it started on a locked phone — not what was measured before' : `refused: ${lastLine(r)}`);
    record('locked-start', ['waiting-on-phone', 'locked'].includes(s.arm?.reason) ? 'PASS' : 'FAIL', `recorded reason: ${s.arm?.reason ?? 'none'} (want waiting-on-phone or locked)`);
    record('locked-start', s.runner ? 'FAIL' : 'PASS', `afterwards automation is ${s.runner ? 'RUNNING' : 'off'}`);
    if (s.runner) await putDown(phone, 'locked-start');
  }],

  ['stop-on-phone', 'Stopping from the phone is told apart from the server stopping', async (phone) => {
    if (!await doThis('Unlock the phone, on Wi-Fi.')) return record('stop-on-phone', 'SKIP', 'skipped');
    if (!await start(phone, 'stop-on-phone')) return;
    if (!await doThis('Hold BOTH volume buttons until the "Automation Running" banner goes away.')) { await putDown(phone, 'stop-on-phone'); return record('stop-on-phone', 'SKIP', 'skipped'); }
    await sleep(4000);
    const s = await snapshot(phone);
    record('stop-on-phone', !s.runner ? 'PASS' : 'FAIL', `automation is ${s.runner ? 'STILL RUNNING' : 'off'}`);
    record('stop-on-phone', s.lastSession?.endedOnDevice ? 'PASS' : 'FAIL', `last session ended on the phone: ${s.lastSession?.endedOnDevice ?? 'unknown'}`);
    record('stop-on-phone', 'INFO', `tunnel afterwards: ${s.tunnel}`);
    if (s.runner) await putDown(phone, 'stop-on-phone');
  }],

  ['launch-app', `The server can bring an app to the front (${RETURN_APP})`, async (phone) => {
    if (!await doThis('Unlock the phone and go to the home screen.')) return record('launch-app', 'SKIP', 'skipped');
    if (!await start(phone, 'launch-app')) return;
    const r = json(await sup(phone, '--launch-app', { extra: [RETURN_APP] }));
    record('launch-app', r?.launched && r.foreground === RETURN_APP ? 'PASS' : 'FAIL', `launched=${r?.launched} · in front: ${r?.foreground ?? 'unknown'}${r?.error ? ` · ${r.error}` : ''}`);
    judge('launch-app', await yesNo('Did that app come to the front?'), true, 'app came to the front');
    await putDown(phone, 'launch-app');
  }],

  ['restart', 'After a restart: unreachable until unlocked, then one passcode prompt', async (phone) => {
    if (!await doThis('Restart the phone. When the lock screen shows, do NOT unlock it.')) return record('restart', 'SKIP', 'skipped');
    const sealed = await snapshot(phone);
    record('restart', sealed.net === 'unreachable' ? 'PASS' : 'INFO', `before the first unlock: network ${sealed.net} · Wi-Fi door ${sealed.frontDoor}`);
    if (!await doThis('Unlock the phone. Stay on the home screen, on Wi-Fi. Wait 20 seconds.')) return;
    await sleep(UNATTENDED ? 0 : 20000);
    record('restart', 'INFO', `after unlocking: ${line(await snapshot(phone))}`);
    console.log('    Starting now. The phone will ask for its passcode to "Enable UI Automation": enter it.');
    if (await start(phone, 'restart')) await putDown(phone, 'restart');
  }],
];

// ─── main ────────────────────────────────────────────────────────────────────

if (has('--list')) {
  for (const [id, title] of STEPS) console.log(`${id.padEnd(14)} ${title}`);
  process.exit(0);
}

const phone = pickPhone();
const only = flag('--step', '').split(',').filter(Boolean);
const unknown = only.filter((id) => !STEPS.some(([s]) => s === id));
if (unknown.length) { console.error(`Unknown step: ${unknown.join(', ')}. See --list.`); process.exit(2); }
console.log(`live check — ${phone.who} · ${phone.address} · UDID ${phone.udid.slice(0, 8)}…${UNATTENDED ? ' · UNATTENDED (--yes)' : ''}`);

try {
  for (const [id, title, fn] of STEPS) {
    if (only.length && !only.includes(id)) continue;
    console.log(`\n── ${id}: ${title}`);
    try { await fn(phone); } catch (e) {
      if (e instanceof Quit) throw e;
      record(id, 'FAIL', `step crashed: ${e.message}`);
    }
  }
} catch (e) {
  if (!(e instanceof Quit)) throw e;
  console.log('\n(stopped early)');
}
rl?.close();

const out = flag('--out', `live-check-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ address: phone.address, unattended: UNATTENDED, report }, null, 2));
const n = (v) => report.filter((r) => r.verdict === v).length;
console.log(`\n${n('PASS')} pass · ${n('FAIL')} fail · ${n('INFO')} notes · ${n('SKIP')} skipped — full record in ${out}`);
process.exit(n('FAIL') ? 1 : 0);
