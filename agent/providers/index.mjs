// providers/index.mjs — one model client per provider, all with the same shape:
//
//   const model = createModel({ provider: 'anthropic', model: 'claude-opus-5-5', apiKey });
//   const r = await model.complete({ messages, tools, onlyTools });
//   r.message          the assistant message, in the loop's format
//   r.usage            { input_tokens (incl. cached), output_tokens, cache_read_input_tokens, cache_write_input_tokens, reasoning_output_tokens }
//   r.finishReasons, r.responseId, r.responseModel
//   r.raw              { url, request, response, status, attempts } — the exact exchange, for the run record
//
// A failed request throws with .status, .nonRecoverable and .attempts.

import { createAnthropic } from './anthropic.mjs';
import { createOpenAI } from './openai.mjs';
import { createGemini } from './gemini.mjs';

export const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };

export function createModel({ provider, model, apiKey, temperature = null, effort = null, nativeWebSearch = true, log = () => {} }) {
  if (provider === 'anthropic') return createAnthropic({ model, apiKey, temperature, effort, nativeWebSearch, log });
  if (provider === 'openai') return createOpenAI({ model, apiKey, temperature, effort, nativeWebSearch, log });
  if (provider === 'gemini') return createGemini({ model, apiKey, temperature, log });
  throw new Error(`unknown provider "${provider}" (anthropic, openai, gemini)`);
}
