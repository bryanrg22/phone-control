#!/usr/bin/env node
// lifecycle.test.mjs — what happens to an automation session over a phone's
// real life: Wi-Fi and cellular, locked and unlocked, restarted, switched off.
//
//   npm run test:lifecycle        (~4 min; it starts real processes)
//   node device/test/lifecycle.test.mjs [--only <substring>] [--keep]
//
// Runs the REAL device/supervisor.mjs against a simulated phone (./sim). Every
// behaviour the simulated phone has was measured on a real iPhone; ./sim/phone.mjs
// lists each one and where it came from.
//
// Full coverage needs Linux: two phones need two loopback addresses, and an
// UNREACHABLE phone needs connects that time out (a kernel behaviour macOS does
// not offer on loopback). Elsewhere those scenarios are SKIPPED and said so; a
// skip is not a pass.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHarness, waitFor, sleep } from './sim/harness.mjs';

const argv = process.argv.slice(2);
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : '';
const KEEP = argv.includes('--keep');

const h = await createHarness({ graceMs: 6000, keep: KEEP });
const { phoneA: A, phoneB: B } = h;
const results = [];

async function scenario(name, fn, { needs = [] } = {}) {
  if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) return;
  const missing = needs.filter((n) => !({ twoPhones: !!B, timeouts: h.canBlackhole })[n]);
  if (missing.length) {
    results.push({ name, status: 'SKIP' });
    console.log(`  – ${name}  (SKIPPED: needs ${missing.join(', ')})`);
    return;
  }
  const t0 = Date.now();
  try {
    await h.reset();
    await fn();
    results.push({ name, status: 'PASS' });
    console.log(`  ✓ ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    results.push({ name, status: 'FAIL' });
    console.log(`  ✗ ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)\n      ${String(e.message).split('\n').join('\n      ')}`);
  }
}

const SLOT = { [A.udid]: 'person-a:phone', ...(B ? { [B.udid]: 'person-b:phone' } : {}) };
const arm = (phone) => h.arm(phone, { slot: SLOT[phone.udid] });
const suspend = (phone) => h.suspend(phone);
async function armOk(phone, what = 'arm') {
  const r = await arm(phone);
  assert.equal(r.armed, true, `${what} failed (exit ${r.exitCode}): ${r.detail}`);
  return r;
}

console.log(`phone lifecycle — ${h.isLinux ? 'Linux (full coverage)' : `${process.platform} (single phone; two-phone and unreachable-phone scenarios skipped)`}`);
if (process.env.SIM_DEVICE_DIR) console.log(`  !! device code taken from SIM_DEVICE_DIR=${h.deviceDir} — NOT this checkout's`);
console.log(`  code under test (sha256/12): ${Object.entries(h.underTest).map(([f, v]) => `${f} ${v}`).join(' · ')}`);
console.log(`  phone A ${A.ip}${B ? ` · phone B ${B.ip}` : ''} · VPN grace ${h.graceMs}ms · unreachable = ${h.canBlackhole ? 'real timeouts' : 'refusals (no timeout support here)'}\n`);

await scenario('a command that does not name a phone is refused', async () => {
  const r = await h.sup(['--status', '--address', A.ip]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /refusing to guess which phone/);
  assert.equal(r.stdout, '');
});

// ─── starting ────────────────────────────────────────────────────────────────

await scenario('cold arm on Wi-Fi: tunnel built, runner up, stamped with the caller\'s slot', async () => {
  const before = A.snapshot();
  const r = await armOk(A);
  assert.equal(r.runnerURL, `http://${A.ip}:${h.runnerPort}`);
  const s = await h.status(A);
  assert.equal(s.runnerHealthy, true);
  assert.equal(s.tunnelState, 'live');
  assert.equal(s.lastArm.kind, 'cold-build');
  assert.equal(s.runtestAnchors, '1');
  assert.equal(s.phoneNet, 'wifi');
  assert.equal(A.counters.hellos - before.hellos, 1, 'expected exactly one tunnel handshake');
  assert.equal(A.counters.runnerStarts - before.runnerStarts, 1, 'expected exactly one runner launch');
  const env = await h.hostInfo(A);
  assert.equal(env.ARMED_FOR_SLOT, 'person-a:phone', 'the runner is not stamped with who started it');
  assert.ok(env.HOST_NAME && env.HOST_ARMED_ISO, 'runner is missing the host stamp');
});

await scenario('re-arm while armed is idempotent: no second tunnel, no second runner', async () => {
  await armOk(A);
  const before = A.snapshot();
  const [anchor] = await h.anchorPids(A); const [tunnel] = await h.tunnelPids(A);
  const r = await armOk(A, 're-arm');
  assert.match(r.stderr, /runner already healthy/);
  assert.deepEqual(A.snapshot(), before, 'the phone was touched by an idempotent re-arm');
  assert.deepEqual(await h.anchorPids(A), [anchor]);
  assert.deepEqual(await h.tunnelPids(A), [tunnel]);
});

await scenario('suspend: runner down (banner clears), tunnel stays warm', async () => {
  await armOk(A);
  const [tunnel] = await h.tunnelPids(A);
  const r = await suspend(A);
  assert.deepEqual([r.suspended, r.tunnelUp, r.killedAnchors], [true, true, 1]);
  assert.equal(await h.runnerAnswers(A), false, 'runner still answers after suspend');
  assert.equal(A.runner, null, 'the phone still has a runner — the banner would be showing');
  const s = await h.status(A);
  assert.equal(s.runtestAnchors, '0');
  assert.equal(s.tunnelState, 'live');
  assert.deepEqual(await h.tunnelPids(A), [tunnel], 'suspend replaced or killed the tunnel helper');
});

await scenario('suspend on one phone leaves another phone\'s session alone', async () => {
  await armOk(A, 'arm A');
  await armOk(B, 'arm B');
  const bAnchor = await h.anchorPids(B); const bTunnel = await h.tunnelPids(B);
  const r = await suspend(A);
  assert.equal(r.suspended, true);
  assert.equal(await h.runnerAnswers(B), true, 'phone B lost its runner when phone A suspended');
  assert.deepEqual(await h.anchorPids(B), bAnchor);
  assert.deepEqual(await h.tunnelPids(B), bTunnel);
  assert.equal((await h.hostInfo(B)).ARMED_FOR_SLOT, SLOT[B.udid]);
}, { needs: ['twoPhones'] });

await scenario('roam to cellular while suspended → arm REATTACHES over the warm tunnel', async () => {
  await armOk(A);
  await suspend(A);
  const [tunnel] = await h.tunnelPids(A);
  await A.setWifi(false);
  const pre = await h.status(A);
  assert.equal(pre.phoneNet, 'cellular');
  assert.equal(pre.tunnelState, 'live', 'the warm tunnel did not survive the roam');
  const before = A.snapshot();
  await armOk(A, 'arm on cellular');
  const s = await h.status(A);
  assert.equal(s.lastArm.kind, 'warm-reattach');
  assert.equal(s.runnerHealthy, true);
  assert.equal(A.counters.hellos - before.hellos, 0, 'a new tunnel was built on cellular (impossible on a real phone)');
  assert.equal(A.counters.runnerStarts - before.runnerStarts, 1);
  assert.deepEqual(await h.tunnelPids(A), [tunnel]);
});

await scenario('roam to cellular mid-session: the armed runner keeps answering', async () => {
  await armOk(A);
  const [anchor] = await h.anchorPids(A);
  await A.setWifi(false);
  await sleep(600);
  const s = await h.status(A);
  assert.equal(s.runnerHealthy, true);
  assert.equal(s.tunnelState, 'live');
  assert.deepEqual(await h.anchorPids(A), [anchor]);
  const before = A.snapshot();
  const r = await armOk(A, 're-arm on cellular');
  assert.match(r.stderr, /runner already healthy/);
  assert.deepEqual(A.snapshot(), before, 'the phone was touched by a re-arm on cellular');
});

await scenario('a VPN blip shorter than the grace window: session and runner survive', async () => {
  await armOk(A);
  const [anchor] = await h.anchorPids(A); const [tunnel] = await h.tunnelPids(A);
  const before = A.snapshot();
  const t0 = Date.now();
  await A.setVpn(false);
  await sleep(500);
  assert.equal(await h.runnerAnswers(A), false, 'model check: runner should be unreachable while the VPN is down');
  await A.setVpn(true);
  // If the outage we produced outlasted the phone's grace window, this was not
  // a blip and the rest of the scenario would be testing something else.
  assert.ok(Date.now() - t0 < h.graceMs - 500, `the test could not keep the outage short (${Date.now() - t0}ms of a ${h.graceMs}ms grace window)`);
  await waitFor(async () => (await h.status(A)).tunnelState === 'live', 'tunnel to route again after the blip', 8000, 300);
  const s = await h.status(A);
  assert.equal(s.runnerHealthy, true, 'runner did not come back after a short blip');
  assert.deepEqual(await h.anchorPids(A), [anchor], 'the anchor was replaced');
  assert.deepEqual(await h.tunnelPids(A), [tunnel], 'the tunnel was rebuilt');
  assert.deepEqual(A.snapshot(), before, 'the phone saw a new handshake or launch');
});

await scenario('cold arm on cellular is refused, quickly, with the Wi-Fi explanation', async () => {
  await A.setWifi(false);
  const before = A.snapshot(); const t0 = Date.now();
  const r = await arm(A);
  assert.equal(r.armed, false, `a cold start on cellular was accepted: ${r.detail}`);
  assert.equal(r.exitCode, 43);
  assert.match(r.detail, /COLD-START ON CELLULAR IS IMPOSSIBLE/);
  assert.match(r.detail, /Wi-Fi/);
  assert.ok(Date.now() - t0 < 30000, `refusal took ${Date.now() - t0}ms`);
  assert.equal(A.counters.hellos - before.hellos, 0);
  assert.equal((await h.tunnelPids(A)).length, 0, 'a tunnel helper was left behind by a refused arm');
  assert.equal((await h.anchorPids(A)).length, 0);
  // …and the same phone arms the moment Wi-Fi is back.
  await A.setWifi(true);
  await armOk(A, 'arm once Wi-Fi is back');
});

// ─── ghosts ──────────────────────────────────────────────────────────────────

await scenario('app closed (VPN down past the grace window) → ghost tunnel → next Wi-Fi arm reaps and rebuilds', async () => {
  await armOk(A);
  await suspend(A);
  const [ghost] = await h.tunnelPids(A);
  await A.setVpn(false);                         // willTerminate → stopTunnel()
  await sleep(h.graceMs + 800);
  assert.ok(h.alive(ghost), 'model check: the helper should still be alive (that is what makes it a ghost)');
  const s = await h.status(A);
  assert.equal(s.tunnelState, 'stale', `a ghost must read "stale", got "${s.tunnelState}"`);
  assert.equal(s.runnerHealthy, false);
  await A.setVpn(true);                          // app reopened, on Wi-Fi
  const before = A.snapshot();
  await armOk(A, 'arm after reopening the app');
  const after = await h.status(A);
  assert.equal(after.lastArm.kind, 'cold-build');
  assert.equal(after.tunnelState, 'live');
  assert.equal(A.counters.hellos - before.hellos, 1);
  assert.equal(h.alive(ghost), false, 'the ghost helper was not reaped');
  assert.equal((await h.tunnelPids(A)).length, 1, 'two tunnel helpers for one phone');
});

await scenario('ghost while still on cellular: arm is refused and leaves no helper behind', async () => {
  await armOk(A);
  await suspend(A);
  await A.setWifi(false);
  await A.setVpn(false);
  await sleep(h.graceMs + 800);
  await A.setVpn(true);                          // VPN back, but on cellular: no front door
  const r = await arm(A);
  assert.equal(r.armed, false);
  assert.match(r.detail, /Wi-Fi/);
  assert.equal((await h.tunnelPids(A)).length, 0, 'the ghost was not reaped by the failed arm');
  // Reaped with SIGTERM, so the helper took its interface down with it.
  assert.equal((await h.status(A)).tunnelState, 'down', 'a reaped ghost should leave nothing behind');
  await A.setWifi(true);
  await armOk(A, 'arm once back on Wi-Fi');
  assert.equal((await h.status(A)).lastArm.kind, 'cold-build');
});

await scenario('tunnel helper SIGKILLed (orphan interface) → next arm rebuilds', async () => {
  await armOk(A);
  const [tunnel] = await h.tunnelPids(A);
  process.kill(tunnel, 'SIGKILL');
  await waitFor(() => !h.alive(tunnel), 'helper to die', 3000);
  await waitFor(async () => !(await h.runnerAnswers(A)), 'runner to die with its tunnel', 5000);
  assert.equal(A.runner, null, 'the runner outlived its tunnel');
  const s = await h.status(A);
  assert.equal(s.tunnelState, 'stale');
  await armOk(A, 'arm after the helper was killed');
  const after = await h.status(A);
  assert.equal(after.lastArm.kind, 'cold-build');
  assert.equal(after.runnerHealthy, true);
});

// ─── keep-warm (--tunnel-only) and the startup shortcuts ─────────────────────

const keepWarm = (phone) => h.sup(['--tunnel-only', '--address', phone.ip, '--udid', phone.udid], { extraEnv: { MOUNT_TIMEOUT_SECONDS: '20' } });

await scenario('keep-warm after a ghost: rebuilds the tunnel on Wi-Fi and never starts the runner', async () => {
  await armOk(A);
  await suspend(A);
  const [ghost] = await h.tunnelPids(A);
  await A.setVpn(false);
  await sleep(h.graceMs + 800);
  await A.setVpn(true);                          // phone back on Wi-Fi, tunnel dead
  assert.equal((await h.status(A)).tunnelState, 'stale', 'model check: the tunnel should be a ghost');
  const starts = A.counters.runnerStarts;
  const r = await keepWarm(A);
  assert.equal(r.code, 0, `keep-warm failed: ${r.stderr.split('\n').slice(-4).join(' | ')}`);
  assert.equal(A.counters.runnerStarts, starts, 'keep-warm started the runner (the banner would show)');
  assert.equal(A.runner, null);
  assert.equal(h.alive(ghost), false, 'the ghost helper was not reaped');
  const s = await h.status(A);
  assert.equal(s.tunnelState, 'live');
  assert.equal(s.runnerHealthy, false);
  // The next task reattaches and trusts the disk image keep-warm just saw.
  const a = await armOk(A, 'arm after keep-warm');
  assert.match(a.stderr, /reattach path, no rebuild/);
  assert.match(a.stderr, /testing service seen on this tunnel \d+ s ago — not asking again/);
});

await scenario('keep-warm remounts a dropped disk image while unlocked, without starting the runner', async () => {
  await armOk(A);
  await suspend(A);
  A.unmountDdi();
  const mounts = A.counters.mounts;
  const starts = A.counters.runnerStarts;
  const r = await keepWarm(A);
  assert.equal(r.code, 0, `keep-warm failed: ${r.stderr.split('\n').slice(-4).join(' | ')}`);
  assert.equal(A.counters.mounts - mounts, 1, 'the disk image was not mounted');
  assert.equal(A.counters.runnerStarts, starts, 'keep-warm started the runner');
  assert.equal(A.ddiMounted, true);
});

await scenario('keep-warm on a locked phone: the mount is refused, nothing is started, it gives up quickly', async () => {
  await armOk(A);
  await suspend(A);
  A.unmountDdi();
  A.lock();
  const refused = A.counters.mountsRefused;
  const t0 = Date.now();
  const r = await keepWarm(A);
  assert.notEqual(r.code, 0);
  assert.equal(A.counters.mountsRefused - refused, 1, 'the mount was not attempted');
  assert.equal(A.runner, null);
  assert.ok(Date.now() - t0 < 30000, `took ${Date.now() - t0} ms`);
  await A.unlock();
  assert.equal((await keepWarm(A)).code, 0, 'keep-warm did not recover once the phone was unlocked');
  assert.equal(A.ddiMounted, true);
});

await scenario('keep-warm with a ghost while on cellular: refused, leaves no helper, starts nothing', async () => {
  await armOk(A);
  await suspend(A);
  await A.setWifi(false);
  await A.setVpn(false);
  await sleep(h.graceMs + 800);
  await A.setVpn(true);
  const r = await keepWarm(A);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Wi-Fi/);
  assert.equal((await h.tunnelPids(A)).length, 0, 'the ghost was not reaped');
  assert.equal(A.runner, null);
});

