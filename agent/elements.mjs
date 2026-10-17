// elements.mjs — the runner's view hierarchy → the element list the model reads.
//
// Sent with every screenshot, and returned by getUIElements. Each line:
//
//   - "Save" at (87.3%, 10.9%) size 72x44
//   - "Wi-Fi" = "1" at (…)                 a labelled control with a value
//   - picker wheel = "6 o'clock" at (…)    a control known only by its value
//   - text field "Label" (empty) at (…)    an unlabelled field, named by its placeholder
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
//    Alarm sheet had no picker and no field (iOSWorld, 2026-10-15);
//  • an unlabelled field is named by its placeholder: SwiftUI's empty
//    TextField("Label", …) has no label and no value, only the placeholder,
//    and was missing from the list entirely;
//  • only what is on screen: home-screen icons on another page come back with
//    a zero-size frame at (0, 0), which a model would tap.

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

/** How one element reads: `"Label"`, `"Label" = "value"`, `picker wheel = "value"`, `text field "Hint" (empty)`, or null. */
export function describeElement(node) {
  const label = (node.label || '').trim();
  const value = node.value === null || node.value === undefined ? '' : String(node.value).trim();
  const hint = (node.placeholderValue || '').trim();
  const type = VALUE_TYPES[node.elementType];
  if (label && value && type && value !== label) return `"${label}" = "${clip(value)}"`;
  if (label) return `"${label}"`;
  if (!type || (!value && !hint)) return null;
  const named = hint ? `${type} "${clip(hint)}"` : type;
  return value && value !== hint ? `${named} = "${clip(value)}"` : `${named} (empty)`;
}

/** On screen: a real frame whose centre is inside the screen. */
const onScreen = (f, W, H) => f.Width > 0 && f.Height > 0 && f.X + f.Width / 2 >= 0 && f.X + f.Width / 2 <= W && f.Y + f.Height / 2 >= 0 && f.Y + f.Height / 2 <= H;

// XCUIElement.ElementType raw values, named for a reader (the decision mode
// shows the kind beside each candidate). Unlisted types read as "element".
const KINDS = {
  9: 'button', 20: 'key', 27: 'row', 30: 'row', 33: 'slider', 37: 'segmented control', 39: 'picker wheel', 40: 'switch', 41: 'toggle', 42: 'link',
  43: 'image', 45: 'search field', 48: 'text', 49: 'text field', 50: 'secure text field', 51: 'date picker', 52: 'text view', 75: 'cell', 79: 'stepper', 80: 'tab',
};
const EDITABLE = new Set([45, 49, 50, 52]);   // search field, text field, secure text field, text view

/**
 * The on-screen elements, one entry each, in tree order, with the line the
 * model reads and what a program needs: the centre in percent, the size in
 * points, the top edge in percent, the kind, whether it takes typing, and the
 * name a tool can find it by (its label or placeholder; null when it has neither).
 * @returns {Array<{ line: string, desc: string, text: string, name: string|null, value: string|null, kind: string, type: number|undefined, editable: boolean, focused: boolean, x: number|null, y: number|null, top: number|null, w: number|null, h: number|null }>}
 */
export function listElements(hierarchyText, screenW, screenH) {
  let root;
  try { root = JSON.parse(hierarchyText); } catch { return []; }
  const out = [];
  const seen = new Set();
  (function walk(node) {
    if (!node) return;
    const desc = describeElement(node);
    if (desc && (!node.frame || onScreen(node.frame, screenW, screenH))) {
      const text = (node.label || '').trim() || String(node.value ?? '').trim() || (node.placeholderValue || '').trim();
      const f = node.frame;
      const cx = f ? f.X + f.Width / 2 : null;
      const cy = f ? f.Y + f.Height / 2 : null;
      if (!isNoise(text, cy, screenH)) {
        const x = f ? pct(cx, screenW) : null;
        const y = f ? pct(cy, screenH) : null;
        const w = f ? Math.round(f.Width) : null;
        const h = f ? Math.round(f.Height) : null;
        const line = f ? `- ${desc} at (${x}%, ${y}%) size ${w}x${h}` : `- ${desc}`;
        const key = f ? `${desc}@${Math.round(cx)},${Math.round(cy)}` : desc;
        if (!seen.has(key)) {
          seen.add(key);
          const name = (node.label || '').trim() || (node.placeholderValue || '').trim() || null;
          out.push({ line, desc, text, name, value: node.value != null ? String(node.value) : null, kind: KINDS[node.elementType] || 'element', type: node.elementType, editable: EDITABLE.has(node.elementType), focused: node.hasFocus === true, x, y, top: f ? pct(f.Y, screenH) : null, w, h });
        }
      }
    }
    for (const c of node.children || []) walk(c);
  })(root?.axElement || root);
  return out;
}

/** @returns {string[]} one line per element, in tree order */
export function formatElements(hierarchyText, screenW, screenH) {
  return listElements(hierarchyText, screenW, screenH).map((e) => e.line);
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

/**
 * The element a tool names: the first whose label, title or identifier is
 * exactly `text`; failing that, the first whose placeholder is (an unlabelled
 * SwiftUI field is known only by its placeholder). With { editable: true }
 * (tools that type) a matching field wins over any other element: on iOSWorld's
 * Add Alarm sheet "Label" is both the heading above the field and the field's
 * placeholder. Only elements with a real frame count. Null when none.
 */
export function findElement(hierarchyText, text, { editable = false } = {}) {
  let root;
  try { root = JSON.parse(hierarchyText); } catch { return null; }
  let byName = null; let byHint = null; let field = null;
  (function walk(n) {
    if (!n) return;
    const real = n.frame && n.frame.Width > 0 && n.frame.Height > 0;
    if (real) {
      const named = n.label === text || n.title === text || n.identifier === text;
      if (editable && !field && EDITABLE.has(n.elementType) && (named || n.placeholderValue === text)) field = n;
      if (!byName && named) byName = n;
      if (!byHint && n.placeholderValue === text) byHint = n;
    }
    for (const c of n.children || []) walk(c);
  })(root?.axElement || root);
  // A tool that types asked for a field: a heading with the same text is not
  // one, and typing into it would land wherever the focus happens to be.
  return editable ? field : (byName || byHint);
}

/** Every piece of text on screen: labels, titles, values and placeholders of on-screen elements. */
export function screenTexts(hierarchyText, screenW, screenH) {
  let root;
  try { root = JSON.parse(hierarchyText); } catch { return []; }
  const out = [];
  (function walk(n) {
    if (!n) return;
    if (!n.frame || onScreen(n.frame, screenW, screenH)) {
      for (const v of [n.label, n.title, n.value, n.placeholderValue]) {
        const t = v === null || v === undefined ? '' : String(v).trim();
        if (t) out.push(t);
      }
    }
    for (const c of n.children || []) walk(c);
  })(root?.axElement || root);
  return out;
}

/** The app whose window is on screen: the label of the first application node (SpringBoard on the home screen). Null when unknown. */
export function appOnScreen(hierarchyText) {
  let root;
  try { root = JSON.parse(hierarchyText); } catch { return null; }
  let found = null;
  (function walk(n) {
    if (!n || found) return;
    if (n.elementType === 2 && (n.label || n.title)) { found = (n.label || n.title).trim(); return; }
    for (const c of n.children || []) walk(c);
  })(root?.axElement || root);
  return found;
}
