// openai.mjs — the OpenAI Responses API.
//
// Nothing is stored at OpenAI (store: false), so the conversation is resent
// each step. The model's reasoning travels with it: each reply's reasoning
// items (encrypted) are kept on the assistant message and sent back, which is
// how a reasoning model keeps its own thinking across tool calls without
// server-side state. Shapes from developers.openai.com.

import { postJSON } from './http.mjs';

const base = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

/** The loop's messages → { instructions, input } in Responses API shape. */
export function toResponses(messages) {
  let instructions;
  const input = [];
  for (const m of messages) {
    if (m.role === 'system') { instructions = m.content; continue; }
    if (m.role === 'tool') { input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: String(m.content ?? '') }); continue; }
    if (m.role === 'assistant') {
      for (const item of m.reasoning || []) input.push(item);
      if (typeof m.content === 'string' && m.content.trim()) input.push({ role: 'assistant', content: [{ type: 'output_text', text: m.content }] });
      for (const tc of m.tool_calls || []) input.push({ type: 'function_call', call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
      continue;
    }
    if (typeof m.content === 'string') { input.push({ role: 'user', content: [{ type: 'input_text', text: m.content }] }); continue; }
    input.push({ role: 'user', content: m.content.map((c) => (c.type === 'image_url' ? { type: 'input_image', image_url: c.image_url.url, detail: 'auto' } : { type: 'input_text', text: c.text ?? '' })) });
  }
  return { instructions, input };
}

/** A Responses API reply → the loop's assistant message (reasoning kept for the next request). */
export function fromResponses(data) {
  const texts = [];
  const calls = [];
  const reasoning = [];
  for (const item of data?.output || []) {
    if (item.type === 'message') for (const c of item.content || []) { if (c.type === 'output_text' && c.text) texts.push(c.text); }
    else if (item.type === 'function_call') calls.push({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } });
    else if (item.type === 'reasoning') reasoning.push(item);
    // web_search_call: run by OpenAI inside the request; nothing to do here.
  }
  const message = { role: 'assistant', content: texts.join('') || null };
  if (calls.length) message.tool_calls = calls;
  if (reasoning.length) message.reasoning = reasoning;
  return message;
}

export function createOpenAI({ model, apiKey, nativeWebSearch = true, temperature = null, effort = null, log }) {
  const url = `${base()}/responses`;
  return {
    provider: 'openai',
    model,
    url,
    async complete({ messages, tools, onlyTools = null }) {
      const { instructions, input } = toResponses(messages);
      const defs = tools.filter((t) => !onlyTools || onlyTools.includes(t.name)).map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }));
      if (nativeWebSearch && !onlyTools) defs.push({ type: 'web_search' });
      const body = {
        model, input, store: false, include: ['reasoning.encrypted_content'],
        ...(effort !== null ? { reasoning: { effort } } : {}),
        ...(instructions ? { instructions } : {}),
        ...(temperature !== null ? { temperature } : {}),
        tools: defs, tool_choice: 'auto',
      };
      const r = await postJSON(url, { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body, { provider: 'openai', log });
      const u = r.json.usage || {};
      return {
        message: fromResponses(r.json),
        finishReasons: [r.json.status === 'incomplete' ? (r.json.incomplete_details?.reason || 'incomplete') : r.json.status].filter(Boolean),
        responseId: r.json.id ?? null,
        responseModel: r.json.model ?? null,
        // OpenAI's input_tokens already include the cached part, as OTel GenAI defines it.
        usage: { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, cache_read_input_tokens: u.input_tokens_details?.cached_tokens || 0, cache_write_input_tokens: null, reasoning_output_tokens: u.output_tokens_details?.reasoning_tokens ?? null },
        raw: { url, request: body, response: r.json, status: r.status, attempts: r.attempts },
      };
    },
  };
}
