#!/usr/bin/env node
// test-task-runner.mjs — one phone task from start to a clean phone, with every
// way it can end. Device-free: the phone, the supervisor and the agent process
// are scripted, so each scenario states exactly what the host observed and
// asserts what the user is told and — always — that automation was put down.
//
// The failure cases are the ones produced on the real phone on 2026-10-11/12:
// unreachable, waiting on the passcode, locked, stopped with the volume
// buttons, and the connection dropping.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunStore } from '../src/runs.mjs';
import { createTaskRunner } from '../src/task-runner.mjs';
import { createToolApi } from '../src/tool-api.mjs';
import { createPrefs } from '../src/prefs.mjs';
import { resolveModel, MODELS, providerKeyPresent } from '../src/models.mjs';
import { buildAgentArgs } from '../src/agent-runner.mjs';

let passed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

const UID = 'u1';
const WHERE = { address: '100.64.0.20', udid: 'UDID-1' };
const LUNA = resolveModel('gpt-6-luna');
const tick = () => new Promise((r) => setImmediate(r));
/** Let a task run for a bounded number of turns. A task that should have ended
 *  by itself and did not must FAIL its test, not hang the suite. */
async function settled(promise, turns = 2000) {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < turns && !done; i++) await tick();
  return done;
}

/**
 * A scripted world. `statuses` answers devices.status in order (the last one
 * repeats); `inspects` and `screens` answer the watchdog the same way.
 */
function world({ statuses, inspects = [{ runnerHealthy: true }], screens = [{ locked: false }], suspendThrows = false, limits = {}, returnApp = null, meta = {}, banner = null } = {}) {
  let si = 0; let ii = 0; let ci = 0; let t = 0;
  // One clock for the run store and the runner, as in production. `listening`
  // stands for the chat checking status back-to-back; turn it off to model a
  // chat that has stopped following the task.
  const state = { listening: true };
  const store = createRunStore({ now: () => t });
  const calls = { status: [], suspend: [], agent: [], kill: [], order: [], launch: [], cancelArm: 0 };
  const next = (list, n) => list[Math.min(n, list.length - 1)];
  let run = null;
  const proc = new EventEmitter();
  proc.kill = (sig) => { calls.kill.push(sig); setImmediate(() => proc.emit('close', null)); };
  const runner = createTaskRunner({
    store,
    devices: {
      status: async (uid, opts) => { calls.status.push(opts); return { ...WHERE, ...next(statuses, si++) }; },
      resolve: () => ({ state: 'enrolled', ...WHERE }),
    },
    supervisor: {
      inspect: async () => next(inspects, ii++),
      screenState: async () => next(screens, ci++),
      prepareScreen: async () => { calls.order.push('prepareScreen'); return banner; },
      launchApp: async (w, id) => { calls.order.push('launchApp'); calls.launch.push(id); return { launched: true, foreground: id }; },
      cancelArm: async () => { calls.cancelArm += 1; return false; },
      suspend: async (w) => { calls.order.push('suspend'); calls.suspend.push(w); if (suspendThrows) throw new Error('host said no'); return { suspended: true }; },
    },
    startAgent: (ctx) => { calls.order.push('agent'); calls.agent.push(ctx); return { proc }; },
    sleep: async (ms) => { t += ms; if (state.listening && run) store.polled(run.id); await tick(); },
    now: () => t,
    returnApp,
    limits: { startTimeoutMs: 60000, startPollMs: 3000, watchEveryMs: 10000, misses: 2, abandonMs: 60000, dropGraceMs: 15000, clientCheckMs: 3000, ...limits },
  });
  run = store.create({ uid: UID, task: 'open Settings', meta: { model: LUNA.id, ...meta } });
  const view = () => store.get(run.id, UID);
  return { store, runner, run, calls, proc, view, state, clock: () => t, start: () => runner.start({ run, uid: UID, model: LUNA }) };
}
const READY = { ready: true, state: 'ready', message: 'The phone is connected and ready.' };
const WAKING = { ready: false, state: 'waking', message: 'Starting automation on your phone. This can take up to a minute; ask me again in a few seconds.' };

// ─── the lifecycle ───────────────────────────────────────────────────────────

