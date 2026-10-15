// http.mjs — one POST to a model provider, with the retry policy every provider shares.
//
// Retried with backoff (Retry-After when given, else exponential with jitter,
// capped at 60 s): network errors and timeouts, 429, 529, and 500/502/503/504.
// Not retried, and tagged nonRecoverable so the run ends as ERRORED (exit 42)
// instead of burning its steps: auth (401/402/403), billing or quota messages,
// and a transient error that outlived every retry. Every attempt is returned
// for the run record, so a slow step can be traced to a provider's 429s.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT_MS = 120_000;
const TRANSIENT = new Set([429, 500, 502, 503, 504, 529]);

/** True when retrying cannot help: bad auth, no credit, a hard quota. */
export function isNonRecoverable(status, bodyText, provider) {
  if (status === 401 || status === 402 || status === 403) return true;
  // Gemini's free tier answers its per-minute limit with 429 "exceeded your
  // current quota", which clears within a minute: let it retry.
  if (provider === 'gemini' && status === 429) return false;
  return /credit balance|insufficient_quota|insufficient quota|exceeded your current quota|billing|purchase credits/
    .test(String(bodyText || '').toLowerCase());
}

function fail(message, { status = null, nonRecoverable = false, attempts, body = null }) {
  const e = new Error(message);
  e.status = status; e.nonRecoverable = nonRecoverable; e.attempts = attempts; e.responseBody = body;
  return e;
}

/**
 * @returns {Promise<{ status: number, json: object, headers: Headers, attempts: object[] }>}
 * @throws an Error with .status, .nonRecoverable, .attempts, .responseBody
 */
export async function postJSON(url, headers, body, { provider, maxRetries = 8, log = () => {} } = {}) {
  const attempts = [];
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    let resp;
    try {
      resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      attempts.push({ status: 0, ms: Date.now() - t0, error: `${e.name}: ${String(e.message).slice(0, 120)}` });
      if (attempt < maxRetries) {
        const wait = Math.min(60000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
        log(`[API] request error (${e.name}) — retry ${attempt + 1}/${maxRetries} in ${(wait / 1000).toFixed(1)}s`);
        await sleep(wait);
        continue;
      }
      throw fail(`model request failed after ${maxRetries} retries: ${String(e.message).slice(0, 120)}`, { status: 0, nonRecoverable: true, attempts });
    }
    const text = await resp.text();
    attempts.push({ status: resp.status, ms: Date.now() - t0, request_id: resp.headers.get('request-id') || resp.headers.get('x-request-id') || null });
    if (resp.ok) {
      let json;
      try { json = JSON.parse(text); } catch { throw fail(`model returned non-JSON (${text.slice(0, 80)})`, { status: resp.status, attempts, body: text }); }
      return { status: resp.status, json, headers: resp.headers, attempts };
    }
    if (isNonRecoverable(resp.status, text, provider)) {
      throw fail(`API error ${resp.status}: ${text.slice(0, 200)}`, { status: resp.status, nonRecoverable: true, attempts, body: text });
    }
    if (TRANSIENT.has(resp.status) && attempt < maxRetries) {
      const after = parseFloat(resp.headers.get('retry-after')) || 0;
      const wait = Math.max(after * 1000, Math.min(60000, 1000 * 2 ** attempt)) + Math.floor(Math.random() * 500);
      log(`[API] ${resp.status} (attempt ${attempt + 1}/${maxRetries}) — backing off ${(wait / 1000).toFixed(1)}s`);
      await sleep(wait);
      continue;
    }
    // Out of retries on a transient error is a provider problem, not the
    // task's; any other error (a malformed request) is reported to the loop.
    throw fail(`API error ${resp.status}: ${text.slice(0, 200)}`, { status: resp.status, nonRecoverable: TRANSIENT.has(resp.status), attempts, body: text });
  }
}
