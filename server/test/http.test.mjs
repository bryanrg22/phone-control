#!/usr/bin/env node
// http.test.mjs — end-to-end tests of the connector's HTTP surface
// against a real listening server on 127.0.0.1, with the phone and the agent
// stubbed out.
//
// What this actually proves: a client can discover the auth server, register
// itself, walk a consumer through consent with a link code, exchange the code
// for a credential, and then drive the tools over MCP and REST — and that every
// door is shut to an unauthenticated caller, to a DEVICE credential, and to
// another tenant.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import { createConnectorApp, allowedHostCheck } from '../src/server.mjs';
import { request as httpRequest } from 'node:http';
import { createRunStore } from '../src/runs.mjs';
import { createToolApi } from '../src/tool-api.mjs';
import { createMcpHandler } from '../src/mcp.mjs';
import { loadStore, createLinkCode, saveStore } from '../src/auth.mjs';

let passed = 0;
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; });
}

const dir = mkdtempSync(join(tmpdir(), 'connector-server-test-'));
const storePath = join(dir, 'connector.json');
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const store = createRunStore({});
const devices = {
  status: async () => ({ ready: true, state: 'ready', address: '100.64.0.11', udid: 'U', message: 'The phone is connected and ready.' }),
};
const started = [];
const api = createToolApi({ statusWaitMs: 0, store, devices, startRun: ({ run }) => { started.push(run.id); } });
const mcp = createMcpHandler({ api });

const app = createConnectorApp({
  publicUrl: 'https://agent.example.com/',
  storePath, api, mcp, store,
  allowUrlTokens: false,
  // Stands in for whatever a future onboarding app proves its identity with.
  linkAuth: async (body) => (body?.proof === 'good-token'
    ? { uid: 'uid-alice', email: 'alice@example.com' }
    : null),
});

const server = createServer(app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const get = (p, opts = {}) => fetch(BASE + p, { redirect: 'manual', ...opts });
const postJSON = (p, body, headers = {}) => get(p, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const postForm = (p, form) => get(p, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(),
});
const rpc = (msg, token) => postJSON('/mcp', msg, token ? { authorization: `Bearer ${token}` } : {});

// ─── discovery ───────────────────────────────────────────────────────────────

/** A request with a Host header of our choosing (fetch forbids setting Host). */
function rawGet(path, host, origin) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const r = httpRequest({ host: u.hostname, port: u.port, path, method: 'GET', headers: { host, ...(origin ? { origin } : {}) } }, (res) => {
      let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    r.on('error', reject); r.end();
  });
}

await ok('DNS rebinding: a request naming another host is refused, before anything else runs', async () => {
  const evil = await rawGet('/healthz', 'evil.example.com', 'http://evil.example.com');
  assert.equal(evil.status, 403);
  assert.equal(JSON.parse(evil.body).error, 'forbidden_host');
  assert.equal((await rawGet('/mcp', 'evil.example.com:443')).status, 403);
});

await ok('DNS rebinding: our own public name and loopback are served', async () => {
  for (const host of ['agent.example.com', 'agent.example.com:443', 'AGENT.example.com', 'localhost', '127.0.0.1:8788', '[::1]:3000']) {
    assert.equal((await rawGet('/healthz', host)).status, 200, `refused ${host}`);
  }
});

await ok('the host check rejects look-alikes and malformed headers', () => {
  const allowed = allowedHostCheck('https://agent.example.com');
  for (const bad of ['agent.example.com.evil.com', 'evil.agent.example.com', 'agent.example.com:8443', 'user@agent.example.com', 'agent.example.com/x', '', undefined, '127.0.0.1.evil.com']) {
    assert.equal(allowed(bad), false, `accepted ${bad}`);
  }
  const withPort = allowedHostCheck('http://127.0.0.1:9999');
  assert.equal(withPort('127.0.0.1:9999'), true);
  assert.equal(allowedHostCheck('https://pc.example.ts.net')('pc.example.ts.net'), true);
});

