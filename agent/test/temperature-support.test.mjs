// Unit tests for models.mjs::supportsTemperature — the rule agent.mjs uses to
// decide whether `temperature` can be sent, and run.mjs uses to predict the
// effective value it records in run-config.json.
//
// The OpenAI branch is pinned to a LIVE probe (2026-07-17, model gpt-5.5):
//   temperature: 0 → HTTP 400 invalid_request_error / unsupported_value / param
//     "temperature" — "Only the default (1) value is supported."
//   temperature: 1 → accepted (served model id gpt-5.5-2026-04-23).
// Anthropic/Gemini/local acceptance is per official API docs (SUSPECTED [S], not
// live-verified — no credits on those accounts). Run: node agent/test/temperature-support.test.mjs
import { supportsTemperature, DEFAULT_MODELS } from '../models.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('OpenAI reasoning family (fixed temperature — VERIFIED live on gpt-5.5):');
check('pinned openai model rejects 0', supportsTemperature('openai', DEFAULT_MODELS.openai, 0) === false);
check('gpt-5.5 rejects 0', supportsTemperature('openai', 'gpt-5.5', 0) === false);
check('gpt-5.5 rejects 0.7', supportsTemperature('openai', 'gpt-5.5', 0.7) === false);
check('gpt-5.5 accepts the explicit default 1', supportsTemperature('openai', 'gpt-5.5', 1) === true);
check('gpt-5.6-terra rejects 0 (same gpt-5 family rule)', supportsTemperature('openai', 'gpt-5.6-terra', 0) === false);
check('gpt-5.6-terra accepts the explicit default 1', supportsTemperature('openai', 'gpt-5.6-terra', 1) === true);
check('o3-family rejects 0', supportsTemperature('openai', 'o3-mini', 0) === false);
check('o1 rejects 0', supportsTemperature('openai', 'o1', 0) === false);
check('gpt-4o (non-reasoning) accepts 0', supportsTemperature('openai', 'gpt-4o', 0) === true);

console.log('Other providers (per API docs — SUSPECTED, no live probe):');
check('anthropic pinned model accepts 0', supportsTemperature('anthropic', DEFAULT_MODELS.anthropic, 0) === true);
check('gemini pinned model accepts 0', supportsTemperature('gemini', DEFAULT_MODELS.gemini, 0) === true);
check('local (ollama) accepts 0', supportsTemperature('local', DEFAULT_MODELS.local, 0) === true);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
