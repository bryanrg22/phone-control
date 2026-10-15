// phone-screen-state.mjs — read "is it locked? is Wi-Fi on?" off the screen.
//
// The supervisor's network label is INFERRED (one TCP probe from the host). The
// phone's own screen is ground truth, and whenever the XCUITest runner is up we
// can read it: POST /viewHierarchy with no app ids returns SpringBoard's
// element tree, which includes the lock screen and the status bar.
//
// Measured on the real phone (iPhone 15 Pro, 2026-10-12, locked, screen off) —
// the tree carried, among others:
//   label "Swipe up to unlock" · label "Locked" + identifier "proud-lock"
//   identifier "lockscreen-date-view" · identifier "SBCoverSheetWindow"
//   label "Wi-Fi", identifier "3 of 3 Wi-Fi bars", value "SSID, 3 of 3 Wi-Fi bars"
//   label "Cellular", value "3 of 4 bars, signal strength"
//
// NOT yet measured: the same tree with the phone UNLOCKED. Until it is, `locked`
// rests on the lock-screen hint being absent when unlocked, which is likely but
// unproven — so the signals that fired are returned alongside the verdict.
//
// Pure: no I/O, no side effects. Tested in server/test/preflight.test.mjs.

const TEXT_KEYS = ['label', 'identifier', 'title', 'value'];

/** Every non-empty label / identifier / title / value in the tree, any shape. */
export function collectStrings(tree) {
  const out = [];
  const seen = new Set();
  (function walk(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    for (const k of TEXT_KEYS) {
      const v = node[k];
      if (typeof v === 'string' && v.trim()) out.push({ key: k, text: v.trim() });
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  })(tree);
  return out;
}

/**
 * Another app's banner sitting over the top of the screen — today, the Claude
 * app's own Live Activity ("Claude's reply"), which stays expanded until it is
 * swiped away and covers where back buttons live. Returns the element and where
 * it is, so it can be swiped up deterministically BEFORE an agent starts
 * working, rather than hoping the agent decides to.
 *
 * The pattern comes from the pill's visible text, seen in a screenshot. How
 * SpringBoard exposes that pill in the element tree has NOT
 * been captured yet, so this matches on text in any label/value/title and
 * requires a real on-screen frame; if nothing matches, nothing is touched.
 */
export const DEFAULT_BANNER_PATTERNS = [/claude[’']?s reply/i];

export function findBanner(tree, patterns = DEFAULT_BANNER_PATTERNS) {
  let hit = null;
  const seen = new Set();
  (function walk(node, inherited) {
    if (hit || !node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const f = node.frame && typeof node.frame === 'object' ? node.frame : null;
    const frame = f && f.Width > 0 && f.Height > 0 ? { x: f.X, y: f.Y, width: f.Width, height: f.Height } : inherited;
    for (const k of TEXT_KEYS) {
      const v = node[k];
      if (typeof v === 'string' && patterns.some((p) => p.test(v)) && frame) { hit = { text: v.trim(), frame }; return; }
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, frame);
  })(tree, null);
  return hit;
}

/** The swipe that sends a banner back to the Dynamic Island: from its middle, straight up off the top. */
export function bannerSwipe(frame) {
  const x = Math.round(frame.x + frame.width / 2);
  const y = Math.round(frame.y + frame.height / 2);
  return { startX: x, startY: y, endX: x, endY: 0, duration: 0.2 };
}

const BARS = /(\d) of (\d) (Wi-Fi )?bars/;

export function parseScreenState(tree) {
  const strings = collectStrings(tree);
  const has = (key, text) => strings.some((s) => s.key === key && s.text === text);

  const lockSignals = [];
  if (has('label', 'Swipe up to unlock')) lockSignals.push('label:Swipe up to unlock');
  if (has('identifier', 'lockscreen-date-view')) lockSignals.push('identifier:lockscreen-date-view');
  if (has('identifier', 'proud-lock') && has('label', 'Locked')) lockSignals.push('proud-lock:Locked');

  let wifi = null;
  for (const s of strings) {
    const m = s.text.match(BARS);
    if (m && m[3]) { wifi = { bars: Number(m[1]), of: Number(m[2]) }; break; }
  }
  let cellular = null;
  for (const s of strings) {
    const m = s.text.match(BARS);
    if (m && !m[3] && /signal strength/.test(s.text)) { cellular = { bars: Number(m[1]), of: Number(m[2]) }; break; }
  }

  return {
    // null when the tree is empty: "could not tell" must never read as "unlocked".
    locked: strings.length === 0 ? null : lockSignals.length > 0,
    lockSignals,
    wifi,          // null = no Wi-Fi indicator in the status bar
    cellular,
    elements: strings.length,
  };
}
