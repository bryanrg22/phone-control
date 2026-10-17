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
//
// Decision models (openai-decisions, typesafe) have another shape, for the
// decision loop (../decision/loop.mjs):
//
//   const decider = createDecider({ provider: 'typesafe', model: 'jev-latest', apiKey });
//   const a = await decider.decide({ instructions, state: { object, text }, candidates });
//   a.choice, a.probability, a.confidence, a.probabilities   the answer to one choice question
//   a.usage, a.responseId, a.responseModel, a.raw            as above
//   decider.api                                              what the record says about the API (status, headers)

import { createAnthropic } from './anthropic.mjs';
import { createOpenAI } from './openai.mjs';
import { createGemini } from './gemini.mjs';
import { createOpenAIDecisions, API_INFO as OPENAI_DECISIONS_API } from './openai-decisions.mjs';
import { createTypeSafe, API_INFO as TYPESAFE_API } from './typesafe.mjs';

export const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', 'openai-decisions': 'OPENAI_API_KEY', typesafe: 'TYPESAFE_API_KEY' };
export const LLM_PROVIDERS = ['anthropic', 'openai', 'gemini'];
export const DECISION_PROVIDERS = ['openai-decisions', 'typesafe'];
export const DECISION_APIS = { 'openai-decisions': OPENAI_DECISIONS_API, typesafe: TYPESAFE_API };
export const isDecisionProvider = (provider) => DECISION_PROVIDERS.includes(provider);

// The hybrid mode: a decision model chooses, an LLM takes the steps it cannot
// (decision/escalate.mjs). Named as one --model: "<chooser>:<model>+<llm>:<model>".
export const HYBRID_PROVIDER = 'hybrid';
/** @returns {{ chooser: { provider: string, model: string }, llm: { provider: string, model: string } }} */
export function parseHybridModel(spec) {
  const [a, b, ...rest] = String(spec || '').split('+');
  if (!a || !b || rest.length) throw new Error(`a hybrid model is "<decision provider>:<model>+<llm provider>:<model>" (got "${spec}")`);
  const part = (s, allowed, what) => {
    const [provider, ...m] = s.split(':');
    const model = m.join(':');
    if (!allowed.includes(provider) || !model) throw new Error(`the ${what} of a hybrid model is one of ${allowed.join(', ')} with a model, as "provider:model" (got "${s}")`);
    return { provider, model };
  };
  return { chooser: part(a, DECISION_PROVIDERS, 'chooser'), llm: part(b, LLM_PROVIDERS, 'LLM') };
}

export function createModel({ provider, model, apiKey, temperature = null, effort = null, nativeWebSearch = true, log = () => {} }) {
  if (provider === 'anthropic') return createAnthropic({ model, apiKey, temperature, effort, nativeWebSearch, log });
  if (provider === 'openai') return createOpenAI({ model, apiKey, temperature, effort, nativeWebSearch, log });
  if (provider === 'gemini') return createGemini({ model, apiKey, temperature, log });
  throw new Error(`unknown provider "${provider}" (${LLM_PROVIDERS.join(', ')}; decision models: ${DECISION_PROVIDERS.join(', ')})`);
}

export function createDecider({ provider, model, apiKey, log = () => {} }) {
  if (provider === 'openai-decisions') return createOpenAIDecisions({ model, apiKey, log });
  if (provider === 'typesafe') return createTypeSafe({ model, apiKey, log });
  throw new Error(`unknown decision provider "${provider}" (${DECISION_PROVIDERS.join(', ')})`);
}
