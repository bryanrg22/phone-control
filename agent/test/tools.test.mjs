// tools.test.mjs — each tool against a mock device: what it does to the phone,
// and that what it tells the model is true.

import { toolDefinitions, createToolRunner } from '../tools.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}

const node = (label, { x = 100, y = 300, w = 100, h = 40, type = 9, value = null, identifier = '' } = {}) => ({ label, value, identifier, elementType: type, frame: { X: x, Y: y, Width: w, Height: h }, children: [] });
const tree = (...children) => JSON.stringify({ axElement: { label: '', elementType: 2, frame: { X: 0, Y: 0, Width: 402, Height: 874 }, children } });

function mock({ hierarchy = tree(), keyboard = [false] } = {}) {
  const calls = [];
  const kb = [...keyboard];
  const device = {
    hierarchy: async () => (typeof hierarchy === 'function' ? hierarchy(calls) : hierarchy),   // a function: the screen after the calls so far
    keyboardVisible: async () => (kb.length > 1 ? kb.shift() : kb[0]),
    emptySpotAboveKeyboard: async () => ({ x: 8, y: 300 }),
    launchApp: async (b) => calls.push(['launchApp', b]),
    tap: async (x, y) => calls.push(['tap', x, y]),
    type: async (t) => calls.push(['type', t]),
    pressKey: async (k) => calls.push(['pressKey', k]),
    pressButton: async (b) => calls.push(['pressButton', b]),
    swipe: async (...a) => calls.push(['swipe', ...a]),
    drag: async (...a) => calls.push(['drag', ...a]),
  };
  const state = { keyboardUp: false };
  const answers = [];
  const protocol = { ask: async (q) => { answers.push(q); return q.kind === 'text' ? '482913' : null; } };
  const run = createToolRunner({ device, apps: { Clock: 'com.apple.mobiletimer' }, screen: () => ({ widthPoints: 402, heightPoints: 874 }), protocol, state });
  return { run, calls, state, answers };
}

console.log('the tool set:');
{
  const names = toolDefinitions({ apps: { Clock: 'x' } }).map((t) => t.name);
  check('only tools that work on a real iPhone', !['searchMaps', 'openURL', 'setLocation', 'setAppearance', 'copyToClipboard', 'zoomAndTap', 'recallMemory', 'recallHistory', 'saveMemory'].some((n) => names.includes(n)), names.join(','));
  check('webSearch only when the provider has no search of its own', !names.includes('webSearch') && toolDefinitions({ apps: {}, braveSearch: true }).some((t) => t.name === 'webSearch'));
  check('openApp lists the apps it can open', toolDefinitions({ apps: { Clock: 'x', Maps: 'y' } })[0].description.includes('Clock, Maps'));
}

console.log('touching the phone:');
{
  const { run, calls } = mock();
  const r = await run('openApp', { appName: 'Clock' });
  check('openApp launches by bundle ID', calls[0][0] === 'launchApp' && calls[0][1] === 'com.apple.mobiletimer' && r.changesScreen);
  const bad = await run('openApp', { appName: 'Nope' });
  check('an unknown app is an error that lists the apps, and nothing is pressed', bad.error && bad.text.includes('Clock') && calls.length === 1);
}
{
  const { run, calls } = mock();
  await run('tap', { x: 50, y: 25 });
  check('tap converts percent to points', calls[0][0] === 'tap' && calls[0][1] === 201 && calls[0][2] === 219, JSON.stringify(calls[0]));
  const r = await run('tap', { x: 400, y: 900 });
  check('pixels instead of percent are refused, not tapped', r.error && calls.length === 1);
}
{
  const { run, calls } = mock({ hierarchy: tree(node('Save', { x: 300, y: 70, w: 80, h: 40 })) });
  const r = await run('tapText', { text: 'Save' });
  check('tapText taps the centre of the matching element', calls[0][1] === 340 && calls[0][2] === 90 && !r.error);
  const miss = await run('tapText', { text: 'Cancel' });
  check('tapText on a missing label is an error, and nothing is tapped', miss.error && calls.length === 1);
}
{
  const { run, calls } = mock();
  check('pressKey home is the hardware button', (await run('pressKey', { key: 'home' })) && calls[0][0] === 'pressButton' && calls[0][1] === 'home');
  await run('pressKey', { key: 'done' });
  check('common aliases are mapped (done → enter)', calls[1][0] === 'pressKey' && calls[1][1] === 'enter');
  check('an unknown key is refused', (await run('pressKey', { key: 'f5' })).error);
}

