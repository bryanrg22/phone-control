#!/usr/bin/env node
// conformance.mjs — the official MCP conformance suite, against the real server.
//
//   npm run test:conformance
//   node e2e/conformance.mjs --scenario tools-list        one scenario
//
// Starts server/src/server.mjs on a free local port with throwaway state,
// signs in the way an assistant does (client registration, connect code, PKCE),
// and runs @modelcontextprotocol/conformance against it. The suite cannot send
// an Authorization header, so the token travels in the URL path, a mode the
// server only allows when CONNECTOR_ALLOW_URL_TOKENS=1.
//
// Many scenarios exercise features this server does not offer (resources,
// prompts, sampling, the suite's own sample tools). Those are listed, with the
// reason, in e2e/conformance-expected-failures.yml. The suite fails the run
// when a scenario regresses OR when a listed failure starts passing, so the
// list cannot silently go stale.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

import { run as phonectl } from '../server/bin/phonectl.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = '@modelcontextprotocol/conformance@0.1.16';       // pinned: the suite itself is pre-1.0
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const argv = process.argv.slice(2);
const scenario = argv.includes('--scenario') ? argv[argv.indexOf('--scenario') + 1] : null;

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), 'phone-control-conformance-'));
const paths = { devicesPath: join(dir, 'devices.json'), storePath: join(dir, 'connector.json') };
phonectl(['device', 'add', '--email', 'conformance@example.com', '--address', '100.64.0.9', '--udid', '00008130-000A1B2C3D4E5F60'], paths);

const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;
let output = '';
const server = spawn(process.execPath, [join(REPO, 'server', 'src', 'server.mjs')], {
  env: {
    ...process.env,
    CONNECTOR_PUBLIC_URL: BASE,
    CONNECTOR_PORT: String(port),
    CONNECTOR_BIND: '127.0.0.1',
    CONNECTOR_ALLOW_HTTP: '1',
    CONNECTOR_ALLOW_URL_TOKENS: '1',
    CONNECTOR_STORE: paths.storePath,
    CONNECTOR_DEVICES: paths.devicesPath,
    PHONE_CONTROL_STATE_DIR: join(dir, 'var'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => { output += d; });
server.stderr.on('data', (d) => { output += d; });

let exitCode = 1;
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* not up yet */ }
    if (i > 100) throw new Error(`the server did not start:\n${output}`);
    await sleep(100);
  }

  // Sign in as an assistant would.
  const post = (p, body, form = false) => fetch(BASE + p, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
  const client = await (await post('/oauth/register', { client_name: 'MCP conformance', redirect_uris: [REDIRECT] })).json();
  const code = phonectl(['link-code', '--email', 'conformance@example.com'], paths)[0].replace('Connect code: ', '');
  const verifier = randomBytes(32).toString('base64url');
  const redirected = await post('/oauth/authorize', {
    client_id: client.client_id, redirect_uri: REDIRECT, state: 's', response_type: 'code', link_code: code,
    code_challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url'), code_challenge_method: 'S256',
  }, true);
  const issued = new URL(redirected.headers.get('location')).searchParams.get('code');
  const { access_token: token } = await (await post('/oauth/token', {
    grant_type: 'authorization_code', code: issued, client_id: client.client_id, code_verifier: verifier, redirect_uri: REDIRECT,
  }, true)).json();
  if (!token) throw new Error('sign-in did not produce a token');

  const args = ['-y', SUITE, 'server', '--url', `${BASE}/mcp/k/${token}`, '--spec-version', '2025-11-25',
    ...(scenario ? ['--scenario', scenario] : ['--expected-failures', join(REPO, 'e2e', 'conformance-expected-failures.yml')])];
  exitCode = await new Promise((resolve) => {
    const c = spawn('npx', args, { stdio: 'inherit', cwd: dir });
    c.on('close', (code) => resolve(code ?? 1));
  });
} catch (e) {
  console.error(`conformance: ${e.message}`);
} finally {
  server.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
}
process.exit(exitCode);

