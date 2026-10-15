#!/usr/bin/env node
// test-phone-state.mjs — device-free tests for the two pure pieces that turn
// measurements into answers: scripts/phone-screen-state.mjs (what the phone's
// screen says) and connector/preflight.mjs (what to tell the user), plus the
// resolver wiring that decides when to start automation.
//
// The status objects below are the SHAPES the real host returned for the real
// phone on 2026-10-11/12, one per state that was actually produced on the
// device; the comment on each says how.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseScreenState, collectStrings, findBanner, bannerSwipe } from '../../device/screen-state.mjs';
import { describePhoneState, parseDeviceOverrides, createSupervisorClient } from '../src/preflight.mjs';
import { createDeviceResolver } from '../src/device-resolver.mjs';
import { createToolApi } from '../src/tool-api.mjs';
import { fingerprint, serverFiles, agentFiles, createVersionInfo, releaseOf, commitOf, toolsFingerprint } from '../src/version.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

// ─── the screen ──────────────────────────────────────────────────────────────

// Strings exactly as the runner returned them with the phone locked, screen off.
const LOCKED_TREE = { axElement: { children: [
  { identifier: 'SBCoverSheetWindow', children: [
    { identifier: 'jindo-container-view:1,client-identifier:com.apple' },
    { label: 'Swipe up to unlock' }, { identifier: 'proud-lock', label: 'Locked' },
    { identifier: 'lockscreen-date-view', children: [{ label: 'Sun Oct 11' }, { label: '9:56 PM' }] },
    { identifier: 'flashlight-orb-button', label: 'Flashlight', value: 'Off' },
  ] },
  { children: [
    { label: 'T-Mobile' }, { label: 'Cellular', value: '3 of 4 bars, signal strength' },
    { label: 'Wi-Fi', identifier: '3 of 3 Wi-Fi bars', value: 'SSID, 3 of 3 Wi-Fi bars' },
  ] },
] } };

await ok('locked screen: locked, with the signals that said so', () => {
  const s = parseScreenState(LOCKED_TREE);
  assert.equal(s.locked, true);
  assert.deepEqual(s.lockSignals.sort(), ['identifier:lockscreen-date-view', 'label:Swipe up to unlock', 'proud-lock:Locked']);
});

await ok('status bar: Wi-Fi and cellular bars are read separately', () => {
  const s = parseScreenState(LOCKED_TREE);
  assert.deepEqual(s.wifi, { bars: 3, of: 3 });
  assert.deepEqual(s.cellular, { bars: 3, of: 4 }, 'the Wi-Fi bars were mistaken for the cellular ones, or the reverse');
});

await ok('no Wi-Fi indicator → wifi is null, cellular still read', () => {
  const s = parseScreenState({ a: [{ label: 'Cellular', value: '2 of 4 bars, signal strength' }, { label: 'Maps' }] });
  assert.equal(s.wifi, null);
  assert.deepEqual(s.cellular, { bars: 2, of: 4 });
  assert.equal(s.locked, false);
});

await ok('an empty or missing tree is "cannot tell", never "unlocked"', () => {
  assert.equal(parseScreenState({}).locked, null);
  assert.equal(parseScreenState(null).locked, null);
  assert.equal(parseScreenState({ axElement: { children: [] } }).locked, null);
});

await ok('"Locked" on its own (an app\'s label) is not the lock screen', () => {
  assert.equal(parseScreenState({ c: [{ label: 'Locked' }, { label: 'Notes' }] }).locked, false);
});

await ok('the walker survives cycles and odd shapes', () => {
  const a = { label: 'x' }; a.self = a; a.list = [null, 3, 'str', { value: 'y' }];
  assert.deepEqual(collectStrings(a).map((s) => s.text).sort(), ['x', 'y']);
});

await ok('another app\'s banner over the top is found with the frame to swipe; no match means nothing to touch', () => {
  const pill = { identifier: 'x', frame: { X: 16, Y: 20, Width: 361, Height: 88 }, children: [{ label: 'Claude’s reply', frame: { X: 0, Y: 0, Width: 0, Height: 0 } }, { label: 'Bash' }] };
  const hit = findBanner({ axElement: { children: [{ label: 'Wi-Fi' }, pill] } });
  assert.equal(hit.text, 'Claude’s reply');
  assert.deepEqual(hit.frame, { x: 16, y: 20, width: 361, height: 88 }, 'a zero-size child frame must fall back to its container');
  assert.ok(findBanner({ a: [{ label: "Claude's reply", frame: { X: 1, Y: 2, Width: 3, Height: 4 } }] }), 'the straight apostrophe must match too');
  assert.equal(findBanner(LOCKED_TREE), null);
  assert.equal(findBanner({ a: [{ label: 'Claude’s reply' }] }), null, 'text with no position on screen cannot be swiped and must not be guessed at');
  assert.equal(findBanner(null), null);
});

