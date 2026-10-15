#!/usr/bin/env node
// auth.test.mjs — device-free tests for the connector credential
// layer (connector/auth.mjs): link codes, client tokens, and the OAuth 2.1
// authorization-code + PKCE flow both platforms require.
//
// The security properties under test are the ones that would be expensive to
// get wrong: single-use codes, expiry, exact redirect matching, S256-only,
// PKCE verification, replay revocation, and revoked credentials failing closed.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

import {
  loadStore, saveStore, pruneExpired, parseBearer,
  mintClientToken, issueClientToken, findClientByToken, revokeClient, revokeAllForUid,
  createLinkCode, redeemLinkCode, normalizeLinkCode, formatLinkCode,
  registerOAuthClient, findOAuthClient, createAuthCode, exchangeAuthCode,
  LINK_CODE_TTL_MS, AUTH_CODE_TTL_MS,
} from '../src/auth.mjs';

let passed = 0;
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; });
}

const dir = mkdtempSync(join(tmpdir(), 'connector-auth-test-'));
const storePath = join(dir, 'connector.json');

const T0 = Date.parse('2026-08-06T12:00:00Z');
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');          // 43 chars
  return { verifier, challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url') };
};
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

// ─── store ───────────────────────────────────────────────────────────────────

await ok('missing store loads empty; a corrupt store authorizes nobody', () => {
  assert.deepEqual(loadStore(storePath), { links: [], codes: [], oauthClients: [], authCodes: [] });
  const bad = join(dir, 'corrupt.json');
  writeFileSync(bad, '{not json');
  assert.deepEqual(loadStore(bad).links, []);
});

await ok('store round-trips through disk', () => {
  const db = loadStore(storePath);
  issueClientToken(db, { uid: 'u1', email: 'a@b.c', platform: 'claude', now: T0 });
  saveStore(db, storePath);
  assert.equal(loadStore(storePath).links.length, 1);
  rmSync(storePath);
});

// ─── client tokens ───────────────────────────────────────────────────────────

await ok('minted token is prefixed, round-trips, and a wrong token misses', () => {
  const db = loadStore(storePath);
  const { token } = issueClientToken(db, { uid: 'u1', email: 'a@b.c', now: T0 });
  assert.match(token, /^iac_/);
  assert.equal(findClientByToken(db, token)?.uid, 'u1');
  assert.equal(findClientByToken(db, 'iac_not-the-real-token-000000'), null);
  assert.equal(findClientByToken(db, ''), null);
  assert.equal(findClientByToken(db, null), null);
});

await ok('plaintext token is never stored — only its hash', () => {
  const db = loadStore(storePath);
  const { token, record } = issueClientToken(db, { uid: 'u-secret', now: T0 });
  const serialized = JSON.stringify(db);
  assert.ok(!serialized.includes(token), 'plaintext token leaked into the store');
  assert.equal(record.tokenSha256, createHash('sha256').update(token).digest('hex'));
});

await ok('revoked credentials fail closed', () => {
  const db = loadStore(storePath);
  const { token, record } = issueClientToken(db, { uid: 'u2', now: T0 });
  assert.ok(findClientByToken(db, token));
  assert.equal(revokeClient(db, record.id, T0), true);
  assert.equal(findClientByToken(db, token), null, 'a revoked token still opened the API');
});

await ok('revokeAllForUid disconnects every assistant for one user only', () => {
  const db = loadStore(storePath);
  const a = issueClientToken(db, { uid: 'multi', platform: 'claude', now: T0 });
  const b = issueClientToken(db, { uid: 'multi', platform: 'chatgpt', now: T0 });
  const other = issueClientToken(db, { uid: 'bystander', now: T0 });
  assert.equal(revokeAllForUid(db, 'multi', T0), 2);
  assert.equal(findClientByToken(db, a.token), null);
  assert.equal(findClientByToken(db, b.token), null);
  assert.ok(findClientByToken(db, other.token), 'revoking one user hit another user');
});

await ok('mintClientToken is 32 bytes of entropy, base64url', () => {
  const { token } = mintClientToken();
  assert.ok(token.length > 40);
  assert.match(token.slice(4), /^[A-Za-z0-9_-]+$/);
});

await ok('parseBearer accepts only a Bearer header', () => {
  assert.equal(parseBearer('Bearer abc'), 'abc');
  assert.equal(parseBearer('bearer abc'), '');
  assert.equal(parseBearer('Basic abc'), '');
  assert.equal(parseBearer(undefined), '');
});

