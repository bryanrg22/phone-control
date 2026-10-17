// keep-warm.test.mjs — the keep-warm job: what it reports, who it skips, how
// often it runs, and how a task's bring-up takes priority over it.
//
//   node server/test/keep-warm.test.mjs
//
// The supervisor's --tunnel-only itself (rebuild, mount, never the runner) is
// tested against the simulated phone in device/test/lifecycle.test.mjs.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKeepWarm, summarize } from '../src/keep-warm.mjs';
import { createSupervisorClient } from '../src/preflight.mjs';
import { createDeviceResolver } from '../src/device-resolver.mjs';

let passed = 0;
async function ok(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); process.exitCode = 1; }
}

console.log('what a keep-warm run did:');
await ok('a tunnel that was live and a disk image already mounted: nothing to report', () => {
  assert.deepEqual(summarize({ code: 0, lines: ['[t] adopted live tunnel RSD fd02::1:57805', '[t] tunnel already live (RSD fd02::1:57805) — reattach path, no rebuild', '[t] --tunnel-only: tunnel is up; NOT arming the runner'] }), { changed: false, outcome: 'already warm' });
});
await ok('a dead tunnel rebuilt, and a dropped disk image mounted', () => {
  assert.deepEqual(summarize({ code: 0, lines: ['[t] NOT adopting fd03::1:54019 — interface up but does NOT route (ghost)', '[t] building tunnel to 100.0.0.1 (explicit address, no mDNS) …', '[t] tunnel routing — endpoint persisted', '[t] testmanagerd ABSENT (DDI not mounted) — attempting auto-mount (phone must be UNLOCKED) …'] }),
    { changed: true, outcome: 'rebuilt the tunnel and mounted the disk image' });
});
await ok('on cellular, locked, unreachable and unpaired each say why', () => {
  assert.match(summarize({ code: 43, lines: ["[t] not building: the phone's front door (:49152) is refusing (cellular)", '[t] COLD-START ON CELLULAR IS IMPOSSIBLE'] }).outcome, /on cellular/);
  assert.match(summarize({ code: 43, lines: ['[t] testmanagerd ABSENT (DDI not mounted) — attempting auto-mount …', '[t] auto-mount failed: DeviceLocked', '[t] testmanagerd absent and auto-mount did not fix it'] }).outcome, /could not mount the disk image; phone locked/);
  assert.match(summarize({ code: 43, lines: ["[t] not building: the phone's front door (:49152) is not answering (unreachable)", '[t] PHONE UNREACHABLE'] }).outcome, /not reachable/);
  assert.match(summarize({ code: 43, lines: ['[t] NOT PAIRED — no pairing record'] }).outcome, /not accepting this host/);
  assert.equal(summarize({ code: 9, lines: [] }).outcome, 'failed (exit 9)');
});

