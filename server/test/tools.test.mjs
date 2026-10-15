#!/usr/bin/env node
// tools.test.mjs — device-free tests for the connector's run lifecycle,
// the agent-output parser, the tool layer and the MCP framing.
//
// No child process, no phone, no network: the agent spawn is injected, and the
// parser is fed the exact stdout lines agent.mjs prints (copied from
// agent/agent.mjs, so a change there fails here rather than in production).

import assert from 'node:assert/strict';

import { createRunStore, isTerminal, RUN_STATES } from '../src/runs.mjs';
import { createAgentOutputParser, applyEvent, buildAgentArgs, describe } from '../src/agent-runner.mjs';
import {
  createToolApi, TOOL_DEFINITIONS, HARD_MAX_STEPS, MAX_TASK_CHARS,
} from '../src/tool-api.mjs';
import { createMcpHandler, SUPPORTED_PROTOCOL_VERSIONS } from '../src/mcp.mjs';
import { createDeviceResolver } from '../src/device-resolver.mjs';

let passed = 0;
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; });
}

const ALICE = 'uid-alice';
const BOB = 'uid-bob';

// ─── run registry ────────────────────────────────────────────────────────────

await ok('a created run starts in "starting" and is visible to its owner only', () => {
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 'open Maps' });
  assert.equal(s.get(run.id, ALICE).status, 'starting');
  assert.equal(s.get(run.id, BOB), null, 'another tenant could read the run');
});

await ok('only one run at a time per user; a second user is unaffected', () => {
  const s = createRunStore({});
  s.create({ uid: ALICE, task: 'a' });
  assert.throws(() => s.create({ uid: ALICE, task: 'b' }), (e) => e.code === 'RUN_IN_PROGRESS');
  assert.ok(s.create({ uid: BOB, task: 'c' }), 'a second user was blocked by the first');
});

await ok('progress moves starting → running and records the action', () => {
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 'a' });
  s.progress(run.id, { step: 3, lastAction: 'Opening LinkedIn' });
  const v = s.get(run.id, ALICE);
  assert.equal(v.status, 'running');
  assert.equal(v.step, 3);
  assert.equal(v.last_action, 'Opening LinkedIn');
});

await ok('a question surfaces on the status view and is answerable', () => {
  const delivered = [];
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 'text Sam' });
  s._raw(run.id).answerSink = (c) => delivered.push(c);
  s.ask(run.id, { question: 'Which Sam?', options: ['Sam Chen', 'Sam Ortiz'] });

  const waiting = s.get(run.id, ALICE);
  assert.equal(waiting.status, 'awaiting_answer');
  assert.equal(waiting.question, 'Which Sam?');
  assert.deepEqual(waiting.options, ['Sam Chen', 'Sam Ortiz']);

  const res = s.answer(run.id, ALICE, 'Sam Chen');
  assert.equal(res.ok, true);
  assert.deepEqual(delivered, ['Sam Chen'], 'the answer never reached the agent');
  assert.equal(s.get(run.id, ALICE).status, 'running');
});

await ok('a paraphrased answer resolves to an offered option; ambiguity does not', () => {
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 't' });
  s.ask(run.id, { question: 'Which?', options: ['Sam Chen', 'Sam Ortiz'] });
  assert.equal(s.answer(run.id, ALICE, 'the first one, Sam Chen please').answer, 'Sam Chen');

  const s2 = createRunStore({});
  const r2 = s2.create({ uid: ALICE, task: 't' });
  s2.ask(r2.id, { question: 'Which?', options: ['Sam', 'Sammy'] });
  const bad = s2.answer(r2.id, ALICE, 'Sam and Sammy both');
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'not_an_option');
});

await ok('an off-menu answer to a closed question is refused', () => {
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 't' });
  s.ask(run.id, { question: 'Which?', options: ['A', 'B'] });
  const res = s.answer(run.id, ALICE, 'C');
  assert.equal(res.ok, false);
  assert.deepEqual(res.options, ['A', 'B']);
  assert.equal(s.get(run.id, ALICE).status, 'awaiting_answer', 'the run left the waiting state on a bad answer');
});

await ok('a free-text question accepts free text', () => {
  const delivered = [];
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 't' });
  s._raw(run.id).answerSink = (c) => delivered.push(c);
  s.ask(run.id, { question: 'What is the code?', type: 'text', hint: '6 digits' });
  assert.equal(s.get(run.id, ALICE).hint, '6 digits');
  assert.equal(s.answer(run.id, ALICE, '123456').ok, true);
  assert.deepEqual(delivered, ['123456']);
});

