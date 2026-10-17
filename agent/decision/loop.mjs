// decision/loop.mjs — one task driven by a decision model instead of an LLM.
//
// Each step: (1) the screen is read (screenshot for the record and the judge,
// the element list for the model), (2) the candidate actions are built from it
// (candidates.mjs), (3) ONE choice question goes to the decision model
// (question.mjs; the providers openai-decisions and typesafe), (4) the chosen
// option's tool calls run in order through the same tools the LLM mode uses
// (most options are one call; typing is "tap the field, then type"), (5) the
// screen is read again if an action could have changed it.
//
// The model writes no arguments and keeps no memory: the harness enumerates the
// actions and sends the action history in the state. "done" ends the run as
// taskComplete with a fixed summary (a decision model cannot write an answer:
// a known weakness, measured not assumed), "blocked" as taskFailed. With a
// writer (the hybrid, writer.mjs) an LLM composes the answer for "done" and
// the text for a "write into <field>" option; the decision model still picks.
//
// The record (record.mjs) gets the same spans as the LLM mode: a chat span per
// model request (its messages are the instruction and the state; its "tools"
// are the candidates; the answer's probabilities under eval.decision), an
// execute_tool span per action, an observation per screen, so the evals judge
// and report a decision run exactly as an LLM run.
//
// Outcomes are the same set as loop.mjs: completed, failed, step_budget,
// no_progress, errored, device_lost.

import { observe } from '../observe.mjs';
import { listElements, appOnScreen } from '../elements.mjs';
import { candidateActions, DONE_SUMMARY } from './candidates.mjs';
import { decisionState, INSTRUCTIONS } from './question.mjs';
import { writerMessages, compose, fieldSituation, WRITE_TEXT_INSTRUCTIONS, WRITE_ANSWER_INSTRUCTIONS } from './writer.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEVICE_ERRORS_TO_GIVE_UP = 4;
const SETTLE_MS = 350;
const round3 = (x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x);

/**
 * @param {object} o
 * @param {string} o.task
 * @param {number} o.maxSteps
 * @param {object} o.decider        createDecider(): { provider, model, decide({ instructions, state, candidates }) }
 * @param {object} o.device         device.mjs
 * @param {Function} o.runTool      tools.mjs createToolRunner()
 * @param {string[]} o.apps         installed app names
 * @param {object} o.protocol       protocol.mjs
 * @param {object} o.recorder       record.mjs
 * @param {object} o.progress       stuck.mjs createProgressMonitor()
 * @param {object} o.state          { keyboardUp, screen } shared with the tools
 * @param {(step: number) => Promise<void>} o.autoAllowNotifications
 * @param {string} [o.instructions]
 * @param {object} [o.writer]        the hybrid: createModel() of an LLM that writes free text and the answer (writer.mjs)
 * @returns {Promise<{ status: string, summary?: string, reason?: string, steps: number }>}
 */
