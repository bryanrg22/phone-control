// candidates.mjs — the actions a decision model may choose from, built from the screen.
//
// A decision model (TypeSafe's Jev, OpenAI's Decisions API) answers a choice
// question with a probability for each option; it writes no arguments. So the
// harness enumerates every action it could take as an option with a fixed
// meaning, and the model only picks one. Pure: no I/O.
//
// On every screen:
//   tap_<n>       one per on-screen element with a position (keyboard keys left out:
//                 typing is its own action, and 29 key options would drown the rest)
//   type_<n>_<k>  phrase n into field k: taps the field, then types (one option is
//                 one step: a model without memory cannot plan "tap, then type").
//                 Fields are the on-screen elements that take typing; for a phrase
//                 that starts with a digit, picker wheels too: iOS time pickers
//                 take typed digits once tapped (seen on clock-001, 2026-10-16).
//                 Typing appends; replacing a field's text is not offered (yet)
//   press_return  when the keyboard is open (submits a field, closes most keyboards)
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
 * @returns {Array<{ value: string, description: string, actions: Array<{ tool: string, args: object }> }>}
 */
export function candidateActions({ elements, task, apps = [], currentApp = null, keyboardUp = false, final = false }) {
  const conclude = [
    { value: 'done', description: 'The task is complete: the current screen shows it done. Choose this only then.', actions: [{ tool: 'taskComplete', args: { summary: DONE_SUMMARY } }] },
    { value: 'blocked', description: 'The task cannot be completed on this device (the app, item or setting does not exist). Choose this only then.', actions: [{ tool: 'taskFailed', args: { reason: BLOCKED_REASON } }] },
  ];
  if (final) return conclude;

  const out = [];
  const tappable = elements.filter((e) => e.x !== null && e.kind !== 'key');
  tappable.slice(0, MAX_TAP_CANDIDATES).forEach((e, i) => {
    out.push({ value: `tap_${i}`, description: `Tap ${sliceDesc(e.desc)} (${e.kind} at ${e.x}%, ${e.y}%)`, actions: [{ tool: 'tap', args: { x: e.x, y: e.y, description: e.desc } }] });
  });
  const fields = tappable.filter((e) => e.editable).slice(0, MAX_TYPING_TARGETS);
  const wheels = tappable.filter((e) => e.kind === 'picker wheel').slice(0, MAX_TYPING_TARGETS);
  if (fields.length || wheels.length) {
    phrasesOf(task, { apps }).forEach((p, i) => {
      const targets = /^\d/.test(p) ? [...fields, ...wheels].slice(0, MAX_TYPING_TARGETS) : fields;
      targets.forEach((f, k) => {
        const into = f.kind === 'picker wheel' ? `Set ${sliceDesc(f.desc, 60)} by tapping it and typing "${p}"` : `Type "${p}" into ${sliceDesc(f.desc, 60)}${/ = "/.test(f.desc) ? ' (after its current text)' : ''}`;
        out.push({ value: `type_${i}_${k}`, description: into, actions: [{ tool: 'tap', args: { x: f.x, y: f.y, description: f.desc } }, { tool: 'inputText', args: { text: p } }] });
      });
    });
  }
  const one = (tool, args) => [{ tool, args }];
  if (keyboardUp) out.push({ value: 'press_return', description: 'Press Return on the keyboard (submits the field; closes most keyboards)', actions: one('pressKey', { key: 'enter' }) });
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
