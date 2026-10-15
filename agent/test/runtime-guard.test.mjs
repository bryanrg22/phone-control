// Unit tests for the runtime invocation gate (runtime-guard.mjs).
//
// The guard is the HITL safety boundary: it decides whether a proposed tool
// call must pause for explicit user approval before executing on the device.
// Its load-bearing property is FAIL-SAFE — any ambiguity, error, or missing
// dependency must resolve to "require approval" (never silently auto-execute).
// These tests pin every decision rule in checkRuntimeGuard() plus the
// user-facing formatter, so a regression in the gate is caught before it can
// auto-tap a "Send $50" button.
//
// Architecture reference: Magentic-UI Action Guard (arXiv:2507.22358, §6.4),
// the two-stage tag-then-judge design that runtime-guard.mjs implements.
//
// Unlike test-nonrecoverable.mjs (which regex-extracts a NON-exported function
// from agent.mjs), runtime-guard.mjs exports its API directly, so we import the
// REAL symbols — equally drift-proof, no eval needed.
// Run: `node agent/test/runtime-guard.test.mjs`
import {
  checkRuntimeGuard,
  formatActionForUser,
  TOOL_IRREVERSIBILITY,
  DEFAULT_TAG,
} from '../runtime-guard.mjs';

let pass = 0, fail = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  cond ? pass++ : fail++;
}

// Silent logger so guard's internal log() calls don't spam test output.
const quiet = () => {};

// ─── Stub judges (no network) ────────────────────────────────────────────
// A judge is just `async (messages) => string`. The guard only inspects the
// returned string, so these stubs fully exercise the verdict-parsing branch.
const judgeYes      = async () => 'YES';
const judgeNo       = async () => 'NO';
const judgeThrows   = async () => { throw new Error('simulated judge outage'); };
// Tracks whether the judge was actually invoked (for short-circuit assertions).
function spyJudge(reply) {
  const fn = async () => { fn.called = true; return reply; };
  fn.called = false;
  return fn;
}

// Small async runner so we can await every case and still emit a final tally.
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ── 1. Hard policy short-circuits (checked before any tag lookup) ─────────
// A 'maybe' tool (tap) is used so we PROVE the policy wins over the tag.
test("policy 'off' → no approval (source policy:off)", async () => {
  const r = await checkRuntimeGuard({ toolName: 'tap', toolArgs: {}, policy: 'off', log: quiet });
  check("policy:off requiresApproval=false", r.requiresApproval === false);
  check("policy:off source", r.source === 'policy:off');
});
test("policy 'never' → no approval (source policy:never)", async () => {
  const r = await checkRuntimeGuard({ toolName: 'tap', toolArgs: {}, policy: 'never', log: quiet });
  check("policy:never requiresApproval=false", r.requiresApproval === false);
  check("policy:never source", r.source === 'policy:never');
});
test("policy 'always' → approval required even for a 'never' tool", async () => {
  // scroll is tag:never, yet policy:always must override → approval.
  const r = await checkRuntimeGuard({ toolName: 'scroll', toolArgs: {}, policy: 'always', log: quiet });
  check("policy:always requiresApproval=true", r.requiresApproval === true);
  check("policy:always source", r.source === 'policy:always');
});
test("policy modes short-circuit BEFORE the judge (judge never called)", async () => {
  const spy = spyJudge('YES');
  await checkRuntimeGuard({ toolName: 'tap', toolArgs: {}, policy: 'off', judgeLLM: spy, log: quiet });
  check("policy:off does not invoke judge", spy.called === false);
});

// ── 2. Per-tool irreversibility tag (Stage 1, deterministic) ─────────────
test("'never' tool (scroll) → no approval (source tag:never)", async () => {
  const r = await checkRuntimeGuard({ toolName: 'scroll', toolArgs: {}, log: quiet });
  check("scroll requiresApproval=false", r.requiresApproval === false);
  check("scroll source tag:never", r.source === 'tag:never');
});
test("'never' tool (getDirections) → no approval", async () => {
  const r = await checkRuntimeGuard({ toolName: 'getDirections', toolArgs: {}, log: quiet });
  check("getDirections requiresApproval=false", r.requiresApproval === false);
  check("getDirections source tag:never", r.source === 'tag:never');
});
test("'never' tools skip the judge entirely (latency-free)", async () => {
  const spy = spyJudge('YES');
  const r = await checkRuntimeGuard({ toolName: 'scroll', toolArgs: {}, judgeLLM: spy, log: quiet });
  check("never-tag never invokes judge", spy.called === false);
  check("never-tag has no judgeLatencyMs", r.judgeLatencyMs === undefined);
});
test("unknown tool → DEFAULT_TAG ('maybe') path, not an error", async () => {
  // No judge → maybe falls through to the fail-safe no-judge branch.
  const r = await checkRuntimeGuard({ toolName: 'someBrandNewToolNobodyTagged', toolArgs: {}, log: quiet });
  check("DEFAULT_TAG constant is 'maybe'", DEFAULT_TAG === 'maybe');
  check("unknown tool requiresApproval=true", r.requiresApproval === true);
  check("unknown tool took the maybe-no-judge branch", r.source === 'tag:maybe-no-judge');
});