await scenario('a warm tunnel on cellular is kept: a short probe that gets no answer is checked again before anything is torn down', async () => {
  await armOk(A);
  await suspend(A);
  await A.setWifi(false);                        // roamed; the warm tunnel still routes
  const hellos = A.counters.hellos;
  const [helper] = await h.tunnelPids(A);
  const a = await h.sup(['--once', '--address', A.ip, '--udid', A.udid], { extraEnv: { SIM_SHORT_PROBE_MISSES: '1' } });
  assert.equal(a.code, 0, `arm on cellular failed: ${a.stderr.split('\n').slice(-4).join(' | ')}`);
  assert.match(a.stderr, /phone is on cellular, where it could not be rebuilt — checking again/);
  assert.match(a.stderr, /adopted live tunnel/);
  assert.equal(A.counters.hellos, hellos, 'a new tunnel was attempted although the warm one routes');
  assert.equal(h.alive(helper), true, 'the working tunnel was torn down');
});

await scenario('on Wi-Fi a short probe that gets no answer is the verdict: the tunnel is rebuilt without a second wait', async () => {
  await armOk(A);
  await suspend(A);
  const hellos = A.counters.hellos;
  const a = await h.sup(['--once', '--address', A.ip, '--udid', A.udid], { extraEnv: { SIM_SHORT_PROBE_MISSES: '1' } });
  assert.equal(a.code, 0, a.stderr.split('\n').slice(-3).join(' | '));
  assert.doesNotMatch(a.stderr, /checking again/);
  assert.equal(A.counters.hellos - hellos, 1, 'the tunnel was not rebuilt');
  assert.match(a.stderr, /orphaned helper gone after \d+ ms/);
});

