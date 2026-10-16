#!/usr/bin/env node
// compare.mjs — finished connector-eval runs side by side: how often each model
// passes, and what a task costs it in steps, time and money.
//
//   node evals/connector/compare.mjs evals/results/connector/2026-10-16_0f59812_*_high [--out report.md]
//
// Reads only what the runs recorded (state.json and events.jsonl, or
// events.jsonl.gz in a test record, of each trial); nothing is re-run or re-graded. Per model:
//   pass@1 (Wilson 95% interval), pass^k        how often, and how reliably
//   model calls, tool calls per task            steps: requests to the model, and
//                                               connector tools it called
//   model time, total time per task             seconds; total includes the
//                                               scripted phone, the same for
//                                               every model, so model time is
//                                               the part a model controls
//   cached share of input tokens                how much of each prompt was read
//                                               from the provider's cache
//   cost per task, cost per passed task         list prices (evals/lib/prices.mjs)
// and per case: tool calls and model seconds per task, for each model.
//
// Claude runs recorded before prompt caching was turned on for the Claude
// assistant (2026-10-16) have no cache reads; their cost is also given as an
// estimate with caching, marked as one.

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { summarize } from '../lib/stats.mjs';
import { costOf, PRICES_AS_OF } from '../lib/prices.mjs';
import { readEvents } from '../lib/events.mjs';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const out = outIdx >= 0 ? argv[outIdx + 1] : null;
const runs = argv.filter((a, i) => !a.startsWith('--') && !(outIdx >= 0 && i === outIdx + 1));
const notRuns = runs.filter((d) => !existsSync(join(d, 'run_info.json')));
if (notRuns.length) { console.error(`not a run folder (no run_info.json): ${notRuns.join(', ')}`); process.exit(2); }
if (!runs.length) { console.error('usage: compare.mjs <run folder>... [--out report.md]'); process.exit(2); }

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

/** Cost had the conversation been cached: each request reads the previous request's prompt, writes the rest. */
export function cachedCostEstimate(model, modelCalls, minimum = 512) {
  let prev = 0; let total = 0;
  for (const u of modelCalls) {
    const read = prev >= minimum ? Math.min(prev, u.input_tokens) : 0;
    const write = u.input_tokens >= minimum ? u.input_tokens - read : 0;
    total += costOf(model, { input_tokens: u.input_tokens, cache_read_input_tokens: read, cache_write_input_tokens: write, output_tokens: u.output_tokens });
    prev = u.input_tokens;
  }
  return total;
}