// ── 3. maybe → judge path with a STUB judge ──────────────────────────────
test("maybe tool + judge says YES → approval required (source judge:yes)", async () => {
  const r = await checkRuntimeGuard({ toolName: 'tap', toolArgs: { description: 'Send $50' }, judgeLLM: judgeYes, log: quiet });
  check("judge YES requiresApproval=true", r.requiresApproval === true);
  check("judge YES source", r.source === 'judge:yes');
  check("judge YES records latency", typeof r.judgeLatencyMs === 'number');
});
test("maybe tool + judge says NO → no approval (source judge:no)", async () => {
  const r = await checkRuntimeGuard({ toolName: 'tap', toolArgs: { description: 'next page' }, judgeLLM: judgeNo, log: quiet });
  check("judge NO requiresApproval=false", r.requiresApproval === false);
  check("judge NO source", r.source === 'judge:no');
});
test("verdict parsing is case-insensitive / prefix-tolerant", async () => {
  // 'yes' / 'y' / 'yes, ...' all → approve; 'no' / 'n' / 'no.' all → pass.
  const variants = [
    ['  YeS  ', true,  'judge:yes'],
    ['y',       true,  'judge:yes'],
    ['Yes, this sends money.', true, 'judge:yes'],
    ['NO',     false, 'judge:no'],
    ['n',      false, 'judge:no'],
    ['no.',    false, 'judge:no'],
  ];
  for (const [reply, expectApproval, expectSrc] of variants) {
    const r = await checkRuntimeGuard({ toolName: 'tap', toolArgs: {}, judgeLLM: async () => reply, log: quiet });
    check(`verdict ${JSON.stringify(reply)} → approval=${expectApproval}`, r.requiresApproval === expectApproval && r.source === expectSrc);
  }
});

// ── 4. FAIL-SAFE: any ambiguity / error / missing judge → require approval ─
test("judge THROWS (transient) → heuristic fallback, not blanket block", async () => {
  // A transient judge outage (e.g. 429) on a BENIGN action must NOT block it — the old
  // fail-closed behavior hung a real unattended run. No payment signal on screen → allow.
  const benign = await checkRuntimeGuard({ toolName: 'tap', toolArgs: {}, judgeLLM: judgeThrows, log: quiet });
  check("judge error + no risky signal → NO approval", benign.requiresApproval === false);
  check("judge error benign source", benign.source === 'judge:error-benign');
  check("judge error surfaces message", benign.error === 'simulated judge outage');
  // But a risky on-screen signal (payment) + judge outage → still require approval (fail-closed for risky).
  const risky = await checkRuntimeGuard({ toolName: 'tap', toolArgs: {}, context: { recentScreenText: 'Send $50 to Alex' }, judgeLLM: judgeThrows, log: quiet });
  check("judge error + payment signal → approval", risky.requiresApproval === true);
  check("judge error risky source", risky.source === 'judge:error-risky');
});
test("judge returns garbage / empty / ambiguous → fail-safe approval (source judge:invalid)", async () => {
  // Replies that match NO yes/no prefix → judge:invalid → fail-safe approval.
  const garbage = ['', '   ', 'maybe', 'I am not sure', 'undefined', 'okay sure', 'yeah', '🤷'];
  for (const reply of garbage) {
    const r = await checkRuntimeGuard({ toolName: 'tap', toolArgs: {}, judgeLLM: async () => reply, log: quiet });
    check(`garbage ${JSON.stringify(reply)} → approval=true`, r.requiresApproval === true && r.source === 'judge:invalid');
  }
});
test("verdict parsing: leading 'yes' fails SAFE; a 'no' that also says 'yes' now fails SAFE (fail-OPEN fixed)", async () => {
  // 'yes' = require-approval = the SAFE direction → a liberal prefix match is fine.
  const failSafe = ['YESNO', 'Yes no', 'yes definitely not'];
  for (const reply of failSafe) {
    const r = await checkRuntimeGuard({ toolName: 'tap', toolArgs: {}, judgeLLM: async () => reply, log: quiet });
    check(`leading-yes ${JSON.stringify(reply)} → judge:yes (require approval)`, r.requiresApproval === true && r.source === 'judge:yes');
  }
  // 'no' = auto-execute = the RISKY direction → strict. A contradictory reply that BEGINS with
  // 'no' but also contains 'yes' must NOT auto-execute (was the fail-OPEN bug; now fails SAFE).
  const contradictory = ['No, wait, yes — require approval', 'no but yes actually'];
  for (const reply of contradictory) {
    const r = await checkRuntimeGuard({ toolName: 'tap', toolArgs: {}, judgeLLM: async () => reply, log: quiet });
    check(`contradictory ${JSON.stringify(reply)} → fail-SAFE (judge:invalid, approval)`, r.requiresApproval === true && r.source === 'judge:invalid');
  }
  // A clean 'no' (no contradicting 'yes') still auto-executes — the intended permissive path.
  const cleanNo = ['no', 'nope', 'no approval needed', 'no, this is benign navigation'];
  for (const reply of cleanNo) {
    const r = await checkRuntimeGuard({ toolName: 'tap', toolArgs: {}, judgeLLM: async () => reply, log: quiet });
    check(`clean-no ${JSON.stringify(reply)} → judge:no (no approval)`, r.requiresApproval === false && r.source === 'judge:no');
  }
});
test("judge returns null/undefined → fail-safe approval (no crash)", async () => {
  for (const reply of [null, undefined]) {
    const r = await checkRuntimeGuard({ toolName: 'tap', toolArgs: {}, judgeLLM: async () => reply, log: quiet });
    check(`judge returning ${reply} → approval=true`, r.requiresApproval === true && r.source === 'judge:invalid');
  }
});
test("maybe tool + NO judge provided → fail-safe approval (source tag:maybe-no-judge)", async () => {
  const r = await checkRuntimeGuard({ toolName: 'inputText', toolArgs: { text: 'hunter2' }, log: quiet });
  check("no-judge requiresApproval=true", r.requiresApproval === true);
  check("no-judge source", r.source === 'tag:maybe-no-judge');
});