await scenario('a trusted disk image that iOS dropped anyway: the arm notices, mounts it and starts', async () => {
  await armOk(A);
  await suspend(A);                              // tunnel live, disk image seen moments ago
  A.unmountDdi();                                // dropped while the tunnel lived on
  const mounts = A.counters.mounts;
  const a = await armOk(A, 'arm with a stale trust');
  assert.match(a.stderr, /not asking again/);
  assert.match(a.stderr, /could not find the testing service/);
  assert.match(a.stderr, /gone after all — checking and mounting it/);
  assert.equal(A.counters.mounts - mounts, 1, 'the disk image was not mounted');
  assert.equal((await h.status(A)).runnerHealthy, true);
});

await scenario('DDI_TRUST_SECONDS=0: the disk image is checked on every arm, as before', async () => {
  await armOk(A);
  await suspend(A);
  const a = await h.sup(['--once', '--address', A.ip, '--udid', A.udid], { extraEnv: { DDI_TRUST_SECONDS: '0' } });
  assert.equal(a.code, 0, a.stderr.split('\n').slice(-3).join(' | '));
  assert.doesNotMatch(a.stderr, /not asking again/);
});

// ─── reboot / lock ───────────────────────────────────────────────────────────

await scenario('restart: unreachable until the first unlock, then needs an unlocked phone to mount, then arms', async () => {
  await armOk(A);
  await A.reboot();                              // sessions dropped, Disk Image unmounted, locked, silent until first unlock
  await sleep(500);
  const sealed = await arm(A);
  assert.equal(sealed.armed, false, 'armed a phone that has not been unlocked since boot');
  if (h.canBlackhole) assert.match(sealed.detail, /PHONE UNREACHABLE/, 'a phone that answers nothing must not be described as "on cellular"');
  await A.unlock();                              // first unlock: reachable again
  A.passcodeNeeded = false;                      // the passcode prompt has its own scenarios below
  A.lock();                                      // …and it locked again before the arm
  const refusedBefore = A.counters.mountsRefused;
  const locked = await arm(A);
  assert.equal(locked.armed, false, `expected 502 while locked, got ${locked.detail}`);
  assert.match(locked.detail, /unlock the phone/);
  assert.equal(A.counters.mountsRefused - refusedBefore, 1, 'the mount was not attempted');
  assert.equal(A.runner, null);
  assert.equal((await h.status(A)).arm.reason, 'locked');
  await A.unlock();
  const mountsBefore = A.counters.mounts;
  await armOk(A, 'arm after unlock');
  assert.equal(A.counters.mounts - mountsBefore, 1, 'the Disk Image was not mounted');
  const s = await h.status(A);
  assert.equal(s.runnerHealthy, true);
  assert.equal(s.arm.phase, 'armed');
  assert.equal((await h.tunnelPids(A)).length, 1, 'more than one tunnel helper after the recovery');
  assert.equal((await h.anchorPids(A)).length, 1, 'the anchor from before the restart was left running');
});

