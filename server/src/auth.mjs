// auth.mjs — the credentials an AI assistant holds to act for one person.
//
// There are two kinds of trust in this system and they must never be confused:
//
//   pairing record       Apple's device trust, held by the server. Whoever holds
//                        it can start automation on the phone. Treat it as a
//                        root key; it never leaves the host.
//   assistant credential issued here, held by Claude (or another assistant) on a
//                        person's behalf. It authorises "ask this person's phone
//                        to do something" and nothing else. Stored in its own
//                        file with its own lifecycle, hashes only.
//
// Two ways to present one:
//   • OAuth 2.1 authorization-code + PKCE (S256) + dynamic client registration —
//     what Claude uses, and the only thing ChatGPT accepts.
//   • A long-lived token in the URL — off unless the operator enables it.
//
// Identity is a CONNECT CODE: a short, single-use, ten-minute code the operator
// mints for a person (`phonectl link-code`). The person types it on the consent
// page, and the grant binds to them. No password of ours exists.
//
// Storage: one JSON file, atomic write, mode 0600, hashes only, constant-time
// compare, no dependencies.

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const STORE = process.env.CONNECTOR_STORE || '/etc/phone-control/connector.json';

/** Unambiguous alphabet — no O/0, I/1, so a code read off a phone screen and
 *  typed into a browser cannot be mistyped in the usual ways. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const LINK_CODE_TTL_MS = 10 * 60 * 1000;      // 10 min: long enough to switch devices
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000;       // OAuth 2.1: authorization codes are short-lived

const EMPTY = () => ({ links: [], codes: [], oauthClients: [], authCodes: [] });

export function loadStore(path = STORE) {
  if (!existsSync(path)) return EMPTY();
  try {
    const db = JSON.parse(readFileSync(path, 'utf8'));
    return {
      links: Array.isArray(db.links) ? db.links : [],
      codes: Array.isArray(db.codes) ? db.codes : [],
      oauthClients: Array.isArray(db.oauthClients) ? db.oauthClients : [],
      authCodes: Array.isArray(db.authCodes) ? db.authCodes : [],
    };
  } catch {
    // A corrupt store must not hand out access. Empty = nobody is authorized.
    return EMPTY();
  }
}

export function saveStore(db, path = STORE) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

export function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex');
}

/** Constant-time "does this plaintext hash to that stored hex digest?". */
function hashMatches(presented, storedHex) {
  if (typeof presented !== 'string' || typeof storedHex !== 'string') return false;
  const a = createHash('sha256').update(presented).digest();
  let b;
  try { b = Buffer.from(storedHex, 'hex'); } catch { return false; }
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `Authorization: Bearer x` → `x`; anything else → ''. */
export function parseBearer(header) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

/** Mints a client credential. The plaintext is returned ONCE; only the hash is
 *  stored. The `iac_` prefix ("iPhone agent connector") makes a leaked token
 *  greppable in logs and distinguishable from a device token at a glance. */
export function mintClientToken(random = randomBytes) {
  const token = `iac_${random(32).toString('base64url')}`;
  return { token, sha256: sha256Hex(token) };
}

// ─── link codes: the app→browser identity bridge ─────────────────────────────

export function formatLinkCode(bytes) {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (i === 3) out += '-';
  }
  return out;
}

/** Normalizes user input: case, spaces and dashes are noise, not signal. */
export function normalizeLinkCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Mints a connect code for a person the CALLER has already identified — the
 * operator's CLI today, an onboarding app later. Returns the plaintext code ONCE.
 */
export function createLinkCode(db, { uid, email = '', now = Date.now(), random = randomBytes } = {}) {
  if (!uid) throw new Error('createLinkCode requires a uid');
  const code = formatLinkCode(random(8));
  // One live code per user: minting a second invalidates the first, so a code
  // shoulder-surfed off an earlier screen cannot be redeemed later.
  db.codes = db.codes.filter((c) => c.uid !== uid);
  db.codes.push({
    codeSha256: sha256Hex(normalizeLinkCode(code)),
    uid,
    email,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + LINK_CODE_TTL_MS).toISOString(),
    usedAt: null,
  });
  return { code, expiresAt: new Date(now + LINK_CODE_TTL_MS).toISOString() };
}

