// decision/loop.mjs — one task driven by a decision model instead of an LLM,
// or (hybrid mode) by a decision model that hands some steps to an LLM.
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
// a known weakness, measured not assumed), "blocked" as taskFailed.
//
// Hybrid mode (`llm` given): the LLM takes a step when escalate.mjs says so —
// a conclusion to verify and word, text to write, a low-confidence choice, a
// stuck screen, the final step. It sees the screenshot, the element list and a
// handoff note with the decision model's steps, keeps its own conversation
// across its steps, and runs its tool calls exactly as the LLM loop does
// (execute.mjs). In step mode the decision model takes the next step after it;
// in sticky mode the LLM keeps control until it calls handBack, concludes, or
// has taken STICKY_MAX steps in a row (escalate.mjs).
//
// Irreversible actions (irreversible.mjs). Hybrid: a decision-model choice that
// pays, orders, deletes or sends is the LLM's step (escalate.mjs), and an LLM
// tap that pays, orders or deletes is held, not run, until the user has said yes
// to an askUser question in this task (irreversible.mjs isConsent): GPT-6 Luna holding control in the sticky
// hybrid tapped "Send now" on mybank-003 without asking in 3 of 3 runs, where
// alone it asked in 3 of 3 (2026-10-16/17), so the rule is the harness's, not
// left to the prompt. Decision-only (no LLM, no way to word a question): the
// harness asks the user a fixed Yes/No question before each such tap, and an
// answer other than yes ends the run as failed, untapped; a send or a post goes
// ahead, as the LLM's rule has it ("the user's command IS the confirmation").
//
// The record (record.mjs) gets the same spans as the LLM mode: a chat span per
// model request (a decision step's messages are the instruction and the state,
// its "tools" the candidates, the answer's probabilities under eval.decision;
// an LLM step's are its conversation, with the reason under eval.escalation),
// an execute_tool span per action, an observation per screen, so the evals
// judge and report every mode exactly alike.
//
// Outcomes are the same set as loop.mjs: completed, failed, step_budget,
// no_progress, errored, device_lost.

import { observe, describeScreen } from '../observe.mjs';
import { listElements, appOnScreen } from '../elements.mjs';
import { executeToolCalls } from '../execute.mjs';
import { historyLine } from '../context.mjs';
import { taskMessage, FINAL_STEP } from '../prompt.mjs';
import { candidateActions } from './candidates.mjs';
import { decisionState, INSTRUCTIONS } from './question.mjs';
import { escalationReason, handoffMessage, DEFAULT_THRESHOLD, STICKY_MAX } from './escalate.mjs';
import { commitOfCall, isConsent } from './irreversible.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEVICE_ERRORS_TO_GIVE_UP = 4;
const SETTLE_MS = 350;
/** The user's answer in an askUser result, or null when nobody answered. */
export const answerOf = (text) => { const m = /^User (?:chose|typed): "([\s\S]*)"$/.exec(String(text ?? '')); return m ? m[1] : null; };

/** The result an LLM gets for a held tap. */
export const heldText = (hit) => `Not run: "${hit.label}" would ${hit.what}, which cannot be undone, and the user has not confirmed it in this task. Call askUser first with a Yes/No question that says exactly what will happen (the amount and recipient, or the items, or what is deleted). Tap it only after the user confirms; if the user declines or nobody answers, do not tap it: call taskFailed, saying what is ready and that the user's confirmation was required.`;

/** The question decision-only mode asks before a tap that pays, orders or deletes. */
export const confirmQuestion = (commit, task) => ({ question: `The next step would tap "${commit.label}", which would ${commit.what}. It cannot be undone. The task: "${task}". Go ahead?`, options: [`Yes, tap "${commit.label}"`, 'No, stop here'] });

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
 * @param {{ model: object, context: object, toolDefs: object[], threshold?: number, sticky?: boolean }|null} [o.llm]
 *        hybrid mode: the LLM (createModel()), its conversation (createContext()), its tools, the escalation
 *        threshold, and whether it keeps control after a step (sticky: until handBack, a conclusion, or STICKY_MAX steps)
 * @returns {Promise<{ status: string, summary?: string, reason?: string, steps: number }>}
 */
