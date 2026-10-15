// llm-client.mjs — provider config + LLM transport for agent.mjs.
//
// Extracted from agent.mjs (D2 refactor, 2026-07-17) so the retry/abort
// classification logic is importable and unit-testable
// (agent/test/nonrecoverable.test.mjs imports isNonRecoverableAPIError directly).
//
// NO top-level side effects and NO module-global mutable state: everything an
// LLM call needs (provider, model, key, temperature, tool schemas, sent-image
// dims) is threaded through a context object built by createLLMClient(ctx).
// agent.mjs keeps owning its mutable state and passes getters/callbacks.
// Only repo-local dependency-free imports (CI runs tests without node_modules).

import { convertMessagesForClaude } from './claude-messages.mjs';
import { parseJsonAction, mapLocalModelAction } from './local-adapter.mjs';
import { chatToResponsesInput, toolsToResponses, normalizeResponsesResponse } from './responses-adapter.mjs';

// ─── Provider config ───
// The base URL of each provider can be redirected with the same variables the
// providers' own SDKs read (ANTHROPIC_BASE_URL, OPENAI_BASE_URL): for a proxy,
// or for the test suite's fake model (agent/test/rig/fake-model.mjs).
const base = (envName, dflt) => (process.env[envName] || dflt).replace(/\/+$/, '');
export const LLM_CONFIG = {
  // OpenAI runs on the Responses API (2026-08 migration) — chat-completions
  // is frozen; every new capability (native web_search, computer use, …)
  // ships on /v1/responses only. The `local` provider below keeps the
  // chat-completions shape (Ollama's compat endpoint).
  openai: {
    url: `${base('OPENAI_BASE_URL', 'https://api.openai.com/v1')}/responses`,
    keyEnv: 'OPENAI_API_KEY',
    keyHint: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyEnv: 'GEMINI_API_KEY',
    keyHint: 'https://aistudio.google.com/apikey',
  },
  anthropic: {
    url: `${base('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')}/v1/messages`,
    keyEnv: 'ANTHROPIC_API_KEY',
    keyHint: 'https://console.anthropic.com/settings/keys',
  },
  // Local Ollama (OpenAI-compatible endpoint). No API key, NO rate limits — runs on this
  // machine. Start with `ollama serve` + `ollama pull <model>`, then pass the model via
  // --model (e.g. --provider local --model qwen2.5vl:7b). Uses the same OpenAI-compat
  // request path as gemini, so vision (image_url) + tools work if the model supports them.
  local: {
    url: 'http://localhost:11434/v1/chat/completions',
    keyEnv: 'OLLAMA_API_KEY',
    keyHint: 'Ollama needs no key — just run `ollama serve` and `ollama pull <model>`',
    noKey: true,
  },
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// An API error is "non-recoverable" when retrying cannot possibly help: bad/missing
// auth, exhausted credits/billing, or permanently-insufficient quota. These differ
// fundamentally from transient 429/529 (rate-limit/overload), which DO clear on retry.
//
// Why this matters (seen 2026-05-28): when the Anthropic account
// ran out of credits mid-run, EVERY LLM call returned 400 "credit balance is too low".
// The old loop logged "[AI] ERROR", slept 2s, and continued — burning all steps until
// max-steps, so an account problem was reported as the agent failing the task. So on
// a non-recoverable error we throw a tagged error; the step loop aborts the whole run
// with exit code 42, which means "errored", not "failed".
//
// Surgical on purpose: only auth (401/403/402) and explicit billing/quota messages
// trip this. A generic 400 (e.g. a one-off malformed request) stays on the old
// log-and-continue path so a transient request-shape glitch can't kill an otherwise
// healthy run.
export function isNonRecoverableAPIError(status, bodyText, prov) {
  if (status === 401 || status === 403 || status === 402) return true; // auth / forbidden / payment-required
  // Gemini's free tier returns 429 "exceeded your current quota" for its PER-MINUTE
  // rate limit, which RESETS within ~60s (verified 2026-05-29: a call succeeds seconds
  // later) — UNLIKE OpenAI's insufficient_quota, a hard billing cap. So for gemini let a
  // 429 fall through to the backoff-retry below (exp backoff to 60s x8 outlasts the
  // per-minute window) instead of aborting the whole run.
  if (prov === 'gemini' && status === 429) return false;
  const b = (bodyText || '').toLowerCase();
  // Billing / credit / quota exhaustion — Anthropic surfaces it as 400 ("credit
  // balance is too low ... Plans & Billing ... purchase credits"); OpenAI as 429
  // with "insufficient_quota" / "exceeded your current quota". The account needs
  // funds — no amount of retrying will clear it.
  return /credit balance|insufficient_quota|insufficient quota|exceeded your current quota|billing|purchase credits/.test(b);
}

// Fetch wrapper with rate-limit (429) + overload (529) backoff. Without this a
// single transient rate-limit kills the whole run (verified 2026-05-28 — the
// agent threw immediately on 429 and exited code 1).
// Now it respects Retry-After, falls back to exponential backoff + jitter
// (capped at 60s, since the ITPM window is per-minute), and retries up to
// maxRetries before giving up. Net effect: an unattended run SLOWS DOWN under
// rate limits instead of dying. Non-recoverable errors (auth/billing/quota) are
// tagged and thrown immediately so the caller can abort the whole run.
export async function fetchLLMWithRetry(url, options, { maxRetries = 8, provider } = {}) {
  // A single LLM call should never take minutes. Without a timeout, a hung/half-open connection
  // — or the machine SLEEPING mid-request (what stalled the baseline when the laptop was closed)
  // — stalls the ENTIRE run silently. AbortSignal.timeout caps each attempt; a timeout/network
  // error is retried with backoff (like a 429), so the run recovers (e.g. on wake) instead of dying.
  const LLM_TIMEOUT_MS = 120_000;
  for (let attempt = 0; ; attempt++) {
    let resp;
    try {
      resp = await fetch(url, { ...options, signal: AbortSignal.timeout(LLM_TIMEOUT_MS) });
    } catch (netErr) {
      if (attempt < maxRetries) {
        const waitMs = Math.min(60000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
        console.log(`[API] request error (${netErr?.name || 'network'}: ${String(netErr?.message || netErr).slice(0, 80)}) — retry ${attempt + 1}/${maxRetries} in ${(waitMs / 1000).toFixed(1)}s`);
        await sleep(waitMs);
        continue;
      }
      const e = new Error(`LLM request failed after ${maxRetries} retries: ${String(netErr?.message || netErr).slice(0, 120)}`);
      e.nonRecoverable = true; e.status = 0;   // exhausted transient failure → ERRORED (exit 42), not a task-fail
      throw e;
    }
    if (resp.ok) return resp;
    const errText = await resp.text().catch(() => '');
    // Non-recoverable (auth/billing/quota): abort immediately, tagged. Checked
    // BEFORE the 429 retry branch because OpenAI returns 429 for BOTH transient
    // rate-limits AND permanent insufficient_quota — only the body distinguishes them.
    if (isNonRecoverableAPIError(resp.status, errText, provider)) {
      const e = new Error(`API error ${resp.status}: ${errText.slice(0, 200)}`);
      e.nonRecoverable = true;
      e.status = resp.status;
      throw e;
    }
    // Retryable transient statuses: 429/529 (rate-limit/overload) PLUS provider-incident
    // 5xx — OpenAI/Gemini surface outages as 500/502/503/504 (Anthropic uses 529).
    // Without retrying 5xx, a provider incident failed EVERY step until max-steps and
    // masqueraded as a task failure — the same class as the billing-400 problem.
    const retryableTransient = resp.status === 429 || resp.status === 529 ||
      resp.status === 500 || resp.status === 502 || resp.status === 503 || resp.status === 504;
    if (retryableTransient && attempt < maxRetries) {
      const retryAfterS = parseFloat(resp.headers.get('retry-after')) || 0;
      const expBackoffMs = Math.min(60000, 1000 * 2 ** attempt);
      const waitMs = Math.max(retryAfterS * 1000, expBackoffMs) + Math.floor(Math.random() * 500);
      console.log(`[API] ${resp.status} transient (attempt ${attempt + 1}/${maxRetries}) — backing off ${(waitMs / 1000).toFixed(1)}s. ${errText.slice(0, 100)}`);
      await sleep(waitMs);
      continue;
    }
    // Out of retries (or a non-transient error). A rate-limit/5xx that survived EVERY
    // retry is an infra problem (provider saturated/down), not a task failure — tag it
    // so the step loop ends the run as an error (exit 42) instead of
    // burning steps to max-steps, which would masquerade as a task fail.
    const e = new Error(`API error ${resp.status}: ${errText.slice(0, 200)}`);
    if (retryableTransient) { e.nonRecoverable = true; e.status = resp.status; }
    throw e;
  }
}

// ─── Claude API helpers (native format differs from OpenAI) ───
export function normalizeClaudeResponse(data) {
  const content = data.content || [];
  const text = content.filter(c => c.type === 'text').map(c => c.text).join('') || null;
  const toolUses = content.filter(c => c.type === 'tool_use');
  const message = { role: 'assistant', content: text };
  if (toolUses.length > 0) {
    message.tool_calls = toolUses.map(tu => ({ id: tu.id, type: 'function', function: { name: tu.name, arguments: JSON.stringify(tu.input) } }));
  }
  return { choices: [{ message }], model: data.model ?? null, usage: { prompt_tokens: data.usage?.input_tokens, completion_tokens: data.usage?.output_tokens, cache_creation_input_tokens: data.usage?.cache_creation_input_tokens, cache_read_input_tokens: data.usage?.cache_read_input_tokens } };
}

// POST the request body; if the provider 400s specifically on the `temperature`
// param (a model the static supportsTemperature rule didn't know), drop it, invoke
// onTemperatureUnsupported() (agent.mjs records 'unsupported:<model>'), and retry
// ONCE without it. Any other error propagates untouched.
export async function fetchLLMWithTemperatureFallback(body, headers, { maxRetries, url, provider, onTemperatureUnsupported }) {
  try {
    return await fetchLLMWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) }, { maxRetries, provider });
  } catch (e) {
    const temperatureRejected = 'temperature' in body && !e.nonRecoverable &&
      /temperature/i.test(String(e.message || '')) && /(unsupported|does not support|invalid)/i.test(String(e.message || ''));
    if (!temperatureRejected) throw e;
    onTemperatureUnsupported();
    delete body.temperature;
    return await fetchLLMWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) }, { maxRetries, provider });
  }
}