// ── 5. auto-permissive policy ─────────────────────────────────────────────
// maybe tool + NO payment signal in recentScreenText → short-circuit, no judge.
test("auto-permissive + maybe tool + no payment signal → no approval (permissive:no-signal)", async () => {
  const spy = spyJudge('YES'); // would force approval IF reached — proves we short-circuit before it.
  const r = await checkRuntimeGuard({
    toolName: 'tap',
    toolArgs: { description: 'Like' },
    context: { recentScreenText: 'Home  Profile  Settings  Like  Comment  Share' },
    judgeLLM: spy,
    policy: 'auto-permissive',
    log: quiet,
  });
  check("permissive no-signal requiresApproval=false", r.requiresApproval === false);
  check("permissive no-signal source", r.source === 'permissive:no-signal');
  check("permissive no-signal did NOT call the judge", spy.called === false);
});
test("auto-permissive + maybe tool + missing context → no approval (treats absent text as no signal)", async () => {
  const spy = spyJudge('YES');
  const r = await checkRuntimeGuard({ toolName: 'tap', toolArgs: {}, judgeLLM: spy, policy: 'auto-permissive', log: quiet });
  check("permissive empty-context requiresApproval=false", r.requiresApproval === false);
  check("permissive empty-context source", r.source === 'permissive:no-signal');
});
test("auto-permissive + payment signal ('$50 Send') → proceeds to judge", async () => {
  const spy = spyJudge('YES');
  const r = await checkRuntimeGuard({
    toolName: 'tap',
    toolArgs: { description: 'Send' },
    context: { recentScreenText: 'Pay John Appleseed\n$50   Send' },
    judgeLLM: spy,
    policy: 'auto-permissive',
    log: quiet,
  });
  check("permissive WITH signal reaches the judge", spy.called === true);
  check("permissive WITH signal → judge verdict applied (approval=true)", r.requiresApproval === true && r.source === 'judge:yes');
});
test("auto-permissive payment regex hits each currency / keyword variant", async () => {
  // Spot-check a few PAYMENT_SIGNAL_REGEX alternatives so a future regex edit
  // that drops one (e.g. € or 'transfer') is caught here.
  const signals = ['€20 fee', 'Authorize purchase', 'Transfer funds', 'Venmo', 'Apple Cash', '¥1000', '£5'];
  for (const text of signals) {
    const spy = spyJudge('NO');
    const r = await checkRuntimeGuard({
      toolName: 'tap', toolArgs: {}, context: { recentScreenText: text },
      judgeLLM: spy, policy: 'auto-permissive', log: quiet,
    });
    check(`permissive signal ${JSON.stringify(text)} → judge consulted`, spy.called === true && r.source === 'judge:no');
  }
});
test("auto-permissive still respects a 'never' tag (no judge, no payment scan)", async () => {
  // Regression: permissive must NOT downgrade safety — never-tag is still tag:never.
  const spy = spyJudge('YES');
  const r = await checkRuntimeGuard({
    toolName: 'scroll', toolArgs: {}, context: { recentScreenText: '$999 Send' },
    judgeLLM: spy, policy: 'auto-permissive', log: quiet,
  });
  check("permissive + never-tag stays tag:never", r.source === 'tag:never' && r.requiresApproval === false);
  check("permissive + never-tag skips judge", spy.called === false);
});
test("auto-conservative (default) does NOT short-circuit on missing payment signal", async () => {
  // Contrast with permissive: conservative always runs the judge for maybe tools.
  const spy = spyJudge('NO');
  const r = await checkRuntimeGuard({
    toolName: 'tap', toolArgs: {}, context: { recentScreenText: 'just some benign text' },
    judgeLLM: spy, log: quiet, // policy defaults to auto-conservative
  });
  check("conservative consults judge despite no payment signal", spy.called === true);
  check("conservative applies judge verdict", r.source === 'judge:no' && r.requiresApproval === false);
});