await ok('a task starts automation, runs the agent with the chosen model, and puts automation down', async () => {
  const w = world({ statuses: [WAKING, WAKING, READY] });
  const done = w.start();
  await tick(); await tick();
  assert.equal(w.view().status, 'starting', 'the run claimed to be driving the phone while automation was still starting');
  assert.match(w.view().last_action, /Starting automation/);
  while (w.calls.agent.length === 0) await tick();
  assert.equal(w.calls.agent[0].model.id, 'gpt-6-luna');
  assert.equal(w.calls.agent[0].device.address, WHERE.address);
  assert.equal(w.calls.suspend.length, 0, 'automation was put down while the agent was still working');
  w.store.finish(w.run.id, { success: true, summary: 'iOS 27.0' });
  w.proc.emit('close', 0);
  await done;
  assert.deepEqual([w.view().status, w.view().summary, w.view().model], ['completed', 'iOS 27.0', 'gpt-6-luna']);
  assert.deepEqual([w.calls.suspend[0].address, w.calls.suspend[0].udid], [WHERE.address, WHERE.udid], 'the wrong phone was put down');
  assert.equal(w.calls.suspend.length, 1, 'the banner would still be showing after the task');
  assert.ok(w.calls.status.every((o) => o && o.start === true), 'the task runner must be the one caller that starts automation');
});

await ok('phone unreachable: the run fails with the real reason and the agent never starts', async () => {
  const w = world({ statuses: [{ ready: false, state: 'unreachable', message: 'I cannot reach your phone. It may be switched off…' }] });
  await w.start();
  assert.equal(w.view().status, 'failed');
  assert.match(w.view().summary, /cannot reach your phone/);
  assert.equal(w.calls.agent.length, 0);
  assert.equal(w.calls.suspend.length, 1, 'even a start that never happened must leave the phone clean');
});

await ok('waiting on the passcode is narrated, and the task goes ahead once the owner answers', async () => {
  const waiting = { ready: false, state: 'waiting_on_phone', message: 'Your phone needs you: unlock it and, if it asks for your passcode to allow automation, enter it.' };
  const w = world({ statuses: [WAKING, waiting, waiting, READY] });
  const done = w.start();
  let saw = false;
  for (let i = 0; i < 40 && w.calls.agent.length === 0; i++) { if (/passcode/.test(w.view().last_action || '')) saw = true; await tick(); }
  assert.ok(saw, 'the run never told the user the phone was waiting for them');
  w.store.finish(w.run.id, { success: true, summary: 'done' });
  w.proc.emit('close', 0);
  await done;
  assert.equal(w.view().status, 'completed');
});

await ok('a start that never completes times out, says so, and cleans up', async () => {
  const w = world({ statuses: [WAKING], limits: { startTimeoutMs: 9000 } });
  await w.start();
  assert.equal(w.view().status, 'failed');
  assert.match(w.view().summary, /did not start/);
  assert.equal(w.calls.agent.length, 0);
  assert.equal(w.calls.suspend.length, 1);
});

await ok('a start the owner must fix (needs attention) ends the run with that instruction', async () => {
  const w = world({ statuses: [WAKING, { ready: false, state: 'needs_attention', message: 'Your phone did not respond in time. Unlock it, enter your passcode…' }] });
  await w.start();
  assert.match(w.view().summary, /passcode/);
  assert.equal(w.calls.agent.length, 0);
});

await ok('locked phone: refused before the agent starts, automation put straight back down', async () => {
  const w = world({ statuses: [READY], screens: [{ locked: true, lockSignals: ['label:Swipe up to unlock'] }] });
  await w.start();
  assert.equal(w.view().status, 'failed');
  assert.match(w.view().summary, /locked/i);
  assert.equal(w.calls.agent.length, 0, 'the agent was started against a lock screen');
  assert.equal(w.calls.suspend.length, 1);
});

await ok('an unreadable screen is not treated as locked', async () => {
  const w = world({ statuses: [READY], screens: [null] });
  const done = w.start();
  while (w.calls.agent.length === 0) await tick();
  w.store.finish(w.run.id, { success: true, summary: 'done' }); w.proc.emit('close', 0);
  await done;
  assert.equal(w.view().status, 'completed');
});