export async function runDecisionLoop({ task, maxSteps, decider, device, runTool, apps, protocol, recorder, progress, state, autoAllowNotifications, instructions = INSTRUCTIONS, llm = null }) {
  const { emit, log } = protocol;
  const t0 = Date.now();
  const threshold = llm?.threshold ?? DEFAULT_THRESHOLD;
  const sticky = !!llm?.sticky;
  let llmOwns = false;       // sticky: the LLM has control
  let llmRun = 0;            // sticky: its consecutive steps
  let llmLastSignature = null;
  let consent = false;       // hybrid: the user said yes to the LLM's latest askUser question
  let screen = { widthPoints: 402, heightPoints: 874 };
  state.screen = () => screen;
  let seen = null;   // the latest screen: { elements (structured), lines (capped), signature, currentApp, keyboardUp, image, mime }

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

  const history = [];        // { n, description, changed, result, llm? }
  let deviceErrorSteps = 0;
  let llmSteps = 0;
  let sinceLlm = 0;          // index into history of the first entry after the LLM's last step
  const unchangedStreak = () => { let n = 0; for (let i = history.length - 1; i >= 0 && history[i].changed === false; i--) n++; return n; };

  /** After a step's actions: the conclusion, the device, a fresh look. Returns an outcome, or null to go on. */
  async function afterActions({ step, entry, concluded, deviceFailed, changes, settle, lastResult }) {
    history.push(entry);
    if (concluded?.done) return { status: 'completed', summary: concluded.done.summary, steps: step };
    if (concluded?.failed) return { status: 'failed', reason: concluded.failed.reason, steps: step };
    if (deviceFailed) {
      deviceErrorSteps += 1;
      if (deviceErrorSteps >= DEVICE_ERRORS_TO_GIVE_UP) return { status: 'device_lost', reason: `the phone stopped answering: ${deviceErrorSteps} steps in a row failed on the device`, steps: step };
    } else deviceErrorSteps = 0;
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
    return null;
  }

  /** One LLM step (hybrid mode): the screen, the handoff, its tool calls. Returns an outcome, null to go on, or 'lost' (request failed). */
  async function llmStep({ step, why, final }) {
    const { model, context, toolDefs } = llm;
    const first = llmSteps === 0;
    const since = history.slice(sinceLlm);
    const unchangedForLlm = !first && why.reason === 'sticky' && seen.signature === llmLastSignature;
    if (unchangedForLlm) context.say('(The screen has not changed since your last step.)');
    else {
      const text = `${first ? taskMessage(task, '').replace(/\s+$/, '') : 'Here is the current screen.'}${describeScreen(seen.lines, { keyboardUp: seen.keyboardUp })}`;
      if (seen.image) context.screen({ image: seen.image, mime: seen.mime, text });
      else context.say(text);
    }
    llmLastSignature = seen.signature;
    context.say(handoffMessage({ since, why, first, sticky }));
    if (final) context.say(FINAL_STEP);
    emit('thinking');
    const start = Date.now();
    let result;
    try {
      result = await model.complete({ messages: context.messages, tools: toolDefs, onlyTools: final ? ['taskComplete', 'taskFailed'] : null });
    } catch (e) {
      recorder.modelCall({ step, start, end: Date.now(), provider: model.provider, requestModel: model.model, messages: context.messages, tools: toolDefs, error: e, escalation: why });
      if (e.nonRecoverable) { log(`[llm] ${e.message}`); return { status: 'errored', reason: e.message, steps: step }; }
      log(`[llm] request failed, step lost: ${e.message}`);
      return 'lost';
    }
    llmSteps += 1;
    recorder.modelCall({ step, start, end: Date.now(), provider: model.provider, requestModel: model.model, messages: context.messages, tools: toolDefs, result, escalation: why });
    const msg = result.message;
    if (msg.content) log(`[llm] ${msg.content.slice(0, 300)}`);
    const calls = msg.tool_calls || [];
    sinceLlm = history.length + 1;
    if (!calls.length) {
      if (sticky) { llmRun += 1; llmOwns = llmRun < STICKY_MAX; if (!llmOwns) llmRun = 0; }
      context.assistant(msg.content ? msg : { ...msg, content: '(no response)' });
      return afterActions({ step, entry: { n: step, description: `LLM: no action${msg.content ? ` ("${msg.content.slice(0, 80)}")` : ''}`, changed: null, result: null, llm: true }, concluded: null, deviceFailed: false, changes: false, settle: false, lastResult: null });
    }
    context.assistant(msg);
    const { done, concluded, changes, settle, deviceFailed, handBack } = await executeToolCalls({ calls, step, runTool: guardedRunTool, context, recorder, protocol });
    if (sticky) {
      llmRun += 1;
      if (handBack) { llmOwns = false; llmRun = 0; log('[hybrid] ← the LLM handed control back'); }
      else if (llmRun >= STICKY_MAX) { llmOwns = false; llmRun = 0; log(`[hybrid] ← control returns to the decision model after ${STICKY_MAX} LLM steps`); }
      else llmOwns = true;
    }
    const entry = { n: step, description: `LLM: ${historyLine(step, done).replace(/^Step \d+: /, '')}`, changed: null, result: null, llm: true };
    return afterActions({ step, entry, concluded, deviceFailed, changes, settle, lastResult: null });
  }

  /** The LLM's tools, with a tap that pays, orders or deletes held until the user has agreed. */
  async function guardedRunTool(name, args) {
    const hit = commitOfCall(name, args, { elements: seen.elements, screen, task });
    if (hit?.policy === 'confirm' && !consent) {
      log(`[hybrid] held ${name} on "${hit.label}": it would ${hit.what}, and the user has not confirmed`);
      recorder.note(`A ${name} on "${hit.label}" (it would ${hit.what}) was held: the user had not confirmed.`);
      return { error: true, text: heldText(hit) };
    }
    const r = await runTool(name, args);
    if (name === 'askUser') consent = isConsent(answerOf(r.text));
    return r;
  }

  for (let step = 1; step <= maxSteps; step++) {
    emit('step', { step, total: maxSteps, elapsed: ((Date.now() - t0) / 1000).toFixed(1) });
    log(`\n--- Step ${step}/${maxSteps} ---`);
    const final = step === maxSteps;

    // Hybrid: the final step is the LLM's, as the LLM loop's final step is (it must conclude).
    if (llm && final) {
      const why = escalationReason({ chosen: { value: '' }, probability: null, unchangedStreak: 0, final: true, threshold });
      log(`[hybrid] → LLM: ${why.detail}`);
      const out = await llmStep({ step, why, final: true });
      if (out && out !== 'lost') return out;
      continue;
    }

    // Sticky: the LLM has control, so no decision call this step.
    if (llm && sticky && llmOwns) {
      const why = { reason: 'sticky', detail: `step ${llmRun + 1} of at most ${STICKY_MAX} in a row` };
      log(`[hybrid] LLM keeps control (${why.detail})`);
      const out = await llmStep({ step, why, final: false });
      if (out && out !== 'lost') return out;
      continue;
    }

    const candidates = candidateActions({ elements: seen.elements, task, apps, currentApp: seen.currentApp, keyboardUp: seen.keyboardUp, final, writer: !!llm });
    const st = decisionState({ task, history, elements: seen.lines, currentApp: seen.currentApp, keyboardUp: seen.keyboardUp });
    const messages = [{ role: 'system', content: instructions }, { role: 'user', content: st.text }];
    const tools = candidates.map((c) => ({ name: c.value, description: c.description, parameters: { actions: c.actions } }));

    // ── the decision model ──
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
    const why = llm ? escalationReason({ chosen, probability: answer.probability, unchangedStreak: unchangedStreak(), final: false, threshold }) : null;
    // ── decision-only: a tap that pays, orders or deletes is asked about first ──
    let actions = chosen.actions;
    if (!llm && chosen.commit?.policy === 'confirm') {
      const { question, options } = confirmQuestion(chosen.commit, task);
      actions = [{ tool: 'askUser', args: { question, options }, gate: chosen.commit }, ...chosen.actions];
    }

    const result = {
      message: { role: 'assistant', content: `${answer.choice}: ${chosen.description} (p=${round3(answer.probability)}, confidence ${round3(answer.confidence)})${why ? ` → handed to the LLM: ${why.reason}` : ''}`, tool_calls: why ? [] : actions.map((a, k) => ({ id: callId(k), type: 'function', function: { name: a.tool, arguments: JSON.stringify(a.args) } })) },
      finishReasons: ['choice'], responseId: answer.responseId, responseModel: answer.responseModel, usage: answer.usage, raw: answer.raw,
    };
    const ranked = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
    recorder.modelCall({
      step, start, end: Date.now(), provider: decider.provider, requestModel: decider.model, messages, tools, result,
      decision: { choice: answer.choice, probability: answer.probability, confidence: answer.confidence, candidates: candidates.length, probabilities: Object.fromEntries(ranked), ...(why ? { escalated: why.reason } : {}) },
    });
    log(`[model] ${result.message.content}${ranked.length > 1 ? ` · next: ${ranked.slice(1, 4).map(([v, p]) => `${v} ${round3(p)}`).join(', ')}` : ''}`);

    // ── hybrid: this step is the LLM's ──
    if (why) {
      log(`[hybrid] → LLM: ${why.detail}`);
      const out = await llmStep({ step, why, final: false });
      if (out && out !== 'lost') return out;
      continue;
    }

    // ── the action(s): in order, stopping at the first that fails ──
    let deviceFailed = false;
    let concluded = null;
    let changes = false;
    let settle = false;
    let lastResult = null;
    let failed = false;
    for (let k = 0; k < actions.length; k++) {
      const { tool: name, args, gate } = actions[k];
      emit('action', { tool: name, args });
      log(`[tool] ${name}(${JSON.stringify(args)})`);
      const tStart = Date.now();
      let r;
      let thrown = null;
      try { r = await runTool(name, args); } catch (e) {
        thrown = e;
        deviceFailed = true;
        r = { error: true, text: `Error: ${e.message}` };
      }
      log(`[tool] → ${String(r.text).split('\n')[0].slice(0, 200)}`);
      recorder.toolCall({ step, id: callId(k), name, args, start: tStart, end: Date.now(), result: r.text, error: r.error ? (thrown ? thrown.message : r.text) : null, layer: thrown ? 'device' : (r.error ? 'model' : null) });
      changes = changes || !!r.changesScreen;
      settle = settle || !!r.settle;
      lastResult = String(r.text ?? '').split('\n')[0].slice(0, 120);
      if (r.done || r.failed) { concluded = r; break; }
      if (gate && !isConsent(answerOf(r.text))) {
        // Not confirmed: the tap is not made, and the run ends here, as the LLM ends it without an answer.
        for (let j = k + 1; j < actions.length; j++) recorder.toolCall({ step, id: callId(j), name: actions[j].tool, args: actions[j].args, start: Date.now(), end: Date.now(), result: 'Not run: the user did not confirm.', skipped: true });
        const reason = `Stopped before tapping "${gate.label}": it would ${gate.what}, which cannot be undone, and the user did not confirm.`;
        emit('action', { tool: 'taskFailed', args: { reason } });
        log(`[tool] taskFailed(${JSON.stringify({ reason })})`);
        const t1 = Date.now();
        concluded = await runTool('taskFailed', { reason });
        recorder.toolCall({ step, id: callId(actions.length), name: 'taskFailed', args: { reason }, start: t1, end: Date.now(), result: concluded.text });
        break;
      }
      if (r.error) {
        failed = true;
        for (let j = k + 1; j < actions.length; j++) {
          const rest = actions[j];
          recorder.toolCall({ step, id: callId(j), name: rest.tool, args: rest.args, start: Date.now(), end: Date.now(), result: 'Not run: an earlier action in this step failed.', skipped: true });
        }
        break;
      }
      if (k < actions.length - 1 && !gate) await sleep(SETTLE_MS);   // a tapped field takes focus before typing
    }
    const out = await afterActions({ step, entry: { n: step, description: chosen.description, changed: null, result: failed ? lastResult : null }, concluded, deviceFailed, changes, settle, lastResult });
    if (out) return out;
  }
  return { status: 'step_budget', reason: 'Reached the step limit without finishing.', steps: maxSteps };
}
