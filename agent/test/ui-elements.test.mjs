// ui-elements.test.mjs — the element list the model reads with every screenshot,
// and the screen signature the no-progress stop compares (tools.mjs).
//
// fixtures/add-alarm-hierarchy.json is a REAL hierarchy from our runner on an
// iOS 26.4 simulator: iOSWorld's Clock app, Add Alarm sheet, label "Gym" typed,
// keyboard up (2026-10-15). On that screen every model stalled: the old list
// showed no time picker and no text field, so setting the time looked like
// "no change" and the agent stopped itself after 8 steps.
import { readFileSync } from 'node:fs';
import { formatElements as formatUIElements, screenSignature, describeElement, findElement } from '../elements.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}

const W = 402, H = 874;   // iPhone 17 Pro, points
const ADD_ALARM = readFileSync(new URL('./fixtures/add-alarm-hierarchy.json', import.meta.url), 'utf8');
const node = (o) => ({ identifier: '', label: '', value: null, elementType: 1, frame: { X: 20, Y: 300, Width: 200, Height: 40 }, ...o });
const tree = (...children) => JSON.stringify({ axElement: { label: '', elementType: 2, frame: { X: 0, Y: 0, Width: W, Height: H }, children } });

console.log('the element list on the real Add Alarm sheet:');
{
  const lines = formatUIElements(ADD_ALARM, W, H);
  const has = (re) => lines.some((l) => re.test(l));
  check('the three picker wheels appear with their values', has(/^- picker wheel = "6 o’clock" at/) && has(/^- picker wheel = "38 minutes" at/) && has(/^- picker wheel = "AM" at/), lines.join('\n'));
  check('the label field appears with what was typed, named by its placeholder', has(/^- text field "Label" = "Gym" at/), lines.join('\n'));
  check('the buttons are still there', has(/^- "Save" at/) && has(/^- "Cancel" at/));
  check('the status-bar clock is left out', !has(/10:30/));
  check('status-bar signal and battery are left out', !has(/Cellular|battery|Wi-Fi bars/));
}

console.log('what is noise and what is not:');
{
  const lines = formatUIElements(tree(
    node({ label: '6:45 AM', elementType: 48, frame: { X: 20, Y: 200, Width: 120, Height: 40 } }),
    node({ label: '9:41', elementType: 48, frame: { X: 30, Y: 14, Width: 40, Height: 16 } }),
    node({ label: 'TEAM STANDUP', elementType: 48 }),
  ), W, H);
  check('an alarm time in the app is kept (it used to be deleted as "the clock")', lines.some((l) => l.startsWith('- "6:45 AM" at')), lines.join('\n'));
  check('the status-bar clock is dropped by its position', !lines.some((l) => l.includes('9:41')));
  check('a label merely containing AM is kept', lines.some((l) => l.startsWith('- "TEAM STANDUP"')));
}
{
  const lines = formatUIElements(tree(
    node({ label: 'Delete', elementType: 9, frame: { X: 300, Y: 200, Width: 60, Height: 40 } }),
    node({ label: 'Delete', elementType: 9, frame: { X: 300, Y: 400, Width: 60, Height: 40 } }),
  ), W, H);
  check('two elements with one label at two places are both listed', lines.length === 2, lines.join('\n'));
}

console.log('only what is on screen, and every field:');
{
  const lines = formatUIElements(tree(
    node({ label: 'Clock', elementType: 9, frame: { X: 0, Y: 0, Width: 0, Height: 0 } }),
    node({ label: 'Mail', elementType: 9, frame: { X: 450, Y: 300, Width: 60, Height: 60 } }),
    node({ label: '', value: null, placeholderValue: 'Label', elementType: 49, frame: { X: 20, Y: 400, Width: 362, Height: 44 } }),
    node({ label: 'Save', elementType: 9 }),
  ), W, H);
  check('an icon with a zero-size frame (another home-screen page) is left out', !lines.some((l) => l.includes('"Clock"')), lines.join('\n'));
  check('an element whose centre is off the screen is left out', !lines.some((l) => l.includes('"Mail"')));
  check('an empty unlabelled field is listed by its placeholder', lines.some((l) => l.startsWith('- text field "Label" (empty) at')), lines.join('\n'));
  check('ordinary elements are still there', lines.some((l) => l.startsWith('- "Save"')));
}
{
  const h = tree(
    node({ label: 'Label', elementType: 48, frame: { X: 20, Y: 380, Width: 60, Height: 20 } }),
    node({ label: '', placeholderValue: 'Label', elementType: 49, frame: { X: 20, Y: 404, Width: 362, Height: 44 } }),
    node({ label: '', placeholderValue: 'Search', elementType: 45, frame: { X: 20, Y: 100, Width: 362, Height: 36 } }),
  );
  check('a tool naming a label finds the labelled element first', findElement(h, 'Label').elementType === 48);
  check('a tool naming a placeholder finds the field', findElement(h, 'Search').elementType === 45);
  check('nothing matches, nothing is found', findElement(h, 'Nope') === null);
  check('a tool that types gets the field, not the heading with the same text', findElement(h, 'Label', { editable: true }).elementType === 49);
}

console.log('how one element reads:');
check('a labelled switch shows its state', describeElement({ label: 'Wi-Fi', value: '1', elementType: 40 }) === '"Wi-Fi" = "1"');
check('a value equal to the label is not repeated', describeElement({ label: 'Search', value: 'Search', elementType: 45 }) === '"Search"');
check('static text with a value shows only its label', describeElement({ label: 'Total', value: '$12', elementType: 48 }) === '"Total"');
check('an unlabelled element with no value is skipped', describeElement({ label: '', value: null, elementType: 1 }) === null);
check('an unlabelled value of an unknown kind is skipped', describeElement({ label: '', value: 'x', elementType: 1 }) === null);
check('a very long value is clipped', describeElement({ label: '', value: 'a'.repeat(500), elementType: 52 }).length < 110);

console.log('the screen signature for the no-progress stop:');
{
  const before = formatUIElements(ADD_ALARM, W, H);
  const after = before.map((l) => l.replace('"38 minutes"', '"45 minutes"'));
  check('turning a picker wheel changes the signature (it is progress)', screenSignature(before) !== screenSignature(after));
  check('the same screen gives the same signature', screenSignature(before) === screenSignature(formatUIElements(ADD_ALARM, W, H)));
  const moved = before.map((l) => l.replace(/ at \(\d+%, \d+%\)/, ' at (1%, 1%)'));
  check('positions are not part of it', screenSignature(before) === screenSignature(moved));
  check('the "more elements not shown" line is not part of it', screenSignature([...before, '(… 3 more elements not shown — scroll …)']) === screenSignature(before));
}

console.log(fail ? `\n❌ ${fail} FAILED, ${pass} passed` : `\n✅ ALL PASS: ${pass} passed, 0 failed`);
if (fail) process.exit(1);
