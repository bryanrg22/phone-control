// loop.mjs — one task, from the first screen to an outcome.
//
// Each step: (1) nudges if the agent is repeating itself, (2) one model
// request with the conversation and the tools, (3) the tool calls it returned,
// in order, (4) a fresh look at the screen if anything changed it.
//
// A step's tool calls stop at the first that fails, at taskComplete and at
// taskFailed; the rest are answered "not run" (every call gets a result, as
// the providers require), so the model never acts on a screen it has not seen
// (execute.mjs, shared with the hybrid mode).
//
// Outcomes and how they end the process (agent.mjs):
//   completed      the model called taskComplete                         exit 0
//   failed         the model called taskFailed                           exit 1
//   step_budget    the last step passed without a conclusion             exit 1
//   no_progress    the screen stopped changing (stuck.mjs)                exit 1
//   errored        the model API failed for good (auth, credit, outage)  exit 42
//   device_lost    the phone stopped answering                           exit 43

import { observe, describeScreen } from './observe.mjs';
import { taskMessage, FINAL_STEP, NO_TOOL_CALL } from './prompt.mjs';
import { historyLine } from './context.mjs';
import { executeToolCalls } from './execute.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEVICE_ERRORS_TO_GIVE_UP = 4;     // consecutive steps in which the device itself failed
const SETTLE_MS = 350;                  // iOS animations: navigation push 330 ms, keyboard 250, modal 350

/**
 * @returns {Promise<{ status: string, summary?: string, reason?: string, steps: number }>}
 */
export async function runLoop({ task, maxSteps, model, device, runTool, toolDefs, context, protocol, recorder, stuck, progress, state, autoAllowNotifications }) {
  const { emit, log } = protocol;
  const t0 = Date.now();
  let screen = { widthPoints: 402, heightPoints: 874 };
  state.screen = () => screen;

  async function look(step, lead) {
    await autoAllowNotifications(step);
    const obs = await observe(device);
    screen = obs.screen;
    recorder.observation({ step, image: obs.image, elements: obs.elements });
    // The first screen is not counted, as before the restructure: progress is
    // measured from the screen after the first action.
    const check = step === 0 ? { nudge: null, stop: null } : progress.observe(obs.signature);
    context.screen({ image: obs.image, mime: obs.mime, text: `${lead}${describeScreen(obs.elements, { keyboardUp: state.keyboardUp })}${check.nudge ? `\n\n${check.nudge}` : ''}` });
    return check.stop;
  }

  try { await look(0, taskMessage(task, '').replace(/\s+$/, '')); } catch (e) {
    log(`[observe] the first screen could not be read: ${e.message}`);
    context.say(`Task: ${task}\n\n(The screen could not be read yet.)`);
  }

  const history = [];
  let deviceErrorSteps = 0;

  for (let step = 1; step <= maxSteps; step++) {
    emit('step', { step, total: maxSteps, elapsed: ((Date.now() - t0) / 1000).toFixed(1) });
    log(`\n--- Step ${step}/${maxSteps} ---`);
    const repeat = stuck.assess();
    if (repeat.nudge) context.say(repeat.nudge);
    context.history(history);
    const final = step === maxSteps;
    if (final) context.say(FINAL_STEP);

    // ── the model ──
    emit('thinking');
    const start = Date.now();
    let result;
    try {
      result = await model.complete({ messages: context.messages, tools: toolDefs, onlyTools: final ? ['taskComplete', 'taskFailed'] : null });
    } catch (e) {
      recorder.modelCall({ step, start, end: Date.now(), provider: model.provider, requestModel: model.model, messages: context.messages, tools: toolDefs, error: e });
      if (e.nonRecoverable) {
        log(`[model] ${e.message}`);
        return { status: 'errored', reason: e.message, steps: step };
      }
      log(`[model] request failed, step lost: ${e.message}`);
      continue;
    }
    recorder.modelCall({ step, start, end: Date.now(), provider: model.provider, requestModel: model.model, messages: context.messages, tools: toolDefs, result });
    const msg = result.message;
    if (msg.content) log(`[model] ${msg.content.slice(0, 300)}`);
    const calls = msg.tool_calls || [];

    if (!calls.length) {
      // An empty assistant turn is rejected by some APIs on the next request.
      context.assistant(msg.content ? msg : { ...msg, content: '(no response)' });
      context.say(msg.content ? NO_TOOL_CALL : 'Please use the available tools to complete the task.');
      continue;
    }
    context.assistant(msg);

    // ── the tools ──
    const { done, concluded, changes, settle, deviceFailed } = await executeToolCalls({ calls, step, runTool, context, recorder, stuck, protocol });
    history.push(historyLine(step, done));

    if (concluded?.done) return { status: 'completed', summary: concluded.done.summary, steps: step };
    if (concluded?.failed) return { status: 'failed', reason: concluded.failed.reason, steps: step };

    if (deviceFailed) {
      deviceErrorSteps += 1;
      if (deviceErrorSteps >= DEVICE_ERRORS_TO_GIVE_UP) {
        return { status: 'device_lost', reason: `the phone stopped answering: ${deviceErrorSteps} steps in a row failed on the device`, steps: step };
      }
    } else deviceErrorSteps = 0;

    // ── a fresh look ──
    if (changes) {
      if (settle) await sleep(SETTLE_MS);
      try {
        const stop = await look(step, 'Here is the current screen. Continue with the task.');
        if (stop) return { status: 'no_progress', reason: `no progress: ${stop}`, steps: step };
      } catch (e) {
        log(`[observe] screenshot failed: ${e.message}`);
        context.say('Screenshot failed. Try a different approach.');
      }
    }
  }
  return { status: 'step_budget', reason: 'Reached the step limit without finishing.', steps: maxSteps };
}
