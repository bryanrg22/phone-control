// prices.mjs — list prices, to turn recorded token counts into dollars.
//
// USD per million tokens, standard tier, as published on 2026-10-15:
//   Anthropic  https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI     https://developers.openai.com/api/docs/pricing
// Prices change; every result records tokens, so a cost can always be
// recomputed. Update the date when you update a number.

export const PRICES_AS_OF = '2026-10-15';

export const PRICES = {
  'claude-fable-5-1': { input: 10, cache_write: 12.5, cache_read: 0.25, output: 50 },
  'claude-opus-5-5': { input: 4, cache_write: 5, cache_read: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cache_write: 2.5, cache_read: 0.1, output: 10 },
  'claude-haiku-5-5': { input: 0.1, cache_write: 0.125, cache_read: 0.01, output: 0.5 },   // prompts up to 100k tokens
  'gpt-6-astra': { input: 10, cache_read: 1, output: 50 },
  'gpt-6.1-sol': { input: 2, cache_read: 0.1, output: 10 },
  'gpt-6-luna': { input: 0.1, cache_read: 0.01, output: 0.5 },
  'gpt-5.4-mini': { input: 0.75, cache_read: 0.075, output: 4.5 },
  // Decision models: input tokens only (output is free). The Decisions API uses
  // gpt-6-luna at the same input rate; its responses report output_tokens 0.
  // TypeSafe https://docs.typesafe.ai/models (2026-10-16)
  'jev-latest': { input: 0.042, output: 0 },
  'jev-preview': { input: 0.042, output: 0 },
  'jev-1.13.0': { input: 0.042, output: 0 },
  'jev-1.14.0': { input: 0.042, output: 0 },
};

/**
 * Dollars for one usage record, or null when the model has no listed price.
 * Usage follows the OpenTelemetry GenAI convention, for every provider:
 * input_tokens INCLUDES the cached part (cache_read_input_tokens) and the part
 * written to the cache (cache_write_input_tokens); each part is billed at its
 * own rate and the rest at the input rate.
 */
export function costOf(model, u) {
  const p = PRICES[model];
  if (!p) return null;
  const read = u.cache_read_input_tokens || 0;
  const write = u.cache_write_input_tokens || 0;
  const fresh = Math.max(0, (u.input_tokens || 0) - read - write);
  return (fresh * p.input + read * p.cache_read + write * (p.cache_write ?? p.input) + (u.output_tokens || 0) * p.output) / 1e6;
}