// ── 6. formatActionForUser one-liners ─────────────────────────────────────
test("formatActionForUser: tap (description) / tapText (text) / tap (coords)", async () => {
  check("tap with description", formatActionForUser('tap', { description: 'Send button' }) === 'Tap "Send button"?');
  check("tapText with text",    formatActionForUser('tapText', { text: 'Confirm' }) === 'Tap "Confirm"?');
  check("tap coords fallback",  formatActionForUser('tap', { x: 50, y: 80 }) === 'Tap "(50%, 80%)"?');
});
test("formatActionForUser: inputText", async () => {
  check("inputText", formatActionForUser('inputText', { text: 'hello world' }) === 'Type "hello world"?');
});
test("formatActionForUser: typeAndSubmit (with and without elementText)", async () => {
  check("typeAndSubmit with field", formatActionForUser('typeAndSubmit', { text: 'usc', elementText: 'Search' }) === 'Type "usc" into Search and submit?');
  check("typeAndSubmit default field", formatActionForUser('typeAndSubmit', { text: 'usc' }) === 'Type "usc" into field and submit?');
});
test("formatActionForUser: drag", async () => {
  check("drag", formatActionForUser('drag', { startX: 10, startY: 20, endX: 30, endY: 40 }) === 'Drag from (10%, 20%) to (30%, 40%)?');
});
test("formatActionForUser: pressKey", async () => {
  check("pressKey", formatActionForUser('pressKey', { key: 'enter' }) === 'Press "enter"?');
});
test("formatActionForUser: openURL", async () => {
  check("openURL", formatActionForUser('openURL', { url: 'https://example.com' }) === 'Open URL: https://example.com?');
});
test("formatActionForUser: default branch for an untemplated tool", async () => {
  check("default branch", formatActionForUser('zoomAndTap', { x: 1, y: 2 }) === 'zoomAndTap({"x":1,"y":2})?');
});
test("formatActionForUser: tolerates null/undefined args (no crash)", async () => {
  check("null args → coords undefined string", formatActionForUser('tap', null) === 'Tap "(undefined%, undefined%)"?');
  check("missing inputText text → empty", formatActionForUser('inputText', {}) === 'Type ""?');
});

// ── Sanity: the tag table matches the documented taxonomy ──────────────────
test("TOOL_IRREVERSIBILITY taxonomy sanity (payment-capable tools are 'maybe', nav is 'never')", async () => {
  check("tap is maybe", TOOL_IRREVERSIBILITY.tap === 'maybe');
  check("inputText is maybe", TOOL_IRREVERSIBILITY.inputText === 'maybe');
  check("drag is maybe", TOOL_IRREVERSIBILITY.drag === 'maybe');
  check("scroll is never", TOOL_IRREVERSIBILITY.scroll === 'never');
  check("askUser is never", TOOL_IRREVERSIBILITY.askUser === 'never');
  check("taskComplete is never", TOOL_IRREVERSIBILITY.taskComplete === 'never');
});

// ─── Run all tests sequentially, then emit the final tally ────────────────
(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
    } catch (e) {
      check(`${name} (threw: ${e.message})`, false);
    }
  }
  console.log(`\n${pass}/${pass + fail} passed${fail ? `  — ${fail} FAILED` : ''}`);
  process.exit(fail ? 1 : 0);
})();