await ok('another tenant cannot answer or stop your run', () => {
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 't' });
  s.ask(run.id, { question: 'Which?', options: ['A'] });
  assert.equal(s.answer(run.id, BOB, 'A').reason, 'no_such_run');
  assert.equal(s.stop(run.id, BOB).reason, 'no_such_run');
  assert.equal(s.get(run.id, ALICE).status, 'awaiting_answer');
});

await ok('answering a run that is not waiting reports why', () => {
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 't' });
  const res = s.answer(run.id, ALICE, 'anything');
  assert.equal(res.reason, 'not_waiting');
  assert.equal(res.status, 'starting');
});

await ok('stop kills the process, is idempotent, and reports what happened', () => {
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 't' });
  let killed = 0;
  s._raw(run.id).proc = { kill: () => { killed++; } };
  const first = s.stop(run.id, ALICE);
  assert.equal(first.ok, true);
  assert.equal(killed, 1);
  assert.equal(first.run.status, 'stopped');
  const second = s.stop(run.id, ALICE);
  assert.equal(second.alreadyFinished, true);
  assert.equal(killed, 1, 'stop killed the process twice');
});

await ok('a terminal run ignores late progress and cannot be re-finished', () => {
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 't' });
  s.finish(run.id, { success: true, summary: 'Done.' });
  assert.equal(s.progress(run.id, { step: 9 }), null);
  assert.equal(s.finish(run.id, { success: false, summary: 'no' }), null);
  const v = s.get(run.id, ALICE);
  assert.equal(v.status, 'completed');
  assert.equal(v.summary, 'Done.');
});

await ok('clearQuestion releases a run whose askUser timed out', () => {
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 't' });
  s.ask(run.id, { question: 'Which?', options: ['A'] });
  s.clearQuestion(run.id);
  const v = s.get(run.id, ALICE);
  assert.equal(v.status, 'running');
  assert.equal(v.question, undefined);
});

await ok('the status view never leaks internals or another tenant', () => {
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 't', meta: { email: 'a@b.c' } });
  s._raw(run.id).proc = { kill() {} };
  const v = s.get(run.id, ALICE);
  const keys = Object.keys(v);
  for (const forbidden of ['proc', 'answerSink', 'uid', 'meta', 'log']) {
    assert.ok(!keys.includes(forbidden), `status view leaked ${forbidden}`);
  }
});

await ok('finished runs are pruned per user, active ones never', () => {
  const s = createRunStore({ keep: 2 });
  for (let i = 0; i < 5; i++) {
    const r = s.create({ uid: ALICE, task: `t${i}` });
    s.finish(r.id, { success: true, summary: 'x' });
  }
  assert.equal(s.list(ALICE, 99).length, 2);
});

await ok('isTerminal covers exactly the final states', () => {
  assert.deepEqual(RUN_STATES.filter(isTerminal), ['completed', 'failed', 'stopped']);
});

// ─── agent stdout parser ─────────────────────────────────────────────────────

function collect(lines) {
  const events = [];
  const p = createAgentOutputParser((e) => events.push(e));
  for (const l of lines) p.feed(l + '\n');
  p.end();
  return events;
}

await ok('parses a step line', () => {
  const [e] = collect(['--- Step 4/25 --- (12.3s total)']);
  assert.deepEqual(e, { type: 'step', step: 4, total: 25, elapsed: '12.3' });
});

await ok('parses a tool call into a human sentence', () => {
  const [e] = collect(['[Tool] openApp({"appName":"LinkedIn"})']);
  assert.equal(e.type, 'action');
  assert.equal(e.tool, 'openApp');
  assert.equal(e.text, 'Opening LinkedIn');
});

await ok('parses __ASK_USER__ with options', () => {
  const [e] = collect(['__ASK_USER__:{"question":"Which Sam?","options":["Sam Chen","Sam Ortiz"]}']);
  assert.equal(e.type, 'ask');
  assert.equal(e.kind, 'options');
  assert.deepEqual(e.options, ['Sam Chen', 'Sam Ortiz']);
});

await ok('parses __ASK_USER_TEXT__ with a hint', () => {
  const [e] = collect(['__ASK_USER_TEXT__:{"question":"Code?","hint":"6 digits"}']);
  assert.equal(e.kind, 'text');
  assert.equal(e.hint, '6 digits');
});

