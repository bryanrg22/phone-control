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
// agent's final answer comes from task.json. Step k gets the screen shown
// after step k-1; when none was taken (the step's tools did not change the
// screen: getUIElements, askUser, a text-only reply), the latest screen stands
// in, marked `screenshot_reused`, so the judge sees one screen per step as in
// iOSWorld's own trajectories (appium_agent.py takes one every step).
//
// Actions carry the tool name and arguments, and for a call that failed its
// error, as iOSWorld's do (`status: recoverable_error`): a failed tapText("Save")
// must not read as a tap on Save. Not the tool's reply, which would hand the
// judge the agent's own claims ("Task complete") as if they were observations,
// and not the model's free-text `description` of a tap. Calls the agent did
// not run (after a failure or a conclusion in the same step) are left out.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    by.get(step).push({ name: r.attributes['gen_ai.tool.name'], args: r.attributes['gen_ai.tool.call.arguments'], error: r.status === 'ERROR' ? String(r.attributes['gen_ai.tool.call.result'] ?? 'failed') : null });
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
  let last = null;
  const traj = [...new Set(steps)].map((step) => {
    const fresh = shown.get(step - 1) ?? null;
    if (fresh) last = fresh;
    return {
      step,
      screenshot: fresh ?? last,
      ...(fresh || !last ? {} : { screenshot_reused: true }),
      actions: (actions.get(step) || []).map(({ name, args, error }) => {
        const a = args && typeof args === 'object' ? { tool: name, ...args } : { tool: name, invalid_arguments: args };
        delete a.description;
        return error ? { ...a, error } : a;
      }),
    };
  });
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
  };
}
