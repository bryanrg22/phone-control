// Unit tests for local-adapter.mjs — locks the Tier-2 audit fixes:
//   #14     parseJsonAction: brace-counted FIRST complete object (not greedy first-to-last)
//   #1/#24  mapLocalModelAction: 'drag' reaches the real drag tool (not collapsed to swipe)
//   #2/#10  mapLocalModelAction: pixel→% uses the INJECTED sent-image width (not hardcoded 768)
// Pure logic — no device / sim / network. Run: node agent/test/local-adapter.test.mjs
import { parseJsonAction, mapLocalModelAction } from '../local-adapter.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const approx = (a, b, eps = 0.3) => Math.abs(a - b) <= eps;

console.log('parseJsonAction — extraction (#14):');
check('plain object', JSON.stringify(parseJsonAction('{"tool":"tap","args":{"x":50,"y":50}}')) === JSON.stringify({ name: 'tap', args: { x: 50, y: 50 } }));
check('fenced ```json block', parseJsonAction('```json\n{"tool":"openApp","args":{"appName":"Settings"}}\n```')?.name === 'openApp');
check('prose THEN object', parseJsonAction('Let me tap that. {"action":"click","coordinate":[100,200]}')?.name === 'click');
const twoObj = parseJsonAction('{"thought":"I should tap General"} {"tool":"tap","args":{"x":1,"y":2}}');
check('thought-object THEN action-object → returns the ACTION (skips thought)', twoObj?.name === 'tap', JSON.stringify(twoObj));
const glued = parseJsonAction('{"a":1}\n{"tool":"taskComplete","args":{"summary":"x"}}');
check('two objects on separate lines → 2nd action found (greedy regex would have failed→null)', glued?.name === 'taskComplete', JSON.stringify(glued));
check('flattened top-level args', JSON.stringify(parseJsonAction('{"tool":"tap","x":5,"y":6}')?.args) === JSON.stringify({ x: 5, y: 6 }));
check('braces INSIDE a string value are not miscounted', parseJsonAction('{"tool":"inputText","args":{"text":"a } b { c"}}')?.args.text === 'a } b { c');
check('no JSON → null', parseJsonAction('I cannot do that') === null);
check('empty → null', parseJsonAction('') === null);

console.log('\nmapLocalModelAction — DRAG is distinct from swipe (#1/#24):');
const dPx = mapLocalModelAction('drag', { from: [384, 1248], to: [384, 416] }, { sentW: 768, sentH: 1664 });
check('native drag(from,to) pixels → name is "drag" (NOT swipe)', dPx.name === 'drag', dPx.name);
check('  → startY ≈ 75%, endY ≈ 25% (1248/1664, 416/1664)', approx(dPx.args.startY, 75) && approx(dPx.args.endY, 25), JSON.stringify(dPx.args));
const dPct = mapLocalModelAction('drag', { startX: 50, startY: 70, endX: 50, endY: 30 });
check('drag with %-schema fields → "drag", percentages preserved', dPct.name === 'drag' && dPct.args.startY === 70 && dPct.args.endY === 30, JSON.stringify(dPct));
const dHold = mapLocalModelAction('drag', { from: [10, 10], to: [20, 20], holdDuration: 0.8 }, { sentW: 100, sentH: 100 });
check('drag holdDuration passed through', dHold.name === 'drag' && dHold.args.holdDuration === 0.8);
check('swipe stays swipe (quick flick, NOT drag)', mapLocalModelAction('swipe', { direction: 'up' }).name === 'swipe');
check('scroll → swipe', mapLocalModelAction('scroll', { direction: 'down' }).name === 'swipe');
const sw3b = mapLocalModelAction('swipe', { coordinate: [384, 835], coordinate2: [192, 250] }, { sentW: 768, sentH: 1670 });
check('swipe with coordinate+coordinate2 (qwen 3b live shape) → honors endpoints, not default',
  sw3b.name === 'swipe' && approx(sw3b.args.startX, 50) && approx(sw3b.args.startY, 50, 1) && approx(sw3b.args.endX, 25), JSON.stringify(sw3b.args));