await ok('the completion summary on the FOLLOWING line is captured', () => {
  const events = collect([
    '==================================================',
    '  ✅ TASK COMPLETED',
    '  Finished the puzzle — you scored 4 of 5.',
    '──────────────────────────────────────────────────',
    '  Total time:    41.2s',
  ]);
  const done = events.find((e) => e.type === 'done');
  assert.equal(done.summary, 'Finished the puzzle — you scored 4 of 5.');
});

await ok('an inline DB-verified completion is captured without eating the next line', () => {
  const events = collect(['  ✅ TASK COMPLETED (DB-verified) — 3 rows']);
  assert.equal(events.filter((e) => e.type === 'done').length, 1);
  assert.match(events[0].summary, /DB-verified/);
});

await ok('failure and max-steps both end the run with a reason', () => {
  const failed = collect(['  ❌ TASK FAILED (12.0s)', '  Could not find the game tab.']);
  assert.equal(failed.find((e) => e.type === 'failed').reason, 'Could not find the game tab.');
  const maxed = collect(['  MAX STEPS REACHED']);
  assert.match(maxed[0].reason, /step limit/);
});

await ok('an infra abort is distinguishable from a task failure', () => {
  const [e] = collect(['  ❌ INFRA: device transport unreachable — 4 consecutive tool-error steps.']);
  assert.equal(e.type, 'infra');
  assert.match(e.detail, /transport unreachable/);
});

await ok('an askUser timeout emits ask_timeout so the run does not hang', () => {
  const [e] = collect(['[askUser] No response after 300s — giving up (unattended run).']);
  assert.equal(e.type, 'ask_timeout');
});

await ok('lines split across chunks are still parsed exactly once', () => {
  const events = [];
  const p = createAgentOutputParser((e) => events.push(e));
  p.feed('--- Step 2/10 -');
  p.feed('-- (1.0s tot');
  p.feed('al)\n');
  assert.deepEqual(events, [{ type: 'step', step: 2, total: 10, elapsed: '1.0' }]);
});

await ok('a trailing line without a newline is flushed on end()', () => {
  const events = [];
  const p = createAgentOutputParser((e) => events.push(e));
  p.feed('  ❌ TASK FAILED: the app was not installed');
  p.end();
  assert.equal(events[0].type, 'failed');
});

await ok('describe() degrades to the tool name for unknown tools', () => {
  assert.equal(describe('someNewTool', {}), 'someNewTool');
});

// ─── parser → registry mapping ───────────────────────────────────────────────

await ok('applyEvent drives a full run from stdout events alone', () => {
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 'finish the game' });
  const events = collect([
    '--- Step 1/25 --- (0.5s total)',
    '[Tool] openApp({"appName":"LinkedIn"})',
    '__ASK_USER__:{"question":"Which puzzle?","options":["Queens","Tango"]}',
  ]);
  for (const e of events) applyEvent(s, run.id, e);
  let v = s.get(run.id, ALICE);
  assert.equal(v.status, 'awaiting_answer');
  assert.equal(v.step, 1);
  assert.equal(v.last_action, 'Opening LinkedIn');

  s.answer(run.id, ALICE, 'Queens');
  for (const e of collect(['  ✅ TASK COMPLETED', '  Queens solved in 41 seconds.'])) applyEvent(s, run.id, e);
  v = s.get(run.id, ALICE);
  assert.equal(v.status, 'completed');
  assert.equal(v.success, true);
  assert.equal(v.summary, 'Queens solved in 41 seconds.');
});

await ok('an infra event finishes the run as failed with the detail kept', () => {
  const s = createRunStore({});
  const run = s.create({ uid: ALICE, task: 't' });
  applyEvent(s, run.id, { type: 'infra', detail: 'transport unreachable' });
  const v = s.get(run.id, ALICE);
  assert.equal(v.status, 'failed');
  assert.match(v.error, /transport unreachable/);
});

// ─── agent argv ──────────────────────────────────────────────────────────────

await ok('buildAgentArgs targets the phone over the mesh with a finite HITL timeout', () => {
  const args = buildAgentArgs({
    agentPath: '/repo/agent.mjs', task: 'do a thing', maxSteps: 12,
    driverHost: '100.64.0.11', runId: 'run_abc',
  });
  const pairs = new Map();
  for (let i = 0; i < args.length; i++) if (args[i].startsWith('--')) pairs.set(args[i], args[i + 1]);
  assert.equal(args[0], '/repo/agent.mjs');
  assert.equal(args[1], 'do a thing');
  assert.equal(pairs.get('--backend'), 'phone-direct');
  assert.equal(pairs.get('--driver-host'), '100.64.0.11');
  assert.equal(pairs.get('--driver-port'), '22087');
  assert.equal(pairs.get('--max-steps'), '12');
  assert.equal(pairs.get('--log-run-id'), 'run_abc');
  assert.equal(pairs.get('--runtime-guard'), 'off');
  assert.notEqual(pairs.get('--askuser-timeout'), '0', 'an unattended run could hang forever');
});

