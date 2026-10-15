// Local / tool-less model adapter — translates a GUI-specialist model's free-text JSON
// reply into our tool schema. Pure + dependency-free so it is unit-testable WITHOUT a
// device (see agent/test/local-adapter.test.mjs). Used by agent.mjs whenever noToolsMode
// is active: provider=local (Ollama Qwen2.5-VL, which has no function-calling API), or
// --no-tools on any provider (frontier-model no-tools parity, the #8 grounding study).
//
// Two model conventions are supported simultaneously:
//   • GUI specialists (Qwen2.5-VL): native verbs + PIXEL coords in the sent-image space,
//     e.g. {"action":"click","coordinate":[px,py]} — array coords are always pixels.
//   • Frontier models in --no-tools mode: our tool names + PERCENT coords (0-100), per the
//     NO_FUNCTION_CALLING system-prompt instructions, e.g. {"tool":"tap","args":{"x":50,"y":50}}.

// ─── JSON extraction ────────────────────────────────────────────────────────
// Yield each COMPLETE top-level {...} object in order, via a string-aware brace counter.
// (Replaces a greedy /\{[\s\S]*\}/ that matched first '{' to LAST '}', gluing a
// thought-object + action-object into one unparseable blob — audit finding #14.)
function* iterJsonObjects(s) {
  let start = -1, depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (start === -1) { if (c === '{') { start = i; depth = 1; } continue; }
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        let obj = null;
        try { obj = JSON.parse(s.slice(start, i + 1)); } catch { /* not valid — skip */ }
        start = -1;
        if (obj && typeof obj === 'object') yield obj;
      }
    }
  }
}