await ok('user says stop while automation is still starting: no agent, phone left clean', async () => {
  const w = world({ statuses: [WAKING, WAKING, WAKING, READY] });
  const done = w.start();
  await tick();
  w.store.stop(w.run.id, UID);
  await done;
  assert.equal(w.view().status, 'stopped');
  assert.equal(w.calls.agent.length, 0);
  assert.equal(w.calls.suspend.length, 1);
});

await ok('user says stop mid-task: the agent is killed and automation is put down', async () => {
  const w = world({ statuses: [READY] });
  const done = w.start();
  while (w.calls.agent.length === 0) await tick();
  w.store._raw(w.run.id).proc = w.proc;
  w.store.stop(w.run.id, UID);
  await done;
  assert.equal(w.view().status, 'stopped');
  assert.deepEqual(w.calls.kill, ['SIGTERM']);
  assert.equal(w.calls.suspend.length, 1);
});

// ─── failing while the agent is working ──────────────────────────────────────

await ok('stopped on the phone (both volume buttons) mid-task: said in those words', async () => {
  const gone = { runnerHealthy: false, phoneNet: 'wifi', tunnelState: 'live', lastSession: { endedOnDevice: true } };
  const w = world({ statuses: [READY], inspects: [{ runnerHealthy: true }, gone, gone] });
  await w.start();
  assert.equal(w.view().status, 'failed');
  assert.match(w.view().summary, /stopped on the phone/);
  assert.deepEqual(w.calls.kill, ['SIGTERM'], 'the agent kept running against a phone with no runner');
  assert.equal(w.calls.suspend.length, 1);
});

await ok('connection lost mid-task (power-off, no signal): said as a lost connection', async () => {
  const gone = { runnerHealthy: false, phoneNet: 'unreachable', tunnelState: 'stale', lastSession: { endedOnDevice: false } };
  const w = world({ statuses: [READY], inspects: [gone, gone] });
  await w.start();
  assert.match(w.view().summary, /connection to your phone was lost/);
  assert.equal(w.calls.suspend.length, 1, 'the leftover anchor would never be cleared');
});

await ok('one bad reading is a blip, not a verdict', async () => {
  const gone = { runnerHealthy: false, phoneNet: 'wifi', lastSession: { endedOnDevice: false } };
  const w = world({ statuses: [READY], inspects: [gone, { runnerHealthy: true }, { runnerHealthy: true }] });
  const done = w.start();
  for (let i = 0; i < 12; i++) await tick();
  assert.notEqual(w.view().status, 'failed', 'a single failed probe ended the task');
  w.store.finish(w.run.id, { success: true, summary: 'done' }); w.proc.emit('close', 0);
  await done;
  assert.equal(w.view().status, 'completed');
});

await ok('a status check that could not be read at all does not end the task', async () => {
  const w = world({ statuses: [READY], inspects: [null, null, null, { runnerHealthy: true }] });
  const done = w.start();
  for (let i = 0; i < 16; i++) await tick();
  assert.notEqual(w.view().status, 'failed');
  w.store.finish(w.run.id, { success: true, summary: 'done' }); w.proc.emit('close', 0);
  await done;
});

await ok('phone locked mid-task: the agent is stopped and the user is told why', async () => {
  const w = world({ statuses: [READY], screens: [{ locked: false }, { locked: true }, { locked: true }] });
  await w.start();
  assert.match(w.view().summary, /locked during the task/);
  assert.deepEqual(w.calls.kill, ['SIGTERM']);
  assert.equal(w.calls.suspend.length, 1);
});

await ok('the agent dying without a verdict still ends the run and cleans the phone', async () => {
  const w = world({ statuses: [READY] });
  const done = w.start();
  while (w.calls.agent.length === 0) await tick();
  w.proc.emit('close', 1);
  await done;
  assert.equal(w.view().status, 'failed');
  assert.equal(w.calls.suspend.length, 1);
});

await ok('if putting automation down fails, the run still ends and nothing throws', async () => {
  const w = world({ statuses: [READY], suspendThrows: true });
  const done = w.start();
  while (w.calls.agent.length === 0) await tick();
  w.store.finish(w.run.id, { success: true, summary: 'done' }); w.proc.emit('close', 0);
  await done;
  assert.equal(w.view().status, 'completed');
});

