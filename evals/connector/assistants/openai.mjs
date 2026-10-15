// openai.mjs — an OpenAI model as the assistant under test, talking to the server's tools.
//
// The same harness contract as claude.mjs, so the model is the only thing that
// changes between rows: the server's tools passed unchanged as function tools
// (name, description, input schema), every call forwarded to the server's
// tools/call, no server `instructions` (the client context is held the same
// for every model), the same reasoning effort, the same system prompt apart
// from the line naming the assistant.
//
// Responses API, manual loop, nothing stored server-side (store: false): the
// conversation is kept here, append-only, with each turn's encrypted reasoning
// passed back so the model keeps its own reasoning across tool calls.
//
// Deliberately NO fallback model: an eval must know which model answered.

import OpenAI from 'openai';

export const SYSTEM_PROMPT = `You are ChatGPT, an AI assistant made by OpenAI. The user has connected a connector named "iPhone Agent" that can operate their own iPhone. Today is ${new Date().toISOString().slice(0, 10)}.`;

const now = () => Date.now();

/**
 * @param {object} opts
 * @param {string} [opts.model]     the model under test
 * @param {string} [opts.effort]    reasoning.effort
 * @param {object} [opts.client]    injectable for tests
 */
export function createOpenAIAssistant({ model = 'gpt-6-astra', effort = 'high', client, maxToolCallsPerTurn = 60, turnTimeoutMs = 10 * 60 * 1000 } = {}) {
  const openai = client || new OpenAI({ maxRetries: 4 });
  const input = [];

  return {
    kind: 'openai',
    model,
    effort,
    describe: () => ({ kind: 'openai', model, effort, system_prompt: SYSTEM_PROMPT, max_tool_calls_per_turn: maxToolCallsPerTurn }),

    /**
     * @param {{ userText: string, tools: object[], callTool: (name, args) => Promise<{text, isError, json}>, emit: (event) => void }} turn
     * @returns {Promise<{ text: string, status: string }>}
     */
    async runTurn({ userText, tools, callTool, emit }) {
      // strict: false — strict mode would require every property, which would
      // change the tools' meaning; the schemas are passed exactly as served.
      const apiTools = tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema, strict: false }));
      input.push({ role: 'user', content: userText });
      const started = now();
      let text = '';
      let calls = 0;
      for (;;) {
        if (now() - started > turnTimeoutMs) return { text, status: 'turn_timeout' };
        const t0 = now();
        const request = {
          model, instructions: SYSTEM_PROMPT, input: structuredClone(input), tools: apiTools,
          reasoning: { effort }, store: false, include: ['reasoning.encrypted_content'], max_output_tokens: 16000,
        };
        const res = await openai.responses.create(request);
        input.push(...res.output);
        emit({
          type: 'model_call', ms: now() - t0, requested_model: model, served_model: res.model, stop_reason: res.status,
          request_id: res._request_id ?? null, incomplete: res.incomplete_details ?? null,
          usage: {
            // OTel GenAI convention, as Claude's: input_tokens includes the cached part.
            input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0,
            cache_read_input_tokens: res.usage?.input_tokens_details?.cached_tokens ?? 0, cache_write_input_tokens: 0,
            reasoning_tokens: res.usage?.output_tokens_details?.reasoning_tokens ?? 0,
          },
          // The exact exchange (the SDK adds only headers, which are never recorded).
          request, response: res,
        });
        let refused = false;
        for (const item of res.output) {
          if (item.type !== 'message') continue;
          for (const c of item.content || []) {
            if (c.type === 'output_text' && c.text) { text += (text ? '\n' : '') + c.text; emit({ type: 'assistant_text', text: c.text }); }
            if (c.type === 'refusal') refused = true;
          }
        }
        if (refused) return { text, status: 'refusal' };
        const fnCalls = res.output.filter((i) => i.type === 'function_call');
        if (res.status === 'incomplete') return { text, status: 'truncated' };
        if (!fnCalls.length) return { text, status: 'ok' };

        for (const fc of fnCalls) {
          calls += 1;
          if (calls > maxToolCallsPerTurn) return { text, status: 'tool_call_cap' };
          let args;
          try { args = JSON.parse(fc.arguments || '{}'); } catch { args = null; }
          const c0 = now();
          let result;
          if (args === null) {
            result = { text: 'error: the arguments were not valid JSON', isError: true, json: null };
          } else {
            try { result = await callTool(fc.name, args); } catch (e) {
              result = { text: `error: ${e.message}`, isError: true, json: null, transportError: true };
            }
          }
          emit({ type: 'tool_call', id: fc.call_id, name: fc.name, args: args ?? { invalid_arguments: fc.arguments }, ms: now() - c0, result: { text: result.text, isError: result.isError, json: result.json }, transport_error: !!result.transportError });
          input.push({ type: 'function_call_output', call_id: fc.call_id, output: result.text });
        }
      }
    },
  };
}
