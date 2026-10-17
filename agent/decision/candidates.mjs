// candidates.mjs — the actions a decision model may choose from, built from the screen.
//
// A decision model (TypeSafe's Jev, OpenAI's Decisions API) answers a choice
// question with a probability for each option; it writes no arguments. So the
// harness enumerates every action it could take as an option with a fixed
// meaning, and the model only picks one. Pure: no I/O.
//
// On every screen:
//   tap_<n>       one per on-screen element with a position (keyboard keys left out:
//                 typing is its own action, and 29 key options would drown the rest;
//                 elements under an open keyboard left out too: the element list
//                 does not know what the keyboard covers, and a tap there presses
//                 a key — cinephile-001 and megamart-001 typed stray letters, 2026-10-16)
//   type_<n>_<k>  phrase n into field k: taps the field, then types (one option is
//                 one step: a model without memory cannot plan "tap, then type").
//                 Fields are the on-screen elements that take typing; for a phrase
//                 that starts with a digit, picker wheels too: iOS time pickers
//                 take typed digits once tapped (seen on clock-001, 2026-10-16).
//                 A single-line field that already has text is REPLACED, by
//                 position (replaceTextAt: skytrip-002 typed "ATL" into
//                 "ATLSFOSFO", and its two fields share the label "Airport");
//                 a text view (a note, a document) is appended to.
//   search_<n>_<k> phrase n into search field k, then Return: the submit closes
//                 the keyboard, which covered the result rows (cinephile-001,
//                 megamart-001 tapped a row's title text under it, to no effect)
//   press_return  when the keyboard is open (submits a field, closes most keyboards)
//   hide_keyboard when the keyboard is open (to reach what it covers)
//   scroll_down, scroll_up, home
//   open_<app>    for each installed app the task names, unless it is already open
//   done          the task is complete on the current screen
//   blocked       the task cannot be completed
// On the final step of the budget: done and blocked only, as the LLM mode
// offers only taskComplete and taskFailed then.
//
// Values are stable identifiers (tap_3); descriptions carry what the element
// is and where, since the model never sees anything else about the option.
// Each option is a list of tool calls (`actions`), run in order by the loop.

export const MAX_TAP_CANDIDATES = 120;   // Jev takes 255 options per choice; the rest of the list is reachable by scrolling
export const MAX_PHRASES = 12;
export const MAX_TYPING_TARGETS = 4;   // fields (and wheels) a phrase is offered into: 12 phrases × 4 = 48 options at most
export const DONE_SUMMARY = 'The decision model judged the task complete on the current screen.';
export const BLOCKED_REASON = 'The decision model judged the task impossible to complete on this device.';

const sliceDesc = (s, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Phrases a task implies typing: quoted strings, times, amounts (digits only:
 * a "$" cannot be typed on a number pad), emails, street addresses, capitalised
 * names of two or more words, and all-caps codes (SFO). A phrase inside a
 * longer one is dropped; a name that opens a sentence loses its first word
 * ("Find the Ali Wong show" → "Ali Wong"); app names are not phrases.
 * @returns {string[]} at most MAX_PHRASES, without duplicates, quoted ones first
 */
export function phrasesOf(task, { apps = [] } = {}) {
  const text = String(task || '');
  const found = [];
  const add = (p) => { const v = String(p).trim(); if (v && !found.includes(v)) found.push(v); };
  // 'oatmeal', "Team Standup Notes", ‘Gym’: an opening quote after a space or
  // bracket, a closing one before space or punctuation, so it's and What's are left alone.
  for (const m of text.matchAll(/(?:^|[\s(\u2014-])['\u2018"\u201c]([^'\u2019"\u201d\n]{1,60}?)['\u2019"\u201d](?=$|[\s.,;:!?)\u2014-])/g)) add(m[1]);
  for (const m of text.matchAll(/\b\d{1,2}:\d{2}(?:\s?(?:AM|PM|am|pm))?\b/g)) add(m[0]);
  for (const m of text.matchAll(/\$(\d[\d,]*(?:\.\d+)?)/g)) add(m[1]);
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) add(m[0]);
  for (const m of text.matchAll(/\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g)) add(m[0]);
  const CAP = /\b[A-Z][a-zA-Z0-9]*(?:(?:\s+(?:of|the|and|&))?\s+[A-Z][a-zA-Z0-9]*)+\b/g;
  for (const m of text.matchAll(CAP)) {
    const before = text.slice(0, m.index).trimEnd();
    if (before && !/[.!?]$/.test(before)) { add(m[0]); continue; }
    // Opens a sentence: the first word is a verb ("Open", "Find"), not part of the name.
    const rest = m[0].replace(/^\S+(?:\s+(?:of|the|and|&))?\s+/, '');
    if (/\s/.test(rest)) add(rest);
  }
  for (const m of text.matchAll(/\b[A-Z]{2,5}\b/g)) if (!['AM', 'PM'].includes(m[0])) add(m[0]);
  const appNames = new Set(apps.map((a) => a.toLowerCase()));
  return found
    .filter((p) => !appNames.has(p.toLowerCase()))
    .filter((p) => !found.some((q) => q !== p && q.includes(p)))
    .slice(0, MAX_PHRASES);
}