await ok('healthz answers without credentials', async () => {
  const res = await get('/healthz');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

await ok('protected-resource metadata points at our authorization server', async () => {
  const res = await get('/.well-known/oauth-protected-resource');
  const doc = await res.json();
  assert.equal(doc.resource, 'https://agent.example.com/mcp');
  assert.deepEqual(doc.authorization_servers, ['https://agent.example.com']);
});

await ok('discovery answers at BOTH the root and the RFC 9728 path-inserted form', async () => {
  // A client that probes /.well-known/oauth-protected-resource/mcp must not be
  // met with a 404 — that failure looks like "the connector is broken" at the
  // very first step of adding it.
  for (const p of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server/mcp', '/.well-known/openid-configuration']) {
    const res = await get(p);
    assert.equal(res.status, 200, `${p} did not answer`);
  }
  assert.equal((await (await get('/.well-known/oauth-protected-resource/mcp')).json()).resource, 'https://agent.example.com/mcp');
});

await ok('authorization-server metadata advertises PKCE S256 only', async () => {
  const doc = await (await get('/.well-known/oauth-authorization-server')).json();
  assert.deepEqual(doc.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(doc.grant_types_supported, ['authorization_code']);
  assert.equal(doc.registration_endpoint, 'https://agent.example.com/oauth/register');
});

// ─── the closed doors ────────────────────────────────────────────────────────

await ok('an unauthenticated MCP call is 401 with the metadata pointer clients need', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate') || '', /resource_metadata="https:\/\/agent\.example\.com/);
});

await ok('a made-up token is refused', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'iac_totally-made-up-token-value-x');
  assert.equal(res.status, 401);
});

await ok('GET /mcp is 405 — this server has no SSE stream to open', async () => {
  const res = await get('/mcp');
  assert.equal(res.status, 405);
  assert.match(res.headers.get('allow') || '', /POST/);
});

