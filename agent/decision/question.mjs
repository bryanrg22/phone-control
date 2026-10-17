// question.mjs — the one question a decision model is asked each step, and the
// state it is asked about.
//
// Both APIs take an instruction and a state. The state is the same information
// the LLM mode gets in its conversation, as text: the task, the actions so far
// (with whether each changed the screen), the app, the keyboard, and the
// element list. The screenshot is not sent: text is what both models are built
// for and what makes them fast (handoff, 2026-10-16); Jev 1.14 could take it.
//
// Rewording the instruction is a behaviour change: measure before and after.

export const INSTRUCTIONS = 'You are choosing the next action for an agent operating an iPhone to complete the task. Pick the single action that best advances the task from the current screen, given what has already been done. Choose "done" only when the screen shows the task is complete. Choose "blocked" only when the task cannot be completed on this device. Do not repeat an action that did not change the screen.';

/** @typedef {{ n: number, description: string, changed: boolean|null, result?: string|null }} HistoryEntry */

/**
 * The state as an object (sent to Jev as structured state) and as text (sent
 * to the Decisions API, which takes text).
 * @param {object} o
 * @param {string} o.task
 * @param {HistoryEntry[]} o.history
 * @param {string[]} o.elements        the element lines (capped as the LLM sees them)
 * @param {string|null} o.currentApp
 * @param {boolean} o.keyboardUp
 */
export function decisionState({ task, history, elements, currentApp, keyboardUp }) {
  const shown = history.length > 20 ? history.slice(-20) : history;
  // What a tool answered is shown when it matters: the step changed nothing,
  // or the tool reported a problem (a keyboard that stayed up, a field not found).
  const actions = shown.map((h) => `${h.n}. ${h.description}${h.result ? ` → ${h.result}` : ''}${h.changed === false ? ' (the screen did not change)' : ''}`);
  const object = {
    task,
    actions_so_far: actions.length ? (history.length > 20 ? [`(${history.length - 20} earlier steps omitted)`, ...actions] : actions) : ['(none yet)'],
    app_on_screen: currentApp || 'unknown',
    keyboard: keyboardUp ? 'open' : 'closed',
    elements_on_screen: elements.length ? elements.map((l) => l.replace(/^- /, '')) : ['(no elements read)'],
  };
  const text = [
    `Task: ${task}`, '',
    'Actions so far:', ...object.actions_so_far, '',
    `App on screen: ${object.app_on_screen}`,
    `Keyboard: ${object.keyboard}`, '',
    'Elements on screen (label, value, centre as percent of the screen, size in points):',
    ...elements.length ? elements : ['(no elements read)'],
  ].join('\n');
  return { object, text };
}