await ok('the banner swipe starts in the middle of the banner and goes straight up off the top', () => {
  const g = bannerSwipe({ x: 16, y: 20, width: 361, height: 88 });
  assert.deepEqual([g.startX, g.startY, g.endX, g.endY], [197, 64, 197, 0]);
  assert.ok(g.duration > 0 && g.duration < 1);
});

// ─── what to tell the user ───────────────────────────────────────────────────

const base = { runnerHealthy: false, tunnelState: 'down', phoneNet: 'wifi', arm: null, lastSession: null, meshPath: { type: 'relay', online: true } };
const armInFlight = (phase) => ({ phase, inFlight: true, reason: null, attempt: 1, startedAt: '2026-10-12T05:05:00.000Z', ageSec: 4 });
const armFailed = (reason, ageSec = 20) => ({ phase: 'failed', inFlight: false, reason, attempt: 2, startedAt: '2026-10-12T05:05:00.000Z', ageSec });

await ok('armed on Wi-Fi → ready, no caveat', () => {
  const d = describePhoneState({ ...base, runnerHealthy: true, tunnelState: 'live' });
  assert.deepEqual([d.state, d.ready], ['ready', true]);
  assert.doesNotMatch(d.message, /cellular/);
});

await ok('armed on cellular → ready, with the "a drop will need Wi-Fi" warning', () => {
  const d = describePhoneState({ ...base, runnerHealthy: true, tunnelState: 'live', phoneNet: 'cellular' });
  assert.equal(d.ready, true);
  assert.match(d.message, /cellular/);
  assert.match(d.message, /Wi-Fi/);
});

await ok('bring-up in flight → waking; stuck on the owner → waiting_on_phone', () => {
  assert.equal(describePhoneState({ ...base, arm: armInFlight('tunnel') }).state, 'waking');
  assert.match(describePhoneState({ ...base, arm: armInFlight('mounting') }).message, /unlocked/);
  const w = describePhoneState({ ...base, tunnelState: 'live', arm: armInFlight('waiting-on-phone') });
  assert.equal(w.state, 'waiting_on_phone');
  assert.match(w.message, /passcode/);
  assert.equal(w.startable, false, 'a second start must never be offered while one is running');
});

await ok('powered off / flat / not unlocked since restart → unreachable, and NOT "find Wi-Fi"', () => {
  // The host's exact report for a switched-off phone, after the label fix.
  const d = describePhoneState({ ...base, phoneNet: 'unreachable', tunnelState: 'stale', meshPath: { type: 'relay', online: false } });
  assert.equal(d.state, 'unreachable');
  assert.equal(d.startable, false);
  assert.match(d.message, /unlock/i);
  assert.doesNotMatch(d.message, /Wi-Fi/);
});

await ok('cellular with nothing warm → needs_wifi; cellular with a warm tunnel → startable', () => {
  const cold = describePhoneState({ ...base, phoneNet: 'cellular', tunnelState: 'down' });
  assert.deepEqual([cold.state, cold.startable], ['needs_wifi', false]);
  const warm = describePhoneState({ ...base, phoneNet: 'cellular', tunnelState: 'live' });
  assert.deepEqual([warm.state, warm.startable], ['needs_wake', true]);
});

await ok('Wi-Fi with a dead or missing tunnel → startable (a cold build works there)', () => {
  for (const t of ['down', 'stale']) assert.equal(describePhoneState({ ...base, tunnelState: t }).startable, true, t);
});

await ok('a fresh failure names its cause; an old one is ignored', () => {
  const p = describePhoneState({ ...base, tunnelState: 'live', arm: armFailed('waiting-on-phone') });
  assert.equal(p.state, 'needs_attention');
  assert.match(p.message, /passcode/);
  assert.match(describePhoneState({ ...base, arm: armFailed('locked') }).message, /restarted/);
  const sf = describePhoneState({ ...base, tunnelState: 'live', arm: armFailed('session-failed') });
  assert.deepEqual([sf.state, sf.startable], ['needs_attention', true]);
  assert.match(sf.message, /unlocked and awake/);
  assert.equal(describePhoneState({ ...base, arm: armFailed('waiting-on-phone', 900) }).state, 'needs_wake');
});