{
  // A scroll returns only once the list has stopped (trailblaze-004, 2026-10-17).
  const withStatic = (answers) => {
    const seq = [...answers];
    let reads = 0;
    const order = [];
    const device = {
      swipe: async () => order.push('swipe'),
      screenStatic: async () => { reads++; order.push('static?'); const a = seq.length ? seq.shift() : true; if (a instanceof Error) throw a; return a; },
    };
    const run = createToolRunner({ device, apps: {}, screen: () => ({ widthPoints: 402, heightPoints: 874 }), protocol: {}, state: { keyboardUp: false } });
    return { run, order, reads: () => reads };
  };
  const moving = withStatic([false, false, false, true]);
  const r = await moving.run('scroll', {});
  check('scroll polls the screen after the swipe until it is still', moving.order.join() === 'swipe,static?,static?,static?,static?' && r.text === 'Scrolled down' && r.settle, moving.order.join());
  const sw = withStatic([false, true]);
  await sw.run('swipe', { startX: 50, startY: 30, endX: 50, endY: 70 });
  check('swipe waits too', sw.reads() === 2);
  const broken = withStatic([new Error('runner /isScreenStatic failed (404)')]);
  const b = await broken.run('scroll', {});
  check('a runner without the route: the scroll still succeeds, after one try', !b.error && broken.reads() === 1);
  const t0 = Date.now();
  // Slow each answer so the cap, not the list, ends the wait.
  const slow = createToolRunner({ device: { swipe: async () => {}, screenStatic: async () => { await new Promise((res) => setTimeout(res, 100)); return false; } }, apps: {}, screen: () => ({ widthPoints: 402, heightPoints: 874 }), protocol: {}, state: {} });
  const s = await slow('scroll', {});
  const took = Date.now() - t0;
  check('a screen that never stops (a video): the wait ends at the cap, ~3 s, and the scroll succeeds', !s.error && took >= 2900 && took < 3400, `${took} ms`);
}

console.log('telling the truth:');
for (const [name, kb, hidden] of [
  ['Return closes it', [false], true],
  ['a tap on an empty area closes it', [true, false], true],
  ['nothing closes it', [true, true, true], false],
]) {
  const { run, state } = mock({ keyboard: kb });
  state.keyboardUp = true;
  const r = await run('hideKeyboard', {});
  check(`hideKeyboard when ${name}: says ${hidden ? 'hidden' : 'still up'}`, r.text.startsWith(hidden ? 'Keyboard hidden' : 'Keyboard is still up') && state.keyboardUp === !hidden, r.text);
}
{
  const { run, calls } = mock({ hierarchy: tree() });
  const r = await run('typeAndSubmit', { elementText: 'Message', text: 'hi' });
  check('typeAndSubmit with no such field types nothing and says so', r.error && !calls.some((c) => c[0] === 'type'));
}
{
  const { run, calls } = mock({ hierarchy: tree(node('Message', { type: 49 })) });
  const r = await run('typeAndSubmit', { elementText: 'Message', text: 'hi', submitKey: 'send' });
  check('typeAndSubmit with no Send button says NOTHING WAS SENT', r.error && r.text.includes('NOTHING WAS SENT') && calls.some((c) => c[0] === 'type'));
}
{
  const { run, calls } = mock({ hierarchy: tree(node('Message', { type: 49 }), node('Send', { x: 350, y: 800, w: 30, h: 30 })) });
  const r = await run('typeAndSubmit', { elementText: 'Message', text: 'hi', submitKey: 'send' });
  check('typeAndSubmit taps the Send button it found and names it', !r.error && r.text.includes('"Send"') && calls.at(-1)[0] === 'tap' && calls.at(-1)[1] === 365);
}

