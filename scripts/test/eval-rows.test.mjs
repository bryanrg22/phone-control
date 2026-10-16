#!/usr/bin/env node
// eval-rows.test.mjs — a test record describes both kinds of eval run.

import assert from 'node:assert/strict';
import { evalRows } from '../lib/eval-rows.mjs';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

const C = 'aaaaaaa1111111';

console.log('a connector run:');
ok('one row: assistant, judge, pass@1 with interval, pass^k, trials', () => {
  const [r] = evalRows({ runName: 'r1', recordCommit: C, info: { git: { commit: C, dirty: false }, assistant: { kind: 'claude', model: 'claude-opus-5-5', effort: 'high' }, judge: { provider: 'openai', model: 'gpt-6.1-sol' } }, summary: { pass_at_1: 1, pass_at_1_ci95: { low: 0.94, high: 1 }, pass_hat_k: 1, trials: 57, test_errors: 0 } });
  assert.equal(r.assistant, 'claude-opus-5-5 (high)');
  assert.equal(r.judge, 'openai gpt-6.1-sol');
  assert.equal(r.pass_at_1, '100% (94%–100%)');
  assert.equal(r.trials, '57 graded, 0 test errors');
  assert.equal(r.differs_from_record, false);
});
ok('a re-grade is shown beside the original, with the cases it covered', () => {
  const [r] = evalRows({ runName: 'r1', recordCommit: C, info: { git: { commit: C }, assistant: { kind: 'openai', model: 'gpt-6-luna' }, judge: { provider: 'anthropic', model: 'claude-opus-5-5' } }, summary: { pass_at_1: 0.91, pass_at_1_ci95: { low: 0.81, high: 0.96 }, pass_hat_k: 0.84, trials: 57, test_errors: 0 }, regraded: { pass_at_1: 0.95, pass_at_1_ci95: { low: 0.86, high: 0.98 }, pass_hat_k: 0.89, regraded_cases: ['hitl-two-questions'] }, regradedFolder: 'regrade-x' });
  assert.deepEqual(r.regraded, { folder: 'regrade-x', pass_at_1: '95% (86%–98%)', pass_hat_k: '89%', cases: ['hitl-two-questions'] });
});

console.log('a phone-agent run on iOSWorld:');
const PA_INFO = { phone_control: { commit: 'bbbbbbb2222222', dirty: false }, models: [{ provider: 'openai', model: 'gpt-6.1-sol' }, { provider: 'anthropic', model: 'claude-opus-5-5' }], judge: { script: 'iOSWorld scripts/judge_trajectories.py', provider: 'openai', model: 'gpt-5.4-mini' }, tasks: ['clock-001', 'caltrack-001'], trials: 1 };
const PA_SUMMARY = [{ provider: 'openai', model: 'gpt-6.1-sol', runs: 2, judged: 2, test_errors: 0, pass_rate: 0.5, pass_ci95: { low: 0.09, high: 0.91 }, pass_hat_k: null }];
ok('one row per model, from the report rows (the crash of 2026-10-16)', () => {
  const rows = evalRows({ runName: 'pilot', recordCommit: C, info: PA_INFO, summary: PA_SUMMARY, changedSince: () => '3 files changed' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].assistant, 'phone agent on iOSWorld: openai:gpt-6.1-sol');
  assert.equal(rows[0].judge, 'openai gpt-5.4-mini');
  assert.equal(rows[0].pass_at_1, '50% (9%–91%)');
  assert.equal(rows[0].pass_hat_k, 'n/a');
  assert.equal(rows[0].trials, '2 judged of 2 (2 tasks × 1), 0 test errors');
  assert.equal(rows[0].commit, 'bbbbbbb');
  assert.equal(rows[0].differs_from_record, true);
  assert.equal(rows[0].changed_since_eval, '3 files changed');
});
ok('a model with no report row still gets a row, with n/a, never a crash', () => {
  const rows = evalRows({ runName: 'pilot', recordCommit: C, info: PA_INFO, summary: PA_SUMMARY });
  assert.equal(rows[1].pass_at_1, 'n/a (n/a–n/a)');
  assert.equal(rows[1].trials, '0 judged of 0 (2 tasks × 1), 0 test errors');
});
ok('a run of neither kind is an error that names the run', () => {
  assert.throws(() => evalRows({ runName: 'odd', recordCommit: C, info: {}, summary: {} }), /odd: run_info\.json has neither/);
});

console.log(`\n${passed} passed`);