await ok('buildAgentArgs refuses to guess a phone address or an empty task', () => {
  assert.throws(() => buildAgentArgs({ agentPath: 'a', task: 'x', runId: 'r' }), /driverHost/);
  assert.throws(() => buildAgentArgs({ agentPath: 'a', task: '  ', driverHost: 'h', runId: 'r' }), /task/);
});

// ─── device resolver ─────────────────────────────────────────────────────────

const registryOf = (devices) => () => ({ devices });

await ok('device states map to actionable messages', async () => {
  const cases = [
    [[], 'not_enrolled'],
    [[{ uid: ALICE, status: 'pending' }], 'pending'],
    [[{ uid: ALICE, revokedAt: '2026-08-01T00:00:00Z' }], 'revoked'],
    [[{ uid: ALICE, status: 'approved' }], 'no_address'],
  ];
  for (const [devices, expected] of cases) {
    const r = createDeviceResolver({ loadRegistry: registryOf(devices) });
    const s = await r.status(ALICE);
    assert.equal(s.state, expected);
    assert.equal(s.ready, false);
    assert.ok(s.message.length > 10, `state ${expected} had no useful message`);
  }
});

await ok('a live runner reads ready; a dead one reads needs_wake, not "broken"', async () => {
  const devices = [{ uid: ALICE, status: 'approved', address: '100.64.0.11', udid: 'UDID-A' }];
  const up = createDeviceResolver({ loadRegistry: registryOf(devices), probe: async () => ({ ready: true }) });
  assert.equal((await up.status(ALICE)).state, 'ready');

  const down = createDeviceResolver({ loadRegistry: registryOf(devices), probe: async () => ({ ready: false, detail: 'ECONNREFUSED' }) });
  const s = await down.status(ALICE);
  assert.equal(s.state, 'needs_wake');
  assert.match(s.message, /not connected right now/i);
  assert.equal(s.detail, 'ECONNREFUSED');
});

await ok('an arm delegate is used when configured, and its failure stays honest', async () => {
  const devices = [{ uid: ALICE, status: 'approved', address: '100.64.0.11' }];
  const armed = createDeviceResolver({
    loadRegistry: registryOf(devices),
    probe: async () => ({ ready: false }),
    armDelegate: async () => ({ armed: true }),
  });
  assert.equal((await armed.status(ALICE)).ready, true);

  const failed = createDeviceResolver({
    loadRegistry: registryOf(devices),
    probe: async () => ({ ready: false }),
    armDelegate: async () => { throw new Error('supervisor said no'); },
  });
  const s = await failed.status(ALICE);
  assert.equal(s.ready, false);
  assert.equal(s.state, 'needs_wake');
  assert.match(s.detail, /supervisor said no/);
});

// ─── tool layer ──────────────────────────────────────────────────────────────

function fixture({ ready = true, startRun = () => {} } = {}) {
  const store = createRunStore({});
  const devices = {
    status: async () => (ready
      ? { ready: true, state: 'ready', address: '100.64.0.11', udid: 'U', message: 'ready' }
      : { ready: false, state: 'needs_wake', message: 'The phone is not connected right now.' }),
  };
  const api = createToolApi({ statusWaitMs: 0, store, devices, startRun });
  return { store, api, caller: { uid: ALICE, email: 'a@b.c' } };
}

await ok('every tool is annotated with a title and a read-only/destructive hint', () => {
  for (const t of TOOL_DEFINITIONS) {
    assert.ok(t.annotations?.title, `${t.name} has no annotation title`);
    assert.ok('readOnlyHint' in t.annotations && 'destructiveHint' in t.annotations, `${t.name} is missing hints`);
    assert.equal(t.inputSchema.type, 'object');
  }
  const run = TOOL_DEFINITIONS.find((t) => t.name === 'run_phone_task');
  assert.equal(run.annotations.destructiveHint, true, 'driving someone\'s phone must be flagged destructive');
  assert.equal(TOOL_DEFINITIONS.find((t) => t.name === 'get_run_status').annotations.readOnlyHint, true);
});

