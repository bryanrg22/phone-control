// anthropic.mjs — the Claude Messages API.
//
// The loop's conversation (see ../context.mjs) is converted to Messages API
// shape here and the reply converted back, so nothing else knows the format.
//
// Prompt caching: up to four breakpoints are allowed; three are used — the
// system prompt, the last tool definition, and the last block of the newest
// message. The last one makes each request a cache read of everything before
// it, so a step pays full price only for what changed since the last step.

import { postJSON } from './http.mjs';

const base = () => (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');

/** The loop's messages → { system, messages } in Messages API shape. */
export function toAnthropic(messages) {
  let system = '';
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'system') { system = m.content; continue; }
    if (m.role === 'tool') {
      // Consecutive tool results are one user turn of tool_result blocks.
      const results = [];
      while (i < messages.length && messages[i].role === 'tool') {
        results.push({ type: 'tool_result', tool_use_id: messages[i].tool_call_id, content: String(messages[i].content), ...(messages[i].isError ? { is_error: true } : {}) });
        i++;
      }
      i--;
      out.push({ role: 'user', content: results });
      continue;
    }
    if (m.role === 'assistant') {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls || []) content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || '{}') });
      // The API rejects an empty assistant turn.
      out.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '(no response)' }] });
      continue;
    }
    if (typeof m.content === 'string') { out.push({ role: 'user', content: [{ type: 'text', text: m.content }] }); continue; }
    out.push({
      role: 'user',
      content: m.content.map((p) => {
        const d = p.type === 'image_url' && p.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
        return d ? { type: 'image', source: { type: 'base64', media_type: d[1], data: d[2] } } : { type: 'text', text: p.text ?? '' };
      }),
    });
  }
  return { system, messages: out };
}

/** A Messages API reply → the loop's assistant message. */
export function fromAnthropic(data) {
  const content = data.content || [];
  const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('') || null;
  const uses = content.filter((c) => c.type === 'tool_use');
  const message = { role: 'assistant', content: text };
  if (uses.length) message.tool_calls = uses.map((u) => ({ id: u.id, type: 'function', function: { name: u.name, arguments: JSON.stringify(u.input) } }));
  return message;
}

export function createAnthropic({ model, apiKey, nativeWebSearch = true, maxTokens = 8096, temperature = null, effort = null, log }) {
  const url = `${base()}/v1/messages`;
  return {
    provider: 'anthropic',
    model,
    url,
    /**
     * @param {{ messages: object[], tools: object[], onlyTools?: string[] }} req
     */
    async complete({ messages, tools, onlyTools = null }) {
      const { system, messages: msgs } = toAnthropic(messages);
      const defs = tools.filter((t) => !onlyTools || onlyTools.includes(t.name)).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
      // Server-side search, inside the request. Not on a forced final step: the model must conclude.
      if (nativeWebSearch && !onlyTools) defs.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 3 });
      if (defs.length) defs[defs.length - 1].cache_control = { type: 'ephemeral' };
      const last = msgs.at(-1);
      if (last && Array.isArray(last.content) && last.content.length) last.content[last.content.length - 1].cache_control = { type: 'ephemeral' };
      const body = {
        model, max_tokens: maxTokens, messages: msgs,
        ...(system ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}),
        ...(temperature !== null ? { temperature } : {}),
        ...(effort !== null ? { output_config: { effort } } : {}),
        tools: defs, tool_choice: { type: 'auto' },
      };
      const r = await postJSON(url, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body, { provider: 'anthropic', log });
      const u = r.json.usage || {};
      const cacheRead = u.cache_read_input_tokens || 0;
      const cacheWrite = u.cache_creation_input_tokens || 0;
      return {
        message: fromAnthropic(r.json),
        finishReasons: [r.json.stop_reason].filter(Boolean),
        responseId: r.json.id ?? null,
        responseModel: r.json.model ?? null,
        // OTel GenAI: input_tokens includes the cached part; Anthropic reports it apart.
        usage: { input_tokens: (u.input_tokens || 0) + cacheRead + cacheWrite, output_tokens: u.output_tokens || 0, cache_read_input_tokens: cacheRead, cache_write_input_tokens: cacheWrite, reasoning_output_tokens: null },
        raw: { url, request: body, response: r.json, status: r.status, attempts: r.attempts },
      };
    },
  };
}
