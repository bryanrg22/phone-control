// trajectory.mjs — turn our agent's trace into iOSWorld's trajectory format.
//
// The agent, run with --trace-dir, leaves:
//   steps.jsonl      one line per step: every tool call with its arguments, the
//                    model's text, token use (agent/agent.mjs saveStepRecord)
//   step-NN.jpg|png  the screen the model was shown AFTER step NN (step-00 is
//                    the screen before step 1)
//
// iOSWorld's judge (scripts/llm_action_generator.py evaluate_trajectory) reads
// a list of steps, each with the screenshot taken BEFORE that step's actions
// and the actions themselves, plus `post_action_screenshot` on the last step
// for the end state, and the agent's final answer from task.json. So step k
// gets image k-1, as the model saw it.
//
// Actions carry the tool name and arguments only, like iOSWorld's own
// trajectories: not the tool's reply, which would hand the judge the agent's
// own claims ("Task complete") as if they were observations. The final answer
// reaches the judge the way iOSWorld passes it: task.json `agent_answer`.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The image saved after step n (step-00 = before step 1), or null. */
export function imageAfter(traceDir, n) {
  const nn = String(n).padStart(2, '0');
  for (const ext of ['jpg', 'png']) {
    const f = join(traceDir, `step-${nn}.${ext}`);
    if (existsSync(f)) return f;
  }
  return null;
}

export function readSteps(traceDir) {
  const f = join(traceDir, 'steps.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** How the run ended, from the agent's own final tool call. */
export function outcomeOf(steps) {
  for (let i = steps.length - 1; i >= 0; i--) {
    for (const c of steps[i].tool_calls || []) {
      if (c.name === 'taskComplete') return { ended: 'completed', answer: c.args?.summary ?? '' };
      if (c.name === 'taskFailed') return { ended: 'gave_up', answer: c.args?.reason ?? '' };
    }
  }
  return { ended: 'no_conclusion', answer: null };
}

/**
 * @param {string} traceDir     the agent's --trace-dir
 * @param {string|null} finalScreenshot  the screen after the run ended, captured by the harness
 * @returns {object[]} iOSWorld trajectory entries
 */
export function toTrajectory(traceDir, finalScreenshot) {
  const steps = readSteps(traceDir);
  const traj = steps.map((s) => ({
    step: s.step,
    screenshot: imageAfter(traceDir, s.step - 1),
    actions: (s.tool_calls || []).map((c) => (c.args !== undefined ? { tool: c.name, ...c.args } : { tool: c.name, invalid_arguments: c.args_raw })),
  }));
  if (traj.length && finalScreenshot) traj[traj.length - 1].post_action_screenshot = finalScreenshot;
  return traj;
}

/** Totals for the record: tokens and model time across steps. */
export function usageOf(steps) {
  const sum = (k) => steps.reduce((a, s) => a + (s[k] || 0), 0);
  return {
    steps: steps.length,
    tool_calls: steps.reduce((a, s) => a + (s.tool_calls || []).length, 0),
    ask_user_calls: steps.reduce((a, s) => a + (s.tool_calls || []).filter((c) => c.name === 'askUser' || c.name === 'askUserText').length, 0),
    input_tokens: sum('input_tokens'),
    output_tokens: sum('output_tokens'),
    cache_read_input_tokens: sum('cache_read_input_tokens'),
    cache_creation_input_tokens: sum('cache_creation_input_tokens'),
    model_seconds: Math.round(sum('model_s') * 10) / 10,
    served_models: [...new Set(steps.map((s) => s.served_model).filter(Boolean))],
  };
}

/** Image files in a trace, for counting what the judge will see. */
export const imagesIn = (traceDir) => (existsSync(traceDir) ? readdirSync(traceDir).filter((f) => /^step-\d+\.(jpg|png)$/.test(f)).length : 0);