await ok('tool descriptions teach the poll-and-relay protocol', () => {
  const byName = Object.fromEntries(TOOL_DEFINITIONS.map((t) => [t.name, t]));
  assert.match(byName.run_phone_task.description, /get_run_status/);
  assert.match(byName.get_run_status.description, /answer_question/);
  assert.match(byName.get_run_status.description, /awaiting_answer/);
});

await ok('a call without an authenticated caller is impossible', async () => {
  const { api } = fixture();
  await assert.rejects(() => api.call('get_phone_status', {}, {}), /authenticated caller/);
});

await ok('an unknown tool is a clean error, not a throw', async () => {
  const { api, caller } = fixture();
  const r = await api.call('rm_rf', {}, caller);
  assert.equal(r.error, 'unknown_tool');
});

await ok('run_phone_task refuses when the phone is not ready, and never spawns', async () => {
  let spawned = 0;
  const { api, caller } = fixture({ ready: false, startRun: () => { spawned++; } });
  const r = await api.call('run_phone_task', { task: 'do it' }, caller);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'needs_wake');
  assert.match(r.message, /not connected/i);
  assert.equal(spawned, 0, 'an agent was started against an unreachable phone');
});

await ok('run_phone_task validates the task before touching anything', async () => {
  const { api, caller } = fixture();
  assert.equal((await api.call('run_phone_task', { task: '   ' }, caller)).error, 'missing_task');
  const long = await api.call('run_phone_task', { task: 'x'.repeat(MAX_TASK_CHARS + 1) }, caller);
  assert.equal(long.error, 'task_too_long');
});

await ok('max_steps is clamped, never trusted', async () => {
  let seen = null;
  const { api, caller } = fixture({ startRun: ({ run }) => { seen = run.maxSteps; } });
  await api.call('run_phone_task', { task: 'a', max_steps: 9999 }, caller);
  assert.equal(seen, HARD_MAX_STEPS);
});

await ok('a failed spawn finishes the run instead of leaving it hanging', async () => {
  const { api, store, caller } = fixture({ startRun: () => { throw new Error('no node_modules'); } });
  const r = await api.call('run_phone_task', { task: 'a' }, caller);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'start_failed');
  assert.equal(store.get(r.run_id, ALICE).status, 'failed');
  // …and the user is not left permanently "busy".
  const again = await api.call('run_phone_task', { task: 'b' }, fixtureCaller());
  assert.notEqual(again.error, 'busy');

  function fixtureCaller() { return caller; }
});

await ok('a second task while one is running reports busy, not a silent queue', async () => {
  const { api, caller } = fixture();
  await api.call('run_phone_task', { task: 'first' }, caller);
  const second = await api.call('run_phone_task', { task: 'second' }, caller);
  assert.equal(second.error, 'busy');
  assert.ok(second.run.run_id);
});

await ok('the full conversational loop: start → poll → question → answer → finish', async () => {
  const delivered = [];
  const { api, store, caller } = fixture({
    startRun: ({ run }) => { store._raw(run.id).answerSink = (c) => delivered.push(c); },
  });

  const started = await api.call('run_phone_task', { task: 'text Sam' }, caller);
  assert.equal(started.ok, true);
  assert.match(started.message, /get_run_status/);

  store.ask(started.run_id, { question: 'Which Sam?', options: ['Sam Chen', 'Sam Ortiz'] });

  // The model polls with no run_id — it should still find the active run.
  const status = await api.call('get_run_status', {}, caller);
  assert.equal(status.status, 'awaiting_answer');
  assert.equal(status.question, 'Which Sam?');
  assert.match(status.next_step, /ask the user/i);

  const answered = await api.call('answer_question', { answer: 'Sam Chen' }, caller);
  assert.equal(answered.ok, true);
  assert.deepEqual(delivered, ['Sam Chen']);

  store.finish(started.run_id, { success: true, summary: 'Sent "on my way" to Sam Chen.' });
  const done = await api.call('get_run_status', { run_id: started.run_id }, caller);
  assert.equal(done.status, 'completed');
  assert.match(done.message, /Sam Chen/);
  assert.match(done.next_step, /Tell the user/i);
});

await ok('answer_question rejects an answer nobody offered, with the options to re-ask', async () => {
  const { api, store, caller } = fixture();
  const started = await api.call('run_phone_task', { task: 't' }, caller);
  store.ask(started.run_id, { question: 'Which?', options: ['A', 'B'] });
  const r = await api.call('answer_question', { answer: 'Z' }, caller);
  assert.equal(r.ok, false);
  assert.deepEqual(r.options, ['A', 'B']);
});

