// user-sim.mjs — a person, played by a model, for cases where a fixed script
// cannot follow the conversation.
//
// A scripted user says its lines in a fixed order. An assistant that asks a
// sensible question first ("what time?") then gets each answer one turn early,
// and the case fails for the script's sake, not the assistant's
// (hitl-two-questions, 2026-10-16: three of five failures). The standard
// answer is τ-bench's: a model plays the user from a written instruction, one
// line at a time, revealing only what the moment needs, never inventing
// details, and ending with ###STOP### once the goal is met
// (sierra-research/tau-bench, tau_bench/envs/user.py).
//
// Kept from τ-bench: the instruction-driven prompt and its rules, the stop
// token, and ONE fixed simulator model for every assistant, so all of them
// face the same user. Changed: the opening line is the case's own first line
// rather than a generated one, so every trial starts from the same request;
// and a turn limit ends a conversation that goes nowhere.
//
// The simulator sees only what a person would: their own lines and the
// assistant's replies. Never the tool calls, so it cannot answer a question
// the assistant did not put to it. Every call is recorded like any model call.

import { createHash } from 'node:crypto';

export const STOP = '###STOP###';

export const USER_SIM_PROMPT = `You are a user talking to an AI assistant that can operate your iPhone for you.

Instruction (who you are and what you want):
{instruction}

Rules:
- Write only your next message to the assistant, one line, as this person would type it.
- Do not give away the whole instruction at once. Give a detail only when the assistant asks for it, offers it as a choice, or the conversation clearly needs it.
- Never invent details the instruction does not give. If the assistant asks for something the instruction does not cover, say you don't know or don't mind.
- Do not repeat the instruction word for word; say it in your own words.
- If the assistant asks you to confirm something that matches what you want, confirm it. If it does not match, say so.
- When the assistant tells you your goal is done, or it is clear it cannot be done, reply with ${STOP} alone and nothing else.`;

export const USER_SIM_PROMPT_HASH = createHash('sha256').update(USER_SIM_PROMPT).digest('hex').slice(0, 12);

/**
 * The simulator's view of a conversation, with roles flipped as in τ-bench:
 * the person's own lines are its "assistant" turns, the assistant's replies
 * its "user" turns.
 * @param {{ user: string, text: string }[]} turns
 */
export function simulatorHistory(turns) {
  const out = [];
  for (const t of turns) {
    out.push({ role: 'assistant', content: t.user });
    out.push({ role: 'user', content: t.text?.trim() ? t.text : '(the assistant replied with no text)' });
  }
  return out;
}

/** The simulator's raw reply → { stop } or { text }. */
export function parseUserReply(raw) {
  const text = String(raw ?? '').trim().replace(/^["“](.*)["”]$/s, '$1').trim();
  if (!text) return { stop: false, text: null, error: 'the simulated user returned nothing' };
  if (text.includes(STOP)) return { stop: true, text: null };
  return { stop: false, text };
}

/**
 * @param {{ provider: 'openai'|'anthropic', model: string, instruction: string, client?: object }} opts
 */
export async function createSimulatedUser({ provider, model, instruction, client }) {
  const system = USER_SIM_PROMPT.replace('{instruction}', instruction);
  const describe = () => ({ provider, model, prompt_hash: USER_SIM_PROMPT_HASH, instruction });

  if (provider === 'openai') {
    const OpenAI = (await import('openai')).default;
    const openai = client || new OpenAI({ maxRetries: 4 });
    return {
      describe,
      /** @returns {Promise<{ stop, text, error?, call }>} call is the recorded exchange */
      async next(turns) {
        const t0 = Date.now();
        const request = { model, instructions: system, input: simulatorHistory(turns), reasoning: { effort: 'low' }, store: false, max_output_tokens: 2000 };
        const res = await openai.responses.create(request);
        return {
          ...parseUserReply(res.output_text),
          call: {
            model: res.model, ms: Date.now() - t0, request_id: res._request_id ?? null,
            usage: { input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0, cache_read_input_tokens: res.usage?.input_tokens_details?.cached_tokens ?? 0, cache_write_input_tokens: 0 },
            request, response: res,
          },
        };
      },
    };
  }

  if (provider === 'anthropic') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = client || new Anthropic({ maxRetries: 4 });
    return {
      describe,
      async next(turns) {
        const t0 = Date.now();
        // The person speaks first, but the Messages API must open with a user
        // turn: a neutral one stands in front of the history.
        const request = { model, max_tokens: 2000, system, messages: [{ role: 'user', content: '(The conversation starts. Write your first message.)' }, ...simulatorHistory(turns)], output_config: { effort: 'low' } };
        const res = await anthropic.messages.create(request);
        const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
        return {
          ...parseUserReply(raw),
          call: {
            model: res.model, ms: Date.now() - t0, request_id: res._request_id ?? null,
            usage: { input_tokens: (res.usage?.input_tokens || 0) + (res.usage?.cache_read_input_tokens || 0) + (res.usage?.cache_creation_input_tokens || 0), output_tokens: res.usage?.output_tokens || 0, cache_read_input_tokens: res.usage?.cache_read_input_tokens || 0, cache_write_input_tokens: res.usage?.cache_creation_input_tokens || 0 },
            request, response: res,
          },
        };
      },
    };
  }

  throw new Error(`unknown user-simulator provider "${provider}" (openai | anthropic)`);
}
