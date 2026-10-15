// models.mjs — single source of truth for default model IDs per provider.
//
// These are what agent.mjs uses when it is run with --provider and no --model.
// The server always passes --model (see server/src/models.mjs), so they matter
// only when the agent is run by hand.
//
// PINNED ON PURPOSE — not auto-"latest". A brand-new model can change cost,
// latency or behaviour, or drop a feature the agent depends on (tool calling,
// vision). To adopt a newer model: test it, then change the one line here.

export const DEFAULT_MODELS = {
  // 2026-08-02 cutover to the newest generation per provider (all IDs
  // confirmed against each provider's live /models endpoint that day):
  anthropic: 'claude-sonnet-5',     // newest Sonnet tier. List-verified only — no API credits
                                    // for a live run at cutover time; first run is the real test.
  openai: 'gpt-5.6-terra',          // balanced 5.6 tier (Sol=flagship, Luna=fast/cheap).
                                    // Live-verified: /v1/responses + vision + function call.
  gemini: 'gemini-3.6-flash',       // newest Flash. Live-verified: OpenAI-compat + vision + tools.
                                    // NOTE: Gemini 3.x REQUIRES echoing thought_signature on
                                    // tool-call messages (400 without it) — we already append the
                                    // raw response message, which preserves extra_content.
  local: 'qwen2.5vl:7b',            // Ollama vision model; tool-free path
};

// The simple screenshot-loop runners (run.mjs / run-phone.mjs) intentionally default to the
// cheaper/faster Flash-Lite — they're the lightweight, gemini-only path, not the tool agent.
// (Kept distinct on purpose; change it here if that ever stops being the right tradeoff.)
export const SIMPLE_RUNNER_MODEL = 'gemini-3.5-flash-lite'; // newest lite (live hello-verified 2026-08-02)

// Resolve the default model for a provider. Unknown provider → gemini's default,
// matching the else-branch of the inline ternaries this replaced.
export function defaultModelFor(provider) {
  return DEFAULT_MODELS[provider] ?? DEFAULT_MODELS.gemini;
}

// ─── Temperature support ───
//
// Can `temperature: value` be sent to this provider/model without a 400?
//
// OpenAI reasoning-family models (gpt-5*, o1/o3/o4*) REJECT any non-default
// temperature. VERIFIED LIVE 2026-07-17 on the pinned gpt-5.5:
//   temperature: 0 → 400 invalid_request_error, code "unsupported_value",
//     param "temperature", message "Only the default (1) value is supported."
//   temperature: 1 → accepted (model gpt-5.5-2026-04-23).
// So for that family only the explicit default (1) may be sent.
//
// Anthropic (Messages API: temperature 0..1) and Gemini (OpenAI-compat endpoint
// maps temperature through to generationConfig) accept it per their official API
// docs — SUSPECTED [S], not live-verified here (no credits on those accounts).
// Ollama's OpenAI-compat endpoint accepts temperature (docs).
//
// Caller: agent.mjs decides whether to put `temperature` in the request body
// and what "effective temperature" to log.
const OPENAI_FIXED_TEMPERATURE_MODELS = /^(gpt-5|o1|o3|o4)/i;

export function supportsTemperature(provider, model, value) {
  if (provider === 'openai' && OPENAI_FIXED_TEMPERATURE_MODELS.test(String(model))) {
    return Number(value) === 1; // only the explicit default is accepted (verified live)
  }
  return true;
}