// Parse the FIRST JSON object that names an action. Tolerates markdown fences, surrounding
// prose, and a leading thought-only object. Normalizes tool/name/action/function + args.
export function parseJsonAction(text) {
  if (!text) return null;
  const s = String(text).replace(/```(?:json)?/gi, '');
  for (const obj of iterJsonObjects(s)) {
    const name = obj.tool || obj.name || obj.action || obj.function;
    if (!name || typeof name !== 'string') continue; // skip thought-only objects
    let args = obj.args || obj.arguments || obj.parameters || obj.input;
    if (!args || typeof args !== 'object') {
      // model flattened args to the TOP level (e.g. {"tool":"tap","x":50,"y":50})
      const { tool: _t, name: _n, action: _ac, function: _fn, args: _a, arguments: _ar, parameters: _p, input: _i, ...rest } = obj;
      args = rest;
    }
    return { name, args };
  }
  return null;
}

// ─── action mapping ───────────────────────────────────────────────────────────
const asArr = (v) => (Array.isArray(v) && v.length >= 2) ? v : null;
const DIR = { up: [50, 70, 50, 30], down: [50, 30, 50, 70], left: [70, 50, 30, 50], right: [30, 50, 70, 50] };
const dirMap = (dir) => DIR[dir] || DIR.up;

// Map a native action to our tool schema, converting coordinates to PERCENTAGES (0-100).
// sentW/sentH = pixel dimensions of the image ACTUALLY sent to the model this turn (768
// when compressed, native width with --no-compress). Hardcoding 768 was audit finding
// #2/#10 — it corrupted every --no-compress run and the (then-uncompressed) step-0 image.
export function mapLocalModelAction(name, args = {}, { sentW = 768, sentH = 768 } = {}) {
  const n = String(name || '').toLowerCase().replace(/[_\s-]/g, '');
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const pxToPct = (cx, cy) => ({ x: +clamp(cx / sentW * 100).toFixed(1), y: +clamp(cy / sentH * 100).toFixed(1) });
  // A coordinate PAIR is pixels if either component exceeds 100 (frontier % stay ≤100);
  // GUI-model array coords are always pixels.
  const pairToPct = (cx, cy) => (Math.abs(+cx) > 100 || Math.abs(+cy) > 100) ? pxToPct(+cx, +cy) : { x: +cx, y: +cy };

  // coords arrive as coordinate/coord/point/position/location arrays, OR x as a [x,y] array
  // (qwen2.5vl:7b does this), OR plain numeric x/y.
  const coordArr = [args.coordinate, args.coord, args.position, args.point, args.x, args.location].find(v => Array.isArray(v) && v.length >= 2);
  let pt = null;
  if (coordArr) pt = pxToPct(+coordArr[0], +coordArr[1]);                       // array form → always pixels
  else if (args.x != null && args.y != null) pt = pairToPct(args.x, args.y);   // bare x/y → pixels-or-%

  if (['click', 'leftclick', 'tap', 'touch', 'press', 'select'].includes(n) && pt)
    return { name: 'tap', args: { ...pt, description: args.description || args.element || args.target || '' } };
  if (['type', 'input', 'inputtext', 'text', 'write', 'settext'].includes(n))
    return { name: 'inputText', args: { text: args.text ?? args.content ?? args.value ?? '' } };
  if (['key', 'keypress', 'presskey', 'hotkey'].includes(n))
    return { name: 'pressKey', args: { key: args.key || args.text || 'enter' } };
  if (['open', 'openapp', 'launch', 'launchapp'].includes(n))
    return { name: 'openApp', args: { appName: args.appName || args.app || args.name || args.text || '' } };

  // DRAG (held: pick up → move → release) is DISTINCT from swipe/scroll (quick flick) and
  // maps to our `drag` tool (XCTest /drag with holdDuration), which swipe cannot express.
  // Pre-fix, drag collapsed into the swipe branch so local models could NEVER reach the
  // real drag tool — breaking the drag_game / drawing categories (audit finding #1/#24).
  if (['drag', 'draganddrop', 'dragdrop', 'dragndrop', 'longpressdrag'].includes(n)) {
    // Endpoint from an ARRAY is GUI-model PIXELS → pxToPct (like the tap branch); from
    // NAMED startX/endX fields it may be frontier PERCENTAGES → pairToPct heuristic.
    // Conflating both through pairToPct mis-scaled Qwen drags near a screen edge ~8-13x.
    const fromArr = asArr(args.from) || asArr(args.start) || asArr(args.startPoint) || asArr(args.coordinate);
    const toArr   = asArr(args.to)   || asArr(args.end)   || asArr(args.endPoint)   || asArr(args.coordinate2);
    const a = fromArr ? pxToPct(+fromArr[0], +fromArr[1]) : (args.startX != null ? pairToPct(args.startX, args.startY) : null);
    const b = toArr   ? pxToPct(+toArr[0], +toArr[1])     : (args.endX   != null ? pairToPct(args.endX,   args.endY)   : null);
    if (a && b) {
      return { name: 'drag', args: {
        startX: a.x, startY: a.y, endX: b.x, endY: b.y,
        ...(args.holdDuration != null ? { holdDuration: +args.holdDuration } : {}),
        ...(args.dragDuration != null ? { dragDuration: +args.dragDuration } : {}),
      } };
    }
    const m = dirMap((args.direction || 'up').toLowerCase());
    return { name: 'drag', args: { startX: m[0], startY: m[1], endX: m[2], endY: m[3] } };
  }
  if (['swipe', 'scroll', 'flick'].includes(n)) {
    // from/to also arrive as coordinate+coordinate2 (qwen2.5vl:3b emits this for swipe —
    // observed live 2026-05-30; without it the swipe fell back to a default up-flick).
    const fromArr = asArr(args.from) || asArr(args.coordinate) || asArr(args.start);
    const toArr   = asArr(args.to)   || asArr(args.coordinate2) || asArr(args.end);
    const a = fromArr ? pxToPct(+fromArr[0], +fromArr[1]) : (args.startX != null ? pairToPct(args.startX, args.startY) : null);
    const b = toArr   ? pxToPct(+toArr[0], +toArr[1])     : (args.endX   != null ? pairToPct(args.endX,   args.endY)   : null);
    if (a && b) { return { name: 'swipe', args: { startX: a.x, startY: a.y, endX: b.x, endY: b.y } }; }
    const m = dirMap((args.direction || 'up').toLowerCase());
    return { name: 'swipe', args: { startX: m[0], startY: m[1], endX: m[2], endY: m[3] } };
  }
  if (['terminate', 'done', 'finished', 'complete', 'taskcomplete', 'answer', 'stop', 'end'].includes(n))
    return { name: 'taskComplete', args: { summary: args.summary || args.answer || args.text || 'done' } };
  if (['wait'].includes(n)) return { name: 'takeScreenshot', args: {} };
  return { name, args }; // already a valid agent tool name → pass through
}
