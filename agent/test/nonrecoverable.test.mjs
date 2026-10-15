// Regression test for the error contract:
//
//   A non-recoverable API error (auth / billing / hard-quota exhaustion) must be
//   classified as an INFRASTRUCTURE error — never recorded as the agent FAILING
//   the task. Transient errors (429 rate-limit, 529 overload)
//   and one-off malformed 400s must stay RECOVERABLE so the run isn't killed.
//
// Why this exists: on 2026-05-28 the Anthropic account ran out of credits mid-run.
// Every LLM call returned 400 "credit balance is too low". The agent looped
// (log → sleep → continue), burned all steps, hit max-steps, and the account problem
// was reported as the agent failing the task.
//
// Provider nuance (added 2026-05-29): Gemini's FREE tier returns 429 "exceeded your
// current quota" for its PER-MINUTE rate limit, which RESETS within ~60s (verified: a
// call succeeds seconds later) — that is transient, NOT a hard billing cap. So a gemini
// 429 must stay RECOVERABLE (let the backoff retry it), while OpenAI's insufficient_quota
// 429 and Anthropic's billing 400 stay non-recoverable. Hence the classifier is now
// provider-aware: isNonRecoverableAPIError(status, body, provider).
//
// This test imports the REAL shipped classifier from llm-client.mjs (the module
// agent.mjs itself uses) so it can never drift from production. Historically it
// regex-extracted + eval'd the function out of agent.mjs because the classifier
// wasn't importable; the D2 extraction (2026-07-17) made it a real module.
// Run: `node agent/test/nonrecoverable.test.mjs`
import { isNonRecoverableAPIError, filterToolDefs } from '../llm-client.mjs';

// The REAL recorded Anthropic billing 400 body from the 2026-05-28 failed run:
const ANTHROPIC_BILLING = '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_abc"}';
// The REAL recorded Gemini free-tier RPM 429 body (2026-05-29) — note it uses the SAME
// "exceeded your current quota / billing" phrasing as a hard cap, but it's transient:
const GEMINI_RPM_429 = '[{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits"}}]';

const cases = [
  // [name, status, body, provider, expected] — true = abort run as infra ERROR
  ['Anthropic billing 400 (the real bug)',        400, ANTHROPIC_BILLING, 'anthropic', true],
  ['OpenAI 429 insufficient_quota (hard cap)',    429, '{"error":{"message":"You exceeded your current quota","type":"insufficient_quota"}}', 'openai', true],
  ['OpenAI 429 "exceeded your current quota"',    429, '{"error":{"message":"You exceeded your current quota, please check your plan"}}', 'openai', true],
  ['401 authentication_error (bad key)',          401, '{"error":{"type":"authentication_error","message":"invalid x-api-key"}}', 'openai', true],
  ['403 forbidden',                               403, '{"error":{"message":"forbidden"}}', 'anthropic', true],
  ['402 payment required',                        402, '{"error":{"message":"payment required"}}', 'openai', true],
  // ── Gemini free-tier per-minute 429: transient, MUST stay recoverable (the 2026-05-29 fix) ──
  ['Gemini 429 RPM (real body, must RETRY)',      429, GEMINI_RPM_429, 'gemini', false],
  ['Gemini 429 generic quota (must RETRY)',       429, '{"error":{"message":"exceeded your current quota"}}', 'gemini', false],
  // ── REGRESSIONS: these MUST stay recoverable / non-aborting ──
  ['429 transient rate-limit (must retry)',       429, '{"error":{"type":"rate_limit_error","message":"Number of requests has exceeded your rate limit. Please slow down."}}', 'anthropic', false],
  ['529 overloaded (must retry)',                 529, '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', 'anthropic', false],
  ['generic 400 malformed (empty-turn; continue)',400, '{"type":"error","error":{"type":"invalid_request_error","message":"messages: text content blocks must be non-empty"}}', 'anthropic', false],
  ['500 internal (transient)',                    500, '{"error":{"message":"internal server error"}}', 'openai', false],
  ['200 ok (sanity)',                             200, '', 'openai', false],
  // Guard: a NON-gemini provider hitting the same "exceeded your current quota" 429 IS a hard cap:
  ['OpenAI 429 quota is NOT made recoverable',    429, '{"error":{"message":"You exceeded your current quota"}}', 'openai', true],
];

let pass = 0, fail = 0;
for (const [name, status, body, prov, expected] of cases) {
  const got = isNonRecoverableAPIError(status, body, prov);
  const ok = got === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${status} ${prov}] ${name}  → got=${got} expected=${expected}`);
  ok ? pass++ : fail++;
}

// ── filterToolDefs (forced-done final-step tool restriction) ──
{
  const defs = [{ name: 'tap' }, { name: 'taskComplete' }, { name: 'taskFailed' }];
  const oai = defs.map(d => ({ type: 'function', function: { name: d.name } }));
  const t1 = filterToolDefs(defs, ['taskComplete', 'taskFailed']);
  const t2 = filterToolDefs(oai, ['taskComplete', 'taskFailed']);
  const t3 = filterToolDefs(defs, null);
  const checks = [
    ['filterToolDefs restricts native defs', t1.length === 2 && t1.every(d => d.name !== 'tap')],
    ['filterToolDefs handles OpenAI wrapper shape', t2.length === 2 && t2.every(d => d.function.name !== 'tap')],
    ['filterToolDefs passthrough when onlyTools is null', t3 === defs],
  ];
  for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); ok ? pass++ : fail++; }
}
console.log(`\n${pass}/${pass + fail} passed${fail ? `  — ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
