// decision/writer.mjs — the hybrid: an LLM writes what a decision model cannot.
//
// A decision model picks one of the enumerated actions and writes no text
// (loop.mjs). With --writer, two of those actions are handed to an LLM, which
// sees the screenshot, the element list, the task and the actions so far:
//   • "write into <field>": the LLM composes the text (a message, a note, a
//     reply) and the harness types it, or replaces the field's text with it;
//   • "done": the LLM writes the answer to the user from the final screen,
//     instead of the fixed summary.
// The decision model stays in charge of every other step (which field, when
// to send, when to stop). The LLM is called with no tools, so it can only
// write; its calls are recorded as chat spans under its own model, so tokens
// and cost are counted per model (evals/phone-agent/trajectory.mjs).

const MAX_TEXT = 2000;

export const WRITE_TEXT_INSTRUCTIONS = 'You write text for an automated agent operating an iPhone. The agent is carrying out the task below and has chosen to write into a field on the current screen (shown in the screenshot). Reply with ONLY the text to put in the field: no quotes around it, no explanation, no markdown. Write what the task asks for, in the user\'s own voice, concise and natural for the app.';
export const WRITE_ANSWER_INSTRUCTIONS = 'You write the final answer for an automated agent that has operated an iPhone to carry out the task below and has just judged it complete. From the screenshot, the elements on screen and the actions taken, write the answer to the user: what was done, and every piece of information the task asked for, read from the screen (names, times, prices, dates, counts). If something the task asked for is not visible, say so plainly rather than guessing. Reply with the answer only, two to four sentences, no markdown.';

const clean = (s) => String(s ?? '').trim().replace(/^["'“‘]+|["'”’]+$/g, '').trim().slice(0, MAX_TEXT);

/** The messages for one writing call: the instruction, then the screenshot and the situation as text. */
export function writerMessages({ instructions, task, history, elements, currentApp, keyboardUp, image, mime, situation }) {
  const actions = history.length ? history.map((h) => `${h.n}. ${h.description}${h.changed === false ? ' (the screen did not change)' : ''}`) : ['(none yet)'];
  const text = [
    `Task: ${task}`, '',
    'Actions so far:', ...actions, '',
    `App on screen: ${currentApp || 'unknown'}`, `Keyboard: ${keyboardUp ? 'open' : 'closed'}`, '',
    ...(situation ? [situation, ''] : []),
    'Elements on screen (label, value, centre as percent of the screen, size in points):',
    ...(elements.length ? elements : ['(no elements read)']),
  ].join('\n');
  const content = image ? [{ type: 'image_url', image_url: { url: `data:${mime || 'image/jpeg'};base64,${image.toString('base64')}` } }, { type: 'text', text }] : text;
  return [{ role: 'system', content: instructions }, { role: 'user', content }];
}

/**
 * One call to the writer. Returns the text and the provider's result (for the
 * record); throws what the provider threw (the loop decides what an error means).
 * @param {object} writer   createModel(): { provider, model, complete({ messages, tools, onlyTools }) }
 */
export async function compose(writer, messages) {
  const result = await writer.complete({ messages, tools: [], onlyTools: [] });   // no tools, no web search: it can only write
  const raw = result.message?.content;
  const text = clean(typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((p) => p.text || '').join('') : '');
  return { text, result };
}

/** The situation line for a write-into-field call. */
export function fieldSituation({ field, current, replace }) {
  return replace
    ? `Field to write: ${field}\nIt currently contains:\n${current}\n\nYour reply REPLACES the whole field: include everything that should stay, with what the task asks for added in the right place.`
    : `Field to write: ${field}\nIt is empty: your reply will be typed into it as is.`;
}
