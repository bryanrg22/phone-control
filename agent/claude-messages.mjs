// Convert the agent's internal OpenAI-shaped message history into Anthropic Messages API
// shape. Pure + dependency-free so it is unit-testable (agent/test/claude-messages.test.mjs).
//
// noToolsMode (provider=local, or --no-tools on any provider): the request carries NO `tools`
// param, and the Anthropic Messages API returns a 400 on ANY tool_use / tool_result block
// when `tools` is absent. So in that mode we FLATTEN tool turns to plain text — the
// assistant's action text (its emitted JSON) stays as a text block (the synthetic tool_use
// is dropped), and each tool result becomes a plain user text turn ("Tool result: ..."). This
// preserves the action→result narrative without any tool blocks, so no `tools` param is needed.
//
// Audit re-review caught the regression: suppressing `tools` (the #15 fix) while STILL emitting
// tool_use/tool_result blocks 400'd every step 2+, burning runs to max-steps as fake TASK FAILs.
export function convertMessagesForClaude(messages, { noToolsMode = false } = {}) {
  let system = '';
  const converted = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'system') { system = msg.content; continue; }
    if (msg.role === 'tool') {
      // Consecutive tool results → one user turn. With tools: a tool_result array.
      // Without tools (noToolsMode): a plain text turn, so no tool blocks reach the API.
      const toolResults = [];
      const toolTexts = [];
      while (i < messages.length && messages[i].role === 'tool') {
        toolResults.push({ type: 'tool_result', tool_use_id: messages[i].tool_call_id, content: String(messages[i].content) });
        toolTexts.push(`Tool result: ${String(messages[i].content)}`);
        i++;
      }
      i--;
      converted.push(noToolsMode
        ? { role: 'user', content: toolTexts.join('\n') }
        : { role: 'user', content: toolResults });
      continue;
    }
    if (msg.role === 'assistant') {
      const content = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      // In noToolsMode the assistant's action already lives in msg.content (text); emitting
      // tool_use here would force a `tools` param → 400. Drop it.
      if (msg.tool_calls && !noToolsMode) {
        for (const tc of msg.tool_calls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) });
        }
      }
      // Anthropic rejects assistant turns with empty content; substitute a placeholder.
      converted.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '(no response)' }] });
      continue;
    }
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        converted.push({ role: 'user', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const content = msg.content.map(part => {
          if (part.type === 'image_url') {
            const m = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
            if (m) return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
          }
          return part;
        });
        converted.push({ role: 'user', content });
      }
    }
  }
  return { system, messages: converted };
}
