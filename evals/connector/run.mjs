#!/usr/bin/env node
// run.mjs — connector evals: does an assistant use phone-control's tools correctly?
//
//   node evals/connector/run.mjs                              Claude Opus 5.5, 3 trials, OpenAI judge
//   node evals/connector/run.mjs --model claude-sonnet-5-5 --trials 5
//   node evals/connector/run.mjs --assistant openai --model gpt-6-astra    an OpenAI model, Claude judge
//   node evals/connector/run.mjs --cases hitl,stop            only cases whose id contains these
//   node evals/connector/run.mjs --assistant oracle --expect all-pass    test the harness itself
//   node evals/connector/run.mjs --assistant null   --expect all-fail
//
// Each trial runs in a fresh stack (evals/lib/stack.mjs): the real server, a
// simulated phone, and a scripted stand-in for the phone agent, so what is
// measured is the ASSISTANT. A trial is graded by code checks first
// (grade.mjs), then one judge call per plain-English expectation.
//
// Needs the key of the assistant's provider and of the judge's (the other
// family). Costs money: start with --cases and --trials 1.
//
// Output, never overwritten (a new folder per run):
//   evals/results/connector/<run>/run_info.json         what ran: commits, versions, models, hashes
//   evals/results/connector/<run>/summary.json, .md     pass@1 with its 95% interval, pass^k, per case
//   evals/results/connector/<run>/<case>/trial-<n>/
//       events.jsonl     every model call (with its exact request and response), tool call
//                        and result, in order: the raw evidence
//       transcript.md    readable: the conversation, then each check and judgment
//       state.json       verdict, checks, judgments, usage, timing
//       server.log       what the server itself logged during the trial

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { startStack } from '../lib/stack.mjs';
import { createJudge, JUDGE_PROMPT_HASH } from '../lib/judges.mjs';
import { summarize } from '../lib/stats.mjs';
import { codeChecks, verdictFor, renderTranscript } from './grade.mjs';
import { createScriptedAssistant } from './assistants/scripted.mjs';
import { costOf, PRICES_AS_OF } from '../lib/prices.mjs';
import { scrub } from '../../agent/record.mjs';

export const HARNESS_VERSION = '0.1.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── arguments ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const assistantKind = opt('assistant', 'claude');
// The assistants that call a model; oracle and null are the harness's own self-tests.
const MODEL_ASSISTANTS = { claude: { provider: 'anthropic', model: 'claude-opus-5-5', judge: 'openai' }, openai: { provider: 'openai', model: 'gpt-6-astra', judge: 'anthropic' } };
const isModel = assistantKind in MODEL_ASSISTANTS;
const model = opt('model', isModel ? MODEL_ASSISTANTS[assistantKind].model : null);
const effort = opt('effort', 'high');
const trials = Number(opt('trials', isModel ? '3' : '1'));
const filter = (opt('cases', '') || '').split(',').filter(Boolean);
const expect = opt('expect', null);              // all-pass | all-fail: for harness self-tests
// A judge from another family than the assistant: Claude is judged by an OpenAI model, and the reverse.
const judgeProvider = opt('judge', isModel ? MODEL_ASSISTANTS[assistantKind].judge : 'none');
const judgeModel = opt('judge-model', judgeProvider === 'openai' ? 'gpt-6-luna' : judgeProvider === 'anthropic' ? 'claude-opus-5-5' : null);
const runName = opt('run', `${new Date().toISOString().replace(/[:.]/g, '-')}_${isModel ? `${model}_${effort}` : assistantKind}`);
const outRoot = join(opt('out', join(REPO, 'evals', 'results')), 'connector', runName);

