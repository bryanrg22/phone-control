#!/usr/bin/env node
// tools-on-simulator.mjs — every phone tool, run for real on a simulator, checked against the screen.
//
//   node e2e/tools-on-simulator.mjs --udid <simulator> [--port 22187] [--iosworld ~/dev/GitHub/iOSWorld]
//
// No model is involved: each tool is called directly (agent/tools.mjs, through
// agent/device.mjs and the same XCTest runner the phone uses) and the result is
// judged by reading the screen afterwards (the element list, agent/elements.mjs),
// never by what the tool said. A tool that reports success without the screen
// changing fails here — the class of bug hideKeyboard had.
//
// Needs the simulator prepared for the phone-agent evals (evals/phone-agent/
// prepare-simulator.sh) with the runner running (start-runner.sh). Each run
// starts from iOSWorld's reset, so the apps hold their seeded data.

import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createDevice } from '../agent/device.mjs';
import { createToolRunner } from '../agent/tools.mjs';
import { observe } from '../agent/observe.mjs';
import { formatElements } from '../agent/elements.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const udid = opt('udid', process.env.IOSWORLD_UDID);
const port = Number(opt('port', '22187'));
const iosworld = resolve(opt('iosworld', join(homedir(), 'dev', 'GitHub', 'iOSWorld')));
if (!udid) { console.error('--udid <simulator> is required'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APPS = { Clock: 'com.iosworld.benchmark.clock', Settings: 'com.apple.Preferences' };
const device = createDevice({ host: '127.0.0.1', port, knownApps: Object.values(APPS) });
const state = { keyboardUp: false };
const asked = [];
const run = createToolRunner({
  device,
  apps: APPS,
  screen: () => ({ widthPoints: 402, heightPoints: 874 }),
  protocol: { ask: async (q) => { asked.push(q); return null; } },
  state,
});
const screen = async () => formatElements(await device.hierarchy(), 402, 874);
const has = (lines, re) => lines.some((l) => re.test(l));
const value = (lines, re) => (lines.find((l) => re.test(l)) || '').match(/= "([^"]*)"/)?.[1] ?? null;
// Whether the keyboard is up, read from the screen itself (its keys are in the
// element tree), not from the runner's /keyboard route that hideKeyboard uses:
// a check must not share the sensor of the thing it checks.
const keyboardOnScreen = async () => {
  const root = JSON.parse(await device.hierarchy());
  let keys = 0;
  (function walk(n) { if (!n) return; if (n.elementType === 20 && /^[A-Z]$/.test(n.label || '') && n.frame?.Width > 0) keys += 1; (n.children || []).forEach(walk); })(root.axElement || root);
  return keys >= 10;
};

let passed = 0; let failed = 0;
async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed += 1; console.log(`  ✓ ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`); } catch (e) {
    failed += 1; console.log(`  ✗ ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)\n      ${e.message}`);
  }
}
function assert(cond, message) { if (!cond) throw new Error(message); }

// ─── start from iOSWorld's state ─────────────────────────────────────────────
console.log(`tools on the simulator ${udid} (runner :${port})`);
try { await device.info(); } catch (e) { console.error(`the runner is not answering on :${port}: ${e.message}`); process.exit(2); }
const reset = JSON.parse(execFileSync(join(iosworld, '.venv', 'bin', 'python'), [join(REPO, 'evals', 'phone-agent', 'iosworld_reset.py'), '--iosworld', iosworld, '--udid', udid], { encoding: 'utf8', timeout: 600000 }).trim().split('\n').pop());
if (!reset.ok) { console.error(`reset failed: ${reset.error}`); process.exit(2); }
console.log(`  (iOSWorld reset: ${reset.apps} apps in ${reset.seconds}s)\n`);

await check('observe: a 768-pixel-wide JPEG and an element list of the real screen', async () => {
  await device.pressButton('home'); await sleep(800);
  const o = await observe(device);
  assert(o.width === 768 && o.mime === 'image/jpeg', `image ${o.width} wide, ${o.mime}`);
  assert(o.elements.length > 5 && has(o.elements, /"Dock"/), `elements: ${o.elements.slice(0, 5).join(' | ')}`);
  assert(!o.elements.some((l) => / at \(0%, 0%\) size 0x0/.test(l)), 'icons from another home-screen page are listed');
  const again = await observe(device);
  assert(again.signature === o.signature, 'the same screen gave two different signatures');
});

await check('openApp opens the app it names', async () => {
  const r = await run('openApp', { appName: 'Clock' }); await sleep(1500);
  const s = await screen();
  // iOSWorld's seeded Clock opens on its World Clock tab.
  assert(!r.error && has(s, /^- "World Clock"/) && has(s, /^- "Tab Bar"/), `${r.text} | ${s.slice(0, 6).join(' | ')}`);
});

await check('tapText on a tab-bar item switches the tab', async () => {
  // The app labels this tab "Alarm" until it is selected, then "Alarms".
  const r = await run('tapText', { text: 'Alarm' }); await sleep(1200);
  const s = await screen();
  assert(!r.error && has(s, /^- "Morning run, Weekdays"/), `${r.text} | ${s.slice(0, 8).join(' | ')}`);
});

await check('openApp on an unknown app is an error, and the screen stays put', async () => {
  const before = await screen();
  const r = await run('openApp', { appName: 'NotAnApp' }); await sleep(500);
  assert(r.error && JSON.stringify(await screen()) === JSON.stringify(before), r.text);
});

