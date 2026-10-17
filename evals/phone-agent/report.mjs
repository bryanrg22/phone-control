// report.mjs — the numbers of a phone-agent run, per model, across trials. Pure.
//
// What is reported, and why (sources in evals/README.md):
//   pass rate with its 95% Wilson interval            iOSWorld's metric; the interval so small differences are not over-read
//   pass^k: every trial of a task passed               τ-bench; what someone relying on the agent experiences
//   by category (single_app, multi_app, memory)        iOSWorld's breakdown, to compare with the paper
//   rubric score: share of rubric criteria held        iOSWorld's secondary metric (partial credit)
//   steps, wall time, model time                       efficiency; the step budget is stated beside it
//   tokens: input (cached included), cached, output, reasoning; cost at list prices
//                                                      recomputable as prices change (Kapoor et al. 2024)
//   how runs ended: completed, failed (gave up), step_budget, no_progress, errored, device_lost
//                                                      a stop-reason breakdown, not one failure bucket
//   tool errors per tool call; questions to the user   process measures
//   test errors, apart                                 infrastructure failures are never scored as the model's
//   calibration (decision models only)                 pass rate by the probability the model put on "done":
//                                                      does its confidence predict the judge's verdict? (reliability by bucket)

import { wilson } from '../lib/stats.mjs';

const ENDINGS = ['completed', 'failed', 'step_budget', 'no_progress', 'errored', 'device_lost', 'stopped'];
// Probability on "done" at the end of a run, bucketed; a run that did not end with "done" is its own row.
export const CALIBRATION_BUCKETS = [[0, 0.5], [0.5, 0.8], [0.8, 0.95], [0.95, 1.0001]];
const round = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Did iOSWorld's judge pass this task? Every rubric criterion held (their definition). */
export function passedBy(evaluation) {
  if (!evaluation) return false;
  if (evaluation.rubric_results) return evaluation.rubric_results.length > 0 && evaluation.rubric_results.every((r) => r.satisfied);
  return !!evaluation.success;
}

/**
 * @param {Array<{ model: {provider, model}, trials: Array<{ trial: number, records: object[], evaluations: Record<string, object> }> }>} models
 *   records: record.json of each task (status ok|error, category, steps, tokens, cost_usd, ended, agent_seconds, …)
 *   evaluations: task name → the judge's evaluation (iOSWorld task.json `evaluation`)
 */
export function buildReport(models) {
  return models.map(({ model, trials }) => {
    const all = trials.flatMap((t) => t.records.map((r) => ({ ...r, trial: t.trial, evaluation: t.evaluations[r.task] })));
    const judged = all.filter((r) => r.status === 'ok' && r.evaluation);
    const passes = judged.filter((r) => passedBy(r.evaluation)).length;
    const n = judged.length;

    // pass^k over tasks that every trial judged.
    const byTask = new Map();
    for (const r of judged) { if (!byTask.has(r.task)) byTask.set(r.task, []); byTask.get(r.task).push(passedBy(r.evaluation)); }
    const complete = [...byTask.values()].filter((v) => v.length === trials.length);
    const passHatK = trials.length > 1 && complete.length ? complete.filter((v) => v.every(Boolean)).length / complete.length : null;

    const byCategory = {};
    for (const r of judged) {
      const c = (byCategory[r.category] ||= { n: 0, passes: 0, steps: 0 });
      c.n += 1; c.steps += r.steps || 0; if (passedBy(r.evaluation)) c.passes += 1;
    }
    const sum = (k, rows = all) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const mean = (k) => (n ? sum(k, judged) / n : null);
    const rubricScores = judged.map((r) => r.evaluation.score).filter((x) => typeof x === 'number');
    const ended = Object.fromEntries(ENDINGS.map((e) => [e, all.filter((r) => r.ended === e).length]).filter(([, v]) => v));
    const calibration = calibrationOf(judged);

    return {
      provider: model.provider, model: model.model, trials: trials.length,
      runs: all.length, judged: n, test_errors: all.filter((r) => r.status !== 'ok').length,
      pass_rate: n ? passes / n : null, pass_ci95: wilson(passes, n), pass_hat_k: passHatK,
      by_category: Object.fromEntries(Object.entries(byCategory).map(([k, c]) => [k, { n: c.n, pass_rate: c.passes / c.n, avg_steps: round(c.steps / c.n) }])),
      rubric_score: rubricScores.length ? round(rubricScores.reduce((a, b) => a + b, 0) / rubricScores.length, 3) : null,
      avg_steps: round(mean('steps')), avg_agent_seconds: round(mean('agent_seconds')), avg_model_seconds: round(mean('model_seconds')),
      ended,
      tool_calls: sum('tool_calls'), tool_error_rate: sum('tool_calls') ? round(sum('tool_errors') / sum('tool_calls'), 3) : null,
      ask_user_calls: sum('ask_user_calls'),
      // Hybrid runs: how many steps the LLM took, of all model steps.
      ...(all.some((r) => typeof r.llm_steps === 'number' && r.llm_steps > 0) ? { llm_steps: sum('llm_steps'), llm_step_share: sum('model_calls') ? round(sum('llm_steps') / sum('model_calls'), 3) : null } : {}),
      tokens: { input: sum('input_tokens'), cache_read: sum('cache_read_input_tokens'), output: sum('output_tokens'), reasoning: sum('reasoning_output_tokens') },
      cost_usd: round(sum('cost_usd'), 2), cost_per_task_usd: all.length ? round(sum('cost_usd') / all.length, 3) : null,
      served_models: [...new Set(all.flatMap((r) => r.served_models || []))],
      ...(calibration ? { calibration, avg_decision_probability: round(mean('decision_mean_probability'), 3) } : {}),
    };
  });
}

