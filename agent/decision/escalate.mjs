// escalate.mjs — when the hybrid mode hands a step from the decision model to the LLM.
//
// The decision model is fast and cheap but writes nothing and holds no plan.
// The LLM takes a step in these cases, each a fact the loop can see, so the
// policy is explicit and testable (the pattern of JEV-as-a-Judge, arXiv
// 2609.26550: accept when confident, escalate when unsure; the threshold is
// fixed before a run, never tuned on it):
//
//   conclusion      the decision model chose done or blocked: the LLM verifies
//                   on the screen and writes the real summary or answer
//   free_text       it chose "write into field F": the text is not in the task,
//                   so the LLM writes it (jev-ultrafast's TYPE_TEXT helper)
//   irreversible    it chose a control that commits something (irreversible.mjs):
//                   pay, order, delete, send, post. The LLM checks the screen
//                   against the task and, for money or a deletion, asks the user
//                   first, as it does alone; whatever the probability (mybank-003
//                   paid $50 at p 0.87 without asking, 2026-10-16)
//   low_confidence  its best option fell below the threshold
//   stuck           the screen has not changed for STUCK_STEPS of its steps
//   final           the last step of the budget: the LLM must conclude
//
// Pure: no I/O.

export const DEFAULT_THRESHOLD = 0.5;
export const STUCK_STEPS = 3;

// Escalation modes. "step" (the first hybrid, 487f174): the LLM takes one step,
// then the decision model chooses again. "sticky": once the LLM takes a step it
// keeps control, with no decision call, until it calls handBack or concludes, or
// for at most STICKY_MAX steps in a row. Made after the step mode's 27-task run:
// the decision model confidently undid the LLM's plan (weather-004,
// cinephile-001), and 232 of its 500 calls were handed to the LLM anyway.
export const ESCALATION_MODES = ['step', 'sticky'];
export const STICKY_MAX = 5;

/**
 * @param {object} o
 * @param {{ value: string, description?: string, commit?: object }} o.chosen   the chosen candidate
 * @param {number|null} o.probability          the probability on it
 * @param {number} o.unchangedStreak           consecutive decision steps that changed nothing
 * @param {boolean} o.final                    the last step of the budget
 * @param {number} [o.threshold]
 * @returns {{ reason: string, detail: string, commit?: object }|null}
 */
export function escalationReason({ chosen, probability, unchangedStreak, final, threshold = DEFAULT_THRESHOLD }) {
  if (final) return { reason: 'final', detail: 'the last step of the budget: conclude now' };
  if (chosen.value === 'done' || chosen.value === 'blocked') return { reason: 'conclusion', detail: `the decision model chose "${chosen.value}" (p=${fmt(probability)})` };
  if (chosen.value.startsWith('write_')) return { reason: 'free_text', detail: `the decision model chose: ${chosen.description}` };
  if (chosen.commit) return { reason: 'irreversible', detail: `the decision model chose to tap "${chosen.commit.label}", which would ${chosen.commit.what} (p=${fmt(probability)})`, commit: chosen.commit };
  if (typeof probability === 'number' && probability < threshold) return { reason: 'low_confidence', detail: `the decision model's best option, "${chosen.description}", had p=${fmt(probability)} (below ${threshold})` };
  if (unchangedStreak >= STUCK_STEPS) return { reason: 'stuck', detail: `the screen has not changed for ${unchangedStreak} steps` };
  return null;
}

// The askUser rules of the system prompt, applied to the control at hand. No
// "unless the user already confirmed it" escape: GPT-6 Luna read the task as
// that confirmation (loop.mjs safetyLine, measured by replay, 2026-10-17).
export const CONFIRM_ASK = 'It cannot be undone. First check on the screen that it is what the task asks (the amount, the recipient, the items, the address) and that it has not already been done. The task saying to do it is not the user\'s confirmation: a payment, a purchase or a deletion needs it from askUser. Unless the user has answered yes to an askUser question about it in this task, call askUser with a Yes/No question that says exactly what will happen, and do not tap it in the same step. Tap it only if the user confirms. If the user declines or nobody answers, do not tap it: call taskFailed, saying what is ready and that the user\'s confirmation was required.';
export const VERIFY_ASK = 'It cannot be undone. Check on the screen that it is what the task asks (the recipient and the text, or the details) and that it has not already been done. If it is right, tap it: the user\'s command is the confirmation for this. If not, correct it first, or conclude if it was already done.';

const fmt = (p) => (typeof p === 'number' ? (Math.round(p * 100) / 100).toString() : '?');

/**
 * The message the LLM gets with the screen: what the decision model did, and why this step is its.
 * @param {object} o
 * @param {Array<{ n: number, description: string, changed: boolean|null, result?: string|null }>} o.since   decision steps since the LLM's last step
 * @param {{ reason: string, detail: string }} o.why
 * @param {boolean} o.first   the LLM's first step of the run
 * @param {boolean} [o.sticky] sticky mode: the LLM keeps control and may hand back
 */
export function handoffMessage({ since, why, first, sticky = false }) {
  if (why.reason === 'sticky') {
    return `[Control] You still have control (${why.detail}). Continue the task, or call handBack when what remains is simple taps or scrolls on listed elements.`;
  }
  const lines = since.map((h) => `  ${h.n}. ${h.description}${h.result ? ` → ${h.result}` : ''}${h.changed === false ? ' (the screen did not change)' : ''}`);
  const ask = {
    conclusion: 'Check the screen. If the task is done, call taskComplete with a summary that includes any information the task asked for, read from the screen. If it is not done, continue with the tools. If it cannot be done, call taskFailed.',
    free_text: 'Write the text the task calls for and enter it (tap the field and inputText, or typeAndSubmit / replaceText), then continue or conclude.',
    low_confidence: 'Take the next action or actions toward the task.',
    stuck: 'Take a different approach: read the screen, then act.',
    final: 'This is the final step: call taskComplete only if the task is verifiably done on this screen, otherwise taskFailed.',
    irreversible: why.commit?.policy === 'confirm' ? CONFIRM_ASK : VERIFY_ASK,
  }[why.reason];
  return [
    first ? '[Handoff] A fast decision model has been operating the phone for this task; it chooses among on-screen actions but cannot write text or answers. You take over for this step.' : '[Handoff] The decision model took the steps below since your last one.',
    lines.length ? `Its steps:\n${lines.join('\n')}` : 'It has taken no steps since.',
    `This step is yours because ${why.detail}. ${ask}`,
    ...(sticky && why.reason !== 'final' ? ['You keep control after this step until you conclude or call handBack. Call handBack when the remaining steps are simple taps or scrolls on listed elements, so the faster decision model can take them.'] : []),
  ].join('\n\n');
}