await check('tapText taps the element it names', async () => {
  const r = await run('tapText', { text: 'Add' }); await sleep(1500);
  const s = await screen();
  assert(!r.error && has(s, /^- "Add Alarm"/) && has(s, /^- "Save"/), `${r.text} | ${s.slice(0, 6).join(' | ')}`);
});

await check('the element list shows the time picker and the empty field', async () => {
  const s = await screen();
  assert(s.filter((l) => l.startsWith('- picker wheel = ')).length === 3, `pickers: ${s.filter((l) => l.includes('picker')).join(' | ')}`);
  assert(has(s, /^- text field "Label" \(empty\) at/), `field: ${s.filter((l) => l.includes('text field')).join(' | ') || 'not listed'}`);
});

await check('swipe on a picker wheel changes its value', async () => {
  const s = await screen();
  const hour = s.find((l) => l.startsWith('- picker wheel = ')); const before = value([hour], /./);
  const [, x, y] = hour.match(/at \(([\d.]+)%, ([\d.]+)%\)/);
  const r = await run('swipe', { startX: +x, startY: +y + 4, endX: +x, endY: +y - 4 }); await sleep(1200);
  const after = value(await screen(), /^- picker wheel = /);
  assert(!r.error && after && after !== before, `hour before "${before}", after "${after}"`);
});

await check('typeAndSubmit on a field that is not there types nothing and says so', async () => {
  const r = await run('typeAndSubmit', { elementText: 'NoSuchField', text: 'zzz' }); await sleep(500);
  const s = await screen();
  assert(r.error && !s.some((l) => l.includes('zzz')), r.text);
});

await check('tapping the field by its placeholder and typing fills it, and the keyboard comes up', async () => {
  const r1 = await run('tapText', { text: 'Label' });
  // "Label" is also the heading above the field: tapText (not a typing tool)
  // may hit the heading, so focus the field through replaceText's rule instead.
  const r = await run('replaceText', { field: 'Label', value: 'Gym' }); await sleep(800);
  const s = await screen();
  assert(!r.error && value(s, /^- text field "Label"/) === 'Gym', `${r1.text} / ${r.text} | field: ${s.find((l) => l.includes('text field'))}`);
  assert(await keyboardOnScreen(), 'the keyboard is not on screen after typing');
  assert(await device.keyboardVisible(), 'the keyboard is on screen, but the runner\'s /keyboard says it is not');
});

await check('replaceText replaces what the field holds', async () => {
  const r = await run('replaceText', { field: 'Label', value: 'Run' }); await sleep(800);
  const v = value(await screen(), /^- text field "Label"/);
  assert(!r.error && v === 'Run', `${r.text} | field holds "${v}"`);
});

await check('hideKeyboard says what the screen shows', async () => {
  assert(await keyboardOnScreen(), 'precondition: the keyboard should be up before hideKeyboard');
  const r = await run('hideKeyboard', {}); await sleep(500);
  const up = await keyboardOnScreen();
  const claimsHidden = r.text.startsWith('Keyboard hidden');
  assert(claimsHidden === !up, `said "${r.text.split(':')[0]}", keyboard actually ${up ? 'up' : 'hidden'}`);
});

await check('tap at a percentage lands on the element at that position', async () => {
  await run('tapText', { text: 'Cancel' }); await sleep(1200);
  const s = await screen();
  assert(!has(s, /^- "Add Alarm"/), 'the sheet did not close on Cancel');
  const add = s.find((l) => l.startsWith('- "Add" at'));
  const [, x, y] = add.match(/at \(([\d.]+)%, ([\d.]+)%\)/);
  const r = await run('tap', { x: +x, y: +y }); await sleep(1500);
  assert(!r.error && has(await screen(), /^- "Add Alarm"/), `tapped (${x}%, ${y}%) but the sheet did not open`);
  await run('tapText', { text: 'Cancel' }); await sleep(1000);
});

await check('waitForText finds text that is there and times out on text that is not', async () => {
  const yes = await run('waitForText', { text: 'Alarms', timeoutSec: 3 });
  const no = await run('waitForText', { text: 'NoSuchText12345', timeoutSec: 2 });
  assert(/^Found/.test(yes.text) && /^TIMEOUT/.test(no.text), `${yes.text} | ${no.text}`);
});

await check('getUIElements lists the screen', async () => {
  const r = await run('getUIElements', {});
  assert(/- "Alarms" at/.test(r.text) && /- "Add" at/.test(r.text), r.text.slice(0, 200));
});

await check('scroll moves a long list', async () => {
  await run('openApp', { appName: 'Settings' }); await sleep(1500);
  // Settings is not one of iOSWorld's apps, so its reset does not touch it:
  // swipe back to the top first, so there is a list below to scroll to.
  for (let i = 0; i < 3; i++) { await run('swipe', { startX: 50, startY: 30, endX: 50, endY: 85 }); await sleep(700); }
  const before = (await screen()).slice(0, 12).join('|');
  const r = await run('scroll', {}); await sleep(1200);
  const after = (await screen()).slice(0, 12).join('|');
  assert(!r.error && after !== before, 'the visible list did not change');
});

await check('pressKey home goes to the home screen', async () => {
  const r = await run('pressKey', { key: 'home' }); await sleep(1000);
  assert(!r.error && has(await screen(), /^- "Dock"/), r.text);
});

console.log(`\n${passed} passed · ${failed} failed`);
console.log('not checked here (unit-tested only): drag, inputText alone, askUser, taskComplete/taskFailed, webSearch');
process.exit(failed ? 1 : 0);