await ok('answer_question with nothing to answer is a clean refusal', async () => {
  const { api, caller } = fixture();
  assert.equal((await api.call('answer_question', { answer: '' }, caller)).error, 'missing_answer');
  assert.equal((await api.call('answer_question', { answer: 'x' }, caller)).error, 'no_such_run');
});

await ok('stop_run stops the active run and is honest when there was nothing to stop', async () => {
  const { api, caller } = fixture();
  assert.equal((await api.call('stop_run', {}, caller)).error, 'no_such_run');
  const started = await api.call('run_phone_task', { task: 't' }, caller);
  const stopped = await api.call('stop_run', {}, caller);
  assert.equal(stopped.ok, true);
  assert.equal(stopped.run_id, started.run_id);
  assert.equal(stopped.status, 'stopped');
});

await ok('one user cannot address another user\'s run by id', async () => {
  const { api, store, caller } = fixture();
  const started = await api.call('run_phone_task', { task: 't' }, caller);
  const mallory = { uid: BOB, email: 'b@b.c' };
  assert.equal((await api.call('get_run_status', { run_id: started.run_id }, mallory)).error, 'no_such_run');
  assert.equal((await api.call('stop_run', { run_id: started.run_id }, mallory)).error, 'no_such_run');
  assert.equal(store.get(started.run_id, ALICE).status, 'starting', 'a stranger changed the run');
});

// ─── MCP framing ─────────────────────────────────────────────────────────────

function mcpFixture() {
  const f = fixture();
  return { ...f, mcp: createMcpHandler({ api: f.api }) };
}

await ok('initialize echoes a supported protocol version and advertises tools', async () => {
  const { mcp, caller } = mcpFixture();
  const res = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, caller);
  assert.equal(res.result.protocolVersion, '2025-06-18');
  assert.ok(res.result.capabilities.tools);
  assert.match(res.result.instructions, /run_phone_task/);
});

await ok('an unknown protocol version falls back to our newest', async () => {
  const { mcp, caller } = mcpFixture();
  const res = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, caller);
  assert.equal(res.result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);
});

await ok('notifications get no response at all', async () => {
  const { mcp, caller } = mcpFixture();
  assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, caller), null);
});

await ok('tools/list returns every tool with its schema and annotations', async () => {
  const { mcp, caller } = mcpFixture();
  const res = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, caller);
  assert.equal(res.result.tools.length, TOOL_DEFINITIONS.length);
  for (const t of res.result.tools) {
    assert.ok(t.inputSchema && t.annotations && t.description);
  }
});

await ok('tools/call returns JSON in a text block and flags tool errors', async () => {
  const { mcp, caller } = mcpFixture();
  const res = await mcp.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'run_phone_task', arguments: { task: '' } },
  }, caller);
  assert.equal(res.result.isError, true);
  const payload = JSON.parse(res.result.content[0].text);
  assert.equal(payload.error, 'missing_task');
});

await ok('a tool that throws becomes a tool error, not a protocol error', async () => {
  const store = createRunStore({});
  const devices = { status: async () => { throw new Error('registry on fire'); } };
  const api = createToolApi({ statusWaitMs: 0, store, devices, startRun: () => {} });
  const mcp = createMcpHandler({ api });
  const res = await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_phone_status' } }, { uid: ALICE });
  assert.equal(res.error, undefined, 'a failing tool broke the connection instead of reporting');
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /registry on fire/);
});

await ok('an unknown tool and a malformed message are proper JSON-RPC errors', async () => {
  const { mcp, caller } = mcpFixture();
  const unknown = await mcp.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } }, caller);
  assert.equal(unknown.error.code, -32602);
  const bad = await mcp.handle({ id: 6, method: 'tools/list' }, caller);
  assert.equal(bad.error.code, -32600);
  const missing = await mcp.handle({ jsonrpc: '2.0', id: 7, method: 'resources/list' }, caller);
  assert.equal(missing.error.code, -32601);
});

await ok('ping answers empty', async () => {
  const { mcp, caller } = mcpFixture();
  const res = await mcp.handle({ jsonrpc: '2.0', id: 8, method: 'ping' }, caller);
  assert.deepEqual(res.result, {});
});

console.log(`\n${passed} connector-api assertions passed`);