// ─── cases ───────────────────────────────────────────────────────────────────
const CASE_DIR = join(HERE, 'cases');
const caseFiles = readdirSync(CASE_DIR).filter((f) => f.endsWith('.json')).sort();
const allCases = caseFiles.map((f) => ({ file: f, ...JSON.parse(readFileSync(join(CASE_DIR, f), 'utf8')) }));
for (const c of allCases) {
  for (const k of ['id', 'turns', 'checks', 'oracle']) if (!(k in c)) throw new Error(`${c.file}: missing "${k}"`);
  if (c.oracle.length !== c.turns.length) throw new Error(`${c.file}: the oracle plan must have one entry per turn`);
}
const cases = filter.length ? allCases.filter((c) => filter.some((f) => c.id.includes(f))) : allCases;
if (!cases.length) { console.error(`no case matches ${filter.join(',')}`); process.exit(2); }
const casesHash = createHash('sha256').update(caseFiles.map((f) => readFileSync(join(CASE_DIR, f))).join('\n')).digest('hex').slice(0, 12);

const git = (args) => { try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim(); } catch { return null; } };

// ─── one trial ───────────────────────────────────────────────────────────────
async function newAssistant(kase) {
  if (assistantKind === 'claude') {
    const { createClaudeAssistant } = await import('./assistants/claude.mjs');
    return createClaudeAssistant({ model, effort });
  }
  if (assistantKind === 'openai') {
    const { createOpenAIAssistant } = await import('./assistants/openai.mjs');
    return createOpenAIAssistant({ model, effort });
  }
  if (assistantKind === 'oracle' || assistantKind === 'null') return createScriptedAssistant({ kind: assistantKind, plan: kase.oracle });
  throw new Error(`unknown assistant "${assistantKind}" (claude | openai | oracle | null)`);
}