// ─── is anyone still listening? ──────────────────────────────────────────────

await ok('the chat stops following a running task: the agent is stopped and automation put down', async () => {
  const w = world({ statuses: [READY] });
  const done = w.start();
  while (w.calls.agent.length === 0) await tick();
  assert.notEqual(w.view().status, 'stopped');
  w.state.listening = false;                       // Stop pressed in the chat: no more status checks
  assert.ok(await settled(done), 'the task carried on although the chat had stopped following it');
  assert.equal(w.view().status, 'stopped');
  assert.match(w.view().summary, /chat stopped following/);
  assert.deepEqual(w.calls.kill, ['SIGTERM'], 'the agent kept driving the phone with nobody watching');
  assert.equal(w.calls.suspend.length, 1, 'the banner would stay up after the chat was stopped');
});

await ok('a status check cut off mid-wait ends the task much sooner than plain silence', async () => {
  const w = world({ statuses: [READY] });
  const done = w.start();
  while (w.calls.agent.length === 0) await tick();
  w.state.listening = false;
  const at = w.clock();
  w.store.clientDropped(w.run.id);                 // the in-flight check was dropped
  assert.ok(await settled(done), 'the task carried on after its status check was cut off');
  assert.match(w.view().summary, /chat was stopped/);
  assert.ok(w.clock() - at < 40000, `took ${w.clock() - at}ms of task time to react to a dropped check`);
  assert.equal(w.calls.suspend.length, 1);
});

await ok('a dropped check followed by a fresh one is forgiven', async () => {
  const w = world({ statuses: [READY] });
  const done = w.start();
  while (w.calls.agent.length === 0) await tick();
  w.store.clientDropped(w.run.id);                 // dropped…
  for (let i = 0; i < 30; i++) await tick();       // …but the chat keeps checking (listening is on)
  assert.equal(w.view().status === 'stopped', false, 'one dropped request killed a task that was still being followed');
  w.store.finish(w.run.id, { success: true, summary: 'done' }); w.proc.emit('close', 0);
  await done;
  assert.equal(w.view().status, 'completed');
});

await ok('a task waiting for the user\'s answer is NOT treated as abandoned', async () => {
  const w = world({ statuses: [READY] });
  const done = w.start();
  while (w.calls.agent.length === 0) await tick();
  w.store.ask(w.run.id, { question: 'Which Sam?', options: ['Sam Chen', 'Sam Ortiz'] });
  w.state.listening = false;
  for (let i = 0; i < 80; i++) await tick();
  assert.equal(w.view().status, 'awaiting_answer', 'the task was killed while the user was deciding');
  w.store.finish(w.run.id, { success: true, summary: 'done' }); w.proc.emit('close', 0);
  await done;
});

await ok('the chat goes away while automation is still STARTING: the bring-up is cancelled, nothing is left running', async () => {
  const w = world({ statuses: [WAKING], limits: { startTimeoutMs: 10 * 60 * 1000 } });
  w.state.listening = false;
  assert.ok(await settled(w.start()), 'a start nobody was waiting for was never given up');
  assert.equal(w.view().status, 'stopped');
  assert.equal(w.calls.agent.length, 0);
  assert.ok(w.calls.cancelArm >= 1, 'a bring-up in flight would finish later and leave the banner up');
  assert.equal(w.calls.suspend.length, 1);
});

// ─── the screen before, and the phone after ──────────────────────────────────

await ok('before the agent starts, the top of the screen is cleared — after the lock check, before the agent', async () => {
  const w = world({ statuses: [READY], banner: { bannerFound: true, text: 'Claude’s reply', cleared: true, swipes: 1 } });
  const done = w.start();
  while (w.calls.agent.length === 0) await tick();
  assert.deepEqual(w.calls.order.slice(0, 2), ['prepareScreen', 'agent']);
  w.store.finish(w.run.id, { success: true, summary: 'done' }); w.proc.emit('close', 0);
  await done;
});