await ok('a phone that was never paired: says so before anything is tried, and is not startable', () => {
  const d = describePhoneState({ ...base, pairingRecord: false });
  assert.deepEqual([d.state, d.ready, d.startable], ['needs_setup', false, false]);
  assert.match(d.message, /not been paired with the server/);
  // …even when the phone is otherwise in a state that reads as fine or as something else
  assert.equal(describePhoneState({ ...base, pairingRecord: false, phoneNet: 'cellular' }).state, 'needs_setup');
  assert.equal(describePhoneState({ ...base, pairingRecord: false, phoneNet: 'unreachable' }).state, 'needs_setup');
  // A working phone is never blocked by this check: a live tunnel or a running
  // session proves a record exists wherever pymobiledevice3 found it.
  assert.equal(describePhoneState({ ...base, pairingRecord: false, tunnelState: 'live' }).state, 'needs_wake');
  assert.equal(describePhoneState({ ...base, pairingRecord: false, runnerHealthy: true, tunnelState: 'live' }).state, 'ready');
  // An older supervisor that does not report the field changes nothing.
  assert.equal(describePhoneState({ ...base }).state, 'needs_wake');
  assert.equal(describePhoneState({ ...base, pairingRecord: true }).state, 'needs_wake');
});

await ok('the phone refuses the server\'s connection: reported once as needing attention, not retried forever', () => {
  const d = describePhoneState({ ...base, pairingRecord: true, arm: armFailed('tunnel-failed') });
  assert.deepEqual([d.state, d.startable], ['needs_attention', true]);
  assert.match(d.message, /would not accept the server's connection/);
  assert.match(d.message, /pairing/);
  assert.equal(describePhoneState({ ...base, pairingRecord: true, arm: armFailed('tunnel-failed', 900) }).state, 'needs_wake', 'a stale failure still blocked');
});

await ok('a failure does not hide an unreachable phone', () => {
  assert.equal(describePhoneState({ ...base, phoneNet: 'unreachable', arm: armFailed('unreachable') }).state, 'unreachable');
});

await ok('stopped on the phone (both volume buttons) is said out loud', () => {
  const d = describePhoneState({ ...base, tunnelState: 'live', phoneNet: 'cellular', lastSession: { log: 'x', endedOnDevice: true } });
  assert.match(d.message, /stopped on the phone/);
  assert.equal(d.startable, true);
});

await ok('no status at all → unknown, not a guess', () => {
  assert.equal(describePhoneState(null).state, 'unknown');
  assert.equal(describePhoneState({ ...base, phoneNet: null }).state, 'unknown');
});

// ─── resolver wiring ─────────────────────────────────────────────────────────

const REG = { devices: [
  { uid: 'u1', email: 'One@Example.com', address: '100.64.0.12', udid: 'UDID-1' },
] };
function resolver({ status, startArm, overrides } = {}) {
  const calls = { inspect: [], arm: [] };
  const r = createDeviceResolver({
    loadRegistry: () => REG,
    probe: async () => { throw new Error('the legacy probe must not run on the preflight path'); },
    inspect: async (q) => { calls.inspect.push(q); return typeof status === 'function' ? status() : status; },
    startArm: startArm === false ? null : (q) => { calls.arm.push(q); return { started: true }; },
    overrides,
  });
  return { r, calls };
}

await ok('ready phone: no bring-up is started', async () => {
  const { r, calls } = resolver({ status: { ...base, runnerHealthy: true } });
  const s = await r.status('u1');
  assert.deepEqual([s.ready, s.state, s.address], [true, 'ready', '100.64.0.12']);
  assert.equal(calls.arm.length, 0);
});

await ok('ASKING about a startable phone starts nothing: it reports standby', async () => {
  for (const st of [{ ...base }, { ...base, phoneNet: 'cellular', tunnelState: 'live' }, { ...base, tunnelState: 'live', lastSession: { log: 'x', endedOnDevice: true } }]) {
    const { r, calls } = resolver({ status: st });
    const s = await r.status('u1');
    assert.deepEqual([s.ready, s.running, s.startable, s.state], [false, false, true, 'standby']);
    assert.equal(calls.arm.length, 0, 'a status question put the automation banner on the phone');
    assert.match(s.message, /nothing is showing on the phone/);
    assert.doesNotMatch(s.message, /not running on the phone right now/);
    if (st.phoneNet === 'cellular') assert.match(s.message, /cellular/);
    if (st.lastSession) assert.match(s.message, /stopped on the phone/);
  }
});

await ok('starting a task on a startable phone: one bring-up, with the registry slot, and the answer is "waking"', async () => {
  const { r, calls } = resolver({ status: { ...base } });
  const s = await r.status('u1', { start: true });
  assert.deepEqual([s.ready, s.state], [false, 'waking']);
  assert.deepEqual(calls.arm, [{ address: '100.64.0.12', udid: 'UDID-1', slot: 'u1' }]);
});

await ok('unreachable / needs_wifi / in flight: nothing is started', async () => {
  for (const st of [{ ...base, phoneNet: 'unreachable' }, { ...base, phoneNet: 'cellular' }, { ...base, arm: armInFlight('session') }]) {
    const { r, calls } = resolver({ status: st });
    const s = await r.status('u1', { start: true });
    assert.equal(s.ready, false);
    assert.equal(calls.arm.length, 0, `started a bring-up for state ${s.state}`);
  }
});

await ok('arming not allowed: startable is reported as needs_wake with the manual step', async () => {
  const { r } = resolver({ status: { ...base }, startArm: false });
  const s = await r.status('u1');
  assert.equal(s.state, 'needs_wake');
  assert.match(s.message, /set not to start automation/);
});

await ok('a start that died waiting on the owner is reported ONCE, then retried when asked again', async () => {
  const failed = { ...base, tunnelState: 'live', arm: armFailed('waiting-on-phone') };
  const { r, calls } = resolver({ status: failed });
  assert.equal((await r.status('u1')).state, 'needs_attention', 'just asking must report the failure');
  assert.equal((await r.status('u1')).state, 'needs_attention', 'just asking must not use up the one report');
  const first = await r.status('u1', { start: true });
  assert.equal(first.state, 'needs_attention');
  assert.equal(calls.arm.length, 0, 'the passcode prompt would be put straight back on an unattended phone');
  const second = await r.status('u1', { start: true });
  assert.equal(second.state, 'waking');
  assert.equal(calls.arm.length, 1);
});

await ok('an operator override redirects to the phone\'s real address (by email, any case)', async () => {
  const { r, calls } = resolver({ status: { ...base, runnerHealthy: true }, overrides: parseDeviceOverrides('{"one@example.com":{"address":"100.64.0.20"}}') });
  const s = await r.status('u1');
  assert.equal(s.address, '100.64.0.20');
  assert.equal(calls.inspect[0].address, '100.64.0.20');
});

await ok('overrides are validated, not trusted', () => {
  assert.deepEqual(parseDeviceOverrides(''), {});
  assert.throws(() => parseDeviceOverrides('{not json'), /not valid JSON/);
  assert.throws(() => parseDeviceOverrides('{"a":{"address":"10.0.0.1; rm -rf /"}}'), /not an IPv4/);
  assert.throws(() => parseDeviceOverrides('{"a":{"address":"999.1.1.1"}}'), /not an IPv4/);
});

// ─── the host client ─────────────────────────────────────────────────────────

await ok('startArm runs the one fixed command and never two at once per phone', () => {
  const spawned = [];
  const spawnFn = (node, args) => { const c = new EventEmitter(); spawned.push({ args, c }); return c; };
  const sup = createSupervisorClient({ supervisorPath: '/x/sup.mjs', node: 'node', spawnFn });
  assert.deepEqual(sup.startArm({ address: '1.2.3.4', udid: 'U', slot: 'u' }), { started: true });
  assert.deepEqual(spawned[0].args, ['/x/sup.mjs', '--once', '--address', '1.2.3.4', '--udid', 'U', '--slot', 'u']);
  assert.deepEqual(sup.startArm({ address: '1.2.3.4', udid: 'U' }), { started: false, alreadyRunning: true });
  assert.equal(spawned.length, 1);
  assert.equal(sup.startArm({ address: '5.6.7.8' }).started, true, 'a second phone was blocked by the first');
  spawned[0].c.emit('exit', 0);
  assert.equal(sup.startArm({ address: '1.2.3.4', udid: 'U' }).started, true, 'a finished bring-up still blocked the next one');
});

await ok('a bring-up keeps the supervisor\'s own narration in a log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bringup-'));
  let opts = null;
  const sup = createSupervisorClient({ supervisorPath: '/x/sup.mjs', node: 'node', logDir: dir, spawnFn: (_n, _a, o) => { opts = o; return new EventEmitter(); } });
  sup.startArm({ address: '1.2.3.4', udid: 'U' });
  assert.equal(opts.stdio[0], 'ignore');
  assert.equal(typeof opts.stdio[2], 'number', 'stderr was not pointed at the log');
  assert.match(readFileSync(join(dir, 'bringup.log'), 'utf8'), /bring-up for 1\.2\.3\.4/);
  rmSync(dir, { recursive: true, force: true });
});

