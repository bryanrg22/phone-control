#!/usr/bin/env node
// prices-stats.test.mjs — dollars from token counts, and the eval statistics.

import assert from 'node:assert/strict';
import { costOf, PRICES } from '../prices.mjs';
import { wilson, summarize } from '../stats.mjs';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

console.log('cost');
ok('the cached part of the input is billed at the cached rate, not twice', () => {
  // 1M input, of which 900k read from cache and 50k written: 50k fresh.
  close(costOf('claude-opus-5-5', { input_tokens: 1e6, cache_read_input_tokens: 9e5, cache_write_input_tokens: 5e4, output_tokens: 1e4 }), (5e4 * 4 + 9e5 * 0.2 + 5e4 * 5 + 1e4 * 20) / 1e6);
});
ok('OpenAI: no cache writes; cached input at the cached rate', () => {
  close(costOf('gpt-6-luna', { input_tokens: 1e6, cache_read_input_tokens: 8e5, output_tokens: 1e4 }), (2e5 * 0.1 + 8e5 * 0.01 + 1e4 * 0.5) / 1e6);
});
ok('no tokens cost nothing; an unpriced model has no cost rather than a wrong one', () => {
  assert.equal(costOf('gpt-6-astra', {}), 0);
  assert.equal(costOf('some-new-model', { input_tokens: 5 }), null);
});
ok('every model evaluated has a price', () => {
  for (const m of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.4-mini']) assert.ok(PRICES[m], m);
});

console.log('statistics');
ok('the Wilson interval contains the observed rate and stays within 0-1', () => {
  const { low, high } = wilson(7, 10);
  assert.ok(low < 0.7 && high > 0.7 && low >= 0 && high <= 1);
  assert.deepEqual(wilson(0, 0), { low: 0, high: 0 });
});
ok('pass^k counts only cases where every trial passed; test errors are left out', () => {
  const s = summarize({ a: ['PASS', 'PASS', 'PASS'], b: ['PASS', 'FAIL', 'PASS'], c: ['PASS', 'TEST_ERROR', 'PASS'] });
  assert.equal(s.trials, 8);
  assert.equal(s.test_errors, 1);
  close(s.pass_at_1, 7 / 8);
  close(s.pass_hat_k, 2 / 3);
});

console.log(`\n${passed} passed`);