console.log('appending to a field of several lines (the decision mode):');
{
  // cloudslides-002's agenda field, 157x62 pt at (122, 244): centre (50%, 31.5%).
  const AGENDA = 'Threat models\nResearch gaps\nWhy benchmarks matter';
  const screenAfter = (calls) => tree(
    node('', { type: 49, value: 'Agenda', x: 122, y: 195, w: 157, h: 29 }),
    node('', { type: 49, value: calls.some((c) => c[0] === 'type') ? `${AGENDA}\nsafety` : AGENDA, x: 122, y: 244, w: 157, h: 62 }),
  );
  const { run, calls, state } = mock({ hierarchy: screenAfter });
  const r = await run('appendTextAt', { x: 50, y: 31.5, text: '\nsafety' });
  check('taps the field\'s bottom-right corner, just inside (where iOS puts the caret at the end), then types', calls.length === 2 && calls[0][0] === 'tap' && calls[0][1] === 273 && calls[0][2] === 300 && calls[1][0] === 'type' && calls[1][1] === '\nsafety' && state.keyboardUp, JSON.stringify(calls));
  check('reads the field back, and says it now ends with the text (as CloudSlides read on the simulator, 2026-10-17)', !r.error && r.changesScreen && r.text.includes('at its end') && r.text.includes('now ends with it: "Threat models\\nResearch gaps\\nWhy benchmarks matter\\nsafety"'), r.text);
}
{
  // The point is inside the field but off-centre (the keyboard moved it a little): the field is found by containment.
  const { run, calls } = mock({ hierarchy: tree(node('', { type: 52, value: 'Standup notes', x: 16, y: 200, w: 370, h: 300 })) });
  const r = await run('appendTextAt', { x: 30, y: 30, text: ' Gym' });
  check('a text view: its own corner, found by containment; and when the text is not there it says so', calls[0][1] === 380 && calls[0][2] === 494 && r.text.includes('No field\'s text ends with it'), `${JSON.stringify(calls)} ${r.text}`);
}
{
  // A field inside a larger editable container: the smallest that holds the point.
  const { run, calls } = mock({ hierarchy: tree(node('', { type: 52, value: 'outer', x: 0, y: 100, w: 402, h: 600, children: [] }), node('', { type: 49, value: 'a\nb', x: 50, y: 300, w: 200, h: 40 })) });
  await run('appendTextAt', { x: 37.3, y: 36.6, text: '\nc' });
  check('the smallest field that holds the point is the one appended to', calls[0][1] === 244 && calls[0][2] === 334, JSON.stringify(calls));
}
{
  const { run, calls } = mock({ hierarchy: tree(node('Save', { x: 300, y: 70, w: 80, h: 40 })) });
  const r = await run('appendTextAt', { x: 50, y: 50, text: 'x' });
  check('no field at the point: taps the point itself, and says it could not find the end', calls[0][0] === 'tap' && calls[0][1] === 201 && calls[0][2] === 437 && r.text.includes('no field was found'), `${JSON.stringify(calls)} ${r.text}`);
  check('pixels instead of percent are refused, and nothing is typed', (await run('appendTextAt', { x: 300, y: 600, text: 'x' })).error && calls.length === 2);
}

