#!/usr/bin/env node
// trajectory.test.mjs — the conversion from the agent's run record to
// iOSWorld's trajectory format, which decides what iOSWorld's judge sees.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toTrajectory, outcomeOf, usageOf, readTrace, parseModelSpec, costOfTrace } from '../trajectory.mjs';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

const chat = (step, usage = {}) => ({ record: 'span', attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.response.model': 'claude-opus-5-5', 'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.output_tokens': 20, 'gen_ai.usage.cache_read.input_tokens': 800, ...usage }, eval: { step, latency_ms: 2000 } });
const tool = (step, name, args, extra = {}) => ({ record: 'span', status: extra.error ? 'ERROR' : 'OK', attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': name, 'gen_ai.tool.call.arguments': args, 'gen_ai.tool.call.result': 'ok' }, eval: { step, skipped: !!extra.skipped } });
const shown = (step) => ({ record: 'event', name: 'observation', eval: { step, image: `blobs/sha256/${step}.jpg`, elements: [] } });

const TRACE = [
  shown(0),
  chat(1), tool(1, 'openApp', { appName: 'Clock' }), shown(1),
  chat(2), tool(2, 'getUIElements', {}),                         // no new screen after step 2
  chat(3), tool(3, 'tap', { x: 50.5, y: 90.1 }), tool(3, 'taskComplete', { summary: 'Alarm set for 6:45 AM, labeled Gym.' }), tool(3, 'tap', { x: 1, y: 1 }, { skipped: true }),
];
function trace(records) {
  const dir = mkdtempSync(join(tmpdir(), 'trajectory-test-'));
  writeFileSync(join(dir, 'trace.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return dir;
}

console.log('trajectory conversion');

ok('each step gets the screen the model was shown before it acted', () => {
  const dir = trace(TRACE);
  const t = toTrajectory(dir, '/final.png');
  assert.equal(t[0].screenshot, join(dir, 'blobs/sha256/0.jpg'));
  assert.equal(t[1].screenshot, join(dir, 'blobs/sha256/1.jpg'));
  rmSync(dir, { recursive: true });
});

ok('a step after which the screen was not observed again gets no image, not a stale one', () => {
  const dir = trace(TRACE);
  assert.equal(toTrajectory(dir, null)[2].screenshot, null);
  rmSync(dir, { recursive: true });
});

ok('the end state is attached to the last step only, as iOSWorld does', () => {
  const dir = trace(TRACE);
  const t = toTrajectory(dir, '/final.png');
  assert.equal(t[2].post_action_screenshot, '/final.png');
  assert.equal(t[0].post_action_screenshot, undefined);
  rmSync(dir, { recursive: true });
});

ok('actions carry the tool and its arguments; calls the agent did not run are left out', () => {
  const dir = trace(TRACE);
  assert.deepEqual(toTrajectory(dir, null)[2].actions, [{ tool: 'tap', x: 50.5, y: 90.1 }, { tool: 'taskComplete', summary: 'Alarm set for 6:45 AM, labeled Gym.' }]);
  rmSync(dir, { recursive: true });
});

ok('the answer is what the agent said when it finished, or why it gave up', () => {
  assert.deepEqual(outcomeOf(TRACE), { ended: 'completed', answer: 'Alarm set for 6:45 AM, labeled Gym.' });
  assert.deepEqual(outcomeOf([chat(1), tool(1, 'taskFailed', { reason: 'No such contact.' })]), { ended: 'gave_up', answer: 'No such contact.' });
  assert.deepEqual(outcomeOf([chat(1), tool(1, 'tap', {})]), { ended: 'no_conclusion', answer: null });
});

ok('tokens, model time and questions to the user are totalled', () => {
  const u = usageOf([...TRACE, chat(4), tool(4, 'askUser', {}), tool(4, 'tapText', { text: 'x' }, { error: true })]);
  assert.equal(u.steps, 4);
  assert.equal(u.input_tokens, 4000);
  assert.equal(u.cache_read_input_tokens, 3200);
  assert.equal(u.ask_user_calls, 1);
  assert.equal(u.tool_errors, 1);
  assert.equal(u.tool_calls, 6);
  assert.deepEqual(u.served_models, ['claude-opus-5-5']);
});

ok('a run with no record yields no trajectory, so it is a test error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trajectory-test-'));
  assert.deepEqual(toTrajectory(dir, '/final.png'), []);
  assert.deepEqual(readTrace(dir), []);
  rmSync(dir, { recursive: true });
});

console.log(`\n${passed} passed`);

// ── the hybrid on the eval side: the --models entry and the cost per model ──
ok('a plain entry: provider:model', () => {
  const m = parseModelSpec('typesafe:jev-latest');
  assert.deepEqual(m, { provider: 'typesafe', model: 'jev-latest', writer: null, display: 'jev-latest', dir: 'typesafe_jev-latest' });
});
ok('a hybrid entry: provider:model+writerProvider:writerModel', () => {
  const m = parseModelSpec('openai-decisions:gpt-6-luna+openai:gpt-6-luna');
  assert.deepEqual(m, { provider: 'openai-decisions', model: 'gpt-6-luna', writer: { provider: 'openai', model: 'gpt-6-luna' }, display: 'gpt-6-luna+openai:gpt-6-luna', dir: 'openai-decisions_gpt-6-luna+openai_gpt-6-luna' });
});
ok('a malformed entry is refused', () => {
  for (const bad of ['typesafe', 'typesafe:jev+openai', 'a:b+c:d+e:f']) assert.throws(() => parseModelSpec(bad), /must be provider:model/);
});
ok('the cost of a trace is each chat span at its own model\'s price', () => {
  const span = (model, usage) => ({ record: 'span', attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': model, ...usage }, eval: { step: 1 } });
  const t = [
    span('jev-latest', { 'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.output_tokens': 100 }),
    span('gpt-6-luna', { 'gen_ai.usage.input_tokens': 1000, 'gen_ai.usage.cache_read.input_tokens': 800, 'gen_ai.usage.output_tokens': 20 }),
  ];
  const want = (1000 * 0.042 + 100 * 0) / 1e6 + (200 * 0.1 + 800 * 0.01 + 20 * 0.5) / 1e6;
  assert.ok(Math.abs(costOfTrace(t) - want) < 1e-12, `${costOfTrace(t)} vs ${want}`);
  assert.equal(costOfTrace([...t, span('some-new-model', { 'gen_ai.usage.input_tokens': 5 })]), null);
  assert.equal(costOfTrace([]), null);
});