// ─── LLM API call (supports OpenAI, Gemini, Anthropic, and local/Ollama) ───
//
// ctx (all state lives in agent.mjs — this module holds none):
//   provider, modelName, apiKey, url      — static per run
//   noToolsMode                           — static per run
//   toolDefs, openaiTools                 — array refs (post --disable-tools filtering)
//   getTemperature()                      — number | null (mutable: runtime fallback can clear it)
//   markTemperatureUnsupported()          — records 'unsupported:<model>' + logs
//   getSentImageSize()                    — { w, h } of the image actually sent last turn
//                                           (local-adapter pixel→% conversion; audit #2/#10)
// Pure helper: restrict a tool-def list to the named subset (order preserved).
// Used by the forced-done final step — on the last step the model gets ONLY
// taskComplete/taskFailed so every run ends with an explicit verdict instead of
// silent budget exhaustion. Exported for unit tests.
export function filterToolDefs(defs, onlyTools) {
  if (!onlyTools) return defs;
  return defs.filter(d => onlyTools.includes(d.name ?? d.function?.name));
}

export function createLLMClient(ctx) {
  // Tool-less model: synthesize an OpenAI tool_calls array from the JSON action in the
  // message content, so the rest of the loop (which reads message.tool_calls) is unchanged.
  // Coordinate conversion uses the ACTUAL sent-image dimensions (audit fix #2/#10).
  function injectToolCallFromJSON(data) {
    const msg = data?.choices?.[0]?.message;
    if (msg && !(msg.tool_calls?.length)) {
      const act = parseJsonAction(msg.content || '');
      if (act) {
        const { w, h } = ctx.getSentImageSize();
        const mapped = mapLocalModelAction(act.name, act.args, { sentW: w, sentH: h });
        msg.tool_calls = [{ id: `call_${Date.now()}`, type: 'function', function: { name: mapped.name, arguments: JSON.stringify(mapped.args || {}) } }];
      }
    }
    return data;
  }

  async function callLLM(messages, { useTools = true, maxRetries = 8, onlyTools = null } = {}) {
    const { provider, modelName, apiKey, url, noToolsMode } = ctx;
    // onlyTools (forced-done final step): restrict the registry for THIS call.
    const toolDefs = filterToolDefs(ctx.toolDefs, onlyTools);
    const openaiTools = filterToolDefs(ctx.openaiTools, onlyTools);
    const fallbackOpts = { maxRetries, url, provider, onTemperatureUnsupported: ctx.markTemperatureUnsupported };
    const requestedTemperature = ctx.getTemperature();

    if (provider === 'anthropic') {
      const { system, messages: claudeMessages } = convertMessagesForClaude(messages, { noToolsMode });
      const body = { model: modelName, max_tokens: 8096, messages: claudeMessages };
      if (requestedTemperature !== null) body.temperature = requestedTemperature;
      // Prompt caching: mark system prompt + tool definitions as ephemeral.
      // Cache hits don't count toward ITPM on modern Claude models (incl. Sonnet 4.6).
      // TTL is 5 min sliding window, reset on each read.
      if (system) body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
      if (useTools && !noToolsMode) {
        const defs = toolDefs.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
        // Native web search (server-side tool, verified 2026-08-02): Anthropic
        // runs the searches inside the request and returns cited results.
        // web_search_20250305 = the basic version — broadest model support
        // (newer versions default to code-execution callers that not every
        // model supports). Brave's webSearch tool is dropped from toolDefs by
        // agent.mjs when this is on, so the model never sees two search tools.
        // No server-side web search on a restricted (forced-done) call — the model
        // must conclude, not research.
        if (ctx.nativeWebSearch && !onlyTools) defs.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 3 });
        if (defs.length > 0) defs[defs.length - 1].cache_control = { type: 'ephemeral' };
        body.tools = defs;
        body.tool_choice = { type: 'auto' };
      }
      const resp = await fetchLLMWithTemperatureFallback(body,
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, fallbackOpts);
      const cdata = normalizeClaudeResponse(await resp.json());
      // #15: --no-tools parity works for anthropic too — synthesize tool_calls from JSON text.
      return (useTools && noToolsMode) ? injectToolCallFromJSON(cdata) : cdata;
    }

    if (provider === 'openai') {
      // Responses API (2026-08 migration; shapes verified against docs).
      // The loop's chat-shape messages/tools are converted at the boundary
      // and the response normalized back, so the loop is unchanged.
      const { instructions, input } = chatToResponsesInput(messages);
      const body = { model: modelName, input, store: false };
      if (instructions) body.instructions = instructions;
      if (requestedTemperature !== null) body.temperature = requestedTemperature;
      if (useTools && !noToolsMode) {
        body.tools = toolsToResponses(openaiTools, { nativeWebSearch: !!ctx.nativeWebSearch && !onlyTools });
        body.tool_choice = 'auto';
      }
      const resp = await fetchLLMWithTemperatureFallback(body,
        { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, fallbackOpts);
      const rdata = normalizeResponsesResponse(await resp.json());
      return (useTools && noToolsMode) ? injectToolCallFromJSON(rdata) : rdata;
    }

    // gemini (OpenAI-compat) + local (Ollama) stay on the chat-completions
    // shape. Gemini native (google_search grounding) is blocked for us:
    // grounding only composes with function calling on Gemini 3 models
    // (ai.google.dev docs, verified 2026-08-02) — our pinned 2.5 models
    // can't, so gemini keeps the Brave webSearch tool.
    const body = { model: modelName, messages };
    if (requestedTemperature !== null) body.temperature = requestedTemperature;
    if (useTools && !noToolsMode) { body.tools = openaiTools; body.tool_choice = 'auto'; }
    const resp = await fetchLLMWithTemperatureFallback(body,
      { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, fallbackOpts);
    const data = await resp.json();
    return (useTools && noToolsMode) ? injectToolCallFromJSON(data) : data;
  }

  return { callLLM };
}
