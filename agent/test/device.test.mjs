// device.test.mjs — what the runner client sends, against a local stand-in.
// e2e/tools-on-simulator.mjs checks the same things against the real runner.

import { startFakeRunner } from './rig/fake-runner.mjs';
import { createDevice, parseSimctlApps } from '../device.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}

const runner = await startFakeRunner();
const device = createDevice({ host: '127.0.0.1', port: runner.port, knownApps: ['com.apple.mobiletimer', 'com.apple.Maps'] });

console.log('the runner client:');
await device.keyboardVisible();
const first = runner.callsTo('/keyboard')[0].body.appIds;
// The runner's /keyboard asks the first FOREGROUND app of this list; with
// only the home screen in it, it always answered "no keyboard".
check('the keyboard check offers every installed app, home screen last', first.join() === 'com.apple.mobiletimer,com.apple.Maps,com.apple.springboard', first.join());
await device.launchApp('com.example.game');
await device.keyboardVisible();
const second = runner.callsTo('/keyboard')[1].body.appIds;
check('the app opened last is offered first', second[0] === 'com.example.game' && second.at(-1) === 'com.apple.springboard', second.join());
await device.tap(201, 437);
check('a tap is sent in points', runner.callsTo('/touch')[0].body.x === 201 && runner.callsTo('/touch')[0].body.y === 437);
await device.swipe(1, 2, 3, 4);
check('a swipe uses swipeV2 (orientation-aware)', runner.callsTo('/swipeV2').length === 1);
runner.kill();
let threw = false;
try { await device.tap(1, 1); } catch { threw = true; }
check('a runner that fails makes the call throw (the loop counts these)', threw);
await runner.close();

console.log('installed apps on a simulator:');
const apps = parseSimctlApps(`
    "com.iosworld.benchmark.clock" = {
        CFBundleDisplayName = Clock;
        CFBundleIdentifier = "com.iosworld.benchmark.clock";
    };
    "com.apple.Preferences" = {
        CFBundleDisplayName = Settings;
        CFBundleIdentifier = "com.apple.Preferences";
    };`);
check('display name → bundle ID', apps.Clock === 'com.iosworld.benchmark.clock' && apps.Settings === 'com.apple.Preferences', JSON.stringify(apps));

console.log(fail ? `\n❌ ${fail} FAILED, ${pass} passed` : `\n✅ ALL PASS: ${pass} passed, 0 failed`);
if (fail) process.exit(1);
