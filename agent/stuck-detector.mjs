// stuck-detector.mjs — normalized-action repeat detection for the agent loop.
//
// Extracted + upgraded from the inline agent.mjs logic (2026-08-04) after a live
// 12-step thrash run that the old detector missed entirely: the agent alternated
// tap → typeAndSubmit → hideKeyboard → tap …, so no three CONSECUTIVE actions ever
// matched, yet the same actions kept recurring across the window. The fix (from
// browser-use's ActionLoopDetector pattern, verified against their views.py
// 2026-08-04): compare NORMALIZED action keys over a rolling window, not raw
// arg-JSON of the last 3, and escalate advisory nudges as the repeat count grows
// instead of firing one fixed warning.
//
// Two signals, both advisory (the hard circuit breakers stay in agent.mjs):
//   • consecutive — 3 in a row of the same normalized action (or same tool with
//     clustered coordinates), the original signal, kept byte-compatible in spirit.
//   • windowed repeats — the same normalized action N times in the last `window`
//     steps regardless of what ran in between; nudges escalate at 3 / 5 / 8.
//
// Pure module: no I/O, no module-global state. Mirrors must stay in sync with
// OnDeviceAgent.swift (StuckDetector) — enforced by the parity manifest.

/** Normalize a tool call to a comparable key. Coordinates snap to a 10% grid so
 *  near-identical taps collide; free text is lowercased/trimmed; volatile args
 *  (descriptions, durations) are dropped. */
export function normalizeActionKey(toolName, args = {}) {
  const t = String(toolName);
  const snap = (v) => Math.round(Number(v) / 10) * 10;
  switch (t) {
    case 'tap':
    case 'zoomAndTap':
      return `${t}@${snap(args.x)},${snap(args.y)}`;
    case 'swipe':
    case 'drag':
      return `${t}@${snap(args.startX)},${snap(args.startY)}>${snap(args.endX)},${snap(args.endY)}`;
    case 'tapText':
      return `tapText:${String(args.text ?? '').trim().toLowerCase()}`;
    case 'openApp':
      return `openApp:${String(args.appName ?? args.bundleId ?? '').trim().toLowerCase()}`;
    case 'inputText':
      return `inputText:${String(args.text ?? '').trim().toLowerCase()}`;
    case 'typeAndSubmit':
      return `typeAndSubmit:${String(args.elementText ?? '').trim().toLowerCase()}:${String(args.text ?? '').trim().toLowerCase()}`;
    case 'pressKey':
      return `pressKey:${String(args.key ?? '').trim().toLowerCase()}`;
    case 'replaceText':
      return `replaceText:${String(args.field ?? '').trim().toLowerCase()}`;
    case 'waitForText':
      return `waitForText:${String(args.text ?? '').trim().toLowerCase()}`;
    default:
      // Observation/memory/HITL tools: identity by name only.
      return t;
  }
}

/** Rolling-window stuck detector. record() every executed action; assess() once
 *  per step (before the LLM call) to get the nudge to inject, if any.
 *  Window default is 12, not 10: the level-8 nudge needs 8 same-key entries
 *  WITHOUT 3 consecutive (consecutive outranks it), and the best non-consecutive
 *  density is 2/3 — so a 10-window caps at 7 and level 8 would be unreachable. */
export function createStuckDetector({ window = 12 } = {}) {
  const entries = []; // { key, tool, x, y }
  // Escalation memory: highest windowed-repeat threshold already nudged for a key.
  // Prevents re-firing "3 repeats" every step while the count hovers at 3, but
  // still allows the 5- and 8-level nudges to fire as the count climbs.
  const nudgedLevel = new Map();

  function record(toolName, args = {}) {
    const key = normalizeActionKey(toolName, args);
    const x = Number(args.x ?? args.startX);
    const y = Number(args.y ?? args.startY);
    entries.push({ key, tool: String(toolName), x: Number.isFinite(x) ? x : null, y: Number.isFinite(y) ? y : null });
    if (entries.length > window) entries.shift();
    for (const k of [...nudgedLevel.keys()]) {
      if (!entries.some(e => e.key === k)) nudgedLevel.delete(k); // key aged out — allow fresh escalation later
    }
  }

  /** Original signal: last 3 actions identical, or same tool with coordinates
   *  clustered within a 10% box (the historical semantic match, preserved). */
  function consecutiveStuck() {
    if (entries.length < 3) return false;
    const last3 = entries.slice(-3);
    if (last3.every(e => e.key === last3[0].key)) return true;
    if (!last3.every(e => e.tool === last3[0].tool)) return false;
    if (last3.every(e => e.x !== null && e.y !== null)) {
      const xs = last3.map(e => e.x), ys = last3.map(e => e.y);
      if (Math.max(...xs) - Math.min(...xs) <= 10 && Math.max(...ys) - Math.min(...ys) <= 10) return true;
    }
    return false;
  }

  /** Occurrences of the most recent action's key within the window. */
  function windowedRepeats() {
    if (entries.length === 0) return { key: null, count: 0 };
    const key = entries[entries.length - 1].key;
    return { key, count: entries.filter(e => e.key === key).length };
  }

  /** One assessment per step. Returns { stuck, nudge } — nudge is the message to
   *  inject as a user turn, or null. Consecutive stuck outranks windowed nudges. */
  function assess() {
    if (consecutiveStuck()) {
      return {
        stuck: true,
        nudge: 'WARNING: You have repeated similar actions 3 times with no progress. Your coordinates or element text may be WRONG. Try: 1) getUIElements to see what is actually on screen with exact coordinates, 2) tap with coordinates from getUIElements, 3) a completely different approach.',
      };
    }
    const { key, count } = windowedRepeats();
    if (key !== null) {
      const level = count >= 8 ? 8 : count >= 5 ? 5 : count >= 3 ? 3 : 0;
      if (level > (nudgedLevel.get(key) || 0)) {
        nudgedLevel.set(key, level);
        if (level === 8) {
          return { stuck: true, nudge: `WARNING: You have now tried "${key.split(':')[0]}" ${count} times in your recent actions and the task is not advancing. Your current approach does NOT work. Stop and reconsider from scratch: re-read every visible element, consider whether this task is even possible on this device — if it is not (missing app, missing setting, unsupported feature), call taskFailed and explain why instead of repeating actions.` };
        }
        if (level === 5) {
          return { stuck: true, nudge: `Heads up: you have repeated a similar action ${count} times in your last ${entries.length} actions without finishing the task. It might be worth reconsidering your approach — read ALL text on screen, use webSearch if this app/screen is unfamiliar, or try a structurally different path to the goal.` };
        }
        return { stuck: false, nudge: `Note: you have used a very similar action ${count} times recently. If it is not producing the result you expect, check the UI element list for exact coordinates before trying again.` };
      }
    }
    return { stuck: false, nudge: null };
  }

  return { record, assess, _entries: entries };
}