await ok('the URL-token path stays closed unless it is explicitly enabled', async () => {
  const res = await postJSON('/mcp/k/some-token-value-long-enough-x', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(res.status, 404);
});

// ─── registration + consent ──────────────────────────────────────────────────

let clientId;
await ok('dynamic client registration issues a public client id', async () => {
  const res = await postJSON('/oauth/register', { client_name: 'Claude', redirect_uris: [REDIRECT] });
  assert.equal(res.status, 201);
  const doc = await res.json();
  clientId = doc.client_id;
  assert.match(clientId, /^cli_/);
  assert.equal(doc.token_endpoint_auth_method, 'none');
});

await ok('registration refuses a non-https redirect', async () => {
  const res = await postJSON('/oauth/register', { client_name: 'Evil', redirect_uris: ['http://evil.example/cb'] });
  assert.equal(res.status, 400);
});

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
const authorizeParams = () => ({
  client_id: clientId, redirect_uri: REDIRECT, state: 'st4te',
  code_challenge: challenge, code_challenge_method: 'S256', response_type: 'code',
});

await ok('the consent page names the client and asks for the app\'s code', async () => {
  const res = await get(`/oauth/authorize?${new URLSearchParams(authorizeParams())}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Claude/);
  assert.match(html, /link_code/);
  assert.match(html, /cannot pair new devices/i, 'the consent page must state the limits of the grant');
});

await ok('authorize refuses an unregistered client, a mismatched redirect, and non-S256', async () => {
  const unknown = await get(`/oauth/authorize?${new URLSearchParams({ ...authorizeParams(), client_id: 'cli_nope' })}`);
  assert.equal(unknown.status, 400);
  const badRedirect = await get(`/oauth/authorize?${new URLSearchParams({ ...authorizeParams(), redirect_uri: 'https://evil.example/cb' })}`);
  assert.equal(badRedirect.status, 400);
  const plain = await get(`/oauth/authorize?${new URLSearchParams({ ...authorizeParams(), code_challenge_method: 'plain' })}`);
  assert.equal(plain.status, 400);
});

// ─── the onboarding hook mints the link code ─────────────────────────────────

let linkCode;
await ok('the app exchanges a signed-in identity for a link code; a bad token gets nothing', async () => {
  assert.equal((await postJSON('/link/code', { proof: 'nope' })).status, 401);
  const res = await postJSON('/link/code', { proof: 'good-token' });
  assert.equal(res.status, 200);
  const doc = await res.json();
  linkCode = doc.code;
  assert.match(linkCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(doc.connectUrl, 'https://agent.example.com/mcp');
});

await ok('a wrong link code re-renders the form instead of granting anything', async () => {
  const res = await postForm('/oauth/authorize', { ...authorizeParams(), link_code: 'ZZZZ-ZZZZ' });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /not valid any more/i);
});

let authCode;
await ok('the right link code redirects back with a code and the state intact', async () => {
  const res = await postForm('/oauth/authorize', { ...authorizeParams(), link_code: linkCode });
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('location'));
  assert.equal(to.origin + to.pathname, REDIRECT);
  assert.equal(to.searchParams.get('state'), 'st4te');
  authCode = to.searchParams.get('code');
  assert.ok(authCode);
});

let accessToken;
await ok('the token endpoint exchanges code + verifier for a credential', async () => {
  const res = await postForm('/oauth/token', {
    grant_type: 'authorization_code', code: authCode, client_id: clientId,
    code_verifier: verifier, redirect_uri: REDIRECT,
  });
  assert.equal(res.status, 200);
  const doc = await res.json();
  accessToken = doc.access_token;
  assert.match(accessToken, /^iac_/);
  assert.equal(doc.token_type, 'Bearer');
});

await ok('replaying the authorization code fails AND kills the credential it issued', async () => {
  const res = await postForm('/oauth/token', {
    grant_type: 'authorization_code', code: authCode, client_id: clientId,
    code_verifier: verifier, redirect_uri: REDIRECT,
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_grant');
  const afterReplay = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, accessToken);
  assert.equal(afterReplay.status, 401, 'the replayed grant left a live credential behind');
});

await ok('an unsupported grant type is refused', async () => {
  const res = await postForm('/oauth/token', { grant_type: 'client_credentials' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'unsupported_grant_type');
});

// A fresh, live credential for the rest of the suite (the one above is now
// revoked on purpose).
async function freshCredential(uid, email) {
  const db = loadStore(storePath);
  const { code } = createLinkCode(db, { uid, email });
  saveStore(db, storePath);
  const v = randomBytes(32).toString('base64url');
  const c = createHash('sha256').update(v, 'ascii').digest('base64url');
  const params = { client_id: clientId, redirect_uri: REDIRECT, state: 's', code_challenge: c, code_challenge_method: 'S256', response_type: 'code' };
  const redirected = await postForm('/oauth/authorize', { ...params, link_code: code });
  const issued = new URL(redirected.headers.get('location')).searchParams.get('code');
  const res = await postForm('/oauth/token', {
    grant_type: 'authorization_code', code: issued, client_id: clientId, code_verifier: v, redirect_uri: REDIRECT,
  });
  return (await res.json()).access_token;
}

const aliceToken = await freshCredential('uid-alice', 'alice@example.com');
const bobToken = await freshCredential('uid-bob', 'bob@example.com');

// ─── driving the tools ───────────────────────────────────────────────────────

await ok('initialize + tools/list work over MCP with a real credential', async () => {
  const init = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, aliceToken)).json();
  assert.equal(init.result.protocolVersion, '2025-06-18');
  const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, aliceToken)).json();
  assert.deepEqual(list.result.tools.map((t) => t.name).sort(),
    ['answer_question', 'get_phone_status', 'get_run_status', 'run_phone_task', 'stop_run']);
});

await ok('a notification over HTTP gets 202 with no body', async () => {
  const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, aliceToken);
  assert.equal(res.status, 202);
  assert.equal(await res.text(), '');
});

let aliceRunId;
await ok('a task started over MCP actually reaches the runner', async () => {
  const res = await (await rpc({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'run_phone_task', arguments: { task: 'open LinkedIn and finish the puzzle' } },
  }, aliceToken)).json();
  const payload = JSON.parse(res.result.content[0].text);
  assert.equal(payload.ok, true);
  aliceRunId = payload.run_id;
  assert.equal(started.at(-1), aliceRunId, 'the agent was not started for this run');
});

await ok('a question raised mid-run comes back through get_run_status and is answerable', async () => {
  const delivered = [];
  store._raw(aliceRunId).answerSink = (c) => delivered.push(c);
  store.ask(aliceRunId, { question: 'Which puzzle?', options: ['Queens', 'Tango'] });

  const status = JSON.parse((await (await rpc({
    jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_run_status', arguments: {} },
  }, aliceToken)).json()).result.content[0].text);
  assert.equal(status.status, 'awaiting_answer');
  assert.equal(status.question, 'Which puzzle?');

  const answered = JSON.parse((await (await rpc({
    jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'answer_question', arguments: { answer: 'Queens' } },
  }, aliceToken)).json()).result.content[0].text);
  assert.equal(answered.ok, true);
  assert.deepEqual(delivered, ['Queens']);
});

await ok('another tenant cannot see or stop that run, by id', async () => {
  const seen = JSON.parse((await (await rpc({
    jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_run_status', arguments: { run_id: aliceRunId } },
  }, bobToken)).json()).result.content[0].text);
  assert.equal(seen.error, 'no_such_run');
  const stopped = JSON.parse((await (await rpc({
    jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'stop_run', arguments: { run_id: aliceRunId } },
  }, bobToken)).json()).result.content[0].text);
  assert.equal(stopped.error, 'no_such_run');
  assert.equal(store.get(aliceRunId, 'uid-alice').status, 'running');
});

// ─── the REST framing of the same tools ──────────────────────────────────────

await ok('REST /v1/phone reports readiness', async () => {
  const res = await get('/v1/phone', { headers: { authorization: `Bearer ${bobToken}` } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ready, true);
});

await ok('REST start → status → stop round-trips for a second tenant', async () => {
  const start = await (await postJSON('/v1/tasks', { task: 'check my email' }, { authorization: `Bearer ${bobToken}` })).json();
  assert.equal(start.ok, true);
  const status = await (await get(`/v1/runs/${start.run_id}`, { headers: { authorization: `Bearer ${bobToken}` } })).json();
  assert.equal(status.run_id, start.run_id);
  const stop = await (await postJSON(`/v1/runs/${start.run_id}/stop`, {}, { authorization: `Bearer ${bobToken}` })).json();
  assert.equal(stop.status, 'stopped');
});

await ok('REST rejects a bad task with 400 and a reason', async () => {
  const res = await postJSON('/v1/tasks', { task: '' }, { authorization: `Bearer ${bobToken}` });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'missing_task');
});

await ok('an unknown path is 404, not a stack trace', async () => {
  const res = await get('/v1/nope', { headers: { authorization: `Bearer ${bobToken}` } });
  assert.equal(res.status, 404);
});

// ─── revocation ──────────────────────────────────────────────────────────────

await ok('the app can disconnect every assistant, and the credential dies immediately', async () => {
  const res = await postJSON('/link/revoke', { proof: 'good-token' });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).revoked >= 1);
  const after = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, aliceToken);
  assert.equal(after.status, 401, 'a revoked credential still worked');
  // …and only that user's credentials were revoked.
  const bobStill = await get('/v1/phone', { headers: { authorization: `Bearer ${bobToken}` } });
  assert.equal(bobStill.status, 200);
});

server.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} connector-server assertions passed`);