/** Decision runs: judged runs by the probability on "done", with the pass rate of each bucket. Null for LLM runs. */
export function calibrationOf(judged) {
  const dec = judged.filter((r) => typeof r.decision_mean_probability === 'number');
  if (!dec.length) return null;
  const rows = CALIBRATION_BUCKETS.map(([lo, hi]) => {
    const inBucket = dec.filter((r) => typeof r.decision_done_probability === 'number' && r.decision_done_probability >= lo && r.decision_done_probability < hi);
    return { bucket: `done p ${lo}–${Math.min(hi, 1)}`, n: inBucket.length, pass_rate: inBucket.length ? inBucket.filter((r) => passedBy(r.evaluation)).length / inBucket.length : null };
  });
  const noDone = dec.filter((r) => typeof r.decision_done_probability !== 'number');
  rows.push({ bucket: 'did not end with done', n: noDone.length, pass_rate: noDone.length ? noDone.filter((r) => passedBy(r.evaluation)).length / noDone.length : null });
  return rows;
}

/** The report as Markdown. */
export function reportMarkdown(rows, { judgeModel, maxSteps, pricesAsOf }) {
  const pct = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);
  const cats = ['single_app', 'multi_app', 'memory'];
  const endingText = (e) => Object.entries(e).map(([k, v]) => `${k} ${v}`).join(', ');
  return [
    '# Phone agent on iOSWorld', '',
    `Judge: ${judgeModel} (iOSWorld's script, unchanged) · ${maxSteps} steps, no time limit · costs at list prices of ${pricesAsOf}`, '',
    '## Outcomes', '',
    `| model | trials | pass rate (95% interval) | pass^k | ${cats.join(' | ')} | rubric score | test errors |`,
    `| --- | --- | --- | --- | ${cats.map(() => '---').join(' | ')} | --- | --- |`,
    ...rows.map((r) => `| ${r.provider}:${r.model} | ${r.trials} | ${pct(r.pass_rate)} (${pct(r.pass_ci95.low)}–${pct(r.pass_ci95.high)}) of ${r.judged} | ${pct(r.pass_hat_k)} | ${cats.map((c) => (r.by_category[c] ? `${pct(r.by_category[c].pass_rate)} of ${r.by_category[c].n}` : '–')).join(' | ')} | ${r.rubric_score ?? '–'} | ${r.test_errors} |`),
    '', '## Efficiency and cost', '',
    '| model | avg steps | avg time (s) | avg model time (s) | input tokens (cached) | output (reasoning) | cost | per task |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.provider}:${r.model} | ${r.avg_steps ?? '–'} | ${r.avg_agent_seconds ?? '–'} | ${r.avg_model_seconds ?? '–'} | ${r.tokens.input.toLocaleString()} (${r.tokens.cache_read.toLocaleString()}) | ${r.tokens.output.toLocaleString()} (${r.tokens.reasoning.toLocaleString()}) | $${(r.cost_usd ?? 0).toFixed(2)} | $${(r.cost_per_task_usd ?? 0).toFixed(3)} |`),
    '', '## How runs ended, and behaviour', '',
    '| model | endings | tool error rate | questions to the user | steps by the LLM (hybrid) | served by |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.provider}:${r.model} | ${endingText(r.ended) || '–'} | ${pct(r.tool_error_rate)} of ${r.tool_calls} | ${r.ask_user_calls} | ${typeof r.llm_steps === 'number' ? `${pct(r.llm_step_share)} (${r.llm_steps})` : '–'} | ${r.served_models.join(', ') || '–'} |`),
    '',
    ...(rows.some((r) => r.calibration) ? [
      '## Confidence calibration (decision models)', '',
      'Pass rate by the probability the model put on "done" when it ended the run; a well-calibrated model passes more often when it is surer.', '',
      '| model | avg probability on the chosen action | ' + rows.find((r) => r.calibration).calibration.map((b) => b.bucket).join(' | ') + ' |',
      '| --- | --- | ' + rows.find((r) => r.calibration).calibration.map(() => '---').join(' | ') + ' |',
      ...rows.filter((r) => r.calibration).map((r) => `| ${r.provider}:${r.model} | ${r.avg_decision_probability ?? '–'} | ${r.calibration.map((b) => (b.n ? `${pct(b.pass_rate)} of ${b.n}` : '–')).join(' | ')} |`),
      '',
    ] : []),
  ].join('\n');
}
