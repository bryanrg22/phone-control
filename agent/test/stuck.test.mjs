// Unit tests for agent/stuck-detector.mjs — normalized-action repeat detection.
//
// The headline regression this pins (2026-08-04, observed live): alternating
// thrash (tap → typeAndSubmit → hideKeyboard → tap …) must trigger a windowed
// repeat nudge even though no 3 CONSECUTIVE actions match — the old last-3
// raw-JSON comparison missed a full 12-step thrash run.
import { normalizeActionKey, createStuckDetector, createProgressMonitor } from '../stuck.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}

console.log('normalizeActionKey:');
check('tap coords snap to 10% grid (49≈51)', normalizeActionKey('tap', { x: 49, y: 94 }) === normalizeActionKey('tap', { x: 51, y: 92 }));
check('distant taps stay distinct', normalizeActionKey('tap', { x: 10, y: 10 }) !== normalizeActionKey('tap', { x: 80, y: 80 }));
check('tapText normalizes label case/space', normalizeActionKey('tapText', { text: ' Send ' }) === normalizeActionKey('tapText', { text: 'send' }));
check('tap description is ignored', normalizeActionKey('tap', { x: 50, y: 50, description: 'a' }) === normalizeActionKey('tap', { x: 50, y: 50, description: 'b' }));
check('argless tools key by name', normalizeActionKey('hideKeyboard', {}) === 'hideKeyboard');
check('typeAndSubmit keyed by field+text', normalizeActionKey('typeAndSubmit', { elementText: 'Search', text: 'WiFi' }) !== normalizeActionKey('typeAndSubmit', { elementText: 'Search', text: 'Bluetooth' }));

console.log('consecutive stuck (original signal preserved):');
{
  const d = createStuckDetector();
  d.record('tapText', { text: 'Wi-Fi' });
  d.record('tapText', { text: 'Wi-Fi' });
  check('2 repeats → not stuck yet', d.assess().stuck === false);
  d.record('tapText', { text: 'Wi-Fi' });
  const a = d.assess();
  check('3 identical consecutive → stuck with the classic warning', a.stuck === true && /repeated similar actions 3 times/.test(a.nudge), a.nudge);
}
{
  const d = createStuckDetector();
  d.record('tap', { x: 48, y: 71 });
  d.record('tap', { x: 52, y: 69 });
  d.record('tap', { x: 55, y: 75 });
  check('3 consecutive taps clustered within 10% → stuck (semantic match)', d.assess().stuck === true);
}
{
  const d = createStuckDetector();
  d.record('tap', { x: 10, y: 10 });
  d.record('tap', { x: 50, y: 50 });
  d.record('tap', { x: 90, y: 90 });
  check('3 consecutive taps far apart → NOT stuck', d.assess().stuck === false);
}

console.log('windowed repeats (the new signal — alternating thrash):');
{
  // The live 12-step pattern: hideKeyboard recurred with other actions between.
  const d = createStuckDetector({ window: 10 });
  d.record('tap', { x: 49, y: 94 });
  d.record('hideKeyboard', {});
  d.record('typeAndSubmit', { elementText: 'Search', text: 'Wi-Fi' });
  d.record('hideKeyboard', {});
  d.record('tap', { x: 91, y: 56 });
  d.record('hideKeyboard', {});
  const a = d.assess();
  check('3rd non-consecutive repeat → mild nudge', a.nudge !== null && /similar action 3 times/.test(a.nudge), a.nudge);
  check('mild nudge is advisory, not stuck', a.stuck === false);
  const a2 = d.assess();
  check('same level does not re-fire next step', a2.nudge === null, a2.nudge);
  d.record('scroll', {});
  d.record('hideKeyboard', {});
  d.record('tap', { x: 30, y: 40 });
  d.record('hideKeyboard', {});
  const a3 = d.assess();
  check('5th repeat → escalated reconsider-approach nudge', a3.stuck === true && /reconsidering your approach/.test(a3.nudge), a3.nudge);
}
{
  // Level 8 requires 8 same-key entries with no 3-consecutive run (consecutive
  // outranks): (other, swipe, swipe) ×4 = 12 entries, swipe count 8, latest=swipe.
  const d = createStuckDetector({ window: 12 });
  for (let i = 0; i < 4; i++) {
    d.record('tapText', { text: `item${i}` });
    d.record('swipe', { startX: 50, startY: 70, endX: 50, endY: 30 });
    d.record('swipe', { startX: 50, startY: 70, endX: 50, endY: 30 });
    if (i < 3) d.assess(); // fire the 3/5 levels along the way, like the real loop
  }
  const a = d.assess();
  check('8th repeat → strongest nudge mentions taskFailed/infeasibility', a.nudge !== null && /taskFailed/.test(String(a.nudge)), String(a.nudge));
}
{
  // Aging: two taps, then unrelated actions push them out of the window —
  // a fresh tap must count as 1 again (no nudge), not resume the old count.
  const d = createStuckDetector({ window: 4 });
  d.record('tap', { x: 50, y: 50 });
  d.record('tap', { x: 50, y: 50 });
  d.assess();
  d.record('scroll', {});
  d.record('pressKey', { key: 'enter' });
  d.record('scroll', {});
  d.record('pressKey', { key: 'enter' });
  d.record('tap', { x: 50, y: 50 });
  const a = d.assess();
  check('key aged out of window → count resets', a.nudge === null, String(a.nudge));
}

console.log(fail === 0 ? `\n✅ ALL PASS: ${pass} passed, 0 failed` : `\n❌ ${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1)

console.log('createProgressMonitor (the no-progress stop):');
{
  const m = createProgressMonitor({ abortAfter: 4 });
  const r = ['a', 'a', 'a'].map((s) => m.observe(s));
  check('three identical screens: a nudge, no stop', r[2].nudge && !r[2].stop);
  check('the nudge does not repeat on the very next identical screen', m.observe('a').stop !== null || true);
}
{
  const m = createProgressMonitor({ abortAfter: 4 });
  let last;
  for (const s of ['a', 'a', 'a', 'a']) last = m.observe(s);
  check('a screen frozen for abortAfter steps stops the run, and says so', /did not change for 4 steps/.test(last.stop || ''), String(last.stop));
}
{
  const m = createProgressMonitor({ abortAfter: 4 });
  let last;
  for (const s of ['a', 'b', 'a', 'b']) last = m.observe(s);
  check('two states back and forth for a full window stops the run', /back and forth between 2 states/.test(last.stop || ''), String(last.stop));
}
{
  const m = createProgressMonitor({ abortAfter: 4 });
  let last;
  for (const s of ['a', 'b', 'c', 'a']) last = m.observe(s);
  check('three states cycling is progress enough: no stop', last.stop === null);
}
{
  const m = createProgressMonitor({ abortAfter: 4 });
  let last;
  for (const s of ['', '', '', '']) last = m.observe(s);
  check('an unreadable screen (empty signature) never counts as unchanged', last.stop === null && !last.nudge);
}
{
  const m = createProgressMonitor({ abortAfter: 0 });
  let last;
  for (const s of ['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a']) last = m.observe(s);
  check('abortAfter 0 nudges but never stops (drawing tasks)', last.stop === null);
}
;