export async function runDecisionLoop({ task, maxSteps, decider, device, runTool, apps, protocol, recorder, progress, state, autoAllowNotifications, instructions = INSTRUCTIONS, writer = null }) {
  const { emit, log } = protocol;
  const t0 = Date.now();
  let screen = { widthPoints: 402, heightPoints: 874 };
  state.screen = () => screen;
  let seen = null;   // the latest screen: { elements (structured), lines (capped), signature, currentApp, keyboardUp }

  async function look(step) {
    await autoAllowNotifications(step);
    const obs = await observe(device);
    screen = obs.screen;
    recorder.observation({ step, image: obs.image, elements: obs.elements });
    const check = step === 0 ? { nudge: null, stop: null } : progress.observe(obs.signature);
    const keyboardUp = await device.keyboardVisible().catch(() => state.keyboardUp);
    state.keyboardUp = keyboardUp;
    seen = { elements: listElements(obs.hierarchy, screen.widthPoints, screen.heightPoints), lines: obs.elements, signature: obs.signature, currentApp: appOnScreen(obs.hierarchy), keyboardUp, image: obs.image, mime: obs.mime };
    return check.stop;
  }

  try { await look(0); } catch (e) {
    log(`[observe] the first screen could not be read: ${e.message}`);
    seen = { elements: [], lines: [], signature: '', currentApp: null, keyboardUp: false, image: null, mime: null };
  }

  const history = [];
  let deviceErrorSteps = 0;

  // The hybrid's writing call: the LLM sees the latest screen and the history.
  // Its request is recorded as a chat span under its own model. Returns the
  // text, or null when the call failed (the step then reports the failure).
  async function write(step, kind, situation) {
    const messages = writerMessages({ instructions: kind === 'answer' ? WRITE_ANSWER_INSTRUCTIONS : WRITE_TEXT_INSTRUCTIONS, task, history, elements: seen.lines, currentApp: seen.currentApp, keyboardUp: seen.keyboardUp, image: seen.image, mime: seen.mime, situation });
    emit('thinking');
    const start = Date.now();
    try {
      const { text, result } = await compose(writer, messages);
      recorder.modelCall({ step, start, end: Date.now(), provider: writer.provider, requestModel: writer.model, messages, tools: [], result });
      log(`[writer] ${kind}: ${JSON.stringify(text.length > 160 ? `${text.slice(0, 160)}…` : text)}`);
      return text;
    } catch (e) {
      recorder.modelCall({ step, start, end: Date.now(), provider: writer.provider, requestModel: writer.model, messages, tools: [], error: e });
      log(`[writer] request failed: ${e.message}`);
      if (e.nonRecoverable) throw e;
      return null;
    }
  }

  for (let step = 1; step <= maxSteps; step++) {
    emit('step', { step, total: maxSteps, elapsed: ((Date.now() - t0) / 1000).toFixed(1) });
    log(`\n--- Step ${step}/${maxSteps} ---`);
    const final = step === maxSteps;
    const candidates = candidateActions({ elements: seen.elements, task, apps, currentApp: seen.currentApp, keyboardUp: seen.keyboardUp, final, writer: !!writer });
    const st = decisionState({ task, history, elements: seen.lines, currentApp: seen.currentApp, keyboardUp: seen.keyboardUp });
    const messages = [{ role: 'system', content: instructions }, { role: 'user', content: st.text }];
    const tools = candidates.map((c) => ({ name: c.value, description: c.description, parameters: { actions: c.actions } }));

    // ── the model ──
    emit('thinking');
    const start = Date.now();
    let answer;
    try {
      answer = await decider.decide({ instructions, state: st, candidates });
    } catch (e) {
      recorder.modelCall({ step, start, end: Date.now(), provider: decider.provider, requestModel: decider.model, messages, tools, error: e });
      if (e.nonRecoverable) {
        log(`[model] ${e.message}`);
        return { status: 'errored', reason: e.message, steps: step };
      }
      log(`[model] request failed, step lost: ${e.message}`);
      continue;
    }
    const chosen = candidates.find((c) => c.value === answer.choice);
    const callId = (k) => `choice_${step}_${k}`;
    const result = {
      message: { role: 'assistant', content: `${answer.choice}: ${chosen.description} (p=${round3(answer.probability)}, confidence ${round3(answer.confidence)})`, tool_calls: chosen.actions.map((a, k) => ({ id: callId(k), type: 'function', function: { name: a.tool, arguments: JSON.stringify(a.args) } })) },
      finishReasons: ['choice'], responseId: answer.responseId, responseModel: answer.responseModel, usage: answer.usage, raw: answer.raw,
    };
    const ranked = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
    recorder.modelCall({
      step, start, end: Date.now(), provider: decider.provider, requestModel: decider.model, messages, tools, result,
      decision: { choice: answer.choice, probability: answer.probability, confidence: answer.confidence, candidates: candidates.length, probabilities: Object.fromEntries(ranked) },
    });
    log(`[model] ${result.message.content}${ranked.length > 1 ? ` · next: ${ranked.slice(1, 4).map(([v, p]) => `${v} ${round3(p)}`).join(', ')}` : ''}`);

    // ── the action(s): in order, stopping at the first that fails ──
    let thrown = null;
    let concluded = null;
    let changes = false;
    let settle = false;
    let lastResult = null;
    let failed = false;
    // The hybrid turns two actions into real tool calls after an LLM call:
    // "writeText" becomes the typing of the composed text, "done" gets the
    // composed answer as its summary. Everything else runs as chosen.
    let actions = chosen.actions;
    if (writer) {
      const expanded = [];
      let writerFailed = null;
      for (const a of actions) {
        if (a.tool === 'writeText') {
          const text = await write(step, 'text', fieldSituation(a.args)).catch((e) => { writerFailed = e; return null; });
          if (writerFailed) break;
          if (text === null || !text) { expanded.push({ tool: 'writeText', args: a.args, failed: text === null ? 'the writer\'s request failed' : 'the writer returned no text' }); break; }
          if (a.args.replace) expanded.push({ tool: 'replaceTextAt', args: { x: a.args.x, y: a.args.y, value: text } });
          else expanded.push({ tool: 'tap', args: { x: a.args.x, y: a.args.y, description: a.args.field } }, { tool: 'inputText', args: { text } });
        } else if (a.tool === 'taskComplete' && a.args.summary === DONE_SUMMARY) {
          const text = await write(step, 'answer', null).catch((e) => { writerFailed = e; return null; });
          if (writerFailed) break;
          expanded.push({ tool: 'taskComplete', args: { summary: text || DONE_SUMMARY } });
        } else expanded.push(a);
      }
      if (writerFailed) return { status: 'errored', reason: writerFailed.message, steps: step };
      actions = expanded;
    }
    for (let k = 0; k < actions.length; k++) {
      const { tool: name, args, failed: notRun } = actions[k];
      emit('action', { tool: name, args });
      log(`[tool] ${name}(${JSON.stringify(args)})`);
      const tStart = Date.now();
      let r;
      if (notRun) r = { error: true, text: `Error: ${notRun}` };
      else {
        try { r = await runTool(name, args); } catch (e) {
          thrown = e;
          r = { error: true, text: `Error: ${e.message}` };
        }
      }
      log(`[tool] → ${String(r.text).split('\n')[0].slice(0, 200)}`);
      recorder.toolCall({ step, id: callId(k), name, args, start: tStart, end: Date.now(), result: r.text, error: r.error ? (thrown ? thrown.message : r.text) : null, layer: thrown ? 'device' : (r.error ? 'model' : null) });
      changes = changes || !!r.changesScreen;
      settle = settle || !!r.settle;
      lastResult = String(r.text ?? '').split('\n')[0].slice(0, 120);
      if (r.done || r.failed) { concluded = r; break; }
      if (r.error) {
        failed = true;
        for (let j = k + 1; j < actions.length; j++) {
          const rest = actions[j];
          recorder.toolCall({ step, id: callId(j), name: rest.tool, args: rest.args, start: Date.now(), end: Date.now(), result: 'Not run: an earlier action in this step failed.', skipped: true });
        }
        break;
      }
      if (k < actions.length - 1) await sleep(SETTLE_MS);   // a tapped field takes focus before typing
    }
    const entry = { n: step, description: chosen.description, changed: null, result: failed ? lastResult : null };
    history.push(entry);

    if (concluded?.done) return { status: 'completed', summary: concluded.done.summary, steps: step };
    if (concluded?.failed) return { status: 'failed', reason: concluded.failed.reason, steps: step };

    if (thrown) {
      deviceErrorSteps += 1;
      if (deviceErrorSteps >= DEVICE_ERRORS_TO_GIVE_UP) {
        return { status: 'device_lost', reason: `the phone stopped answering: ${deviceErrorSteps} steps in a row failed on the device`, steps: step };
      }
    } else deviceErrorSteps = 0;

    // ── a fresh look ──
    if (changes) {
      if (settle) await sleep(SETTLE_MS);
      const before = seen.signature;
      try {
        const stop = await look(step);
        entry.changed = seen.signature !== before;
        if (!entry.changed) entry.result = lastResult;
        if (stop) return { status: 'no_progress', reason: `no progress: ${stop}`, steps: step };
      } catch (e) {
        log(`[observe] screenshot failed: ${e.message}`);
      }
    } else { entry.changed = false; entry.result = lastResult; }
  }
  return { status: 'step_budget', reason: 'Reached the step limit without finishing.', steps: maxSteps };
}