async function runTrial(kase, n, judge, ctx) {
  const dir = join(outRoot, kase.id, `trial-${n}`);
  mkdirSync(dir, { recursive: true });
  const events = [];
  const emit = (e) => events.push({ at: new Date().toISOString(), ...e });
  const turns = [];
  let error = null;
  let stack = null;
  const t0 = Date.now();
  let toolsHash = null;
  let assistant = null;
  try {
    stack = await startStack({ phone: kase.phone || {}, scenario: kase.scenario || { steps: [{ done: 'Done.' }] } });
    const tools = await stack.mcp.listTools();
    toolsHash = createHash('sha256').update(JSON.stringify(tools)).digest('hex').slice(0, 12);
    if (kase.setup?.start_task) {
      // A task already running when the conversation starts, as if started earlier.
      const started = await stack.mcp.callTool('run_phone_task', { task: kase.setup.start_task });
      emit({ type: 'setup', action: 'start_task', result: started.json });
      for (let i = 0; i < 10; i++) {
        const s = (await stack.mcp.callTool('get_run_status', {})).json;
        if (s?.status === 'running') break;
      }
    }
    assistant = await newAssistant(kase);
    for (let i = 0; i < kase.turns.length; i++) {
      const user = kase.turns[i];
      const turnEvents = [];
      const turnEmit = (e) => { turnEvents.push(e); emit({ turn: i + 1, ...e }); };
      turnEmit({ type: 'user', text: user });
      const tt = Date.now();
      const result = await assistant.runTurn({
        userText: user, tools, emit: turnEmit,
        callTool: (name, args) => stack.mcp.callTool(name, args),
      });
      turns.push({
        user, text: result.text, status: result.status, ms: Date.now() - tt, events: turnEvents,
        toolCalls: turnEvents.filter((e) => e.type === 'tool_call').map((e) => ({ name: e.name, args: e.args, result: e.result })),
      });
      if (result.status !== 'ok') break;
    }
  } catch (e) {
    error = { message: e.message, status: e.status ?? null, type: e.constructor?.name };
    emit({ type: 'error', ...error });
  }

  // Facts after the conversation, read from the system itself.
  let finalRun = null; let phone = null; let defaultModel = null; let starts = []; let serverLog = '';
  if (stack) {
    try {
      for (let i = 0; i < 40; i++) { phone = await stack.phoneState(); if (!phone.automationRunning) break; await sleep(500); }
      const last = (await stack.mcp.callTool('get_run_status', {})).json;
      finalRun = last?.ok === false ? null : last;
      defaultModel = (await stack.mcp.callTool('get_phone_status', {})).json?.default_model ?? null;
      starts = stack.stubCalls();
      serverLog = stack.serverLog();
    } catch (e) { error = error || { message: `reading the end state: ${e.message}` }; }
    await stack.stop();
  }

  const trial = { turns, starts, finalRun, phone, defaultModel };
  const checks = error ? [] : codeChecks(kase, trial);
  const transcript = renderTranscript(turns);
  const judged = [];
  if (!error) {
    for (const expectation of kase.expect || []) {
      try { judged.push({ expectation, ...(await judge.grade({ transcript, expectation })) }); } catch (e) {
        judged.push({ expectation, verdict: 'error', reason: `judge call failed: ${e.message}` });
      }
    }
  }
  const verdict = verdictFor({ checks, judged, error });

  const modelCalls = events.filter((e) => e.type === 'model_call');
  const sum = (k) => modelCalls.reduce((a, e) => a + (e.usage?.[k] || 0), 0);
  const usage = {
    model_calls: modelCalls.length,
    served_models: [...new Set(modelCalls.map((e) => e.served_model))],
    input_tokens: sum('input_tokens'), output_tokens: sum('output_tokens'),
    cache_read_input_tokens: sum('cache_read_input_tokens'), cache_write_input_tokens: sum('cache_write_input_tokens'),
    tool_calls: events.filter((e) => e.type === 'tool_call').length,
    tool_ms: events.filter((e) => e.type === 'tool_call').reduce((a, e) => a + (e.ms || 0), 0),
    model_ms: modelCalls.reduce((a, e) => a + (e.ms || 0), 0),
    wall_ms: Date.now() - t0,
    judge_input_tokens: judged.reduce((a, j) => a + (j.usage?.input_tokens || 0), 0),
    judge_output_tokens: judged.reduce((a, j) => a + (j.usage?.output_tokens || 0), 0),
  };
  if (isModel) {
    usage.cost_usd = costOf(model, usage);
    usage.judge_cost_usd = judge.model ? costOf(judge.model, { input_tokens: usage.judge_input_tokens, output_tokens: usage.judge_output_tokens }) : null;
  }
  // The model that answered must be the model that was asked for.
  if (isModel && usage.served_models.some((m) => m && !String(m).startsWith(model))) {
    checks.push({ name: 'the requested model served every call', ok: false, detail: `served by ${usage.served_models.join(', ')}` });
  }

  const state = {
    case: kase.id, trial: n, verdict, error, checks, judged, usage,
    assistant: assistant?.describe?.() ?? { kind: assistantKind }, judge: { provider: judge.provider, model: judge.model, prompt_hash: JUDGE_PROMPT_HASH },
    tools_hash: toolsHash, final_run: finalRun, starts, phone, default_model: defaultModel, run: ctx.runName,
  };
  // Key-shaped strings are scrubbed from everything written (agent/record.mjs scrub).
  writeFileSync(join(dir, 'events.jsonl'), scrub(events.map((e) => JSON.stringify(e)).join('\n')) + '\n');
  writeFileSync(join(dir, 'state.json'), `${scrub(JSON.stringify(state, null, 2))}\n`);
  writeFileSync(join(dir, 'server.log'), serverLog);
  writeFileSync(join(dir, 'transcript.md'), [
    `# ${kase.id} — trial ${n}: ${verdict}`, '', kase.summary || '', '', '```', transcript, '```', '',
    '## Code checks', ...checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.name} — ${c.detail}`), '',
    '## Judged', ...judged.map((j) => `- ${j.verdict.toUpperCase()} ${j.expectation} — ${j.reason}`),
    ...(error ? ['', `## Error`, `${error.message}`] : []), '',
  ].join('\n'));
  return { verdict, state, toolsHash };
}

