#!/usr/bin/env node
// simulated.test.mjs — the whole path, with only the phone and the model faked.
//
//   npm run test:e2e
//
//   assistant ──HTTP──▶ server/src/server.mjs      (the real program, started the
//                          │                         way systemd starts it)
//                          ├─▶ device/supervisor.mjs (real; one command per call)
//                          │        └─▶ simulated phone (device/test/sim)
//                          └─▶ agent/agent.mjs       (a stand-in: see STUB_AGENT)
//
// It signs in the way an assistant does (client registration, consent with a
// connect code, PKCE token exchange), then uses the tools over MCP and checks
// what happened ON THE PHONE: that asking about the phone never touches it,
// that a task starts automation, runs, hands the screen back and puts
// automation down, and that a stopped or impossible task leaves nothing
// running.
//
// The stand-in agent is the one piece that is not the real thing — it makes no
// model calls. It does talk to the phone's runner, so a task only "succeeds"
// here if automation was really up when the agent started.

import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

import { createHarness, waitFor, sleep } from '../device/test/sim/harness.mjs';
import { run as phonectl } from '../server/bin/phonectl.mjs';
import { fingerprint, serverFiles, deviceFiles } from '../server/src/version.mjs';
import { loadDevices, saveDevices } from '../server/src/devices.mjs';

const execFileP = promisify(execFile);
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const EMAIL = 'ana@example.com';

// What the server starts in place of agent/agent.mjs. Same command line, same
// events (agent/protocol.mjs; server/src/agent-runner.mjs parses them).
const STUB_AGENT = `
const argv = process.argv.slice(2);
const flag = (n) => argv[argv.indexOf(n) + 1];
const task = argv[0];
const emit = (type, data = {}) => console.log('@agent-event ' + JSON.stringify({ type, ...data }));
const base = 'http://' + flag('--driver-host') + ':' + flag('--driver-port');
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const info = await fetch(base + '/deviceInfo').catch((e) => ({ ok: false, statusText: e.message }));
if (!info.ok) { emit('infra', { detail: 'the runner did not answer: ' + info.statusText }); process.exit(43); }
emit('step', { step: 1, total: Number(flag('--max-steps')), elapsed: '0.1' });
emit('action', { tool: 'openApp', args: { appName: 'Settings' } });
await post('/launchApp', { bundleId: 'com.apple.Preferences' });
if (/slowly/.test(task)) await new Promise((r) => setTimeout(r, 120000));
emit('done', { summary: 'Opened Settings. model=' + flag('--model') + ' provider=' + flag('--provider') });
`;

let passed = 0; let failed = 0;
async function ok(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed += 1; console.log(`  ✓ ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`); } catch (e) {
    failed += 1; console.log(`  ✗ ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)\n      ${String(e.message).split('\n').join('\n      ')}`);
  }
}

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

// ─── the world: one simulated phone, one registered person, one server ───────

const h = await createHarness({ graceMs: 6000 });
const A = h.phoneA;
const dir = mkdtempSync(join(tmpdir(), 'phone-control-e2e-'));
const paths = { devicesPath: join(dir, 'etc', 'devices.json'), storePath: join(dir, 'etc', 'connector.json') };
const stubRoot = join(dir, 'stub');
mkdirSync(join(stubRoot, 'agent'), { recursive: true });
writeFileSync(join(stubRoot, 'agent', 'agent.mjs'), STUB_AGENT);

phonectl(['device', 'add', '--email', EMAIL, '--address', A.ip, '--udid', '00008130-000A1B2C3D4E5F60'], paths);
// The simulated phone's UDID starts with "SIM" on purpose — it is what keeps the
// supervisor's process patterns from ever matching a real session — and
// phonectl rightly refuses it as a real UDID. So it is written in afterwards.
const setUdid = (udid) => {
  const registry = loadDevices(paths.devicesPath);
  registry.devices[0].udid = udid;
  saveDevices(registry, paths.devicesPath);
};
setUdid(A.udid);

