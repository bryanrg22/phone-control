// typesafe.mjs — TypeSafe's Jev through the System One endpoint, one choice question per step.
//
//   POST {TYPESAFE_BASE_URL}/v1/systemone   { model, state, questions: { <id>: { type: 'choice', instructions, criteria: { <option>: description } } } }
//   → { model: 'jev-1.13.0', answers: { <id>: { type: 'choice', choice, probabilities: { <option>: p }, confidence } }, usage: { input_tokens, output_tokens } }
//
// Shapes from docs.typesafe.ai (quickstart, primitives/choice, models), read
// on 2026-10-16, and verified with real calls the same day (Add Alarm fixture,
// 24 options: 200 in ~200 ms, every field above present; no top-level id, the
// request id is the x-typesafe-request-id response header; usage reports
// output_tokens too, though only input is priced).
// state may be a string or an object (an object here: the task, the history,
// the elements as a list). A choice takes up to 255 options; a request 64k
// tokens (262k with TypeSafe-Danger-Zone-Long-Context: true, slower and less
// accurate). jev-latest = jev-1.13.0; jev-preview = jev-1.14.0 (images, box).
// Price: input tokens only. Images are not sent (text-only, as planned).

import { postJSON } from './http.mjs';

const base = () => (process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai').replace(/\/+$/, '');
export const QUESTION_ID = 'next_action';
export const MAX_OPTIONS = 255;

export const API_INFO = { api: 'TypeSafe System One (Jev)', endpoint: 'POST /v1/systemone', status: 'request format may change (docs, 2026-10-16); verified with real calls on 2026-10-16 (jev-1.13.0)', question: 'choice', input: 'structured state (object)', headers: [] };

/** @param {{ model: string, instructions: string, stateObject: object, candidates: Array<{ value: string, description: string }> }} o */
export function buildJevRequest({ model, instructions, stateObject, candidates }) {
  if (candidates.length > MAX_OPTIONS) throw new Error(`Jev takes at most ${MAX_OPTIONS} options per choice (got ${candidates.length})`);
  return {
    model,
    state: stateObject,
    questions: { [QUESTION_ID]: { type: 'choice', instructions, criteria: Object.fromEntries(candidates.map((c) => [c.value, c.description])) } },
  };
}

/**
 * The answer to the choice question.
 * @returns {{ choice: string, probability: number|null, confidence: number|null, probabilities: Record<string, number> }}
 * @throws when the answer is missing or names no known choice
 */
export function parseJevAnswer(json, candidates) {
  const a = json?.answers?.[QUESTION_ID];
  if (!a) throw new Error('Jev returned no answer');
  const probabilities = { ...(a.probabilities || {}) };
  const choice = a.choice;
  if (!candidates.some((c) => c.value === choice)) throw new Error(`Jev chose "${choice}", which was not offered`);
  return { choice, probability: probabilities[choice] ?? null, confidence: a.confidence ?? null, probabilities };
}

export function createTypeSafe({ model, apiKey, log }) {
  const url = `${base()}/v1/systemone`;
  return {
    provider: 'typesafe',
    model,
    url,
    api: API_INFO,
    /** @param {{ instructions: string, state: { object: object, text: string }, candidates: Array<{ value: string, description: string }> }} req */
    async decide({ instructions, state, candidates }) {
      const body = buildJevRequest({ model, instructions, stateObject: state.object, candidates });
      const r = await postJSON(url, { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body, { provider: 'typesafe', log });
      const u = r.json.usage || {};
      return {
        ...parseJevAnswer(r.json, candidates),
        responseId: r.json.id ?? r.headers?.get?.('x-typesafe-request-id') ?? null,
        responseModel: r.json.model ?? null,
        usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, cache_read_input_tokens: 0, cache_write_input_tokens: null, reasoning_output_tokens: null },
        raw: { url, request: body, response: r.json, status: r.status, attempts: r.attempts },
      };
    },
  };
}
