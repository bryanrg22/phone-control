#!/usr/bin/env node
// server.mjs — the one long-running process: the endpoint an AI assistant calls.
//
//   POST /mcp                       MCP streamable HTTP (Claude custom connector)
//   POST /mcp/k/<token>             same, token in the path (see "URL tokens" below)
//   GET  /.well-known/oauth-protected-resource   RFC 9728 — how a client discovers our AS
//   GET  /.well-known/oauth-authorization-server RFC 8414 — the AS metadata
//   POST /oauth/register            RFC 7591 dynamic client registration
//   GET|POST /oauth/authorize       consent page: the user enters their connect code
//   POST /oauth/token               authorization-code + PKCE exchange
//   POST /link/code · /link/revoke  hook for a future onboarding app; closed until one exists
//   GET  /v1/phone · POST /v1/tasks · GET /v1/runs/:id · POST /v1/runs/:id/answer|stop
//                                   the same tools as REST (OpenAPI: server/openapi.yaml)
//   GET  /healthz                   liveness + which code is running (src/version.mjs)
//
// IT MUST BE REACHABLE FROM THE PUBLIC INTERNET, ON PORT 443. An assistant calls
// a remote MCP server from its vendor's cloud, not from the user's device, and
// claude.ai only connects out on 443 (anthropics/claude-ai-mcp#373).
// The process itself listens on loopback and is published by a TLS front
// (Tailscale Funnel in docs/install-server.md). What keeps a public endpoint
// that can drive a phone acceptable:
//
//   • Every route except the metadata documents and /healthz requires a
//     credential (src/auth.mjs) and fails closed.
//   • A credential is bound to ONE person, and that person to ONE phone
//     (src/devices.mjs). The worst a stolen credential can do is start a task
//     on that phone, which can be stopped from the chat or with both volume
//     buttons, and revoked on the server (phonectl revoke).
//   • Nothing a caller sends is ever executed. The only processes this server
//     starts are the bundled supervisor and agent, with fixed arguments.
//   • Plain HTTP is refused unless CONNECTOR_ALLOW_HTTP=1, which exists for the
//     loopback-behind-a-TLS-front setup and for tests.
//
// URL tokens (/mcp/k/<token>): a per-user URL is a zero-setup path for a custom
// connector. It is strictly weaker than OAuth — the URL IS the secret — so it
// is off unless CONNECTOR_ALLOW_URL_TOKENS=1.

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import {
  loadStore, saveStore, pruneExpired, parseBearer,
  createLinkCode, redeemLinkCode, findClientByToken,
  registerOAuthClient, findOAuthClient, createAuthCode, exchangeAuthCode,
  revokeAllForUid, touchClient,
} from './auth.mjs';
import { createRunStore } from './runs.mjs';
import { createDeviceResolver } from './device-resolver.mjs';
import { createToolApi } from './tool-api.mjs';
import { createMcpHandler, servedTools } from './mcp.mjs';
import { startAgentProcess, agentLogLine } from './agent-runner.mjs';
import { createSupervisorClient, parseDeviceOverrides } from './preflight.mjs';
import { createVersionInfo, toolsFingerprint } from './version.mjs';
import { createTaskRunner } from './task-runner.mjs';
import { createPrefs } from './prefs.mjs';
import { providerKeyPresent } from './models.mjs';
import { loadDevices } from './devices.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

const MAX_BODY = 64 * 1024;

// ─── small http helpers ──────────────────────────────────────────────────────

