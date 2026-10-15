#!/usr/bin/env node
// trajectory.test.mjs — the conversion from our agent's trace to iOSWorld's
// trajectory format, which decides what iOSWorld's judge sees. Device-free.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toTrajectory, outcomeOf, usageOf, imageAfter } from '../trajectory.mjs';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

/** A trace as the agent writes it: steps.jsonl plus the images it was shown. */
function trace(steps, images) {
  const dir = mkdtempSync(join(tmpdir(), 'trajectory-test-'));
  writeFileSync(join(dir, 'steps.jsonl'), steps.map((s) => JSON.stringify(s)).join('\n') + '\n');
  for (const name of images) writeFileSync(join(dir, name), 'x');
  return dir;
}

const STEPS = [
  { step: 1, model_s: 2.5, served_model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 0, text: '', tool_calls: [{ name: 'openApp', args: { appName: 'Clock' }, result: 'Opened Clock' }] },
  { step: 2, model_s: 3, served_model: 'claude-opus-5-5', input_tokens: 1200, output_tokens: 60, cache_read_input_tokens: 800, text: '', tool_calls: [{ name: 'getUIElements', args: {}, result: '- "Alarm" …' }] },
  { step: 3, model_s: 1.5, served_model: 'claude-opus-5-5', input_tokens: 1300, output_tokens: 40, cache_read_input_tokens: 900, text: '', tool_calls: [{ name: 'tap', args: { x: 50.5, y: 90.1 } }, { name: 'taskComplete', args: { summary: 'Alarm set for 6:45 AM, labeled Gym.' }, result: 'Alarm set…' }] },
];

console.log('trajectory conversion');

ok('each step gets the screen the model was shown before it acted', () => {
  // step-00 is before step 1, step-01 after step 1; step 2 got no new image.
  const dir = trace(STEPS, ['step-00.jpg', 'step-01.jpg', 'step-02.png']);
  const t = toTrajectory(dir, '/final.png');
  assert.equal(t[0].screenshot, join(dir, 'step-00.jpg'));
  assert.equal(t[1].screenshot, join(dir, 'step-01.jpg'));
  assert.equal(t[2].screenshot, join(dir, 'step-02.png'));
  rmSync(dir, { recursive: true });
});

ok('a step that was shown no new image gets none, rather than a stale one', () => {
  const dir = trace(STEPS, ['step-00.jpg', 'step-01.jpg']);
  assert.equal(toTrajectory(dir, null)[2].screenshot, null);
  rmSync(dir, { recursive: true });
});

ok('the end state is attached to the last step only, as iOSWorld does', () => {
  const dir = trace(STEPS, ['step-00.jpg']);
  const t = toTrajectory(dir, '/final.png');
  assert.equal(t[2].post_action_screenshot, '/final.png');
  assert.equal(t[0].post_action_screenshot, undefined);
  rmSync(dir, { recursive: true });
});

ok('actions carry the tool and its arguments, never the tool\'s reply', () => {
  const dir = trace(STEPS, []);
  const t = toTrajectory(dir, null);
  assert.deepEqual(t[2].actions, [{ tool: 'tap', x: 50.5, y: 90.1 }, { tool: 'taskComplete', summary: 'Alarm set for 6:45 AM, labeled Gym.' }]);
  assert.ok(!JSON.stringify(t).includes('Opened Clock'), 'a tool reply leaked into what the judge sees');
  rmSync(dir, { recursive: true });
});

ok('arguments the model garbled are kept as the raw text', () => {
  const dir = trace([{ step: 1, tool_calls: [{ name: 'tap', args_raw: '{x: 5', result: 'ERROR' }] }], []);
  assert.deepEqual(toTrajectory(dir, null)[0].actions, [{ tool: 'tap', invalid_arguments: '{x: 5' }]);
  rmSync(dir, { recursive: true });
});

ok('the answer is what the agent said when it finished, or why it gave up', () => {
  assert.deepEqual(outcomeOf(STEPS), { ended: 'completed', answer: 'Alarm set for 6:45 AM, labeled Gym.' });
  assert.deepEqual(outcomeOf([{ step: 1, tool_calls: [{ name: 'taskFailed', args: { reason: 'No such contact.' } }] }]), { ended: 'gave_up', answer: 'No such contact.' });
  assert.deepEqual(outcomeOf([{ step: 1, tool_calls: [{ name: 'tap', args: {} }] }]), { ended: 'no_conclusion', answer: null });
});

ok('token use and questions to the user are totalled across steps', () => {
  const u = usageOf([...STEPS, { step: 4, tool_calls: [{ name: 'askUser', args: {} }, { name: 'askUserText', args: {} }] }]);
  assert.equal(u.steps, 4);
  assert.equal(u.input_tokens, 3500);
  assert.equal(u.cache_read_input_tokens, 1700);
  assert.equal(u.ask_user_calls, 2);
  assert.deepEqual(u.served_models, ['claude-opus-5-5']);
});

ok('a trace with no steps yields no trajectory, so the run is a test error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trajectory-test-'));
  assert.deepEqual(toTrajectory(dir, '/final.png'), []);
  assert.equal(imageAfter(dir, 0), null);
  rmSync(dir, { recursive: true });
});

console.log(`\n${passed} passed`);
