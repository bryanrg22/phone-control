// agent/responses-adapter.mjs — OpenAI Responses API conversion (2026-08).
//
// The agent loop speaks classic chat-completions shape internally (messages
// with role/content, assistant tool_calls, role:"tool" results). OpenAI's
// current API is the Responses API — where every new capability ships
// (native web_search, computer use, …); chat-completions is frozen. This
// module converts between the two shapes so the loop stays unchanged:
//
//   chatToResponsesInput(messages)  → { instructions, input }
//   toolsToResponses(openaiTools)   → flat tool defs (+ optional web_search)
//   normalizeResponsesResponse(d)   → chat-shape { choices, usage }
//
// Shapes verified against developers.openai.com docs 2026-08-02:
//   - tools: flat { type:"function", name, description, parameters }
//   - model calls: output items { type:"function_call", call_id, name, arguments }
//   - results back: input items { type:"function_call_output", call_id, output }
//   - images: { type:"input_image", image_url:"data:…" } beside input_text
//   - native search: { type:"web_search" }; result = web_search_call item +
//     message item with url_citation annotations
//
// Pure functions, no state, no I/O — unit-tested in
// agent/test/responses-adapter.test.mjs.

/// Convert loop-internal chat messages → Responses API { instructions, input }.
/// system → top-level instructions; user/assistant/tool → typed input items.
export function chatToResponsesInput(messages) {
  let instructions;
  const input = [];
  for (const m of messages) {
    if (m.role === 'system') {
      // Responses puts the system prompt in `instructions`
      instructions = typeof m.content === 'string' ? m.content : '';
      continue;
    }
    if (m.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: String(m.content ?? '') });
      continue;
    }
    if (m.role === 'assistant') {
      // Text (if any) and each tool call become separate output-shaped items.
      const text = typeof m.content === 'string' ? m.content : '';
      if (text.trim().length > 0) {
        input.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
      }
      for (const tc of m.tool_calls || []) {
        input.push({ type: 'function_call', call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments });
      }
      continue;
    }
    // user — string or multimodal array (image_url parts → input_image)
    if (typeof m.content === 'string') {
      input.push({ role: 'user', content: [{ type: 'input_text', text: m.content }] });
    } else if (Array.isArray(m.content)) {
      const parts = m.content.map(c =>
        c.type === 'image_url'
          ? { type: 'input_image', image_url: c.image_url.url, detail: 'auto' }
          : { type: 'input_text', text: c.text ?? '' });
      input.push({ role: 'user', content: parts });
    }
  }
  return { instructions, input };
}

/// Chat-completions tool defs (nested under .function) → Responses flat defs.
/// nativeWebSearch appends OpenAI's server-side web_search tool.
export function toolsToResponses(openaiTools, { nativeWebSearch = false } = {}) {
  const tools = (openaiTools || []).map(t => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
  if (nativeWebSearch) tools.push({ type: 'web_search' });
  return tools;
}

/// Responses API response → chat-completions shape the loop understands.
/// message items → content text; function_call items → tool_calls;
/// web_search_call items are server-side (no client action) and are skipped.
export function normalizeResponsesResponse(data) {
  const output = data?.output || [];
  const texts = [];
  const toolCalls = [];
  for (const item of output) {
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if (c.type === 'output_text' && c.text) texts.push(c.text);
      }
    } else if (item.type === 'function_call') {
      toolCalls.push({
        id: item.call_id,
        type: 'function',
        function: { name: item.name, arguments: item.arguments },
      });
    }
    // 'web_search_call', 'reasoning', etc.: server-side / no client action
  }
  const message = { role: 'assistant', content: texts.join('') || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return {
    choices: [{ message }],
    usage: {
      prompt_tokens: data?.usage?.input_tokens,
      completion_tokens: data?.usage?.output_tokens,
    },
  };
}