console.log('\nmapLocalModelAction — pixel→% uses INJECTED width (#2/#10):');
const center768 = mapLocalModelAction('click', { coordinate: [384, 832] }, { sentW: 768, sentH: 1664 });
check('center on 768-wide image → 50%', center768.name === 'tap' && approx(center768.args.x, 50), JSON.stringify(center768.args));
const centerNative = mapLocalModelAction('click', { coordinate: [589, 1280] }, { sentW: 1178, sentH: 2560 });
check('center on 1178-wide (--no-compress) → 50%, NOT 76.8%', approx(centerNative.args.x, 50), `got ${centerNative.args.x}`);
check('  (proof the bug is fixed: 589/768*100 = 76.7% would be the OLD wrong value)', !approx(centerNative.args.x, 76.7, 1));

console.log('\nmapLocalModelAction — coordinate conventions + verb mapping:');
check('Qwen array coords = pixels even when ≤100 (top-left [38,38]/768 → ~5%)', approx(mapLocalModelAction('tap', { coordinate: [38, 38] }, { sentW: 768, sentH: 768 }).args.x, 5, 0.5));
check('frontier bare x/y ≤100 = percent (50,50 → 50%)', mapLocalModelAction('tap', { x: 50, y: 50 }).args.x === 50);
check('qwen2.5vl:7b {"x":[149,512]} array-in-x → pixels', mapLocalModelAction('tap', { x: [149, 512] }, { sentW: 768, sentH: 1664 }).name === 'tap');
check('type → inputText', mapLocalModelAction('type', { text: 'hi' }).name === 'inputText' && mapLocalModelAction('type', { content: 'hi' }).args.text === 'hi');
check('open → openApp', mapLocalModelAction('open', { text: 'Maps' }).args.appName === 'Maps');
check('key → pressKey (default enter)', mapLocalModelAction('key', {}).args.key === 'enter');
check('terminate → taskComplete', mapLocalModelAction('terminate', { answer: 'all set' }).name === 'taskComplete');
check('wait → takeScreenshot', mapLocalModelAction('wait', {}).name === 'takeScreenshot');
check('already-valid tool name passes through', mapLocalModelAction('getUIElements', {}).name === 'getUIElements');
check('coords clamp to [0,100] (overshoot pixel)', mapLocalModelAction('click', { coordinate: [99999, 99999] }, { sentW: 768, sentH: 768 }).args.x === 100);

console.log('\nmapLocalModelAction — drag/swipe ARRAY coords are pixels even near edges (#MED re-review):');
const dragEdge = mapLocalModelAction('drag', { from: [60, 90], to: [60, 1400] }, { sentW: 768, sentH: 1664 });
check('drag array endpoint [60,90] treated as PIXELS not % (→ ~7.8%, not 60%)', approx(dragEdge.args.startX, 7.8, 0.6) && dragEdge.name === 'drag', JSON.stringify(dragEdge.args));
const swipeEdge = mapLocalModelAction('swipe', { coordinate: [38, 80], coordinate2: [38, 800] }, { sentW: 768, sentH: 1664 });
check('swipe array endpoint [38,..] treated as PIXELS (→ ~5%)', approx(swipeEdge.args.startX, 5, 0.6), JSON.stringify(swipeEdge.args));
check('drag NAMED %-fields still treated as % (startX:60 → 60%, frontier path)', mapLocalModelAction('drag', { startX: 60, startY: 70, endX: 60, endY: 30 }).args.startX === 60);
check('drag synonym "dragAndDrop" → name "drag"', mapLocalModelAction('dragAndDrop', { from: [100, 200], to: [100, 800] }, { sentW: 768, sentH: 1664 }).name === 'drag');
check('drag synonym "long_press_drag" → name "drag"', mapLocalModelAction('long_press_drag', { from: [100, 200], to: [100, 800] }, { sentW: 768, sentH: 1664 }).name === 'drag');
check('large drag array still pixels (regression: [384,1248]/1664 → ~75%)', approx(mapLocalModelAction('drag', { from: [384, 1248], to: [384, 416] }, { sentW: 768, sentH: 1664 }).args.startY, 75));

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