await ok('inspect returns null instead of throwing when the host cannot be read', async () => {
  const sup = createSupervisorClient({ supervisorPath: '/x/sup.mjs', execFn: async () => { throw new Error('boom'); } });
  assert.equal(await sup.inspect({ address: '1.2.3.4' }), null);
  const good = createSupervisorClient({ supervisorPath: '/x/sup.mjs', execFn: async (_n, args) => ({ stdout: JSON.stringify({ args }) }) });
  assert.deepEqual((await good.inspect({ address: '1.2.3.4', udid: 'U' })).args, ['/x/sup.mjs', '--status', '--address', '1.2.3.4', '--udid', 'U']);
});

// ─── which code is running ───────────────────────────────────────────────────

const tmp = mkdtempSync(join(tmpdir(), 'ver-'));
function layout(root) {
  for (const d of ['server/src', 'device', 'agent']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'server/src', 'a.mjs'), 'export const a = 1;\n');
  writeFileSync(join(root, 'server/src', 'b.mjs'), 'export const b = 2;\n');
  writeFileSync(join(root, 'device', 'supervisor.mjs'), '// supervisor v1\n');
  writeFileSync(join(root, 'device', 'tunnel.py'), '# tunnel\n');
  writeFileSync(join(root, 'agent', 'agent.mjs'), '// agent v1\n');
}
layout(tmp);

