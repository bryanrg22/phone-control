// elements.mjs — the runner's view hierarchy → the element list the model reads.
//
// Sent with every screenshot, and returned by getUIElements. Each line:
//
//   - "Save" at (87.3%, 10.9%) size 72x44
//   - "Wi-Fi" = "1" at (…)                 a labelled control with a value
//   - picker wheel = "6 o'clock" at (…)    a control known only by its value
//
// Positions are the element's centre in percent of the screen, the same space
// the tap tool takes, to one decimal (1% is about 9 points down a phone screen,
// more than many targets are tall). Size is in points: a centre alone cannot
// tell a 110×36 button from an 18-point-tall wordmark.
//
// History of the rules below, each learned from a real screen:
//  • one line per label AND position: keyed on the label alone, the first
//    element with a name hid every later one (Claude's "New chat" button
//    vanished behind the wordmark of the same name; 32% of a real screen gone);
//  • the status-bar clock is dropped by position, not text: by text it also
//    deleted every alarm time ("6:45 AM") from the Clock app;
//  • values are shown for value-bearing controls: time-picker wheels carry no
//    label, and a text field's contents are its value, so without them an Add
//    Alarm sheet had no picker and no field (iOSWorld, 2026-10-15).

const NOISE = ['scroll bar', 'battery', 'Cellular', 'Wi-Fi bars', 'No signal', 'Not charging',
  'signal strength', 'battery power', 'location services', 'Location tracking'];
// U+202F NARROW NO-BREAK SPACE is what iOS puts before AM/PM.
const CLOCK = /^\d{1,2}:\d{2}([\s\u202f]?(AM|PM))?$/;
// The status bar is the top ~7% of the screen (its items centre at y≈22-26 pt of 874).
const STATUS_BAR = 0.07;
const isNoise = (text, cy, screenH) => (CLOCK.test(text) && (cy === null || cy < screenH * STATUS_BAR)) || NOISE.some((n) => text.includes(n));

// XCUIElement.ElementType raw values of controls whose value is their state
// (39 picker wheel and 49 text field confirmed on a live hierarchy).
const VALUE_TYPES = {
  33: 'slider', 37: 'segmented control', 39: 'picker wheel', 40: 'switch', 41: 'toggle',
  45: 'search field', 49: 'text field', 50: 'secure text field', 51: 'date picker', 52: 'text view', 79: 'stepper',
};
const MAX_VALUE = 80;
const clip = (v) => (v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v);
const pct = (v, total) => Math.round((v / total) * 1000) / 10;

/** How one element reads: `"Label"`, `"Label" = "value"`, `picker wheel = "value"`, or null. */
export function describeElement(node) {
  const label = (node.label || '').trim();
  const value = node.value === null || node.value === undefined ? '' : String(node.value).trim();
  const type = VALUE_TYPES[node.elementType];
  if (label && value && type && value !== label) return `"${label}" = "${clip(value)}"`;
  if (label) return `"${label}"`;
  if (value && type) return `${type} = "${clip(value)}"`;
  return null;
}

/** @returns {string[]} one line per element, in tree order */
export function formatElements(hierarchyText, screenW, screenH) {
  let root;
  try { root = JSON.parse(hierarchyText); } catch { return []; }
  const lines = [];
  const seen = new Set();
  (function walk(node) {
    if (!node) return;
    const desc = describeElement(node);
    if (desc) {
      const text = (node.label || '').trim() || String(node.value ?? '').trim();
      const f = node.frame;
      const cx = f ? f.X + f.Width / 2 : null;
      const cy = f ? f.Y + f.Height / 2 : null;
      if (!isNoise(text, cy, screenH)) {
        const line = f
          ? `- ${desc} at (${pct(cx, screenW)}%, ${pct(cy, screenH)}%) size ${Math.round(f.Width)}x${Math.round(f.Height)}`
          : `- ${desc}`;
        const key = f ? `${desc}@${Math.round(cx)},${Math.round(cy)}` : desc;
        if (!seen.has(key)) { seen.add(key); lines.push(line); }
      }
    }
    for (const c of node.children || []) walk(c);
  })(root?.axElement || root);
  return lines;
}

// A content-heavy screen (a long settings page, a feed) can carry hundreds of
// elements; 150 covers every real screen measured (typically 16-71) while
// bounding the worst case, as Claude Code and browser-use cap tool output.
export const MAX_ELEMENTS = 150;
export function capElements(lines, max = MAX_ELEMENTS) {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `(… ${lines.length - max} more elements not shown — scroll or use tapText with an exact label …)`];
}

/**
 * What identifies a screen for the no-progress check: every element's
 * description (label and value), without positions, sorted. A moving picker or
 * a field being typed into changes it; a tap that did nothing does not.
 */
export function screenSignature(lines) {
  return lines.map((l) => l.replace(/^- /, '').replace(/ at \(.*$/, '')).filter((l) => !l.startsWith('(… ')).sort().join('|');
}

/** The first element whose label, title or identifier is exactly `text`, or null. */
export function findElement(hierarchyText, text) {
  let root;
  try { root = JSON.parse(hierarchyText); } catch { return null; }
  let hit = null;
  (function walk(n) {
    if (!n || hit) return;
    if ((n.label === text || n.title === text || n.identifier === text) && n.frame) { hit = n; return; }
    for (const c of n.children || []) walk(c);
  })(root?.axElement || root);
  return hit;
}