await ok('a locked phone is never swiped at', async () => {
  const w = world({ statuses: [READY], screens: [{ locked: true }] });
  await w.start();
  assert.equal(w.calls.order.includes('prepareScreen'), false);
});

await ok('when a task ends, the phone is returned to the Claude app, THEN automation is put down', async () => {
  const w = world({ statuses: [READY], returnApp: 'com.anthropic.claude' });
  const done = w.start();
  while (w.calls.agent.length === 0) await tick();
  w.store.finish(w.run.id, { success: true, summary: 'done' }); w.proc.emit('close', 0);
  await done;
  assert.deepEqual(w.calls.launch, ['com.anthropic.claude']);
  assert.deepEqual(w.calls.order.slice(-2), ['launchApp', 'suspend'], 'the runner was put down before it could bring the app back');
});

await ok('"stay" leaves the phone where the task ended', async () => {
  const w = world({ statuses: [READY], returnApp: 'com.anthropic.claude', meta: { whenDone: 'stay' } });
  const done = w.start();
  while (w.calls.agent.length === 0) await tick();
  w.store.finish(w.run.id, { success: true, summary: 'done' }); w.proc.emit('close', 0);
  await done;
  assert.deepEqual(w.calls.launch, []);
  assert.equal(w.calls.suspend.length, 1);
});

await ok('nothing is brought forward when automation never came up', async () => {
  const w = world({ statuses: [{ ready: false, state: 'unreachable', message: 'I cannot reach your phone.' }], returnApp: 'com.anthropic.claude' });
  await w.start();
  assert.deepEqual(w.calls.launch, []);
});

// ─── the waiting status check ────────────────────────────────────────────────

function waitingApi() {
  let t = 0;
  const store = createRunStore({ now: () => t });
  const a = createToolApi({
    store, statusWaitMs: 10000,
    devices: { status: async () => ({ ready: true, state: 'ready', ...WHERE, message: 'ok' }) },
    startRun: () => {},
    now: () => t,
    sleep: async (ms) => { t += ms; await tick(); },
  });
  return { a, store, clock: () => t, advance: (ms) => { t += ms; }, caller: { uid: UID } };
}

await ok('a status check waits for progress and answers the moment something changes', async () => {
  const { a, store, clock, caller } = waitingApi();
  const run = (await a.call('run_phone_task', { task: 'open Settings' }, caller)).run_id;
  const pending = a.call('get_run_status', {}, caller);
  await tick(); await tick();
  store.progress(run, { step: 1, lastAction: 'Opening Settings' });
  const r = await pending;
  assert.deepEqual([r.status, r.step, r.last_action], ['running', 1, 'Opening Settings']);
  assert.ok(clock() < 3000, `answered after ${clock()}ms although the run had already changed`);
});

await ok('with nothing new it answers after about ten seconds, and tells the model to call straight back', async () => {
  const { a, clock, caller } = waitingApi();
  await a.call('run_phone_task', { task: 'open Settings' }, caller);
  const r = await a.call('get_run_status', {}, caller);
  assert.ok(clock() >= 10000 && clock() < 11000, `waited ${clock()}ms`);
  assert.equal(r.status, 'starting');
  assert.match(r.next_step, /right away/);
  assert.doesNotMatch(r.next_step, /[Ww]ait a few seconds/);
});

await ok('repeating the same progress note does not wake a waiting status check', async () => {
  const { a, store, clock, caller } = waitingApi();
  const run = (await a.call('run_phone_task', { task: 'open Settings' }, caller)).run_id;
  store.note(run, 'Starting automation on your phone…');
  const pending = a.call('get_run_status', {}, caller);
  for (let i = 0; i < 6; i++) { await tick(); store.note(run, 'Starting automation on your phone…'); }
  store.note(run, 'Your phone needs you: unlock it.');
  const r = await pending;
  assert.match(r.message, /needs you/);
  assert.ok(clock() >= 1500, `woke after ${clock()}ms on a note that said nothing new`);
});

