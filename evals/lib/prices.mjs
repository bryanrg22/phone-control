// prices.mjs — list prices, to turn recorded token counts into dollars.
//
// USD per million tokens, standard tier, as published on 2026-10-15:
//   Anthropic  https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI     https://developers.openai.com/api/docs/pricing
// Prices change; every result records tokens, so a cost can always be
// recomputed. Update the date when you update a number.

export const PRICES_AS_OF = '2026-10-15';

export const PRICES = {
  // Anthropic: input excludes cache reads and writes, which are billed separately.
  'claude-fable-5-1': { input: 10, cache_write: 12.5, cache_read: 0.25, output: 50 },
  'claude-opus-5-5': { input: 4, cache_write: 5, cache_read: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cache_write: 2.5, cache_read: 0.1, output: 10 },
  'claude-haiku-5-5': { input: 0.1, cache_write: 0.125, cache_read: 0.01, output: 0.5 },   // prompts up to 100k tokens
  // OpenAI: input INCLUDES the cached part, which is billed at the cached rate.
  'gpt-6-astra': { input: 10, cache_read: 1, output: 50 },
  'gpt-6.1-sol': { input: 2, cache_read: 0.1, output: 10 },
  'gpt-6-luna': { input: 0.1, cache_read: 0.01, output: 0.5 },
  'gpt-5.4-mini': { input: 0.75, cache_read: 0.075, output: 4.5 },
};

/**
 * Dollars for one usage record, or null when the model has no listed price.
 * @param {'anthropic'|'openai'} provider  decides how cached tokens are counted
 */
export function costOf(provider, model, u) {
  const p = PRICES[model];
  if (!p) return null;
  const M = 1e6;
  const out = (u.output_tokens || 0) * p.output;
  if (provider === 'openai') {
    const cached = u.cache_read_input_tokens || 0;
    return ((Math.max(0, (u.input_tokens || 0) - cached) * p.input) + cached * p.cache_read + out) / M;
  }
  return ((u.input_tokens || 0) * p.input + (u.cache_read_input_tokens || 0) * p.cache_read
    + (u.cache_creation_input_tokens || 0) * (p.cache_write ?? p.input) + out) / M;
}