// ─── the run ─────────────────────────────────────────────────────────────────
mkdirSync(outRoot, { recursive: true });
const judge = await createJudge({ provider: judgeProvider, model: judgeModel });
const runInfo = {
  harness_version: HARNESS_VERSION, run: runName, started: new Date().toISOString(),
  git: { commit: git(['rev-parse', 'HEAD']), dirty: (git(['status', '--porcelain']) || '').length > 0 },
  assistant: { kind: assistantKind, model: isModel ? model : null, effort: isModel ? effort : null },
  judge: { provider: judgeProvider, model: judgeModel, prompt_hash: JUDGE_PROMPT_HASH },
  trials, cases: cases.map((c) => c.id), cases_hash: casesHash, node: process.version, platform: `${process.platform}-${process.arch}`,
};
writeFileSync(join(outRoot, 'run_info.json'), `${JSON.stringify(runInfo, null, 2)}\n`);
console.log(`connector evals — ${assistantKind}${isModel ? ` ${model} (${effort})` : ''}, judge ${judgeProvider}${judgeModel ? ` ${judgeModel}` : ''}, ${cases.length} case(s) × ${trials} trial(s)\n  ${outRoot}\n`);

const verdicts = {};
const toolHashes = new Set();
let costUsd = 0; let judgeCostUsd = 0;
for (const kase of cases) {
  verdicts[kase.id] = [];
  for (let n = 1; n <= trials; n++) {
    const r = await runTrial(kase, n, judge, { runName });
    verdicts[kase.id].push(r.verdict);
    costUsd += r.state.usage.cost_usd || 0; judgeCostUsd += r.state.usage.judge_cost_usd || 0;
    if (r.toolsHash) toolHashes.add(r.toolsHash);
    const why = [...r.state.checks.filter((c) => !c.ok).map((c) => c.name), ...r.state.judged.filter((j) => j.verdict !== 'held').map((j) => `${j.verdict}: ${j.expectation}`)];
    console.log(`  ${r.verdict.padEnd(10)} ${kase.id} #${n}  (${(r.state.usage.wall_ms / 1000).toFixed(1)}s, ${r.state.usage.tool_calls} tool calls)${r.state.error ? `  ${r.state.error.message}` : ''}${why.length && r.verdict !== 'PASS' ? `\n             ${why.join('\n             ')}` : ''}`);
  }
}

const summary = summarize(verdicts);
if (isModel) Object.assign(summary, { cost_usd: Math.round(costUsd * 100) / 100, judge_cost_usd: Math.round(judgeCostUsd * 100) / 100, prices_as_of: PRICES_AS_OF });
runInfo.finished = new Date().toISOString();
runInfo.tools_hashes = [...toolHashes];
writeFileSync(join(outRoot, 'run_info.json'), `${JSON.stringify(runInfo, null, 2)}\n`);
writeFileSync(join(outRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(0)}%`);
const md = [
  `# Connector evals: ${runName}`, '',
  `Assistant: ${assistantKind}${isModel ? ` ${model} (${effort})` : ''} · judge: ${judgeProvider}${judgeModel ? ` ${judgeModel}` : ''} · commit ${runInfo.git.commit?.slice(0, 7)}${runInfo.git.dirty ? ' (uncommitted changes)' : ''}`, '',
  `pass@1 ${pct(summary.pass_at_1)} (95% interval ${pct(summary.pass_at_1_ci95.low)}–${pct(summary.pass_at_1_ci95.high)}) · pass^${trials} ${pct(summary.pass_hat_k)} · ${summary.trials} graded trials · ${summary.test_errors} test errors · ${summary.reviews} for review`, '',
  '| case | verdicts |', '| --- | --- |',
  ...Object.entries(summary.per_case).map(([id, c]) => `| ${id} | ${c.verdicts.join(', ')} |`), '',
];
writeFileSync(join(outRoot, 'summary.md'), md.join('\n'));
console.log(`\n${md.slice(2, 5).join('\n')}`);

if (expect === 'all-pass' || expect === 'all-fail') {
  const want = expect === 'all-pass' ? 'PASS' : 'FAIL';
  const wrong = Object.entries(verdicts).filter(([, v]) => v.some((x) => x !== want));
  if (wrong.length) {
    console.error(`\nharness self-test FAILED: expected every case to ${want}, but: ${wrong.map(([id, v]) => `${id}=${v.join('/')}`).join(', ')}`);
    process.exit(1);
  }
  console.log(`\nharness self-test passed: every case ${want === 'PASS' ? 'passed with the oracle' : 'failed with the null assistant'}.`);
}