const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;
let serverOutput = '';
const server = spawn(process.execPath, [join(REPO, 'server', 'src', 'server.mjs')], {
  env: {
    ...h.env,                                  // the supervisor's seams: fake go-ios, tunnel helper, ip, tailscale
    CONNECTOR_PUBLIC_URL: BASE,
    CONNECTOR_PORT: String(port),
    CONNECTOR_ALLOW_HTTP: '1',
    CONNECTOR_STORE: paths.storePath,
    CONNECTOR_DEVICES: paths.devicesPath,
    CONNECTOR_RUNNER_PORT: String(h.runnerPort),
    CONNECTOR_AGENT_ROOT: stubRoot,
    PHONE_CONTROL_STATE_DIR: join(dir, 'var'),
    OPENAI_API_KEY: 'test-not-a-real-key',
    ANTHROPIC_API_KEY: 'test-not-a-real-key',
    GEMINI_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => { serverOutput += d; });
server.stderr.on('data', (d) => { serverOutput += d; });

const get = (p, opts = {}) => fetch(BASE + p, { redirect: 'manual', ...opts });
const postJSON = (p, body, headers = {}) => get(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const postForm = (p, form) => get(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });

let token = '';
let rpcId = 0;
/** One MCP tool call, as an assistant makes it. Returns the tool's JSON answer. */
async function tool(name, args = {}) {
  const res = await postJSON('/mcp', { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }, { authorization: `Bearer ${token}` });
  assert.equal(res.status, 200, `tools/call ${name} → HTTP ${res.status}`);
  const body = await res.json();
  assert.ok(body.result, `tools/call ${name} → ${JSON.stringify(body.error)}`);
  return JSON.parse(body.result.content[0].text);
}
const FINAL = ['completed', 'failed', 'stopped'];
/** Poll the way the tool description tells an assistant to: back to back. */
async function untilFinal(runId, timeoutMs = 90000) {
  const t0 = Date.now();
  for (;;) {
    const s = await tool('get_run_status', { run_id: runId });
    if (FINAL.includes(s.status)) return s;
    if (Date.now() - t0 > timeoutMs) throw new Error(`run still ${s.status} after ${timeoutMs}ms: ${JSON.stringify(s)}`);
  }
}
const nothingRunning = async () => (await h.runnerAnswers(A)) === false && (await h.anchorPids(A)).length === 0;

console.log(`whole path, simulated phone — ${process.platform}`);

try {
  await waitFor(async () => { try { return (await get('/healthz')).ok; } catch { return false; } }, 'the server to listen', 15000);

  await ok('the server starts from its real entry point and reports the code it is running', async () => {
    const { version, service } = await (await get('/healthz')).json();
    assert.equal(service, 'phone-control');
    assert.equal(version.server, fingerprint(serverFiles(REPO)));
    assert.equal(version.device, fingerprint(deviceFiles(REPO)));
    assert.equal(version.stale, false);
    assert.match(version.agent, /^[0-9a-f]{12}$/);
  });

  await ok('check-deployed agrees about server and device, and notices the agent is different', async () => {
    const r = await execFileP(process.execPath, [join(REPO, 'scripts', 'check-deployed.mjs'), BASE]).then(
      (x) => ({ code: 0, out: x.stdout }), (e) => ({ code: e.code, out: String(e.stdout) }));
    assert.match(r.out, /✓ server /);
    assert.match(r.out, /✓ device /);
    assert.match(r.out, /✗ agent .*DIFFERENT/);        // this server was pointed at the stand-in agent
    assert.equal(r.code, 1);
  });

  await ok('nothing works without signing in', async () => {
    const res = await postJSON('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate') || '', /resource_metadata=/);
  });

  await ok('an assistant signs in: registers itself, the person enters a connect code, a token comes back', async () => {
    const reg = await (await postJSON('/oauth/register', { client_name: 'Claude', redirect_uris: [REDIRECT] })).json();
    const code = phonectl(['link-code', '--email', EMAIL], paths)[0].replace('Connect code: ', '');
    const verifier = randomBytes(32).toString('base64url');
    const params = {
      client_id: reg.client_id, redirect_uri: REDIRECT, state: 's', response_type: 'code',
      code_challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url'), code_challenge_method: 'S256',
    };
    const redirected = await postForm('/oauth/authorize', { ...params, link_code: code });
    assert.equal(redirected.status, 302);
    const issued = new URL(redirected.headers.get('location')).searchParams.get('code');
    const doc = await (await postForm('/oauth/token', { grant_type: 'authorization_code', code: issued, client_id: reg.client_id, code_verifier: verifier, redirect_uri: REDIRECT })).json();
    token = doc.access_token;
    assert.ok(token, JSON.stringify(doc));
  });

  await ok('asking about the phone only LOOKS: no tunnel, no session, nothing on the screen', async () => {
    const before = A.snapshot();
    const s = await tool('get_phone_status');
    assert.equal(s.state, 'standby', JSON.stringify(s));
    assert.equal(s.ready, true);
    assert.equal(s.automation_running, false);
    assert.equal(s.default_model, 'gpt-6-luna');
    assert.deepEqual(A.snapshot(), before, 'a status question touched the phone');
    assert.equal(await nothingRunning(), true);
  });

  let firstTunnel;
  await ok('a task: automation starts, the agent runs, the answer comes back, the screen is handed back, automation is put down', async () => {
    const started = await tool('run_phone_task', { task: 'open Settings' });
    assert.ok(started.run_id, JSON.stringify(started));
    const done = await untilFinal(started.run_id);
    assert.equal(done.status, 'completed', JSON.stringify(done));
    assert.match(done.summary, /Opened Settings\. model=gpt-6-luna provider=openai/);
    assert.equal(A.counters.runnerStarts, 1, 'automation was not started exactly once');
    await waitFor(nothingRunning, 'automation to be put down after the task', 20000);
    assert.equal(A.foregroundApp, 'com.anthropic.claude', 'the assistant\'s app was not brought back to the front');
    [firstTunnel] = await h.tunnelPids(A);
    assert.ok(firstTunnel, 'the tunnel was not kept warm for the next task');
  });

  await ok('a second task, on cellular, with a model named for this run: reuses the warm tunnel', async () => {
    await A.setWifi(false);
    const before = A.snapshot();
    const done = await untilFinal((await tool('run_phone_task', { task: 'open Settings', model: 'sonnet', when_done: 'stay' })).run_id);
    assert.equal(done.status, 'completed', JSON.stringify(done));
    assert.match(done.summary, /model=claude-sonnet-5-5 provider=anthropic/);
    assert.equal(A.counters.hellos, before.hellos, 'a new tunnel was built on cellular (impossible on a real phone)');
    assert.deepEqual(await h.tunnelPids(A), [firstTunnel]);
    await waitFor(nothingRunning, 'automation to be put down after the task', 20000);
    assert.equal(A.foregroundApp, 'com.apple.Preferences', 'when_done: "stay" did not leave the phone where the task ended');
    await A.setWifi(true);
  });

  await ok('stop: the task ends and automation is put down', async () => {
    const { run_id: runId } = await tool('run_phone_task', { task: 'open Settings slowly' });
    await waitFor(async () => (await tool('get_run_status', { run_id: runId })).status === 'running' && h.runnerAnswers(A), 'the task to be running', 30000);
    const stopped = await tool('stop_run', { run_id: runId });
    assert.equal(stopped.ok, true, JSON.stringify(stopped));
    assert.equal((await untilFinal(runId)).status, 'stopped');
    await waitFor(nothingRunning, 'automation to be put down after a stop', 20000);
  });

  await ok('a model whose key the server does not have is refused before the phone is touched', async () => {
    const before = A.snapshot();
    const r = await tool('run_phone_task', { task: 'open Settings', model: 'gemini' });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(JSON.stringify(r), /GEMINI_API_KEY|key/i);
    assert.deepEqual(A.snapshot(), before);
  });

  await ok('a locked phone: the task fails with what the person has to do, and nothing is left running', async () => {
    A.lock();
    const done = await untilFinal((await tool('run_phone_task', { task: 'open Settings' })).run_id, 120000);
    assert.equal(done.status, 'failed', JSON.stringify(done));
    assert.match(done.summary, /unlock|needs you|locked/i);
    await waitFor(nothingRunning, 'nothing to be left running', 20000);
    await A.unlock();
  });

  await ok('a phone that was never paired with the server: said at once, a task is refused, the phone is not touched', async () => {
    await h.reset();                 // nothing warm: the phone as it is before anything was ever started
    h.setPaired(A.udid, false);
    const before = A.snapshot();
    const s = await tool('get_phone_status');
    assert.equal(s.state, 'needs_setup', JSON.stringify(s));
    assert.match(s.message, /not been paired with the server/);
    const r = await tool('run_phone_task', { task: 'open Settings' });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.error, 'needs_setup');
    assert.deepEqual(A.snapshot(), before);
    h.setPaired(A.udid, true);
  });

  await ok('a phone that refuses the server: the task fails in seconds with the reason, not after minutes of retries', async () => {
    setUdid('SIM0E000-0000000000000E55');                  // an identity the phone was never paired with
    h.setPaired('SIM0E000-0000000000000E55', true);
    const before = A.snapshot();
    const t0 = Date.now();
    const done = await untilFinal((await tool('run_phone_task', { task: 'open Settings' })).run_id, 120000);
    assert.equal(done.status, 'failed', JSON.stringify(done));
    assert.match(done.summary, /would not accept the server's connection/);
    assert.ok(Date.now() - t0 < 45000, `took ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    assert.ok(A.counters.deniedHellos - before.deniedHellos <= 3, `${A.counters.deniedHellos - before.deniedHellos} handshakes were attempted`);
    assert.equal(A.counters.runnerStarts, before.runnerStarts);
    setUdid(A.udid);
  });

  await ok('the server kept a log of what it did', async () => {
    const log = readFileSync(join(dir, 'var', 'logs', 'server.log'), 'utf8');
    assert.match(log, /run_phone_task|run [a-z0-9_]+/i);
  });
} finally {
  server.kill('SIGTERM');
  await sleep(300);
  const { kept } = await h.close({ failed: failed > 0 });
  if (failed) console.log(`\n--- server output ---\n${serverOutput.split('\n').slice(-60).join('\n')}\n(simulator sandbox kept: ${kept}; server files: ${dir})`);
  else rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed · ${failed} failed`);
process.exit(failed ? 1 : 0);
