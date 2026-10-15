// claude.mjs — Claude as the assistant under test, talking to the server's tools.
//
// The harness is the MCP client here: it lists the server's tools, gives them
// to Claude unchanged (name, description, input schema), and forwards every
// tool_use to the server's tools/call, returning the server's own text. That
// is what Claude's apps do with a custom connector, minus their system prompt,
// which is not public. Claude's apps also drop a server's `instructions`
// (anthropics/claude-ai-mcp#93), so none are passed here either.
//
// A manual loop, not the SDK's tool runner, because every request and every
// tool call has to be recorded and routed through the harness.
//
// Deliberately NO refusal fallback: an eval must know which model answered.
// A refusal is recorded as the turn's outcome, not hidden by a reroute.

import Anthropic from '@anthropic-ai/sdk';

export const SYSTEM_PROMPT = `You are Claude, an AI assistant made by Anthropic. The user has connected a connector named "iPhone Agent" that can operate their own iPhone. Today is ${new Date().toISOString().slice(0, 10)}.`;

const now = () => Date.now();

/**
 * @param {object} opts
 * @param {string} [opts.model]     the model under test
 * @param {string} [opts.effort]    output_config.effort
 * @param {object} [opts.client]    injectable for tests
 */
export function createClaudeAssistant({ model = 'claude-opus-5-5', effort = 'high', client, maxToolCallsPerTurn = 60, turnTimeoutMs = 10 * 60 * 1000 } = {}) {
  const anthropic = client || new Anthropic({ maxRetries: 4 });
  /** @type {Anthropic.MessageParam[]} Append-only: thinking blocks are only valid in the history that produced them. */
  const messages = [];

  return {
    kind: 'claude',
    model,
    effort,
    describe: () => ({ kind: 'claude', model, effort, system_prompt: SYSTEM_PROMPT, max_tool_calls_per_turn: maxToolCallsPerTurn }),

    /**
     * @param {{ userText: string, tools: object[], callTool: (name, args) => Promise<{text, isError, json}>, emit: (event) => void }} turn
     * @returns {Promise<{ text: string, status: string }>}
     */
    async runTurn({ userText, tools, callTool, emit }) {
      const apiTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
      messages.push({ role: 'user', content: userText });
      const started = now();
      let text = '';
      let calls = 0;
      for (;;) {
        if (now() - started > turnTimeoutMs) return { text, status: 'turn_timeout' };
        const t0 = now();
        const request = { model, max_tokens: 16000, system: SYSTEM_PROMPT, tools: apiTools, messages: structuredClone(messages), output_config: { effort } };
        const res = await anthropic.messages.create(request);
        messages.push({ role: 'assistant', content: res.content });
        emit({
          type: 'model_call', ms: now() - t0, requested_model: model, served_model: res.model, stop_reason: res.stop_reason,
          request_id: res._request_id ?? null,
          // OTel GenAI convention: input_tokens includes the cached part (Anthropic reports it apart).
          usage: {
            input_tokens: (res.usage?.input_tokens || 0) + (res.usage?.cache_read_input_tokens || 0) + (res.usage?.cache_creation_input_tokens || 0),
            output_tokens: res.usage?.output_tokens || 0,
            cache_read_input_tokens: res.usage?.cache_read_input_tokens || 0,
            cache_write_input_tokens: res.usage?.cache_creation_input_tokens || 0,
          },
          stop_details: res.stop_details ?? null,
          // The exact exchange (the SDK adds only headers, which are never recorded).
          request, response: res,
        });
        for (const block of res.content) {
          if (block.type === 'text' && block.text) { text += (text ? '\n' : '') + block.text; emit({ type: 'assistant_text', text: block.text }); }
        }
        if (res.stop_reason === 'pause_turn') continue;
        if (res.stop_reason === 'refusal') return { text, status: 'refusal' };
        if (res.stop_reason === 'max_tokens') return { text, status: 'truncated' };
        if (res.stop_reason !== 'tool_use') return { text, status: 'ok' };

        const results = [];
        for (const block of res.content) {
          if (block.type !== 'tool_use') continue;
          calls += 1;
          if (calls > maxToolCallsPerTurn) return { text, status: 'tool_call_cap' };
          const c0 = now();
          let result;
          try { result = await callTool(block.name, block.input); } catch (e) {
            result = { text: `error: ${e.message}`, isError: true, json: null, transportError: true };
          }
          emit({ type: 'tool_call', id: block.id, name: block.name, args: block.input, ms: now() - c0, result: { text: result.text, isError: result.isError, json: result.json }, transport_error: !!result.transportError });
          results.push({ type: 'tool_result', tool_use_id: block.id, content: result.text, ...(result.isError ? { is_error: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
      }
    },
  };
}