await ok('a fingerprint depends on names and contents, not on where the files live or their order', () => {
  const files = serverFiles(tmp);
  const f1 = fingerprint(files);
  assert.match(f1, /^[0-9a-f]{12}$/);
  assert.equal(fingerprint([...files].reverse()), f1);
  const copy = mkdtempSync(join(tmpdir(), 'ver2-'));
  layout(copy);
  assert.equal(fingerprint(serverFiles(copy)), f1, 'the same code on another machine must give the same fingerprint');
  rmSync(copy, { recursive: true, force: true });
});

await ok('files changed after start are reported as stale; device and agent code are always read fresh', () => {
  const info = createVersionInfo({ repoRoot: tmp, now: () => new Date('2026-10-12T06:06:10.000Z') });
  const first = info();
  assert.deepEqual([first.stale, first.startedAt], [false, '2026-10-12T06:06:10.000Z']);
  writeFileSync(join(tmp, 'device', 'supervisor.mjs'), '// supervisor v2\n');
  writeFileSync(join(tmp, 'agent', 'agent.mjs'), '// agent v2\n');
  const second = info();
  assert.notEqual(second.device, first.device, 'redeployed device code must show up without a restart');
  assert.notEqual(second.agent, first.agent, 'redeployed agent code must show up without a restart');
  assert.equal(second.stale, false, 'changing device or agent code does not make the SERVER stale');
  writeFileSync(join(tmp, 'device', 'tunnel.py'), '# tunnel v2\n');
  assert.notEqual(info().device, second.device, 'the tunnel helper is part of the device fingerprint');
  writeFileSync(join(tmp, 'server/src', 'a.mjs'), 'export const a = 99;\n');
  const third = info();
  assert.equal(third.stale, true, 'new server files without a restart must be flagged');
  assert.equal(third.server, first.server, 'the reported server version must stay what was LOADED');
});

await ok('a missing file changes the fingerprint instead of crashing; a missing component reports null', () => {
  assert.notEqual(fingerprint([join(tmp, 'nope.mjs')]), fingerprint([join(tmp, 'server/src', 'a.mjs')]));
  const empty = mkdtempSync(join(tmpdir(), 'ver3-'));
  const v = createVersionInfo({ repoRoot: empty })();
  assert.deepEqual([v.device, v.agent], [null, null]);
  rmSync(empty, { recursive: true, force: true });
});