/** Single-use, expiring redemption. Returns { uid, email } or null. */
export function redeemLinkCode(db, presented, now = Date.now()) {
  const norm = normalizeLinkCode(presented);
  if (norm.length !== 8) return null;
  for (const c of db.codes) {
    if (c.usedAt) continue;
    if (Date.parse(c.expiresAt) < now) continue;
    if (!hashMatches(norm, c.codeSha256)) continue;
    c.usedAt = new Date(now).toISOString();
    return { uid: c.uid, email: c.email || '' };
  }
  return null;
}

// ─── client credentials ──────────────────────────────────────────────────────

/**
 * Issues a connector credential for a user. `platform` is informational
 * ('claude' | 'chatgpt' | 'other') and exists so a user can revoke one
 * assistant without revoking the other.
 */
export function issueClientToken(db, { uid, email = '', platform = 'other', clientId = null, now = Date.now(), random = randomBytes } = {}) {
  if (!uid) throw new Error('issueClientToken requires a uid');
  const { token, sha256 } = mintClientToken(random);
  const record = {
    id: `lnk_${sha256.slice(0, 16)}`,
    uid,
    email,
    platform,
    clientId,
    tokenSha256: sha256,
    createdAt: new Date(now).toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
  db.links.push(record);
  return { token, record };
}

/** Constant-time lookup. Revoked links resolve to null — fail closed. */
export function findClientByToken(db, presented) {
  if (typeof presented !== 'string' || presented.length < 16) return null;
  for (const l of db.links) {
    if (l.revokedAt) continue;
    if (hashMatches(presented, l.tokenSha256)) return l;
  }
  return null;
}

export function revokeClient(db, id, now = Date.now()) {
  const l = db.links.find((x) => x.id === id);
  if (!l) return false;
  l.revokedAt = new Date(now).toISOString();
  return true;
}

/** Revokes every credential belonging to a user (the app's "disconnect all"). */
export function revokeAllForUid(db, uid, now = Date.now()) {
  let n = 0;
  for (const l of db.links) {
    if (l.uid === uid && !l.revokedAt) { l.revokedAt = new Date(now).toISOString(); n++; }
  }
  return n;
}

// ─── OAuth 2.1: dynamic client registration ──────────────────────────────────

/**
 * RFC 7591 dynamic client registration. Both platforms prefer DCR or Client ID
 * Metadata Documents over a pre-shared client_id, so accepting DCR means we do
 * not have to coordinate a static ID with either vendor.
 *
 * Public client only: no client_secret is issued, because PKCE is mandatory
 * below and a secret adds nothing for a client that cannot keep one.
 */
export function registerOAuthClient(db, { clientName = 'unnamed client', redirectUris = [], now = Date.now(), random = randomBytes } = {}) {
  const uris = (Array.isArray(redirectUris) ? redirectUris : []).filter((u) => typeof u === 'string' && u.length);
  if (uris.length === 0) throw new Error('redirect_uris must contain at least one URI');
  for (const u of uris) {
    // http is allowed ONLY for loopback (the OAuth 2.1 native-app exception).
    if (!/^https:\/\//i.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(u)) {
      throw new Error(`redirect_uri must be https or loopback http: ${u}`);
    }
  }
  const record = {
    clientId: `cli_${random(16).toString('base64url')}`,
    clientName: String(clientName).slice(0, 120),
    redirectUris: uris,
    createdAt: new Date(now).toISOString(),
  };
  db.oauthClients.push(record);
  return record;
}

export function findOAuthClient(db, clientId) {
  return db.oauthClients.find((c) => c.clientId === clientId) || null;
}

// ─── OAuth 2.1: authorization code + PKCE ────────────────────────────────────

function pkceChallengeOf(verifier) {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/**
 * Issued after the user redeems a link code on the consent page. The code is
 * stored hashed, expires in 5 minutes, and is single-use.
 */
export function createAuthCode(db, { clientId, uid, email = '', redirectUri, codeChallenge, codeChallengeMethod = 'S256', platform = 'other', now = Date.now(), random = randomBytes } = {}) {
  const client = findOAuthClient(db, clientId);
  if (!client) throw new Error('unknown client_id');
  if (!client.redirectUris.includes(redirectUri)) throw new Error('redirect_uri does not match a registered URI');
  // S256 only. "plain" is permitted by RFC 7636 but forbidden by OAuth 2.1 for
  // public clients, and accepting it would let a leaked authorization request
  // be replayed by anyone who saw the challenge.
  if (codeChallengeMethod !== 'S256') throw new Error('code_challenge_method must be S256');
  if (typeof codeChallenge !== 'string' || codeChallenge.length < 43) throw new Error('code_challenge missing or too short');

  const code = random(32).toString('base64url');
  db.authCodes.push({
    codeSha256: sha256Hex(code),
    clientId, uid, email, redirectUri, codeChallenge, platform,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + AUTH_CODE_TTL_MS).toISOString(),
    usedAt: null,
    issuedLinkId: null,
  });
  return code;
}

/**
 * Exchanges an authorization code for a client credential.
 *
 * Replay handling follows RFC 6749 §10.5 / OAuth 2.1: a code presented twice is
 * treated as compromised, so the credential it already minted is REVOKED rather
 * than left live alongside an attacker's copy.
 *
 * Returns { token, record } on success; throws with an OAuth error code string
 * in `err.oauthError` so the endpoint can render a spec-shaped response.
 */
export function exchangeAuthCode(db, { code, clientId, codeVerifier, redirectUri, now = Date.now(), random = randomBytes } = {}) {
  const fail = (oauthError, message) => {
    const e = new Error(message);
    e.oauthError = oauthError;
    return e;
  };
  const entry = db.authCodes.find((a) => hashMatches(String(code || ''), a.codeSha256));
  if (!entry) throw fail('invalid_grant', 'authorization code not found');
  if (entry.usedAt) {
    if (entry.issuedLinkId) revokeClient(db, entry.issuedLinkId, now);
    throw fail('invalid_grant', 'authorization code already used — the credential it issued has been revoked');
  }
  if (Date.parse(entry.expiresAt) < now) throw fail('invalid_grant', 'authorization code expired');
  if (entry.clientId !== clientId) throw fail('invalid_client', 'authorization code was issued to a different client');
  if (entry.redirectUri !== redirectUri) throw fail('invalid_grant', 'redirect_uri mismatch');
  if (typeof codeVerifier !== 'string' || codeVerifier.length < 43 || codeVerifier.length > 128) {
    throw fail('invalid_request', 'code_verifier must be 43-128 characters');
  }
  let derived;
  try { derived = pkceChallengeOf(codeVerifier); } catch { throw fail('invalid_grant', 'code_verifier is not valid ASCII'); }
  const a = Buffer.from(derived);
  const b = Buffer.from(String(entry.codeChallenge));
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw fail('invalid_grant', 'PKCE verification failed');

  entry.usedAt = new Date(now).toISOString();
  const issued = issueClientToken(db, {
    uid: entry.uid, email: entry.email, platform: entry.platform, clientId, now, random,
  });
  entry.issuedLinkId = issued.record.id;
  return issued;
}

/** Drops expired/consumed codes. Cheap to call on every write. */
export function pruneExpired(db, now = Date.now()) {
  const live = (x) => Date.parse(x.expiresAt) > now - 60 * 60 * 1000;   // keep an hour of history
  db.codes = db.codes.filter(live);
  db.authCodes = db.authCodes.filter(live);
  return db;
}

/** Records use for the audit trail. Best-effort; never blocks a request. */
export function touchClient(record, now = Date.now()) {
  if (record) record.lastUsedAt = new Date(now).toISOString();
  return record;
}
