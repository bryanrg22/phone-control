// models.mjs — the default model per provider, and which models take a temperature.
//
// The server always names the model (server/src/models.mjs), so these defaults
// only matter when the agent is run by hand. Pinned, not "latest": a new model
// changes cost and behaviour, so it is adopted by testing it, then changing a line.

export const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-5-5',   // ran the iOSWorld smoke task end to end, 2026-10-15
  openai: 'gpt-6-luna',             // the server's default; same smoke task, 2026-10-15
  gemini: 'gemini-3.6-flash',
  // Decision models (agent/decision/): a choice among the actions on screen, not a conversation.
  'openai-decisions': 'gpt-6-luna',   // the only model of the Decisions API (public beta); a real call answered on 2026-10-16
  typesafe: 'jev-latest',             // = jev-1.13.0 (stable, text); jev-preview = 1.14.0 adds images and box
  hybrid: 'openai-decisions:gpt-6-luna+openai:gpt-6-luna',   // the chooser and the LLM it escalates to (agent/decision/escalate.mjs)
};

export function defaultModelFor(provider) {
  return DEFAULT_MODELS[provider] ?? DEFAULT_MODELS.anthropic;
}

// OpenAI's reasoning models reject any temperature but the default 1 (verified
// on gpt-5.5, 2026-07-17: 400 "Only the default (1) value is supported."). The
// GPT-6 family are reasoning models too.
const OPENAI_FIXED_TEMPERATURE = /^(gpt-[5-9]|o\d)/i;

export function supportsTemperature(provider, model, value) {
  if (provider === 'openai' && OPENAI_FIXED_TEMPERATURE.test(String(model))) return Number(value) === 1;
  return true;
}