export function sendJSON(res, code, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendHTML(res, code, html) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limit) { req.destroy(); reject(new Error('body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJSON(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  return JSON.parse(text);
}

async function readForm(req) {
  const text = await readBody(req);
  return Object.fromEntries(new URLSearchParams(text));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ─── the app ─────────────────────────────────────────────────────────────────

/**
 * Builds the request handler. Every dependency is injected so the whole surface
 * — OAuth, MCP framing, tenancy — is testable without a phone, a registry file
 * or a network.
 */
export function createConnectorApp({
  publicUrl,
  storePath,
  api,
  mcp,
  store,
  linkAuth,                       // async (body) => { uid, email } | null
  versionInfo = null,             // () => { connector, startedAt, stale, supervisor }
  allowUrlTokens = false,
  log = () => {},
  now = Date.now,
  random = randomBytes,
} = {}) {
  if (!publicUrl) throw new Error('createConnectorApp requires publicUrl');
  const BASE = publicUrl.replace(/\/+$/, '');
  const hostAllowed = allowedHostCheck(BASE);

  const withStore = (fn) => {
    const db = loadStore(storePath);
    const out = fn(db);
    pruneExpired(db, now());
    saveStore(db, storePath);
    return out;
  };

  /** Resolve a presented credential to a caller, or an error to send. */
  function authenticate(presented) {
    if (!presented) return { error: 'missing' };
    const db = loadStore(storePath);
    const link = findClientByToken(db, presented);
    if (!link) return { error: 'invalid' };
    // touchClient updates the in-memory copy only. It is deliberately NOT
    // persisted: this runs on EVERY request, and a read-modify-write here would
    // race a concurrent revocation and could write the revoked credential back
    // as live. Losing a lastUsedAt timestamp is nothing; losing a revocation is
    // everything.
    touchClient(link, now());
    return { caller: { uid: link.uid, email: link.email, linkId: link.id, platform: link.platform } };
  }

  function unauthorized(res) {
    const wwwAuth = `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`;
    sendJSON(res, 401, { error: 'unauthorized', message: 'Connect your account to use this tool.' }, { 'www-authenticate': wwwAuth });
  }

  async function handle(req, res) {
    // DNS rebinding: a web page on another domain can make a browser send
    // requests here by pointing its own name at this machine. Such a request
    // carries that other name in Host, so only our own public name and
    // loopback are served (MCP transport spec; conformance scenario
    // dns-rebinding-protection). Loopback stays allowed because a TLS front
    // such as Tailscale Funnel may forward with Host set to 127.0.0.1.
    if (!hostAllowed(req.headers.host)) {
      sendJSON(res, 403, { error: 'forbidden_host', message: 'This server does not answer to that host name.' });
      return;
    }
    const url = new URL(req.url, BASE);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'authorization,content-type,mcp-protocol-version',
        'access-control-max-age': '600',
      });
      res.end();
      return;
    }

    if (path === '/healthz') {
      // The fingerprints are of code, not secrets: publishing them is what lets
      // anyone holding the source confirm what this host is running.
      sendJSON(res, 200, { ok: true, service: 'phone-control', ...(versionInfo ? { version: versionInfo() } : {}) });
      return;
    }

    // ── OAuth discovery (unauthenticated by design) ──────────────────────────
    //
    // BOTH forms are served on purpose. RFC 9728 §3.1 says a resource at
    // https://host/mcp publishes its metadata at
    // /.well-known/oauth-protected-resource/mcp — the path is INSERTED after the
    // well-known segment, not appended to it — while plenty of clients only ever
    // probe the bare root form. Serving one and not the other is the difference
    // between "paste the URL and it connects" and an unexplained failure at the
    // very first step, so answer to either.
    if (req.method === 'GET' && /^\/\.well-known\/oauth-protected-resource(\/mcp)?$/.test(path)) {
      sendJSON(res, 200, {
        resource: `${BASE}/mcp`,
        authorization_servers: [BASE],
        bearer_methods_supported: ['header'],
        scopes_supported: ['phone.control'],
        resource_documentation: `${BASE}/docs`,
      });
      return;
    }
    if (req.method === 'GET' && /^\/\.well-known\/(oauth-authorization-server|openid-configuration)(\/mcp)?$/.test(path)) {
      sendJSON(res, 200, {
        issuer: BASE,
        authorization_endpoint: `${BASE}/oauth/authorize`,
        token_endpoint: `${BASE}/oauth/token`,
        registration_endpoint: `${BASE}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['phone.control'],
      });
      return;
    }

    // ── dynamic client registration ──────────────────────────────────────────
    if (req.method === 'POST' && path === '/oauth/register') {
      let body;
      try { body = await readJSON(req); } catch { sendJSON(res, 400, { error: 'invalid_client_metadata' }); return; }
      try {
        const client = withStore((db) => registerOAuthClient(db, {
          clientName: body.client_name, redirectUris: body.redirect_uris, now: now(), random,
        }));
        sendJSON(res, 201, {
          client_id: client.clientId,
          client_name: client.clientName,
          redirect_uris: client.redirectUris,
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code'],
          response_types: ['code'],
        });
      } catch (e) {
        sendJSON(res, 400, { error: 'invalid_client_metadata', error_description: e.message });
      }
      return;
    }

    // ── consent page ─────────────────────────────────────────────────────────
    if (path === '/oauth/authorize') {
      const q = req.method === 'POST' ? await readForm(req).catch(() => ({})) : Object.fromEntries(url.searchParams);
      const clientId = q.client_id;
      const redirectUri = q.redirect_uri;
      const state = q.state || '';
      const challenge = q.code_challenge;
      const method = q.code_challenge_method || 'S256';

      const client = findOAuthClient(loadStore(storePath), clientId);
      if (!client) { sendHTML(res, 400, page('Unknown application', '<p>That application is not registered with us.</p>')); return; }
      if (!client.redirectUris.includes(redirectUri)) {
        sendHTML(res, 400, page('Bad redirect', '<p>The redirect address does not match the one registered for this application.</p>'));
        return;
      }
      if (method !== 'S256' || !challenge) {
        sendHTML(res, 400, page('Unsupported request', '<p>This service requires PKCE with S256.</p>'));
        return;
      }

      if (req.method === 'GET') {
        sendHTML(res, 200, consentPage({ client, q, error: null }));
        return;
      }

      const linked = withStore((db) => redeemLinkCode(db, q.link_code, now()));
      if (!linked) {
        sendHTML(res, 200, consentPage({ client, q, error: 'That code is not valid any more. Codes work once and expire after ten minutes; ask for a fresh one.' }));
        return;
      }
      const code = withStore((db) => createAuthCode(db, {
        clientId, uid: linked.uid, email: linked.email, redirectUri,
        codeChallenge: challenge, codeChallengeMethod: 'S256',
        platform: guessPlatform(client.clientName, redirectUri),
        now: now(), random,
      }));
      const to = new URL(redirectUri);
      to.searchParams.set('code', code);
      if (state) to.searchParams.set('state', state);
      log(`authorize: issued code for ${linked.email || linked.uid} to ${client.clientName}`);
      res.writeHead(302, { location: to.toString(), 'cache-control': 'no-store' });
      res.end();
      return;
    }

    // ── token exchange ───────────────────────────────────────────────────────
    if (req.method === 'POST' && path === '/oauth/token') {
      const form = await readForm(req).catch(() => ({}));
      if (form.grant_type !== 'authorization_code') {
        sendJSON(res, 400, { error: 'unsupported_grant_type' });
        return;
      }
      // NOT withStore(): a FAILED exchange still mutates the store — replaying a
      // code revokes the credential that code already minted — and that
      // revocation must survive the throw. Persist in `finally`, always.
      const db = loadStore(storePath);
      try {
        const issued = exchangeAuthCode(db, {
          code: form.code,
          clientId: form.client_id,
          codeVerifier: form.code_verifier,
          redirectUri: form.redirect_uri,
          now: now(), random,
        });
        log(`token: issued connector credential ${issued.record.id} for ${issued.record.email || issued.record.uid}`);
        sendJSON(res, 200, {
          access_token: issued.token,
          token_type: 'Bearer',
          scope: 'phone.control',
        });
      } catch (e) {
        log(`token: refused (${e.oauthError || 'invalid_request'}) — ${e.message}`);
        sendJSON(res, 400, { error: e.oauthError || 'invalid_request', error_description: e.message });
      } finally {
        pruneExpired(db, now());
        try { saveStore(db, storePath); } catch (e) { log(`token: store write failed: ${e.message}`); }
      }
      return;
    }

    // ── hook for an onboarding app: mint / revoke connect codes ─────────────
    // `linkAuth` decides who is asking. The production wiring below gives it
    // nobody, so both routes answer 401; today codes come from `phonectl`.
    if (req.method === 'POST' && path === '/link/code') {
      let body;
      try { body = await readJSON(req); } catch { sendJSON(res, 400, { error: 'invalid_json' }); return; }
      const who = await linkAuth(body).catch(() => null);
      if (!who) { sendJSON(res, 401, { error: 'sign_in_required' }); return; }
      const { code, expiresAt } = withStore((db) => createLinkCode(db, { uid: who.uid, email: who.email, now: now(), random }));
      log(`link/code: minted for ${who.email || who.uid}`);
      sendJSON(res, 200, { code, expiresAt, connectUrl: `${BASE}/mcp`, instructions: `Add ${BASE}/mcp as a custom connector, then enter this code when it asks you to sign in.` });
      return;
    }
    if (req.method === 'POST' && path === '/link/revoke') {
      let body;
      try { body = await readJSON(req); } catch { sendJSON(res, 400, { error: 'invalid_json' }); return; }
      const who = await linkAuth(body).catch(() => null);
      if (!who) { sendJSON(res, 401, { error: 'sign_in_required' }); return; }
      const n = withStore((db) => revokeAllForUid(db, who.uid, now()));
      log(`link/revoke: revoked ${n} credential(s) for ${who.email || who.uid}`);
      sendJSON(res, 200, { revoked: n });
      return;
    }

    // ── everything below needs a connector credential ────────────────────────
    let presented = parseBearer(req.headers.authorization);
    let mcpPath = path === '/mcp';
    if (!mcpPath && allowUrlTokens) {
      const m = path.match(/^\/mcp\/k\/([A-Za-z0-9_-]{20,})$/);
      if (m) { mcpPath = true; presented = presented || m[1]; }
    }

    if (mcpPath && req.method === 'GET') {
      // No SSE stream: this server is stateless and never initiates messages.
      sendJSON(res, 405, { error: 'method_not_allowed', message: 'POST JSON-RPC to this endpoint.' }, { allow: 'POST, OPTIONS' });
      return;
    }

    const isApiPath = mcpPath || path.startsWith('/v1/');
    if (!isApiPath) { sendJSON(res, 404, { error: 'not_found' }); return; }

    const auth = authenticate(presented);
    if (auth.error) { unauthorized(res); return; }
    const caller = auth.caller;

    if (mcpPath && req.method === 'POST') {
      let payload;
      try { payload = await readJSON(req); } catch {
        sendJSON(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
        return;
      }
      log(`mcp: ${describeRpc(payload)} from ${caller.email || caller.uid} (${caller.platform || 'other'})`);
      // If the client hangs up before we answer (the user pressed Stop, or the
      // assistant abandoned the call), tell the tool: a waiting status check
      // uses this to notice that nobody is listening any more.
      const gone = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) {
          log(`mcp: ${describeRpc(payload)} was DROPPED by the client before it was answered`);
          gone.abort();
        }
      });
      const out = await mcp.handle(payload, { ...caller, signal: gone.signal });
      if (gone.signal.aborted || res.destroyed) return;
      if (out === null) { res.writeHead(202, { 'content-length': '0' }); res.end(); return; }
      sendJSON(res, 200, out, { 'mcp-protocol-version': req.headers['mcp-protocol-version'] || '2025-06-18' });
      return;
    }

    // ── REST framing of the same tools (OpenAPI surface) ─────────────────────
    const rest = async () => {
      if (req.method === 'GET' && path === '/v1/phone') return api.call('get_phone_status', {}, caller);
      if (req.method === 'POST' && path === '/v1/tasks') {
        const body = await readJSON(req).catch(() => ({}));
        return api.call('run_phone_task', body, caller);
      }
      const m = path.match(/^\/v1\/runs\/([A-Za-z0-9_-]+)(\/(answer|stop))?$/);
      if (m) {
        const runId = m[1];
        if (req.method === 'GET' && !m[3]) return api.call('get_run_status', { run_id: runId }, caller);
        if (req.method === 'POST' && m[3] === 'answer') {
          const body = await readJSON(req).catch(() => ({}));
          return api.call('answer_question', { run_id: runId, answer: body.answer }, caller);
        }
        if (req.method === 'POST' && m[3] === 'stop') return api.call('stop_run', { run_id: runId }, caller);
      }
      if (req.method === 'GET' && path === '/v1/runs') {
        return { ok: true, runs: store.list(caller.uid, 5) };
      }
      return null;
    };

    let result;
    try { result = await rest(); } catch (e) {
      sendJSON(res, 500, { ok: false, error: 'internal', message: String(e?.message || e).slice(0, 200) });
      return;
    }
    if (result === null) { sendJSON(res, 404, { error: 'not_found' }); return; }
    sendJSON(res, result.ok === false ? 400 : 200, result);
  }

  return async function requestHandler(req, res) {
    try {
      await handle(req, res);
    } catch (e) {
      log(`handler error: ${e?.message || e}`);
      if (!res.headersSent) sendJSON(res, 500, { error: 'internal' });
      else res.end();
    }
  };
}

/** One-line, argument-free description of a JSON-RPC payload for the log. Tool
 *  ARGUMENTS are deliberately left out: a task sentence is user content. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Host header check: the public URL's host, or loopback on any port. */
export function allowedHostCheck(publicUrl) {
  const pub = new URL(publicUrl);
  const publicHost = pub.hostname.toLowerCase();
  const publicPort = pub.port || (pub.protocol === 'https:' ? '443' : '80');
  return (header) => {
    if (typeof header !== 'string' || !header) return false;
    let parsed;
    try { parsed = new URL(`http://${header}`); } catch { return false; }
    if (parsed.username || parsed.password || parsed.pathname !== '/') return false;
    const name = parsed.hostname.toLowerCase();
    if (LOOPBACK.has(name)) return true;
    // The public name, with no port or with the public URL's own port.
    return name === publicHost && (!parsed.port || parsed.port === publicPort);
  };
}

export function describeRpc(payload) {
  const one = (m) => {
    const method = typeof m?.method === 'string' ? m.method : '?';
    if (method === 'tools/call') return `tools/call ${String(m?.params?.name ?? '?').slice(0, 40)}`;
    // Which protocol revision a client asks for decides what it expects of us.
    if (method === 'initialize') return `initialize (protocol ${String(m?.params?.protocolVersion ?? '?').slice(0, 20)})`;
    return method;
  };
  return Array.isArray(payload) ? payload.map(one).join(', ') : one(payload);
}

function guessPlatform(clientName = '', redirectUri = '') {
  const s = `${clientName} ${redirectUri}`.toLowerCase();
  if (s.includes('claude') || s.includes('anthropic')) return 'claude';
  if (s.includes('openai') || s.includes('chatgpt')) return 'chatgpt';
  return 'other';
}

// ─── the consent page ────────────────────────────────────────────────────────
// Deliberately plain: no scripts, no fonts, no third-party anything. It asks for
// one thing — the code the app is showing — and says exactly what is being
// granted. A consent screen that overstates or understates the grant is worse
// than none.

function page(title, inner) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
 :root{color-scheme:light dark}
 body{font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;margin:0;
      display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f5f5f4;color:#1c1c1a}
 .card{background:#fff;border:1px solid #e5e5e3;border-radius:14px;padding:28px;max-width:420px;width:calc(100% - 32px)}
 h1{font-size:20px;margin:0 0 12px}
 p{margin:0 0 14px;opacity:.85}
 ul{margin:0 0 18px;padding-left:20px;opacity:.85}
 input{font:inherit;letter-spacing:.14em;text-transform:uppercase;width:100%;box-sizing:border-box;
       padding:12px;border-radius:10px;border:1px solid #bbb;background:transparent;color:inherit}
 button{font:inherit;margin-top:14px;width:100%;padding:12px;border:0;border-radius:10px;background:#c96442;color:#fff;cursor:pointer}
 .err{color:#b3261e;font-size:14px}
 /* LAST on purpose: it has the same specificity as the rules above, so placed
    before them the white card won and dark mode showed light text on white. */
 @media (prefers-color-scheme:dark){body{background:#141413;color:#f5f5f4}.card{background:#20201f;border-color:#333}.err{color:#f2b8b5}}
</style></head><body><div class="card"><h1>${esc(title)}</h1>${inner}</div></body></html>`;
}

export function consentPage({ client, q, error }) {
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'response_type']
    .map((k) => (q[k] ? `<input type="hidden" name="${k}" value="${esc(q[k])}">` : ''))
    .join('');
  return page('Connect your iPhone', `
    <p><strong>${esc(client.clientName)}</strong> is asking to control your iPhone through your agent.</p>
    <ul>
      <li>Start tasks on the phone linked to your account</li>
      <li>See progress and results of those tasks</li>
      <li>Answer questions the task asks you</li>
    </ul>
    <p>It cannot pair new devices or change your account.</p>
    <form method="POST" action="/oauth/authorize">
      ${hidden}
      <label for="link_code">Enter the connect code you were given for this phone:</label>
      <p></p>
      <input id="link_code" name="link_code" autocomplete="one-time-code" autocapitalize="characters"
             autocorrect="off" spellcheck="false" placeholder="XXXX-XXXX" required>
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      <button type="submit">Connect</button>
    </form>`);
}

// ─── wiring for a real deployment ────────────────────────────────────────────

export function buildProductionApp(env = process.env) {
  const publicUrl = env.CONNECTOR_PUBLIC_URL;
  if (!publicUrl) throw new Error('CONNECTOR_PUBLIC_URL is required (e.g. https://agent.example.com)');
  const storePath = env.CONNECTOR_STORE || '/etc/phone-control/connector.json';
  const logDir = env.CONNECTOR_LOG_DIR || join(env.PHONE_CONTROL_STATE_DIR || join(REPO, 'var'), 'logs');
  try { mkdirSync(logDir, { recursive: true }); } catch { /* best effort */ }
  const log = (m) => {
    const line = `[${new Date().toISOString()}] ${m}`;
    console.log(line);
    try { appendFileSync(join(logDir, 'server.log'), line + '\n'); } catch { /* best effort */ }
  };

  const store = createRunStore({});
  // The supervisor is how this server reads a phone's state and starts or
  // stops automation on it. Starting is on unless CONNECTOR_ALLOW_ARM=0, which
  // leaves a server that can report on a phone but never touch it.
  const supervisorPath = env.CONNECTOR_SUPERVISOR || join(REPO, 'device', 'supervisor.mjs');
  const supervisor = createSupervisorClient({ supervisorPath, env, log, logDir });
  const devices = createDeviceResolver({
    loadRegistry: loadDevices,
    registryPath: env.CONNECTOR_DEVICES || undefined,
    runnerPort: Number(env.CONNECTOR_RUNNER_PORT || 22087),
    overrides: parseDeviceOverrides(env.CONNECTOR_DEVICE_OVERRIDES),
    inspect: supervisor.inspect,
    startArm: env.CONNECTOR_ALLOW_ARM === '0' ? null : supervisor.startArm,
  });
  const agentRoot = env.CONNECTOR_AGENT_ROOT || REPO;
  // The tool list is built below; fingerprint it when asked, as served.
  let api = null;
  const versionInfo = createVersionInfo({ repoRoot: REPO, agentRoot, tools: () => (api ? toolsFingerprint(servedTools(api.definitions)) : null) });
  const prefs = createPrefs({
    path: env.CONNECTOR_PREFS || join(dirname(storePath), 'prefs.json'),
    defaultModel: env.CONNECTOR_DEFAULT_MODEL,
  });
  const launchAgent = ({ run, device, model }) => startAgentProcess({
    run, store, repoRoot: agentRoot,
    driverHost: device.address,
    driverPort: Number(env.CONNECTOR_RUNNER_PORT || 22087),
    provider: model.provider,
    model: model.agentModel || model.id,
    extraArgs: model.agentArgs || [],
    askUserTimeoutSec: Number(env.CONNECTOR_ASKUSER_TIMEOUT || 300),
    // Every step into the journal (journalctl -u phone-control), so a run can
    // be explained afterwards: which model chose what, and how long each step
    // took. Text only: the agent's log carries what it read and typed, never
    // a screenshot. CONNECTOR_AGENT_LOG=0 turns it off.
    onLog: env.CONNECTOR_AGENT_LOG === '0' ? null : (line) => log(agentLogLine(run.id, line)),
  });
  // A task owns the whole cycle: start automation, run, put it down again.
  const taskRunner = createTaskRunner({
    store, devices, supervisor, startAgent: launchAgent, log,
    // Where a finished task leaves the phone unless it was asked to stay put.
    returnApp: env.CONNECTOR_RETURN_APP || 'com.anthropic.claude',
    limits: {
      ...(env.CONNECTOR_ABANDON_SECONDS ? { abandonMs: Number(env.CONNECTOR_ABANDON_SECONDS) * 1000 } : {}),
    },
  });
  api = createToolApi({
    store, devices, log, versionInfo, prefs,
    hasProviderKey: (provider) => providerKeyPresent(provider, env),
    startRun: (ctx) => { taskRunner.start(ctx); },   // returns at once; the run record carries progress
  });
  const mcp = createMcpHandler({ api });

  return createConnectorApp({
    publicUrl, storePath, api, mcp, store, log, versionInfo,
    allowUrlTokens: env.CONNECTOR_ALLOW_URL_TOKENS === '1',
    // No onboarding app exists yet, so nobody can ask for a code over HTTP.
    linkAuth: async () => null,
  });
}

function main() {
  const env = process.env;
  const port = Number(env.CONNECTOR_PORT || 8788);
  const bind = env.CONNECTOR_BIND || '127.0.0.1';
  const handler = buildProductionApp(env);

  const cert = env.CONNECTOR_TLS_CERT;
  const key = env.CONNECTOR_TLS_KEY;
  let server;
  if (cert && key) {
    server = createHttpsServer({ cert: readFileSync(cert), key: readFileSync(key), minVersion: 'TLSv1.2' }, handler);
  } else if (env.CONNECTOR_ALLOW_HTTP === '1') {
    // Only sane behind a TLS-terminating proxy on the same host.
    server = createHttpServer(handler);
  } else {
    console.error('FATAL: set CONNECTOR_TLS_CERT + CONNECTOR_TLS_KEY, or CONNECTOR_ALLOW_HTTP=1 if TLS is terminated in front of this process.');
    process.exit(1);
  }
  server.listen(port, bind, () => {
    console.log(`[${new Date().toISOString()}] connector listening on ${bind}:${port} — public ${env.CONNECTOR_PUBLIC_URL}`);
  });
}

// Import-time side effects are forbidden by the repo convention; run only when
// this file IS the program.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