/**
 * @param {object} o
 * @param {Array<{ desc: string, kind: string, editable: boolean, x: number|null, y: number|null }>} o.elements   listElements()
 * @param {string} o.task
 * @param {string[]} [o.apps]           installed app names (openApp's names)
 * @param {string|null} [o.currentApp]  the app on screen, if known
 * @param {boolean} [o.keyboardUp]
 * @param {boolean} [o.final]           the last step of the budget: conclude only
 * @param {boolean} [o.writer]          the hybrid (decision/writer.mjs): an LLM writes free text and the answer
 * @returns {Array<{ value: string, description: string, actions: Array<{ tool: string, args: object }> }>}
 */
export function candidateActions({ elements, task, apps = [], currentApp = null, keyboardUp = false, final = false, writer = false }) {
  const conclude = [
    { value: 'done', description: writer ? 'The task is complete: the current screen shows it done; the assistant then writes the answer from this screen. Choose this only then.' : 'The task is complete: the current screen shows it done. Choose this only then.', actions: [{ tool: 'taskComplete', args: { summary: DONE_SUMMARY } }] },
    { value: 'blocked', description: 'The task cannot be completed on this device (the app, item or setting does not exist). Choose this only then.', actions: [{ tool: 'taskFailed', args: { reason: BLOCKED_REASON } }] },
  ];
  if (final) return conclude;

  const out = [];
  // What the keyboard covers: from the top of its keys, or of the predictions
  // row above them when iOS shows one. Below that line nothing can be tapped.
  const keyTops = elements.filter((e) => e.top !== null && (e.kind === 'key' || e.desc === '"Typing Predictions"')).map((e) => e.top);
  const coverTop = keyboardUp && keyTops.length ? Math.min(...keyTops) : null;
  const reachable = (e) => e.x !== null && e.kind !== 'key' && (coverTop === null || e.y < coverTop);
  const tappable = elements.filter(reachable);
  tappable.slice(0, MAX_TAP_CANDIDATES).forEach((e, i) => {
    out.push({ value: `tap_${i}`, description: `Tap ${sliceDesc(e.desc)} (${e.kind} at ${e.x}%, ${e.y}%)`, actions: [{ tool: 'tap', args: { x: e.x, y: e.y, description: e.desc } }] });
  });
  const fields = tappable.filter((e) => e.editable).slice(0, MAX_TYPING_TARGETS);
  const wheels = tappable.filter((e) => e.kind === 'picker wheel').slice(0, MAX_TYPING_TARGETS);
  if (fields.length || wheels.length) {
    phrasesOf(task, { apps }).forEach((p, i) => {
      const targets = /^\d/.test(p) ? [...fields, ...wheels].slice(0, MAX_TYPING_TARGETS) : fields;
      targets.forEach((f, k) => {
        const hasText = / = "/.test(f.desc);
        if (f.kind === 'picker wheel') {
          out.push({ value: `type_${i}_${k}`, description: `Set ${sliceDesc(f.desc, 60)} by tapping it and typing "${p}"`, actions: [{ tool: 'tap', args: { x: f.x, y: f.y, description: f.desc } }, { tool: 'inputText', args: { text: p } }] });
        } else if (hasText && f.kind !== 'text view') {
          out.push({ value: `type_${i}_${k}`, description: `Replace the text in ${sliceDesc(f.desc, 60)} with "${p}"`, actions: [{ tool: 'replaceTextAt', args: { x: f.x, y: f.y, value: p } }] });
        } else {
          out.push({ value: `type_${i}_${k}`, description: `Type "${p}" into ${sliceDesc(f.desc, 60)}${hasText ? ' (after its current text)' : ''}`, actions: [{ tool: 'tap', args: { x: f.x, y: f.y, description: f.desc } }, { tool: 'inputText', args: { text: p } }] });
        }
        if (f.kind === 'search field' || /search/i.test(f.desc)) {
          const put = hasText ? [{ tool: 'replaceTextAt', args: { x: f.x, y: f.y, value: p } }] : [{ tool: 'tap', args: { x: f.x, y: f.y, description: f.desc } }, { tool: 'inputText', args: { text: p } }];
          out.push({ value: `search_${i}_${k}`, description: `Search for "${p}": ${hasText ? 'replace the text in' : 'type it into'} ${sliceDesc(f.desc, 60)} and press Return`, actions: [...put, { tool: 'pressKey', args: { key: 'enter' } }] });
        }
      });
    });
  }
  // The hybrid: an LLM composes free text for a field (a message, a note, a
  // reply), which the loop then types or puts in place of the field's text.
  // Search fields are left to the phrase options: a composed text is no query.
  if (writer) {
    fields.filter((f) => f.kind !== 'search field' && !/search/i.test(f.desc)).forEach((f, k) => {
      const hasText = / = "/.test(f.desc);
      out.push({
        value: `write_${k}`,
        description: hasText
          ? `Rewrite ${sliceDesc(f.desc, 60)}: the assistant composes its new full text (what the task asks for, added to what should stay) and it replaces the current text`
          : `Write into ${sliceDesc(f.desc, 60)}: the assistant composes the text the task asks for (a message, a note, a reply) and it is typed there`,
        actions: [{ tool: 'writeText', args: { x: f.x, y: f.y, field: f.desc, current: f.value ?? '', replace: hasText } }],
      });
    });
  }
  const one = (tool, args) => [{ tool, args }];
  if (keyboardUp) {
    out.push({ value: 'press_return', description: 'Press Return on the keyboard (submits the field; closes most keyboards)', actions: one('pressKey', { key: 'enter' }) });
    out.push({ value: 'hide_keyboard', description: 'Hide the keyboard, to reach the part of the screen it covers', actions: one('hideKeyboard', {}) });
  }
  out.push({ value: 'scroll_down', description: 'Scroll down to reveal more of the screen', actions: one('scroll', {}) });
  out.push({ value: 'scroll_up', description: 'Scroll up to reveal what is above', actions: one('swipe', { startX: 50, startY: 30, endX: 50, endY: 70 }) });
  out.push({ value: 'home', description: 'Press the Home button (leave the current app)', actions: one('pressKey', { key: 'home' }) });
  const taskLower = String(task || '').toLowerCase();
  for (const app of apps) {
    if (currentApp && app.toLowerCase() === currentApp.toLowerCase()) continue;
    if (new RegExp(`(^|[^a-z0-9])${app.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(taskLower)) {
      out.push({ value: `open_${app.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, description: `Open the ${app} app`, actions: one('openApp', { appName: app }) });
    }
  }
  return [...out, ...conclude];
}