await ok('a finished run is answered at once, however often it is asked', async () => {
  const { a, store, clock, caller } = waitingApi();
  const run = (await a.call('run_phone_task', { task: 'open Settings' }, caller)).run_id;
  store.finish(run, { success: true, summary: 'iOS 27.0' });
  const before = clock();
  const r = await a.call('get_run_status', {}, caller);
  assert.equal(clock(), before);
  assert.deepEqual([r.status, r.message], ['completed', 'iOS 27.0']);
});

await ok('every check marks the chat as listening; one cut off mid-wait is recorded as dropped', async () => {
  const { a, store, advance, caller } = waitingApi();
  const run = (await a.call('run_phone_task', { task: 'open Settings' }, caller)).run_id;
  advance(30000);
  const gone = new AbortController();
  const pending = a.call('get_run_status', {}, { ...caller, signal: gone.signal });
  await tick();
  assert.ok(store._raw(run).lastPolledAt >= 30000, 'the check did not register as the chat listening');
  gone.abort();
  const r = await pending;
  assert.equal(r.error, 'cancelled');
  assert.ok(store._raw(run).clientDroppedAt !== null, 'a dropped check left no trace');
  await a.call('get_run_status', {}, caller);
  assert.equal(store._raw(run).clientDroppedAt, null, 'a later check should clear the drop');
});

await ok('where to leave the phone is recorded with the task', async () => {
  const { a, store, caller } = waitingApi();
  const r1 = (await a.call('run_phone_task', { task: 'tell me the iOS version' }, caller)).run_id;
  assert.equal(store._raw(r1).meta.whenDone, 'return');
  store.finish(r1, { success: true, summary: 'x' });
  const r2 = (await a.call('run_phone_task', { task: 'open Maps and start directions', when_done: 'stay' }, caller)).run_id;
  assert.equal(store._raw(r2).meta.whenDone, 'stay');
});

// ─── choosing the model ──────────────────────────────────────────────────────

await ok('models resolve from ids and from how people say them; a family name means its newest member', () => {
  assert.equal(resolveModel('gpt-6-luna').id, 'gpt-6-luna');
  assert.equal(resolveModel('Luna').id, 'gpt-6-luna');
  assert.equal(resolveModel('GPT-6 Luna').id, 'gpt-6-luna');
  assert.equal(resolveModel('luna 5.6').id, 'gpt-5.6-luna');
  assert.equal(resolveModel('Sonnet').provider, 'anthropic');
  assert.equal(resolveModel('gemini flash').id, 'gemini-3.6-flash');
  assert.equal(resolveModel('gpt-9000'), null);
  assert.equal(resolveModel(''), null);
  const all = Object.values(MODELS).flatMap((m) => m.aliases.map((a) => a.toLowerCase()));
  assert.equal(new Set(all).size, all.length, 'two models share an alias');
});

await ok('a key is "present" only when it is actually set', () => {
  assert.equal(providerKeyPresent('openai', { OPENAI_API_KEY: 'sk-x' }), true);
  assert.equal(providerKeyPresent('openai', { OPENAI_API_KEY: '  ' }), false);
  assert.equal(providerKeyPresent('anthropic', { OPENAI_API_KEY: 'sk-x' }), false);
  assert.equal(providerKeyPresent('nope', {}), false);
});

const dir = mkdtempSync(join(tmpdir(), 'prefs-'));
function api({ status = { ready: false, startable: true, state: 'standby', ...WHERE, message: 'standby' }, keys = ['openai', 'anthropic'] } = {}) {
  const store = createRunStore({});
  const started = []; const statusOpts = [];
  const prefs = createPrefs({ path: join(dir, `p-${Math.random().toString(36).slice(2)}.json`) });
  const a = createToolApi({ statusWaitMs: 0,
    store, prefs,
    devices: { status: async (_u, o) => { statusOpts.push(o); return status; } },
    hasProviderKey: (p) => keys.includes(p),
    startRun: (ctx) => { started.push(ctx); },
  });
  return { a, store, started, statusOpts, prefs, caller: { uid: UID, email: 'a@b.c' } };
}