console.log('the rounds:');
const PHONES = [{ uid: 'u1', address: '100.0.0.1', udid: 'A' }, { uid: 'u2', address: '100.0.0.2', udid: 'B' }];
await ok('each enrolled phone is kept warm in turn; a phone whose owner has a task running is skipped', async () => {
  const calls = [];
  const kw = createKeepWarm({ enrolled: () => PHONES, busy: (uid) => uid === 'u2', keepWarm: async (d) => { calls.push(d); return { ran: true, code: 0, ms: 5, lines: [] }; } });
  await kw.round();
  assert.deepEqual(calls, [{ address: '100.0.0.1', udid: 'A' }]);
});
await ok('something done is logged; "already warm" and a repeated failure are logged once, not every round', async () => {
  const logs = [];
  const results = [
    { ran: true, code: 0, ms: 3100, lines: ['building tunnel to x', 'tunnel routing'] },
    { ran: true, code: 0, ms: 900, lines: [] },
    { ran: true, code: 0, ms: 900, lines: [] },
    { ran: true, code: 43, ms: 2000, lines: ['refusing (cellular)'] },
    { ran: true, code: 43, ms: 2000, lines: ['refusing (cellular)'] },
  ];
  const kw = createKeepWarm({ enrolled: () => [PHONES[0]], busy: () => false, keepWarm: async () => results.shift(), log: (m) => logs.push(m) });
  for (let i = 0; i < 5; i++) await kw.round();
  assert.deepEqual(logs, [
    'keep-warm for 100.0.0.1: rebuilt the tunnel (3.1 s)',
    'keep-warm for 100.0.0.1: already warm (0.9 s)',
    'keep-warm for 100.0.0.1: phone on cellular, so no tunnel can be built (2.0 s)',
  ]);
});
await ok('a keep-warm that is skipped (a bring-up already running) logs nothing; a throwing one does not stop the round', async () => {
  const logs = []; const calls = [];
  const kw = createKeepWarm({
    enrolled: () => PHONES, busy: () => false, log: (m) => logs.push(m),
    keepWarm: async (d) => { calls.push(d.address); if (d.address === '100.0.0.1') throw new Error('spawn failed'); return { ran: false }; },
  });
  await kw.round();
  assert.deepEqual(calls, ['100.0.0.1', '100.0.0.2'], 'the second phone was not tried after the first threw');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^keep-warm for 100\.0\.0\.1: failed \(exit null\)/);
});
await ok('an unreadable registry is logged and the round ends quietly', async () => {
  const logs = [];
  const kw = createKeepWarm({ enrolled: () => { throw new Error('bad json'); }, busy: () => false, keepWarm: async () => ({ ran: true, code: 0, ms: 0, lines: [] }), log: (m) => logs.push(m) });
  await kw.round();
  assert.deepEqual(logs, ['keep-warm: could not read the device registry: bad json']);
});
await ok('the first round waits firstDelayMs, then one every intervalMs; stop() ends it; interval 0 never starts', async () => {
  const timers = []; let rounds = 0;
  const setTimer = (fn, ms) => { const t = { fn, ms, unref() {} }; timers.push(t); return t; };
  const kw = createKeepWarm({ enrolled: () => [PHONES[0]], busy: () => false, keepWarm: async () => { rounds += 1; return { ran: true, code: 0, ms: 0, lines: [] }; }, intervalMs: 600000, firstDelayMs: 30000, setTimer, clearTimer: () => {} });
  kw.start();
  assert.equal(timers[0].ms, 30000);
  await timers[0].fn();
  assert.equal(rounds, 1);
  assert.equal(timers[1].ms, 600000);
  kw.stop();
  await timers[1].fn();
  assert.equal(rounds, 1, 'a round ran after stop()');
  const never = []; createKeepWarm({ enrolled: () => [], busy: () => false, keepWarm: async () => ({}), intervalMs: 0, setTimer: (f, ms) => never.push(ms) }).start();
  assert.equal(never.length, 0);
});