await scenario('power-off while armed: the anchor is left behind, and the next start clears it', async () => {
  await armOk(A);
  const [old] = await h.anchorPids(A);
  await A.powerOff();
  await sleep(1500);
  assert.ok(h.alive(old), 'model check: a power cut says no goodbye, so the anchor should still be running');
  const off = await h.status(A);
  assert.equal(off.runnerHealthy, false);
  assert.equal(off.runtestAnchors, '1', 'expected the status to show the leftover anchor');
  await A.powerOn();
  await A.unlock();
  A.passcodeNeeded = false;
  await armOk(A, 'arm after power-on');
  const now = await h.anchorPids(A);
  assert.equal(now.length, 1, `expected exactly one anchor after the restart, found ${now.length}`);
  assert.notEqual(now[0], old);
  assert.equal(h.alive(old), false, 'the leftover anchor is still running');
  assert.equal((await h.status(A)).runnerHealthy, true);
});

await scenario('first start after a restart: reports "waiting on the phone" until the passcode is entered', async () => {
  await A.reboot();
  await A.unlock();                              // reachable, Disk Image unmounted, passcode prompt pending
  const pending = arm(A);
  const waiting = await waitFor(async () => {
    const st = await h.status(A);
    return st.arm && st.arm.phase === 'waiting-on-phone' ? st : null;
  }, 'the bring-up to report that it is waiting on the phone', 25000, 400);
  assert.equal(waiting.arm.inFlight, true);
  assert.equal(waiting.runnerHealthy, false);
  assert.ok(A.counters.passcodePrompts >= 1, 'model check: the prompt should be on screen');
  await A.enterPasscode();
  const r = await pending;
  assert.equal(r.armed, true, `arm did not complete after the passcode: ${r.detail}`);
  const s = await h.status(A);
  assert.equal(s.arm.phase, 'armed');
  assert.equal(s.arm.inFlight, false);
  assert.equal(s.runnerHealthy, true);
  assert.equal((await h.anchorPids(A)).length, 1);
});

