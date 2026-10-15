// gemini.mjs — Gemini through Google's OpenAI-compatible chat-completions endpoint.
//
// The loop's conversation is already in chat-completions shape, so it is sent
// as is. Gemini 3 requires each tool call's thought_signature to come back
// unchanged; keeping the reply message whole (extra fields included) does that.
// Gemini's own search grounding does not combine with function calling here,
// so Gemini gets no web search tool.

import { postJSON } from './http.mjs';

const URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export function createGemini({ model, apiKey, temperature = null, log }) {
  return {
    provider: 'gemini',
    model,
    url: URL,
    async complete({ messages, tools, onlyTools = null }) {
      const defs = tools.filter((t) => !onlyTools || onlyTools.includes(t.name)).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      const body = {
        model,
        // Fields the loop keeps for itself (bookkeeping, other providers' state) are not sent.
        messages: messages.map(({ reasoning: _r, isError: _e, round: _n, name: _t, ...m }) => m),
        ...(temperature !== null ? { temperature } : {}),
        tools: defs, tool_choice: 'auto',
      };
      const r = await postJSON(URL, { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body, { provider: 'gemini', log });
      const choice = r.json.choices?.[0] || {};
      const u = r.json.usage || {};
      return {
        message: { role: 'assistant', ...(choice.message || {}), content: choice.message?.content ?? null },
        finishReasons: [choice.finish_reason].filter(Boolean),
        responseId: r.json.id ?? null,
        responseModel: r.json.model ?? null,
        usage: { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0, cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens || 0, cache_write_input_tokens: null, reasoning_output_tokens: u.completion_tokens_details?.reasoning_tokens ?? null },
        raw: { url: URL, request: body, response: r.json, status: r.status, attempts: r.attempts },
      };
    },
  };
}
