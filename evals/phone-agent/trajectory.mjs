// trajectory.mjs — turn the agent's run record into iOSWorld's trajectory format.
//
// The agent, run with --trace-dir, leaves (agent/record.mjs):
//   trace.jsonl     a `chat` span per model request, an `execute_tool` span per
//                   tool call, an `observation` event per screen the model was
//                   shown (step 0 = before the first request)
//   manifest.json   how the run ended, and its totals
//   blobs/…         the images and bodies, by hash
//
// iOSWorld's judge (scripts/llm_action_generator.py evaluate_trajectory) reads
// one entry per step: the screenshot taken BEFORE that step's actions, the
// actions, and on the last step `post_action_screenshot` for the end state; the
// agent's final answer comes from task.json. So step k gets the screen shown
// after step k-1, when one was taken (no new screen, no image: never a stale one).
//
// Actions carry the tool name and arguments only, like iOSWorld's own
// trajectories: not the tool's reply, which would hand the judge the agent's
// own claims ("Task complete") as if they were observations. Calls the agent
// did not run (after a failure or a conclusion in the same step) are left out.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { costOf } from '../lib/prices.mjs';

const slug = (s) => s.replace(/[^a-zA-Z0-9.-]+/g, '-');

/**
 * A --models entry: provider:model, or provider:model+writerProvider:writerModel
 * for the hybrid (agent/decision/writer.mjs: a decision model picks, an LLM writes).
 * @returns {{ provider: string, model: string, writer: {provider: string, model: string}|null, display: string, dir: string }}
 */
export function parseModelSpec(spec) {
  const part = (x) => { const [provider, ...rest] = String(x).split(':'); return { provider, model: rest.join(':') }; };
  const [main, ...more] = String(spec).split('+');
  const m = part(main);
  const writer = more.length ? part(more[0]) : null;
  if (!m.provider || !m.model || more.length > 1 || (writer && (!writer.provider || !writer.model))) throw new Error(`--models entry "${spec}" must be provider:model, or provider:model+writerProvider:writerModel for the hybrid`);
  return {
    provider: m.provider, model: m.model, writer,
    display: writer ? `${m.model}+${writer.provider}:${writer.model}` : m.model,
    dir: `${m.provider}_${slug(m.model)}${writer ? `+${writer.provider}_${slug(writer.model)}` : ''}`,
  };
}

/**
 * Dollars for the run, each chat span at its own model's list price (a hybrid
 * run has two models). Null when there is no chat span or a model has no price.
 */
export function costOfTrace(trace) {
  const chats = trace.filter((r) => op(r) === 'chat');
  if (!chats.length) return null;
  let total = 0;
  for (const r of chats) {
    const a = r.attributes || {};
    const c = costOf(a['gen_ai.request.model'], { input_tokens: a['gen_ai.usage.input_tokens'], output_tokens: a['gen_ai.usage.output_tokens'], cache_read_input_tokens: a['gen_ai.usage.cache_read.input_tokens'], cache_write_input_tokens: a['gen_ai.usage.cache_write.input_tokens'] });
    if (c === null) return null;
    total += c;
  }
  return total;
}

export function readTrace(traceDir) {
  const f = join(traceDir, 'trace.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function readManifest(traceDir) {
  const f = join(traceDir, 'manifest.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

const op = (r) => r.attributes?.['gen_ai.operation.name'];

/** The executed tool calls of each step, in order: Map(step → [{ name, args }]). */
function actionsByStep(trace) {
  const by = new Map();
  for (const r of trace) {
    if (op(r) !== 'execute_tool' || r.eval?.skipped) continue;
    const step = r.eval.step;
    if (!by.has(step)) by.set(step, []);
    by.get(step).push({ name: r.attributes['gen_ai.tool.name'], args: r.attributes['gen_ai.tool.call.arguments'] });
  }
  return by;
}

/** How the run ended, from the agent's own final tool call. */
export function outcomeOf(trace) {
  const calls = [...actionsByStep(trace).values()].flat();
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].name === 'taskComplete') return { ended: 'completed', answer: calls[i].args?.summary ?? '' };
    if (calls[i].name === 'taskFailed') return { ended: 'gave_up', answer: calls[i].args?.reason ?? '' };
  }
  return { ended: 'no_conclusion', answer: null };
}

/**
 * @param {string} traceDir
 * @param {string|null} finalScreenshot   the screen after the run ended, captured by the harness
 */
export function toTrajectory(traceDir, finalScreenshot) {
  const trace = readTrace(traceDir);
  const shown = new Map(trace.filter((r) => r.name === 'observation').map((r) => [r.eval.step, join(traceDir, r.eval.image)]));
  const actions = actionsByStep(trace);
  const steps = trace.filter((r) => op(r) === 'chat').map((r) => r.eval.step);
  const traj = [...new Set(steps)].map((step) => ({
    step,
    screenshot: shown.get(step - 1) ?? null,
    actions: (actions.get(step) || []).map(({ name, args }) => (args && typeof args === 'object' ? { tool: name, ...args } : { tool: name, invalid_arguments: args })),
  }));
  if (traj.length && finalScreenshot) traj[traj.length - 1].post_action_screenshot = finalScreenshot;
  return traj;
}

/** Totals for the eval record, from the trace. */
export function usageOf(trace) {
  const chats = trace.filter((r) => op(r) === 'chat');
  const sum = (k) => chats.reduce((a, r) => a + (r.attributes[k] || 0), 0);
  const tools = trace.filter((r) => op(r) === 'execute_tool');
  return {
    steps: new Set(chats.map((r) => r.eval.step)).size,
    model_calls: chats.length,
    tool_calls: tools.filter((r) => !r.eval.skipped).length,
    tool_errors: tools.filter((r) => r.status === 'ERROR').length,
    ask_user_calls: tools.filter((r) => ['askUser', 'askUserText'].includes(r.attributes['gen_ai.tool.name'])).length,
    input_tokens: sum('gen_ai.usage.input_tokens'),
    output_tokens: sum('gen_ai.usage.output_tokens'),
    cache_read_input_tokens: sum('gen_ai.usage.cache_read.input_tokens'),
    cache_write_input_tokens: sum('gen_ai.usage.cache_write.input_tokens'),
    reasoning_output_tokens: sum('gen_ai.usage.reasoning.output_tokens'),
    model_seconds: Math.round(chats.reduce((a, r) => a + (r.eval.latency_ms || 0), 0) / 100) / 10,
    served_models: [...new Set(chats.map((r) => r.attributes['gen_ai.response.model']).filter(Boolean))],
    ...decisionStats(chats),
  };
}

/**
 * Decision mode only (agent/decision/): the probabilities the model put on the
 * actions it chose, for calibration against the judge. Absent for LLM runs.
 *   decision_mean_probability    mean over the steps
 *   decision_min_probability     the least sure step
 *   decision_done_probability    the probability on "done" when the run ended with it, else null
 */
function decisionStats(chats) {
  const ds = chats.map((r) => r.eval?.decision).filter((d) => d && typeof d.probability === 'number');
  if (!ds.length) return {};
  const ps = ds.map((d) => d.probability);
  const last = ds.at(-1);
  const round = (x) => Math.round(x * 1000) / 1000;
  return {
    decision_steps: ds.length,
    decision_mean_probability: round(ps.reduce((a, b) => a + b, 0) / ps.length),
    decision_min_probability: round(Math.min(...ps)),
    decision_done_probability: last.choice === 'done' ? round(last.probability) : null,
  };
}