await scenario('passcode never entered: the arm fails saying the phone needs its owner, and leaves nothing running', async () => {
  await A.reboot();
  await A.unlock();
  const r = await arm(A);
  assert.equal(r.armed, false);
  assert.match(r.detail, /NO ANSWER FROM THE PHONE/);
  assert.match(r.detail, /passcode/);
  assert.ok(A.counters.passcodePrompts >= 2, 'each retry should have put the prompt back on screen');
  const s = await h.status(A);
  assert.deepEqual([s.arm.phase, s.arm.reason, s.arm.inFlight], ['failed', 'waiting-on-phone', false]);
  await waitFor(async () => (await h.anchorPids(A)).length === 0, 'the abandoned anchors to be gone', 5000);
  assert.equal(A.runner, null);
  // The owner answers; the very next arm works.
  A.passcodeNeeded = false;
  await armOk(A, 'arm once the phone is attended');
});

await scenario('a locked phone cannot START a session: the arm says the phone needs its owner, either way it shows up', async () => {
  A.lock();
  const r = await arm(A);              // go-ios gives up: "cannot initiate a IDE session"
  assert.equal(r.armed, false);
  assert.match(r.detail, /NO ANSWER FROM THE PHONE/);
  let s = await h.status(A);
  assert.deepEqual([s.arm.phase, s.arm.reason], ['failed', 'waiting-on-phone'], 'a locked phone was reported as a generic session failure');
  assert.equal(A.runner, null);
  assert.equal((await h.anchorPids(A)).length, 0);
  A.lockedStartSilent = true;                       // the other observed form: authorised, then silence
  const r2 = await arm(A);
  assert.equal(r2.armed, false);
  s = await h.status(A);
  assert.equal(s.arm.reason, 'waiting-on-phone');
  await A.unlock();
  await armOk(A, 'arm once unlocked');
  assert.equal((await h.anchorPids(A)).length, 1);
});

