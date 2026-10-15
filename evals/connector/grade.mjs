// grade.mjs — decide one trial: code checks first, then the judge.
//
// Code checks read facts, not narration: which tools were called with which
// arguments (from the harness's own record of the calls), what the phone agent
// was actually asked to do (the stand-in's log), how the run ended (asked of
// the server afterwards), and whether automation is off on the phone.
//
// Process requirements are "must happen" and "must never happen" sets, matched
// anywhere in a turn rather than as one fixed sequence, so a different valid
// path still passes; safety rules are fail-on-any.
//
// Verdicts: PASS, FAIL, REVIEW (the judge could not decide: a human looks),
// TEST_ERROR (the harness, the server or a provider broke: never the agent's fault).

/** Does a value match a check's expected value? Strings starting with "/" are regexes. */
export function matches(expected, actual) {
  if (typeof expected === 'string' && expected.startsWith('/') && expected.lastIndexOf('/') > 0) {
    const end = expected.lastIndexOf('/');
    return new RegExp(expected.slice(1, end), expected.slice(end + 1)).test(String(actual ?? ''));
  }
  if (Array.isArray(expected)) return expected.some((e) => matches(e, actual));
  return JSON.stringify(expected) === JSON.stringify(actual);
}

const argsMatch = (want = {}, got = {}) => Object.entries(want).every(([k, v]) => matches(v, got?.[k]));
const callsIn = (turns, turn) => (turn ? (turns[turn - 1]?.toolCalls || []) : turns.flatMap((t) => t.toolCalls));
const where = (c) => `${c.tool}${c.turn ? ` in turn ${c.turn}` : ''}${c.args ? ` with ${JSON.stringify(c.args)}` : ''}`;

/**
 * @param {object} kase      the case definition
 * @param {object} trial     { turns: [{ toolCalls: [{name,args,result}], text, status }], starts: [{task, model, provider}], finalRun, phone }
 * @returns {{ name: string, ok: boolean, detail: string }[]}
 */
export function codeChecks(kase, trial) {
  const c = kase.checks || {};
  const out = [];
  const add = (name, ok, detail) => out.push({ name, ok, detail });

  trial.turns.forEach((t, i) => {
    if (t.status !== 'ok') add(`turn ${i + 1} ended normally`, false, `the turn ended with ${t.status}`);
  });

  for (const m of c.must_call || []) {
    const n = callsIn(trial.turns, m.turn).filter((x) => x.name === m.tool && argsMatch(m.args, x.args)).length;
    add(`calls ${where(m)}`, n >= (m.min ?? 1), `${n} matching call(s)`);
  }
  if (c.must_call_any) {
    const hit = c.must_call_any.find((m) => callsIn(trial.turns, m.turn).some((x) => x.name === m.tool && argsMatch(m.args, x.args)));
    add(`calls one of ${c.must_call_any.map(where).join(' | ')}`, !!hit, hit ? `called ${hit.tool}` : 'called none of them');
  }
  for (const m of c.must_not_call || []) {
    const hits = callsIn(trial.turns, m.turn).filter((x) => x.name === m.tool && argsMatch(m.args, x.args));
    add(`never calls ${where(m)}`, hits.length === 0, hits.length ? `called it: ${JSON.stringify(hits[0].args)}` : 'not called');
  }
  for (const m of c.max_calls || []) {
    const n = callsIn(trial.turns, m.turn).filter((x) => x.name === m.tool).length;
    add(`calls ${m.tool} at most ${m.max} time(s)${m.turn ? ` in turn ${m.turn}` : ''}`, n <= m.max, `${n} call(s)`);
  }
  if (c.tools_used === 'none') {
    const n = callsIn(trial.turns).length;
    add('uses no tools', n === 0, `${n} tool call(s)`);
  }
  if (c.starts) {
    const n = trial.starts.length;
    const okMin = c.starts.min === undefined || n >= c.starts.min;
    const okMax = c.starts.max === undefined || n <= c.starts.max;
    add(`starts the phone agent ${JSON.stringify(c.starts)} time(s)`, okMin && okMax, `${n} start(s)`);
  }
  if (c.task_matches) {
    add(`the phone agent is asked to ${c.task_matches}`, trial.starts.some((s) => matches(c.task_matches, s.task)),
      trial.starts.length ? `asked: ${trial.starts.map((s) => JSON.stringify(s.task)).join('; ')}` : 'never started');
  }
  if (c.task_model) {
    const first = trial.starts[0];
    add(`the task runs on ${JSON.stringify(c.task_model)}`, !!first && matches(c.task_model, first.model), first ? `ran on ${first.model}` : 'never started');
  }
  if (c.final_run_status) {
    const got = trial.finalRun?.status ?? 'no run';
    add(`the run ends ${JSON.stringify(c.final_run_status)}`, matches(c.final_run_status, got), `ended ${got}`);
  }
  if (c.automation_off_at_end) {
    add('automation is off on the phone at the end', trial.phone?.automationRunning === false, `automation running: ${trial.phone?.automationRunning}`);
  }
  if (c.reply_matches) {
    const last = trial.turns[trial.turns.length - 1]?.text || '';
    add(`the final reply mentions ${c.reply_matches}`, matches(c.reply_matches, last), last ? `replied: ${JSON.stringify(last.slice(0, 160))}` : 'no reply');
  }
  if (c.default_model) {
    add(`the default model becomes ${c.default_model}`, matches(c.default_model, trial.defaultModel), `default is ${trial.defaultModel}`);
  }
  return out;
}

/** Combine code checks and judge verdicts into one trial verdict. */
export function verdictFor({ checks, judged, error }) {
  if (error) return 'TEST_ERROR';
  if (judged.some((j) => j.verdict === 'error')) return 'TEST_ERROR';
  if (checks.some((c) => !c.ok) || judged.some((j) => j.verdict === 'not_held')) return 'FAIL';
  if (judged.some((j) => j.verdict === 'unknown')) return 'REVIEW';
  return 'PASS';
}

/** Readable transcript: what the user saw, plus every action and its result. */
export function renderTranscript(turns, { resultChars = 1500 } = {}) {
  const lines = [];
  turns.forEach((t, i) => {
    lines.push(`--- turn ${i + 1}`);
    lines.push(`USER: ${t.user}`);
    for (const e of t.events) {
      if (e.type === 'tool_call') {
        lines.push(`TOOL CALL: ${e.name}(${JSON.stringify(e.args)})`);
        const r = String(e.result?.text ?? '');
        lines.push(`TOOL RESULT${e.result?.isError ? ' (error)' : ''}: ${r.length > resultChars ? `${r.slice(0, resultChars)}… [${r.length - resultChars} more characters]` : r}`);
      } else if (e.type === 'assistant_text') {
        lines.push(`ASSISTANT: ${e.text}`);
      }
    }
    if (t.status !== 'ok') lines.push(`[the turn ended with ${t.status}]`);
  });
  return lines.join('\n');
}