await ok('the default is GPT-6 Luna, and a task on a standby phone is accepted without starting automation itself', async () => {
  const { a, started, statusOpts, caller } = api();
  const r = await a.call('run_phone_task', { task: 'open Settings' }, caller);
  assert.deepEqual([r.ok, r.status, r.model], [true, 'starting', 'gpt-6-luna']);
  assert.match(r.message, /GPT-6 Luna/);
  assert.equal(started[0].model.id, 'gpt-6-luna');
  assert.equal(started[0].uid, UID);
  assert.ok(statusOpts.every((o) => !o || o.start !== true), 'the tool started automation instead of leaving it to the task runner');
});

await ok('"use Sonnet for this one" changes that task only', async () => {
  const { a, started, store, caller } = api();
  const r = await a.call('run_phone_task', { task: 'open Maps', model: 'Sonnet' }, caller);
  assert.equal(r.model, 'claude-sonnet-5');
  assert.equal(started[0].model.provider, 'anthropic');
  store.finish(r.run_id, { success: true, summary: 'x' });
  const next = await a.call('run_phone_task', { task: 'open Maps again' }, caller);
  assert.equal(next.model, 'gpt-6-luna', 'a one-off choice changed the default');
});

await ok('"from now on use Sol" changes the default, per user, and shows up in the status answer', async () => {
  const { a, caller } = api();
  const set = await a.call('set_default_model', { model: 'Sol' }, caller);
  assert.deepEqual([set.ok, set.default_model], [true, 'gpt-6-sol']);
  assert.equal((await a.call('run_phone_task', { task: 'open Notes' }, caller)).model, 'gpt-6-sol');
  assert.equal((await a.call('get_phone_status', {}, caller)).default_model, 'gpt-6-sol');
  assert.equal((await a.call('get_phone_status', {}, { uid: 'someone-else' })).default_model, 'gpt-6-luna', 'one user\'s choice leaked to another');
});

await ok('an unknown model, or one with no key on the server, is refused BEFORE the phone is touched', async () => {
  const { a, started, statusOpts, caller } = api({ keys: ['openai'] });
  const typo = await a.call('run_phone_task', { task: 'x', model: 'lunar-9' }, caller);
  assert.equal(typo.error, 'unknown_model');
  assert.match(typo.message, /GPT-6 Luna/);
  const nokey = await a.call('run_phone_task', { task: 'x', model: 'sonnet' }, caller);
  assert.equal(nokey.error, 'model_unavailable');
  assert.match(nokey.message, /anthropic/);
  assert.equal((await a.call('set_default_model', { model: 'sonnet' }, caller)).error, 'model_unavailable');
  assert.equal(started.length, 0);
  assert.equal(statusOpts.length, 0, 'the phone was probed for a task that could never run');
});

await ok('a phone that cannot start is refused with its own message', async () => {
  const { a, started, caller } = api({ status: { ready: false, state: 'needs_wifi', message: 'Your phone is on cellular and automation is not running…' } });
  const r = await a.call('run_phone_task', { task: 'x' }, caller);
  assert.deepEqual([r.ok, r.error], [false, 'needs_wifi']);
  assert.equal(started.length, 0);
});

await ok('the tool list offers set_default_model and a model argument only where they exist', () => {
  const { a } = api();
  assert.ok(a.definitions.some((t) => t.name === 'set_default_model'));
  assert.ok(a.definitions.find((t) => t.name === 'run_phone_task').inputSchema.properties.model);
  const plain = createToolApi({ statusWaitMs: 0, store: createRunStore({}), devices: { status: async () => ({}) }, startRun: () => {} });
  assert.equal(plain.definitions.some((t) => t.name === 'set_default_model'), false);
});

await ok('the agent is launched with the chosen model, or with none to use its own default', () => {
  const base = { agentPath: '/a/agent.mjs', task: 't', driverHost: '1.2.3.4', runId: 'r1' };
  const withModel = buildAgentArgs({ ...base, provider: 'openai', model: 'gpt-6-luna' });
  assert.equal(withModel[withModel.indexOf('--model') + 1], 'gpt-6-luna');
  assert.equal(withModel[withModel.indexOf('--provider') + 1], 'openai');
  assert.equal(buildAgentArgs(base).includes('--model'), false);
});

rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} task-runner assertions passed`);
// A mutated or broken runner can leave a watch loop spinning; do not let that
// keep the process (and CI) alive after the verdict is in.
process.exit(process.exitCode || 0);