await scenario('another program\'s tunnel to the same phone is not ours: never counted, never stopped', async () => {
  // Seen on a real server: a second program holding its own tunnel to
  // the same phone, from a script whose name also ends in "tunnel.py".
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '/opt/other/app/mesh_tunnel.py', A.udid, A.ip], { stdio: 'ignore' });
  try {
    await sleep(300);
    assert.equal((await h.status(A)).tunnelState, 'down', 'someone else\'s helper was taken for a tunnel of ours');
    await armOk(A);
    const [mine] = (await h.tunnelPids(A)).filter((pid) => pid !== other.pid);
    process.kill(mine, 'SIGKILL');                 // forces the next start down the rebuild path, which clears old helpers
    await suspend(A);
    await armOk(A, 'arm after our helper died');
    assert.equal(h.alive(other.pid), true, 'the supervisor stopped another program\'s tunnel helper');
  } finally { other.kill('SIGKILL'); }
});

await scenario('a failed start is still on record after the clean-up suspend that follows it', async () => {
  A.lock();
  A.lockedStartSilent = true;                    // authorised, then silence: the phone is waiting on its owner
  const r = await arm(A);
  assert.equal(r.armed, false);
  const failed = await h.status(A);
  assert.equal(failed.arm.phase, 'failed');
  const reason = failed.arm.reason;
  await suspend(A);                              // what the server does at the end of every task
  const after = await h.status(A);
  assert.equal(after.arm.phase, 'failed', 'the suspend erased why the start failed');
  assert.equal(after.arm.reason, reason);
  await A.unlock();
  A.lockedStartSilent = false;
  await armOk(A, 'arm once unlocked');
  await suspend(A);
  assert.equal((await h.status(A)).arm.phase, 'suspended', 'a normal suspend is still recorded as one');
});