const rows = [];
const perCase = {};   // case → model → { tools, seconds }
for (const dir of runs) {
  const info = JSON.parse(readFileSync(join(dir, 'run_info.json'), 'utf8'));
  const model = info.assistant.model;
  const verdicts = {}; const trials = [];
  for (const kase of readdirSync(dir).filter((d) => existsSync(join(dir, d, 'trial-1')))) {
    verdicts[kase] = [];
    for (const t of readdirSync(join(dir, kase)).filter((d) => d.startsWith('trial-')).sort()) {
      const state = JSON.parse(readFileSync(join(dir, kase, t, 'state.json'), 'utf8'));
      verdicts[kase].push(state.error ? 'TEST_ERROR' : state.verdict);
      if (state.error) continue;
      const calls = readEvents(join(dir, kase, t)).filter((e) => e.type === 'model_call').map((e) => e.usage);
      trials.push({ kase, pass: state.verdict === 'PASS', u: state.usage, calls });
      const c = ((perCase[kase] ||= {})[model] ||= { tools: [], seconds: [], passes: 0, n: 0 });
      c.tools.push(state.usage.tool_calls); c.seconds.push(state.usage.model_ms / 1000); c.n += 1; if (state.verdict === 'PASS') c.passes += 1;
    }
  }
  const s = summarize(verdicts);
  const cost = trials.reduce((a, t) => a + (t.u.cost_usd || 0), 0);
  const uncached = info.assistant.kind === 'claude' && trials.every((t) => !t.u.cache_read_input_tokens && !t.u.cache_write_input_tokens);
  const estimate = uncached ? trials.reduce((a, t) => a + cachedCostEstimate(model, t.calls), 0) : null;
  const passes = trials.filter((t) => t.pass).length;
  rows.push({
    model, run: basename(dir), effort: info.assistant.effort, judge: info.judge.model, commit: info.git?.commit,
    pass_at_1: s.pass_at_1, ci: s.pass_at_1_ci95, pass_hat_k: s.pass_hat_k, trials: s.trials, passes, errors: s.test_errors,
    model_calls: mean(trials.map((t) => t.u.model_calls)), tool_calls: mean(trials.map((t) => t.u.tool_calls)),
    model_s: mean(trials.map((t) => t.u.model_ms / 1000)), model_s_median: median(trials.map((t) => t.u.model_ms / 1000)),
    wall_s: mean(trials.map((t) => t.u.wall_ms / 1000)),
    output_tokens: mean(trials.map((t) => t.u.output_tokens)),
    cached_share: (() => { const i = trials.reduce((a, t) => a + t.u.input_tokens, 0); return i ? trials.reduce((a, t) => a + (t.u.cache_read_input_tokens || 0), 0) / i : null; })(),
    cost_per_task: cost / trials.length, cost_per_pass: passes ? cost / passes : null,
    est_cost_per_task: estimate === null ? null : estimate / trials.length,
  });
}
rows.sort((a, b) => b.pass_at_1 - a.pass_at_1 || (a.est_cost_per_task ?? a.cost_per_task) - (b.est_cost_per_task ?? b.cost_per_task));

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const usd = (x) => (x === null ? '–' : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);
const n1 = (x) => (x === null ? '–' : x.toFixed(1));
const models = rows.map((r) => r.model);
const md = [
  '# Connector eval: models compared', '',
  `${rows.length} runs · ${rows[0].trials} graded trials each · costs at list prices of ${PRICES_AS_OF} · judges from the other company`, '',
  '| model | pass@1 (95% interval) | pass^k | model calls / task | tool calls / task | model s / task (median) | total s / task | output tokens / task | input read from cache | cost / task | cost / passed task |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.model} | ${pct(r.pass_at_1)} (${pct(r.ci.low)}–${pct(r.ci.high)}) | ${pct(r.pass_hat_k)} | ${n1(r.model_calls)} | ${n1(r.tool_calls)} | ${n1(r.model_s)} (${n1(r.model_s_median)}) | ${n1(r.wall_s)} | ${Math.round(r.output_tokens)} | ${r.cached_share === null ? '–' : pct(r.cached_share)} | ${usd(r.cost_per_task)}${r.est_cost_per_task !== null ? ` (≈${usd(r.est_cost_per_task)} cached†)` : ''} | ${usd(r.cost_per_pass)} |`),
  '',
  ...(rows.some((r) => r.est_cost_per_task !== null) ? ['† Recorded without prompt caching (OpenAI caches automatically; the Claude assistant had no cache breakpoints until 2026-10-16). The figure in brackets is an estimate from the recorded token counts, assuming each request reads the previous one from the cache; only a re-run measures it.', ''] : []),
  'Total time includes the scripted phone, the same for every model; model time is the part the model controls.', '',
  '## Per task: tool calls · model seconds', '',
  `| case | ${models.join(' | ')} |`, `| --- | ${models.map(() => '---').join(' | ')} |`,
  ...Object.keys(perCase).sort().map((k) => `| ${k} | ${models.map((m) => { const c = perCase[k][m]; return c ? `${n1(mean(c.tools))} · ${n1(mean(c.seconds))}s${c.passes < c.n ? ` (${c.passes}/${c.n} passed)` : ''}` : '–'; }).join(' | ')} |`),
  '', `Runs: ${rows.map((r) => `\`${r.run}\``).join(', ')}`, '',
].join('\n');

if (out) writeFileSync(out, md);
console.log(md);
