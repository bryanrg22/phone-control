#!/usr/bin/env node
// report.test.mjs — the per-model numbers of a phone-agent run.

import assert from 'node:assert/strict';
import { buildReport, reportMarkdown, passedBy } from '../report.mjs';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

const pass = { success: true, score: 1, rubric_results: [{ satisfied: true }, { satisfied: true }] };
const half = { success: false, score: 0.5, rubric_results: [{ satisfied: true }, { satisfied: false }] };
const rec = (task, category, extra = {}) => ({ task, category, status: 'ok', steps: 10, agent_seconds: 60, model_seconds: 30, input_tokens: 1000, cache_read_input_tokens: 800, output_tokens: 50, reasoning_output_tokens: 5, tool_calls: 12, tool_errors: 1, ask_user_calls: 0, cost_usd: 0.1, ended: 'completed', served_models: ['m-1'], ...extra });

const MODEL = { model: { provider: 'anthropic', model: 'claude-opus-5-5' }, trials: [
  { trial: 1, records: [rec('a', 'single_app'), rec('b', 'multi_app'), rec('c', 'memory', { status: 'error', ended: 'device_lost' })], evaluations: { a: pass, b: half } },
  { trial: 2, records: [rec('a', 'single_app'), rec('b', 'multi_app', { ended: 'step_budget', steps: 50 })], evaluations: { a: pass, b: pass } },
] };

console.log('report');
ok('a task passes only when every rubric criterion holds (iOSWorld)', () => {
  assert.equal(passedBy(pass), true);
  assert.equal(passedBy(half), false);
  assert.equal(passedBy(undefined), false);
});
const [r] = buildReport([MODEL]);
ok('pass rate over judged runs, test errors apart', () => {
  assert.equal(r.judged, 4);
  assert.equal(r.test_errors, 1);
  assert.equal(r.pass_rate, 3 / 4);
  assert.ok(r.pass_ci95.low < 0.75 && r.pass_ci95.high > 0.75);
});
ok('pass^k: tasks that passed in every trial', () => {
  assert.equal(r.pass_hat_k, 1 / 2);
});
ok('by category, with the paper\'s categories', () => {
  assert.deepEqual(r.by_category.single_app, { n: 2, pass_rate: 1, avg_steps: 10 });
  assert.equal(r.by_category.multi_app.pass_rate, 1 / 2);
});
ok('rubric score is the mean share of criteria held', () => {
  assert.equal(r.rubric_score, 0.875);
});
ok('how every run ended is counted, the broken one included', () => {
  assert.deepEqual(r.ended, { completed: 3, step_budget: 1, device_lost: 1 });
});
ok('tokens, cost, tool errors and the serving model are totalled', () => {
  assert.equal(r.tokens.input, 5000);
  assert.equal(r.tokens.cache_read, 4000);
  assert.equal(r.cost_usd, 0.5);
  assert.equal(r.tool_error_rate, 0.083);
  assert.deepEqual(r.served_models, ['m-1']);
});
ok('one trial has no pass^k', () => {
  const [one] = buildReport([{ ...MODEL, trials: [MODEL.trials[0]] }]);
  assert.equal(one.pass_hat_k, null);
});
ok('the Markdown carries outcomes, efficiency and endings', () => {
  const md = reportMarkdown([r], { judgeModel: 'gpt-5.4-mini', maxSteps: 50, pricesAsOf: '2026-10-15' });
  assert.match(md, /75% \(\d+%–\d+%\) of 4/);
  assert.match(md, /step_budget 1/);
  assert.match(md, /Efficiency and cost/);
});

console.log(`\n${passed} passed`);

console.log('calibration (decision models)');
{
  const dec = (task, doneP, meanP) => rec(task, 'single_app', { decision_steps: 5, decision_mean_probability: meanP, decision_min_probability: 0.3, decision_done_probability: doneP });
  const D = { model: { provider: 'typesafe', model: 'jev-latest' }, trials: [{ trial: 1,
    records: [dec('a', 0.97, 0.8), dec('b', 0.6, 0.7), dec('c', null, 0.5), dec('d', 0.99, 0.9)],
    evaluations: { a: pass, b: half, c: half, d: pass } }] };
  const [d, l] = buildReport([D, MODEL]);
  ok('an LLM run has no calibration', () => { assert.equal(l.calibration, undefined); });
  ok('decision runs: pass rate by the probability on done, runs without done apart', () => {
    assert.equal(d.calibration.find((b) => b.bucket === 'done p 0.95–1').n, 2);
    assert.equal(d.calibration.find((b) => b.bucket === 'done p 0.95–1').pass_rate, 1);
    assert.equal(d.calibration.find((b) => b.bucket === 'done p 0.5–0.8').pass_rate, 0);
    assert.equal(d.calibration.find((b) => b.bucket === 'did not end with done').n, 1);
    assert.equal(d.avg_decision_probability, 0.725);
  });
  ok('the markdown gets a calibration section only when a decision model ran', () => {
    const md = reportMarkdown([d, l], { judgeModel: 'j', maxSteps: 50, pricesAsOf: 'd' });
    assert.ok(md.includes('## Confidence calibration'));
    assert.ok(md.includes('| typesafe:jev-latest | 0.725 | 0% of 0'.replace('0% of 0', '–')));
    assert.ok(!reportMarkdown([l], { judgeModel: 'j', maxSteps: 50, pricesAsOf: 'd' }).includes('calibration'));
  });
}