await ok('the agent fingerprint covers its subfolders but not its tests', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-files-'));
  mkdirSync(join(root, 'agent', 'providers'), { recursive: true });
  mkdirSync(join(root, 'agent', 'test'), { recursive: true });
  writeFileSync(join(root, 'agent', 'agent.mjs'), 'a');
  writeFileSync(join(root, 'agent', 'providers', 'openai.mjs'), 'b');
  writeFileSync(join(root, 'agent', 'test', 'x.test.mjs'), 'c');
  const files = agentFiles(root).map((f) => f.slice(root.length + 1));
  assert.deepEqual(files, ['agent/agent.mjs', 'agent/providers/openai.mjs']);
  const before = fingerprint(agentFiles(root));
  writeFileSync(join(root, 'agent', 'providers', 'openai.mjs'), 'changed');
  assert.notEqual(fingerprint(agentFiles(root)), before, 'a provider change must change the fingerprint');
  rmSync(root, { recursive: true, force: true });
});

await ok('the version names the release, the exact commit, and the tool list as served', () => {
  const v = createVersionInfo({ tools: () => 'abc123def456' })();
  assert.match(v.release, /^\d+\.\d+\.\d+/, 'release comes from package.json');
  assert.equal(v.release, releaseOf());
  assert.match(v.commit, /^[0-9a-f]{12}(\+dirty)?$/, 'a checkout reports its commit');
  assert.equal(v.tools, 'abc123def456', 'the tool fingerprint is read when asked, not frozen at start');
  assert.equal(createVersionInfo({ tools: 'fixed' })().tools, 'fixed');
});

await ok('a copy made with git archive reports the commit stamped into it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ver-stamp-'));
  mkdirSync(join(dir, 'server', 'src'), { recursive: true });
  writeFileSync(join(dir, 'server', 'src', 'commit.txt'), `${'a'.repeat(40)}\n`);
  assert.deepEqual(commitOf(dir), { commit: 'a'.repeat(40), dirty: false, source: 'archive' });
  writeFileSync(join(dir, 'server', 'src', 'commit.txt'), '$Format:%H$\n');
  assert.equal(commitOf(dir).source === 'archive', false, 'an unfilled placeholder is never taken for a commit');
  rmSync(dir, { recursive: true, force: true });
});

await ok('the tool fingerprint changes with any change to what an assistant sees', () => {
  const tools = [{ name: 'a', description: 'x', inputSchema: { type: 'object' } }];
  const f = toolsFingerprint(tools);
  assert.match(f, /^[0-9a-f]{12}$/);
  assert.notEqual(toolsFingerprint([{ ...tools[0], description: 'y' }]), f);
});

await ok('get_phone_status carries the server version', async () => {
  const api = createToolApi({ statusWaitMs: 0,
    store: { create() {}, get() {}, activeFor() {}, list() { return []; } },
    devices: { status: async () => ({ ready: true, state: 'ready', message: 'ok' }) },
    startRun: () => {},
    versionInfo: () => ({ server: 'abc123abc123', startedAt: 't', stale: false, device: 'def456def456', agent: null }),
  });
  const r = await api.call('get_phone_status', {}, { uid: 'u1' });
  assert.deepEqual([r.ready, r.automation_running], [true, true]);
  assert.deepEqual(r.server, { server: 'abc123abc123', startedAt: 't', stale: false, device: 'def456def456', agent: null });
});
rmSync(tmp, { recursive: true, force: true });

await ok('get_phone_status never asks the resolver to start anything, and reports standby as ready-to-start', async () => {
  const seen = [];
  const api = createToolApi({ statusWaitMs: 0,
    store: { create() {}, get() {}, activeFor() {}, list() { return []; } },
    devices: { status: async (uid, opts) => { seen.push(opts); return { ready: false, running: false, startable: true, state: 'standby', message: 'm' }; } },
    startRun: () => {},
  });
  const r = await api.call('get_phone_status', {}, { uid: 'u1' });
  assert.ok(seen.every((o) => !o || o.start !== true), 'the status tool asked for a start');
  assert.deepEqual([r.ready, r.automation_running, r.state], [true, false, 'standby']);
});

console.log(`\n${passed} phone-state assertions passed`);