console.log('the user, and the end:');
{
  const { run, answers } = mock();
  const r = await run('askUser', { question: 'Which Sam?', options: ['A', 'B'] });
  check('an unanswered question is reported as such, with no answer assumed', answers[0].kind === 'options' && /No response/.test(r.text) && /NOT authorized/.test(r.text));
  const t = await run('askUserText', { question: 'Code?', hint: '6 digits' });
  check('a free-text answer reaches the model', answers[1].kind === 'text' && t.text === 'User typed: "482913"');
}
{
  const { run } = mock();
  const d = await run('taskComplete', { summary: 'Alarm set.' });
  const f = await run('taskFailed', { reason: 'No Jordan.' });
  check('taskComplete and taskFailed conclude, with their text', d.done?.summary === 'Alarm set.' && f.failed?.reason === 'No Jordan.');
  check('an unknown tool is an error', (await run('flyToMoon', {})).error);
}


console.log('waitForText reads the screen, not the hierarchy JSON:');
{
  const { run } = mock({ hierarchy: tree(node('Alarms', { type: 48 })) });
  const yes = await run('waitForText', { text: 'Alarms', timeoutSec: 1 });
  check('finds a label that is on screen', /^Found/.test(yes.text), yes.text);
  const t0 = Date.now();
  const no = await run('waitForText', { text: 'frame', timeoutSec: 1 });
  check('does not find a JSON key name ("frame" matched at once before 2026-10-16)', /^TIMEOUT/.test(no.text), no.text);
  const digit = await run('waitForText', { text: '2', timeoutSec: 1 });
  check('does not find a digit that only appears in a frame size', /^TIMEOUT/.test(digit.text), digit.text);
  check('a miss waits out the timeout rather than returning early', Date.now() - t0 >= 1900);
}

console.log('gestures refuse pixels like tap does:');
{
  const { run, calls } = mock();
  const s = await run('swipe', { startX: 200, startY: 600, endX: 200, endY: 100 });
  const d = await run('drag', { startX: 50, startY: 50, endX: 300, endY: 50 });
  check('swipe with pixel values is an error, and nothing moves', s.error && !calls.some((c) => c[0] === 'swipe'), s.text);
  check('drag with pixel values is an error, and nothing moves', d.error && !calls.some((c) => c[0] === 'drag'), d.text);
  await run('swipe', { startX: 50, startY: 70, endX: 50, endY: 30 });
  check('a percentage swipe goes through, in points', calls.some((c) => c[0] === 'swipe' && c[1] === 201 && c[2] === 612), JSON.stringify(calls));
}

console.log('replaceText:');
{
  const { run, calls } = mock({ hierarchy: tree(node('Label', { type: 48, x: 20, y: 200 })) });
  const r = await run('replaceText', { field: 'Label', value: 'Gym' });
  check('a heading with the field\'s name is not a field: an error, nothing tapped or typed', r.error && calls.length === 0, r.text);
  const miss = await run('replaceText', { field: 'Nope', value: 'x' });
  check('a missing field is an error', miss.error && calls.length === 0);
}
{
  const { run, calls, state } = mock({ hierarchy: tree(node('Label', { type: 48, x: 20, y: 200 }), node('', { type: 49, value: 'Old', x: 20, y: 260, w: 300, h: 40 })) });
  // The field has no label: it is found by its placeholder.
  const h = JSON.parse(tree(node('Label', { type: 48, x: 20, y: 200 }), { ...node('', { type: 49, value: 'Old', x: 20, y: 260, w: 300, h: 40 }), placeholderValue: 'Label' }));
  const { run: run2, calls: calls2, state: state2 } = mock({ hierarchy: JSON.stringify(h) });
  const r = await run2('replaceText', { field: 'Label', value: 'Gym' });
  check('the real field is focused, selected (three more taps) and typed over', !r.error && calls2.filter((c) => c[0] === 'tap').length === 4 && calls2.at(-1)[0] === 'type' && calls2.at(-1)[1] === 'Gym' && state2.keyboardUp, JSON.stringify(calls2));
  void run; void calls; void state;
}

console.log(fail ? `\n❌ ${fail} FAILED, ${pass} passed` : `\n✅ ALL PASS: ${pass} passed, 0 failed`);
if (fail) process.exit(1);