console.log('the supervisor client:');
function fakeSpawn() {
  const spawned = [];
  const spawnFn = (cmd, args, opts) => {
    const child = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 4000 + spawned.length; child.kill = () => {};
    spawned.push({ args, opts, child });
    return child;
  };
  return { spawned, spawnFn };
}
await ok('keepWarm runs --tunnel-only in its own process group with a short mount limit, logs to keepwarm.log, and reports what happened', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kw-'));
  const { spawned, spawnFn } = fakeSpawn();
  const sup = createSupervisorClient({ supervisorPath: '/s.mjs', spawnFn, logDir: dir, env: { A: '1' } });
  const p = sup.keepWarm({ address: '100.0.0.1', udid: 'U1' });
  const { args, opts, child } = spawned[0];
  assert.deepEqual(args, ['/s.mjs', '--tunnel-only', '--address', '100.0.0.1', '--udid', 'U1']);
  assert.equal(opts.detached, true);
  assert.equal(opts.env.MOUNT_TIMEOUT_SECONDS, '60');
  assert.equal(opts.env.A, '1');
  assert.deepEqual(opts.stdio, ['ignore', 'ignore', 'pipe'], 'keep-warm must never write to the RUNNER_URL channel');
  child.stderr.emit('data', '[t] building tunnel to 100.0.0.1 …\n[t] tunnel routing — endpoint persisted\n');
  child.emit('exit', 0);
  const r = await p;
  assert.equal(r.ran, true); assert.equal(r.code, 0);
  assert.deepEqual(r.lines, ['[t] building tunnel to 100.0.0.1 …', '[t] tunnel routing — endpoint persisted']);
  assert.match(readFileSync(join(dir, 'keepwarm.log'), 'utf8'), /keep-warm for 100\.0\.0\.1 \(exit 0\)[\s\S]*tunnel routing/);
  assert.equal(sup._warming.size, 0);
  rmSync(dir, { recursive: true, force: true });
});
await ok('no keep-warm while a bring-up is running, and never two for one phone', async () => {
  const { spawned, spawnFn } = fakeSpawn();
  const sup = createSupervisorClient({ supervisorPath: '/s.mjs', spawnFn, killGroup: () => {} });
  sup.startArm({ address: '100.0.0.1', udid: 'U1' });
  assert.deepEqual(await sup.keepWarm({ address: '100.0.0.1', udid: 'U1' }), { ran: false });
  const first = sup.keepWarm({ address: '100.0.0.2', udid: 'U2' });
  assert.deepEqual(await sup.keepWarm({ address: '100.0.0.2', udid: 'U2' }), { ran: false });
  assert.equal(spawned.filter((s) => s.args.includes('--tunnel-only')).length, 1);
  spawned.at(-1).child.emit('exit', 0); await first;
});
await ok('a task\'s bring-up stops a keep-warm in progress (its whole process group) and starts at once', async () => {
  const { spawned, spawnFn } = fakeSpawn();
  const killed = []; const logs = [];
  const sup = createSupervisorClient({ supervisorPath: '/s.mjs', spawnFn, killGroup: (pid, sig) => killed.push([pid, sig]), log: (m) => logs.push(m) });
  const warm = sup.keepWarm({ address: '100.0.0.1', udid: 'U1' });
  const warmPid = spawned[0].child.pid;
  const r = sup.startArm({ address: '100.0.0.1', udid: 'U1' });
  assert.equal(r.started, true);
  assert.deepEqual(killed, [[warmPid, 'SIGTERM']]);
  assert.ok(spawned[1].args.includes('--once'), 'the bring-up did not start');
  assert.ok(logs.some((m) => /keep-warm for 100\.0\.0\.1 stopped for a task/.test(m)));
  spawned[0].child.emit('exit', null);
  assert.equal((await warm).ran, true);
  assert.equal(sup._inFlight.has('100.0.0.1'), true, 'the stopped keep-warm cleared the bring-up\'s record');
});

console.log('the device list:');
await ok('enrolled() lists approved phones with an address, overrides applied; pending, revoked and address-less ones are left out', () => {
  const db = { devices: [
    { uid: 'u1', email: 'a@x', address: '100.0.0.1', udid: 'A' },
    { uid: 'u2', email: 'b@x', address: '100.0.0.2', udid: 'B', status: 'pending' },
    { uid: 'u3', email: 'c@x', address: '100.0.0.3', udid: 'C', revokedAt: '2026-01-01' },
    { uid: 'u4', email: 'd@x', udid: 'D' },
    { uid: 'u5', email: 'e@x', address: '100.0.0.5', udid: 'E' },
  ] };
  const r = createDeviceResolver({ loadRegistry: () => db, overrides: { 'e@x': { address: '100.9.9.9' } } });
  assert.deepEqual(r.enrolled().map((d) => [d.uid, d.address, d.udid]), [['u1', '100.0.0.1', 'A'], ['u5', '100.9.9.9', 'E']]);
});

console.log(`\n${passed} keep-warm assertions passed`);