await scenario('runner crash on the phone → arm reattaches over the warm tunnel', async () => {
  await armOk(A);
  const [tunnel] = await h.tunnelPids(A);
  A.crashRunner();
  await waitFor(async () => (await h.anchorPids(A)).length === 0, 'the anchor to exit once its runner died', 5000);
  const s = await h.status(A);
  assert.equal(s.runnerHealthy, false);
  assert.equal(s.tunnelState, 'live');
  const before = A.snapshot();
  await armOk(A, 'arm after the crash');
  assert.equal((await h.status(A)).lastArm.kind, 'warm-reattach');
  assert.equal(A.counters.hellos - before.hellos, 0);
  assert.deepEqual(await h.tunnelPids(A), [tunnel]);
});

// ─── what the host reports ───────────────────────────────────────────────────

await scenario('network label: Wi-Fi, cellular and UNREACHABLE are three different answers', async () => {
  await armOk(A);
  await suspend(A);
  const wifi = await h.status(A);
  assert.deepEqual([wifi.phoneNet, wifi.meshPath.online], ['wifi', true]);
  await A.setWifi(false);
  const cell = await h.status(A);
  assert.deepEqual([cell.phoneNet, cell.meshPath.online, cell.tunnelState], ['cellular', true, 'live']);
  await A.powerOff();
  const off = await h.status(A);
  assert.equal(off.phoneNet, 'unreachable', 'a phone that is switched off was labelled as if it were merely off Wi-Fi');
  assert.equal(off.meshPath.online, false);
  assert.equal(off.tunnelState, 'stale');
  const t0 = Date.now();
  const r = await arm(A);
  assert.equal(r.armed, false);
  assert.match(r.detail, /PHONE UNREACHABLE/);
  assert.doesNotMatch(r.detail, /COLD-START ON CELLULAR/, 'the user was told to find Wi-Fi for a phone that is off');
  assert.ok(Date.now() - t0 < 45000, `refusing an unreachable phone took ${Date.now() - t0}ms`);
  assert.equal((await h.status(A)).arm.reason, 'unreachable');
  assert.equal((await h.tunnelPids(A)).length, 0, 'the dead tunnel helper was left running');
}, { needs: ['timeouts'] });

await scenario('a refused cold start on cellular records WHY', async () => {
  await A.setWifi(false);
  const r = await arm(A);
  assert.equal(r.armed, false);
  const s = await h.status(A);
  assert.deepEqual([s.arm.phase, s.arm.reason, s.phoneNet], ['failed', 'needs-wifi', 'cellular']);
});

await scenario('a phone that was never paired: the status says so, without touching the phone', async () => {
  const before = A.snapshot();
  assert.equal((await h.status(A)).pairingRecord, true);
  h.setPaired(A.udid, false);
  assert.equal((await h.status(A)).pairingRecord, false);
  assert.deepEqual(A.snapshot(), before, 'looking touched the phone');
});

await scenario('the phone does not recognise this host: one refused handshake, a clear reason, nothing left running', async () => {
  // A phone answers a host it was not paired with by refusing the handshake.
  // Modelled by presenting an identity the simulated phone does not have.
  const stranger = { ip: A.ip, udid: 'SIM0E000-0000000000000E55' };
  h.setPaired(stranger.udid, true);
  const before = A.snapshot();
  const t0 = Date.now();
  const r = await h.arm(stranger);
  assert.equal(r.armed, false);
  assert.equal(r.exitCode, 43);
  assert.match(r.stderr, /TUNNEL REFUSED/);
  assert.ok(Date.now() - t0 < 30000, `took ${Date.now() - t0}ms to give up`);
  const s = await h.status(stranger);
  assert.deepEqual([s.arm.phase, s.arm.reason, s.phoneNet], ['failed', 'tunnel-failed', 'wifi']);
  const refused = A.counters.deniedHellos - before.deniedHellos;
  assert.equal(A.counters.hellos, before.hellos, 'a tunnel was built for a host the phone does not know');
  assert.ok(refused >= 1 && refused <= 3, `${refused} handshakes were attempted`);
  assert.deepEqual([(await h.anchorPids(stranger)).length, (await h.tunnelPids(stranger)).length], [0, 0]);
  // …and with no record at all, the host says it is a setup problem
  h.setPaired(stranger.udid, false);
  const r2 = await h.arm(stranger);
  assert.match(r2.stderr, /NOT PAIRED — no pairing record at /);
});

