// Startup smoke test for agent.mjs — the "does the harness even boot?" guard.
//
// Motivated 2026-08-04: the D4 tools.mjs extraction shipped a temporal-dead-zone
// ReferenceError (`pendingMemories` used at the createToolExecutor ctx before its
// declaration ~400 lines later). EVERY `node agent.mjs` run crashed at startup for
// two days while `npm test` stayed green — the unit suites import the extracted
// modules but never boot agent.mjs itself. This test closes that class of bug:
// it spawns the real agent.mjs against a stub XCTest runner (no device, no LLM)
// and asserts the loop reaches "--- Step 1" — i.e. ALL top-level setup code
// (arg parsing, app detection, driver probe, tool executor, LLM client, memory,
// system prompt, initial screenshot) executed without throwing.
//
// The child is killed the moment Step 1 prints, BEFORE the first LLM call, so
// the test needs no API key and makes no network requests beyond localhost.
// Uses --phone + --driver-port so every device interaction goes through the
// stub (the simulator path would need a booted sim for simctl screenshots).
//
// Needs agent.mjs's npm deps (dotenv/sharp) → SKIPPED when node_modules is
// absent, same contract as the spawn layer of agent-cli.test.mjs.
import { spawn } from 'child_process';
import { createServer } from 'http';
import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}

if (!existsSync(join(ROOT, 'node_modules'))) {
  console.log('agent.mjs startup smoke: SKIPPED (node_modules absent — device-free CI)');
  process.exit(0);
}

// 1x1 transparent PNG — a real decodable image so sharp's metadata/resize
// pipeline runs for real instead of being error-swallowed.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// Minimal-but-realistic view hierarchy: one labeled element with a frame, so
// the element-bundling path exercises its JSON branch end to end.
const HIERARCHY = JSON.stringify({
  axElement: {
    label: '', frame: { X: 0, Y: 0, Width: 393, Height: 852 },
    children: [{ label: 'Settings', frame: { X: 10, Y: 100, Width: 60, Height: 60 }, children: [] }],
  },
});

// Stub XCTest runner: the four endpoints agent.mjs touches before Step 1.
const stub = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/deviceInfo') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ widthPoints: 393, heightPoints: 852, widthPixels: 1179, heightPixels: 2556 }));
  } else if (req.method === 'GET' && req.url === '/screenshot') {
    res.setHeader('Content-Type', 'image/png');
    res.end(PNG_1X1);
  } else if (req.url === '/viewHierarchy') {
    req.resume();
    req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(HIERARCHY); });
  } else {
    // pressKey / touch / anything else the setup path fires: accept silently.
    req.resume();
    req.on('end', () => { res.end('{}'); });
  }
});

console.log('agent.mjs startup smoke (stub runner, no LLM):');
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
const port = stub.address().port;

const result = await new Promise((resolve) => {
  const child = spawn('node', [
    'agent/agent.mjs', 'smoke-test: do nothing',
    '--phone', '--driver-port', String(port),
    '--provider', 'local', '--max-steps', '1',
    '--runtime-guard', 'off',
  ], { cwd: ROOT, env: { ...process.env, PHONE_CONTROL_STATE_DIR: mkdtempSync(join(tmpdir(), 'agent-smoke-')) } });

  let out = '';
  let settled = false;
  const finish = (verdict) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    child.kill('SIGKILL');
    resolve({ verdict, out });
  };
  // Generous ceiling: pymobiledevice3 discovery can take a few seconds when a
  // phone is attached; everything else is local. A healthy boot is < 15 s.
  const timer = setTimeout(() => finish('timeout'), 60000);

  const onData = (d) => {
    out += d.toString();
    if (out.includes('--- Step 1')) finish('booted');
    // A crash prints a stack trace and exits before Step 1.
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', () => finish('exited-early'));
});

stub.close();

check('agent.mjs boots to Step 1 against the stub runner', result.verdict === 'booted',
  result.verdict === 'timeout'
    ? 'timed out after 60s'
    : `exited before Step 1 — last output:\n${result.out.split('\n').slice(-15).join('\n')}`);
check('startup produced no ReferenceError/TypeError',
  !/ReferenceError|TypeError|SyntaxError/.test(result.out),
  (result.out.match(/(ReferenceError|TypeError|SyntaxError)[^\n]*/) || [''])[0]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
