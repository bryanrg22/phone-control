// openai-decisions.mjs — OpenAI's Decisions API (public beta), one choice question per step.
//
//   POST {OPENAI_BASE_URL}/decisions   { model, input, questions: [{ type: 'choice', name, instructions, choices: [{ value, description }] }] }
//   → { model, answers: [{ type: 'choice', name, choice, probabilities: [{ value, probability }], confidence }], usage }
//
// Shapes from developers.openai.com/api/docs/guides/decisions, checked with a
// real call on 2026-10-16: usage carries input_tokens, input_tokens_details
// { cached_tokens, cache_write_tokens } and output_tokens 0; the answer's
// probabilities cover every choice. gpt-6-luna is the only model. Input is
// text (or a user message with inline base64 images); the question's choices
// have no documented limit. Price: input tokens only.

import { postJSON } from './http.mjs';

const base = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
export const QUESTION_NAME = 'next_action';

export const API_INFO = { api: 'OpenAI Decisions API', endpoint: 'POST /v1/decisions', status: 'public beta (2026-10-16)', question: 'choice', input: 'text', headers: [] };

/** @param {{ model: string, instructions: string, stateText: string, candidates: Array<{ value: string, description: string }> }} o */
export function buildDecisionsRequest({ model, instructions, stateText, candidates }) {
  return {
    model,
    input: stateText,
    questions: [{ type: 'choice', name: QUESTION_NAME, instructions, choices: candidates.map((c) => ({ value: c.value, description: c.description })) }],
  };
}

/**
 * The answer to the choice question.
 * @returns {{ choice: string, probability: number|null, confidence: number|null, probabilities: Record<string, number> }}
 * @throws when the answer is missing, a refusal, or names no known choice
 */
export function parseDecisionsAnswer(json, candidates) {
  const a = (json?.answers || []).find((x) => x.name === QUESTION_NAME) || json?.answers?.[0];
  if (!a) throw new Error('the Decisions API returned no answer');
  if (a.type === 'refusal') throw new Error(`the Decisions API refused: ${JSON.stringify(a).slice(0, 200)}`);
  const probabilities = Object.fromEntries((a.probabilities || []).map((p) => [p.value, p.probability]));
  const choice = a.choice;
  if (!candidates.some((c) => c.value === choice)) throw new Error(`the Decisions API chose "${choice}", which was not offered`);
  return { choice, probability: probabilities[choice] ?? null, confidence: a.confidence ?? null, probabilities };
}

export function createOpenAIDecisions({ model, apiKey, log }) {
  const url = `${base()}/decisions`;
  return {
    provider: 'openai-decisions',
    model,
    url,
    api: API_INFO,
    /** @param {{ instructions: string, state: { object: object, text: string }, candidates: Array<{ value: string, description: string }> }} req */
    async decide({ instructions, state, candidates }) {
      const body = buildDecisionsRequest({ model, instructions, stateText: state.text, candidates });
      const r = await postJSON(url, { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body, { provider: 'openai', log });
      const u = r.json.usage || {};
      return {
        ...parseDecisionsAnswer(r.json, candidates),
        responseId: r.json.id ?? null,
        responseModel: r.json.model ?? null,
        usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, cache_read_input_tokens: u.input_tokens_details?.cached_tokens || 0, cache_write_input_tokens: u.input_tokens_details?.cache_write_tokens ?? null, reasoning_output_tokens: null },
        raw: { url, request: body, response: r.json, status: r.status, attempts: r.attempts },
      };
    },
  };
}
