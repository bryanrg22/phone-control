// context.mjs — the conversation sent to the model, and what is kept of the past.
//
// Messages are in chat-completions shape (role/content, assistant tool_calls,
// role "tool" results); each provider converts at its edge.
//
// What is kept, step to step:
//  • the newest screenshot only. An older screenshot message becomes text
//    ("[Previous screenshot] …") without its image and without its element
//    list, which described a screen that is gone — kept, both made the
//    context grow with every step;
//  • getUIElements results older than the newest step are cut the same way;
//  • everything the model said and every other tool result, unchanged;
//  • an action history (the last 20 actions, one line each) in a single
//    "[Context]" message kept at the end, so the start of the conversation
//    stays byte-identical from step to step and provider prompt caches hold.

const ELEMENTS_MARK = '\n\nUI elements on screen:';
const OLD_ELEMENTS = '(element list of an earlier screen omitted)';

export function createContext({ system }) {
  const messages = [{ role: 'system', content: system }];
  let toolRound = 0;

  /** Turn every screenshot message into text, without its element list. */
  function forgetScreens() {
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== 'user' || !Array.isArray(m.content) || !m.content.some((c) => c.type === 'image_url')) continue;
      const text = m.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ').split(ELEMENTS_MARK)[0];
      messages[i] = { role: 'user', content: `[Previous screenshot] ${text}` };
    }
    for (const m of messages) {
      if (m.role === 'tool' && m.name === 'getUIElements' && m.round < toolRound && m.content !== OLD_ELEMENTS) m.content = OLD_ELEMENTS;
    }
  }

  return {
    messages,
    /** A screen and the words that go with it (the first one carries the task). */
    screen({ image, mime, text }) {
      forgetScreens();
      messages.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${image.toString('base64')}` } }, { type: 'text', text }] });
    },
    say(text) { messages.push({ role: 'user', content: text }); },
    assistant(message) { toolRound += 1; messages.push(message); },
    toolResult({ id, name, text, isError = false }) { messages.push({ role: 'tool', tool_call_id: id, name, content: text, isError, round: toolRound }); },
    /** Replace the action history at the end of the conversation. */
    history(lines) {
      const i = messages.findIndex((m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[Context]'));
      if (i !== -1) messages.splice(i, 1);
      if (!lines.length) return;
      const shown = lines.length > 20 ? [`(… ${lines.length - 20} earlier steps elided …)`, ...lines.slice(-20)] : lines;
      messages.push({ role: 'user', content: `[Context] Action history:\n${shown.join('\n')}` });
    },
  };
}

/** One line of the action history: `Step 3: tap(50.5, 12), inputText(Gym)`. */
export function historyLine(step, calls) {
  return `Step ${step}: ${calls.map(({ name, args }) => {
    const a = Object.values(args || {}).map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
    return a ? `${name}(${a.slice(0, 60)})` : name;
  }).join(', ')}`;
}
