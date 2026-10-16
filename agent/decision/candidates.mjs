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
//   type_<n>      one per phrase lifted from the task, offered only when a field
//                 that takes typing is on screen, naming that field (typing goes
//                 to the focused one)
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

export const MAX_TAP_CANDIDATES = 120;   // Jev takes 255 options per choice; the rest of the list is reachable by scrolling
export const MAX_PHRASES = 12;
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
 * @returns {Array<{ value: string, description: string, tool: string, args: object }>}
 */
export function candidateActions({ elements, task, apps = [], currentApp = null, keyboardUp = false, final = false }) {
  const conclude = [
    { value: 'done', description: 'The task is complete: the current screen shows it done. Choose this only then.', tool: 'taskComplete', args: { summary: DONE_SUMMARY } },
    { value: 'blocked', description: 'The task cannot be completed on this device (the app, item or setting does not exist). Choose this only then.', tool: 'taskFailed', args: { reason: BLOCKED_REASON } },
  ];
  if (final) return conclude;

  const out = [];
  const tappable = elements.filter((e) => e.x !== null && e.kind !== 'key');
  tappable.slice(0, MAX_TAP_CANDIDATES).forEach((e, i) => {
    out.push({ value: `tap_${i}`, description: `Tap ${sliceDesc(e.desc)} (${e.kind} at ${e.x}%, ${e.y}%)`, tool: 'tap', args: { x: e.x, y: e.y, description: e.desc } });
  });
  // Typing goes to whichever field is focused (iOS reports focus unreliably),
  // so the option names the field(s) on screen: the model can tell a label
  // field from a time to set (clock-001, 2026-10-16: "6:45 AM" typed into "Label").
  const fields = elements.filter((e) => e.editable);
  if (fields.length) {
    const where = fields.length === 1 ? `into ${sliceDesc(fields[0].desc, 60)}` : `into the focused field (fields on screen: ${fields.map((f) => sliceDesc(f.desc, 40)).join(', ')})`;
    phrasesOf(task, { apps }).forEach((p, i) => {
      out.push({ value: `type_${i}`, description: `Type "${p}" ${where}; tap the field first if it is not focused`, tool: 'inputText', args: { text: p } });
    });
  }
  if (keyboardUp) out.push({ value: 'press_return', description: 'Press Return on the keyboard (submits the field; closes most keyboards)', tool: 'pressKey', args: { key: 'enter' } });
  out.push({ value: 'scroll_down', description: 'Scroll down to reveal more of the screen', tool: 'scroll', args: {} });
  out.push({ value: 'scroll_up', description: 'Scroll up to reveal what is above', tool: 'swipe', args: { startX: 50, startY: 30, endX: 50, endY: 70 } });
  out.push({ value: 'home', description: 'Press the Home button (leave the current app)', tool: 'pressKey', args: { key: 'home' } });
  const taskLower = String(task || '').toLowerCase();
  for (const app of apps) {
    if (currentApp && app.toLowerCase() === currentApp.toLowerCase()) continue;
    if (new RegExp(`(^|[^a-z0-9])${app.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(taskLower)) {
      out.push({ value: `open_${app.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, description: `Open the ${app} app`, tool: 'openApp', args: { appName: app } });
    }
  }
  return [...out, ...conclude];
}