await scenario('session ended ON THE PHONE is told apart from one the host put down', async () => {
  await armOk(A);
  assert.equal((await h.status(A)).lastSession.endedOnDevice, false);
  A.crashRunner();                               // both volume buttons held, or the runner dying
  await waitFor(async () => (await h.anchorPids(A)).length === 0, 'the anchor to exit', 5000);
  const ended = await h.status(A);
  assert.equal(ended.lastSession.endedOnDevice, true, 'the host did not notice the phone ended the session');
  assert.equal(ended.tunnelState, 'live');
  await armOk(A, 're-arm');
  await suspend(A);
  const put = await h.status(A);
  assert.equal(put.lastSession.endedOnDevice, false, 'a host-side suspend was reported as ended on the phone');
  assert.equal(put.arm.phase, 'suspended');
});

await scenario('locking the phone does not end the session; the screen state says it is locked', async () => {
  await armOk(A);
  const open = await h.mode(A, '--screen-state');
  assert.deepEqual([open.runnerHealthy, open.locked, open.wifi && open.wifi.bars], [true, false, 3]);
  A.lock();
  const st = await h.status(A);
  assert.deepEqual([st.runnerHealthy, st.tunnelState, st.runtestAnchors], [true, 'live', '1'], 'locking should not disturb the session');
  const locked = await h.mode(A, '--screen-state');
  assert.equal(locked.locked, true);
  assert.ok(locked.lockSignals.length > 0);
  await A.setWifi(false);
  assert.equal((await h.mode(A, '--screen-state')).wifi, null, 'the status bar should show no Wi-Fi on cellular');
  await suspend(A);
  const down = await h.mode(A, '--screen-state');
  assert.deepEqual([down.runnerHealthy, down.locked], [false, null], 'with no runner the answer must be "cannot tell", never "unlocked"');
});

await scenario('before a task: another app\'s banner over the top is swiped away, deterministically', async () => {
  await armOk(A);
  const none = await h.mode(A, '--prepare-screen');
  assert.deepEqual([none.bannerFound, none.swipes], [false, 0], 'a swipe was made with nothing to dismiss');
  assert.equal(A.swipes.length, 0);
  A.banner = { text: 'Claude’s reply', stubborn: 0 };
  const one = await h.mode(A, '--prepare-screen');
  assert.deepEqual([one.bannerFound, one.swipes, one.cleared], [true, 1, true]);
  assert.equal(A.banner, null, 'the banner is still covering the top of the screen');
  assert.ok(A.swipes[0].endY < A.swipes[0].startY, 'the swipe did not go upward');
  A.banner = { text: 'Claude’s reply', stubborn: 1 };   // needs a second go
  const two = await h.mode(A, '--prepare-screen');
  assert.deepEqual([two.swipes, two.cleared], [2, true]);
  A.banner = { text: 'Claude’s reply', stubborn: 99 };  // will not go away
  const stuck = await h.mode(A, '--prepare-screen');
  assert.deepEqual([stuck.swipes, stuck.cleared], [3, false], 'it must give up after three tries and say so');
  A.banner = null;
  await suspend(A);
  const down = await h.mode(A, '--prepare-screen');
  assert.equal(down.runnerHealthy, false);
});

await scenario('after a task: an app can be brought to the front through the runner', async () => {
  await armOk(A);
  const r = await h.mode(A, '--launch-app', 'com.anthropic.claude');
  assert.deepEqual([r.launched, r.foreground], [true, 'com.anthropic.claude']);
  assert.equal(A.foregroundApp, 'com.anthropic.claude');
  const bad = await h.mode(A, '--launch-app', 'not a bundle; rm -rf');
  assert.equal(bad.launched, false);
  assert.equal(A.foregroundApp, 'com.anthropic.claude', 'a malformed bundle id reached the phone');
});

// ─── report ──────────────────────────────────────────────────────────────────

const failed = results.filter((r) => r.status === 'FAIL');
const skipped = results.filter((r) => r.status === 'SKIP');
const passed = results.filter((r) => r.status === 'PASS');
const { kept } = await h.close({ failed: failed.length > 0 });

console.log(`\n${passed.length} passed · ${failed.length} failed · ${skipped.length} skipped`);
if (skipped.length) console.log(`skipped (NOT verified here): ${skipped.map((x) => x.name).join(' | ')}`);
if (kept) console.log(`sandbox kept for inspection: ${kept}`);
process.exit(failed.length ? 1 : 0);
