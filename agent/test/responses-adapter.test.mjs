// Unit tests for agent/responses-adapter.mjs — the chat-shape ↔ Responses API
// conversion layer (2026-08 OpenAI migration). Pure functions, no network.
import { chatToResponsesInput, toolsToResponses, normalizeResponsesResponse } from '../responses-adapter.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}

console.log('chatToResponsesInput:');
{
  const { instructions, input } = chatToResponsesInput([
    { role: 'system', content: 'You are an agent.' },
    { role: 'user', content: 'do the thing' },
  ]);
  check('system → instructions, not an input item', instructions === 'You are an agent.' && input.length === 1);
  check('user string → input_text part', input[0].role === 'user' && input[0].content[0].type === 'input_text' && input[0].content[0].text === 'do the thing');
}
{
  const { input } = chatToResponsesInput([
    { role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } },
      { type: 'text', text: 'what is on screen?' },
    ] },
  ]);
  check('image_url part → input_image with bare data URI', input[0].content[0].type === 'input_image' && input[0].content[0].image_url === 'data:image/jpeg;base64,AAA');
  check('text part → input_text beside the image', input[0].content[1].type === 'input_text' && input[0].content[1].text === 'what is on screen?');
}
{
  const { input } = chatToResponsesInput([
    { role: 'assistant', content: 'tapping now', tool_calls: [
      { id: 'call_1', type: 'function', function: { name: 'tap', arguments: '{"x":50,"y":50}' } },
    ] },
    { role: 'tool', tool_call_id: 'call_1', content: 'Tapped (50%, 50%)' },
  ]);
  check('assistant text → output_text item', input[0].role === 'assistant' && input[0].content[0].type === 'output_text');
  check('tool_calls → function_call items with call_id', input[1].type === 'function_call' && input[1].call_id === 'call_1' && input[1].name === 'tap');
  check('tool result → function_call_output', input[2].type === 'function_call_output' && input[2].call_id === 'call_1' && input[2].output === 'Tapped (50%, 50%)');
}
{
  const { input } = chatToResponsesInput([
    { role: 'assistant', content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'x', arguments: '{}' } }] },
  ]);
  check('empty assistant text emits NO empty output_text item', input.length === 1 && input[0].type === 'function_call');
}

console.log('toolsToResponses:');
{
  const flat = toolsToResponses([
    { type: 'function', function: { name: 'tap', description: 'Tap.', parameters: { type: 'object', properties: {} } } },
  ]);
  check('nested chat tools → flat Responses tools', flat[0].type === 'function' && flat[0].name === 'tap' && flat[0].parameters.type === 'object' && !flat[0].function);
  check('no web_search unless requested', !flat.some(t => t.type === 'web_search'));
  const withSearch = toolsToResponses([], { nativeWebSearch: true });
  check('nativeWebSearch appends { type: "web_search" }', withSearch.length === 1 && withSearch[0].type === 'web_search');
}

console.log('normalizeResponsesResponse:');
{
  const norm = normalizeResponsesResponse({
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'web_search_call', id: 'ws_1', status: 'completed' },
      { type: 'message', content: [{ type: 'output_text', text: 'It is sunny. ' }, { type: 'output_text', text: 'High of 20.' }] },
      { type: 'function_call', call_id: 'call_9', name: 'taskComplete', arguments: '{"summary":"done"}' },
    ],
    usage: { input_tokens: 100, output_tokens: 20 },
  });
  const msg = norm.choices[0].message;
  check('output_text items join into content', msg.content === 'It is sunny. High of 20.');
  check('function_call → chat-shape tool_calls', msg.tool_calls[0].id === 'call_9' && msg.tool_calls[0].function.name === 'taskComplete');
  check('web_search_call + reasoning items are skipped', msg.tool_calls.length === 1);
  check('usage mapped to prompt/completion tokens', norm.usage.prompt_tokens === 100 && norm.usage.completion_tokens === 20);
  check('no cached tokens reported → 0 cached', norm.usage.cache_read_input_tokens === 0);
}
{
  const norm = normalizeResponsesResponse({
    model: 'gpt-6-luna-2026-09-30', output: [],
    usage: { input_tokens: 1000, output_tokens: 5, input_tokens_details: { cached_tokens: 800 } },
  });
  check('the model that answered is kept', norm.model === 'gpt-6-luna-2026-09-30');
  check('cached input tokens are kept (they are billed at the cached rate)', norm.usage.cache_read_input_tokens === 800 && norm.usage.prompt_tokens === 1000);
}
{
  const norm = normalizeResponsesResponse({ output: [] });
  check('empty output → null content, no tool_calls key', norm.choices[0].message.content === null && !('tool_calls' in norm.choices[0].message));
}

console.log(fail === 0 ? `\n✅ ALL PASS: ${pass} passed, 0 failed` : `\n❌ ${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