// ─── link codes ──────────────────────────────────────────────────────────────

await ok('link code is unambiguous and normalizes forgiving input', () => {
  const code = formatLinkCode(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(!/[O0I1]/.test(code), 'code used a confusable character');
  assert.equal(normalizeLinkCode(' ab12-cd34 '), 'AB12CD34');
});

await ok('link code redeems exactly once and binds the right uid', () => {
  const db = loadStore(storePath);
  const { code } = createLinkCode(db, { uid: 'u-link', email: 'l@x.y', now: T0 });
  assert.deepEqual(redeemLinkCode(db, code.toLowerCase(), T0 + 1000), { uid: 'u-link', email: 'l@x.y' });
  assert.equal(redeemLinkCode(db, code, T0 + 2000), null, 'a link code was redeemable twice');
});

await ok('link code expires', () => {
  const db = loadStore(storePath);
  const { code } = createLinkCode(db, { uid: 'u-exp', now: T0 });
  assert.equal(redeemLinkCode(db, code, T0 + LINK_CODE_TTL_MS + 1), null);
});

await ok('minting a new code invalidates the previous one', () => {
  const db = loadStore(storePath);
  const first = createLinkCode(db, { uid: 'u-rot', now: T0 }).code;
  const second = createLinkCode(db, { uid: 'u-rot', now: T0 + 5 }).code;
  assert.equal(redeemLinkCode(db, first, T0 + 10), null, 'a superseded code still worked');
  assert.equal(redeemLinkCode(db, second, T0 + 10)?.uid, 'u-rot');
});

await ok('garbage codes are rejected without a lookup', () => {
  const db = loadStore(storePath);
  assert.equal(redeemLinkCode(db, '', T0), null);
  assert.equal(redeemLinkCode(db, 'SHORT', T0), null);
  assert.equal(redeemLinkCode(db, 'WAY-TOO-LONG-CODE', T0), null);
});

// ─── dynamic client registration ─────────────────────────────────────────────

await ok('DCR requires at least one redirect URI and rejects non-https', () => {
  const db = loadStore(storePath);
  assert.throws(() => registerOAuthClient(db, { clientName: 'x', redirectUris: [] }));
  assert.throws(() => registerOAuthClient(db, { clientName: 'x', redirectUris: ['http://evil.example/cb'] }));
  const loopback = registerOAuthClient(db, { clientName: 'cli', redirectUris: ['http://127.0.0.1:8976/cb'], now: T0 });
  assert.ok(loopback.clientId.startsWith('cli_'));
});

await ok('registered client is findable; unknown id is not', () => {
  const db = loadStore(storePath);
  const c = registerOAuthClient(db, { clientName: 'Claude', redirectUris: [REDIRECT], now: T0 });
  assert.equal(findOAuthClient(db, c.clientId)?.clientName, 'Claude');
  assert.equal(findOAuthClient(db, 'cli_nope'), null);
});

// ─── authorization code + PKCE ───────────────────────────────────────────────

function freshClient(db) {
  return registerOAuthClient(db, { clientName: 'Claude', redirectUris: [REDIRECT], now: T0 });
}

await ok('authorization code requires a known client, exact redirect, and S256', () => {
  const db = loadStore(storePath);
  const client = freshClient(db);
  const { challenge } = pkce();
  assert.throws(() => createAuthCode(db, { clientId: 'cli_unknown', uid: 'u', redirectUri: REDIRECT, codeChallenge: challenge }));
  assert.throws(() => createAuthCode(db, { clientId: client.clientId, uid: 'u', redirectUri: 'https://elsewhere.example/cb', codeChallenge: challenge }));
  assert.throws(() => createAuthCode(db, { clientId: client.clientId, uid: 'u', redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: 'plain' }),
    /S256/, 'PKCE "plain" was accepted');
  assert.throws(() => createAuthCode(db, { clientId: client.clientId, uid: 'u', redirectUri: REDIRECT, codeChallenge: 'tooshort' }));
});

await ok('happy path: code + correct verifier yields a working credential', () => {
  const db = loadStore(storePath);
  const client = freshClient(db);
  const { verifier, challenge } = pkce();
  const code = createAuthCode(db, { clientId: client.clientId, uid: 'u-oauth', email: 'o@x.y', redirectUri: REDIRECT, codeChallenge: challenge, platform: 'claude', now: T0 });
  const { token, record } = exchangeAuthCode(db, { code, clientId: client.clientId, codeVerifier: verifier, redirectUri: REDIRECT, now: T0 + 1000 });
  assert.equal(record.uid, 'u-oauth');
  assert.equal(record.platform, 'claude');
  assert.equal(findClientByToken(db, token)?.uid, 'u-oauth');
});

await ok('wrong PKCE verifier is refused', () => {
  const db = loadStore(storePath);
  const client = freshClient(db);
  const { challenge } = pkce();
  const other = pkce();
  const code = createAuthCode(db, { clientId: client.clientId, uid: 'u', redirectUri: REDIRECT, codeChallenge: challenge, now: T0 });
  assert.throws(
    () => exchangeAuthCode(db, { code, clientId: client.clientId, codeVerifier: other.verifier, redirectUri: REDIRECT, now: T0 + 10 }),
    (e) => e.oauthError === 'invalid_grant' && /PKCE/.test(e.message),
  );
});

await ok('a short verifier is refused before any comparison', () => {
  const db = loadStore(storePath);
  const client = freshClient(db);
  const { challenge } = pkce();
  const code = createAuthCode(db, { clientId: client.clientId, uid: 'u', redirectUri: REDIRECT, codeChallenge: challenge, now: T0 });
  assert.throws(
    () => exchangeAuthCode(db, { code, clientId: client.clientId, codeVerifier: 'short', redirectUri: REDIRECT, now: T0 + 10 }),
    (e) => e.oauthError === 'invalid_request',
  );
});

await ok('code is bound to its client and its redirect URI', () => {
  const db = loadStore(storePath);
  const client = freshClient(db);
  const impostor = registerOAuthClient(db, { clientName: 'Other', redirectUris: [REDIRECT], now: T0 });
  const { verifier, challenge } = pkce();
  const code = createAuthCode(db, { clientId: client.clientId, uid: 'u', redirectUri: REDIRECT, codeChallenge: challenge, now: T0 });
  assert.throws(
    () => exchangeAuthCode(db, { code, clientId: impostor.clientId, codeVerifier: verifier, redirectUri: REDIRECT, now: T0 + 10 }),
    (e) => e.oauthError === 'invalid_client',
  );
  assert.throws(
    () => exchangeAuthCode(db, { code, clientId: client.clientId, codeVerifier: verifier, redirectUri: 'https://claude.ai/other', now: T0 + 10 }),
    (e) => e.oauthError === 'invalid_grant',
  );
});

await ok('expired code is refused', () => {
  const db = loadStore(storePath);
  const client = freshClient(db);
  const { verifier, challenge } = pkce();
  const code = createAuthCode(db, { clientId: client.clientId, uid: 'u', redirectUri: REDIRECT, codeChallenge: challenge, now: T0 });
  assert.throws(
    () => exchangeAuthCode(db, { code, clientId: client.clientId, codeVerifier: verifier, redirectUri: REDIRECT, now: T0 + AUTH_CODE_TTL_MS + 1 }),
    /expired/,
  );
});

await ok('replaying a code revokes the credential it already issued', () => {
  const db = loadStore(storePath);
  const client = freshClient(db);
  const { verifier, challenge } = pkce();
  const code = createAuthCode(db, { clientId: client.clientId, uid: 'u-replay', redirectUri: REDIRECT, codeChallenge: challenge, now: T0 });
  const { token } = exchangeAuthCode(db, { code, clientId: client.clientId, codeVerifier: verifier, redirectUri: REDIRECT, now: T0 + 10 });
  assert.ok(findClientByToken(db, token), 'first exchange should work');
  assert.throws(() => exchangeAuthCode(db, { code, clientId: client.clientId, codeVerifier: verifier, redirectUri: REDIRECT, now: T0 + 20 }));
  assert.equal(findClientByToken(db, token), null, 'replayed code left the original credential live');
});

await ok('unknown code is invalid_grant, not a crash', () => {
  const db = loadStore(storePath);
  assert.throws(
    () => exchangeAuthCode(db, { code: 'nope', clientId: 'cli_x', codeVerifier: 'a'.repeat(43), redirectUri: REDIRECT, now: T0 }),
    (e) => e.oauthError === 'invalid_grant',
  );
});

await ok('pruneExpired drops stale codes but keeps live credentials', () => {
  const db = loadStore(storePath);
  const before = db.links.length;
  createLinkCode(db, { uid: 'u-prune', now: T0 });
  pruneExpired(db, T0 + 24 * 60 * 60 * 1000);
  assert.equal(db.codes.length, 0);
  assert.equal(db.links.length, before, 'pruning removed credentials');
});

rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} connector-auth assertions passed`);
