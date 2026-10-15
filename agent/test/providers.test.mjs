// providers.test.mjs — conversion to and from each provider's format, token
// accounting, and which API errors end a run. No network: the request path is
// exercised against a local server.

import { createServer } from 'node:http';
import { toAnthropic, fromAnthropic, createAnthropic } from '../providers/anthropic.mjs';
import { toResponses, fromResponses, createOpenAI } from '../providers/openai.mjs';
import { isNonRecoverable, postJSON } from '../providers/http.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}

const IMG = 'data:image/jpeg;base64,/9j/AAAA';
const CONVO = [
  { role: 'system', content: 'You are an agent.' },
  { role: 'user', content: [{ type: 'image_url', image_url: { url: IMG } }, { type: 'text', text: 'Task: set an alarm' }] },
  { role: 'assistant', content: 'Opening Clock.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'openApp', arguments: '{"appName":"Clock"}' } }, { id: 'c2', type: 'function', function: { name: 'tap', arguments: '{"x":50,"y":10}' } }] },
  { role: 'tool', tool_call_id: 'c1', name: 'openApp', content: 'Opened Clock' },
  { role: 'tool', tool_call_id: 'c2', name: 'tap', content: 'Not run: an earlier action failed.', isError: true },
  { role: 'user', content: '[Context] Action history:\nStep 1: openApp(Clock)' },
];

console.log('Anthropic Messages API:');
{
  const { system, messages } = toAnthropic(CONVO);
  check('the system prompt is separate', system === 'You are an agent.' && messages[0].role === 'user');
  check('a screenshot becomes a base64 image block', messages[0].content[0].type === 'image' && messages[0].content[0].source.media_type === 'image/jpeg' && messages[0].content[0].source.data === '/9j/AAAA');
  check('tool calls become tool_use blocks with parsed input', messages[1].content[1].type === 'tool_use' && messages[1].content[1].input.appName === 'Clock');
  check('consecutive tool results are one user turn', messages[2].role === 'user' && messages[2].content.length === 2 && messages[2].content.every((c) => c.type === 'tool_result'));
  check('a failed tool result is marked is_error', messages[2].content[1].is_error === true && !messages[2].content[0].is_error);
  check('an empty assistant turn gets placeholder text (the API rejects empty ones)', toAnthropic([{ role: 'assistant', content: null }]).messages[0].content[0].text === '(no response)');
  const back = fromAnthropic({ content: [{ type: 'text', text: 'Done.' }, { type: 'tool_use', id: 't1', name: 'taskComplete', input: { summary: 'ok' } }] });
  check('a reply becomes the loop\'s assistant message', back.content === 'Done.' && back.tool_calls[0].function.name === 'taskComplete' && JSON.parse(back.tool_calls[0].function.arguments).summary === 'ok');
}

console.log('OpenAI Responses API:');
{
  const { instructions, input } = toResponses(CONVO);
  check('the system prompt is instructions', instructions === 'You are an agent.');
  check('a screenshot becomes input_image beside input_text', input[0].content[0].type === 'input_image' && input[0].content[0].image_url === IMG && input[0].content[1].type === 'input_text');
  check('tool calls become function_call items', input[2].type === 'function_call' && input[2].call_id === 'c1');
  check('tool results become function_call_output items', input[4].type === 'function_call_output' && input[4].call_id === 'c1');
  const reply = fromResponses({ output: [{ type: 'reasoning', id: 'rs_1', encrypted_content: 'xyz' }, { type: 'web_search_call', id: 'ws' }, { type: 'message', content: [{ type: 'output_text', text: 'Hi' }] }, { type: 'function_call', call_id: 'f1', name: 'tap', arguments: '{}' }] });
  check('a reply becomes the loop\'s assistant message', reply.content === 'Hi' && reply.tool_calls[0].id === 'f1');
  check('reasoning is kept on the message', reply.reasoning?.[0]?.id === 'rs_1');
  const again = toResponses([{ role: 'assistant', ...reply }]).input;
  check('and sent back first on the next request, so the model keeps its reasoning', again[0].type === 'reasoning' && again[0].encrypted_content === 'xyz' && again.at(-1).type === 'function_call');
}

console.log('which errors end a run:');
check('401, 402, 403 cannot be retried', [401, 402, 403].every((s) => isNonRecoverable(s, '', 'anthropic')));
check('no credit (Anthropic 400) cannot be retried', isNonRecoverable(400, 'Your credit balance is too low', 'anthropic'));
check('insufficient_quota (OpenAI 429) cannot be retried', isNonRecoverable(429, '{"error":{"code":"insufficient_quota"}}', 'openai'));
check('a plain 429 can be retried', !isNonRecoverable(429, 'rate limited', 'openai'));
check('Gemini\'s per-minute "quota" 429 can be retried', !isNonRecoverable(429, 'exceeded your current quota', 'gemini'));
check('a malformed-request 400 is not an account problem', !isNonRecoverable(400, 'invalid request', 'anthropic'));

// A local server playing the provider, to check the request path end to end.
async function server(handler) {
  const s = createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => handler(req, res, JSON.parse(b || '{}'))); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => s.close(r)) };
}

console.log('the request path:');
{
  let calls = 0;
  const srv = await server((req, res) => {
    calls += 1;
    if (calls === 1) { res.writeHead(529, { 'retry-after': '0' }); return res.end('overloaded'); }
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_2' }); res.end('{"ok":true}');
  });
  const r = await postJSON(`${srv.url}/x`, {}, {}, { provider: 'anthropic', maxRetries: 2 });
  check('a 529 is retried, and every attempt is reported', r.json.ok === true && r.attempts.length === 2 && r.attempts[0].status === 529 && r.attempts[1].request_id === 'req_2');
  await srv.close();
}
{
  const srv = await server((req, res) => { res.writeHead(401); res.end('invalid x-api-key'); });
  let err = null;
  try { await postJSON(`${srv.url}/x`, {}, {}, { provider: 'anthropic', maxRetries: 3 }); } catch (e) { err = e; }
  check('a 401 throws at once, tagged non-recoverable', err?.nonRecoverable === true && err.status === 401 && err.attempts.length === 1);
  await srv.close();
}
{
  let seen = null;
  const srv = await server((req, res, body) => {
    seen = { headers: req.headers, body };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_1', model: 'claude-opus-5-5-20261001', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'tap', input: { x: 1, y: 2 } }], usage: { input_tokens: 100, output_tokens: 7, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 } }));
  });
  process.env.ANTHROPIC_BASE_URL = srv.url;
  const m = createAnthropic({ model: 'claude-opus-5-5', apiKey: 'k' });
  const r = await m.complete({ messages: CONVO, tools: [{ name: 'tap', description: 'Tap', parameters: { type: 'object', properties: {} } }, { name: 'taskComplete', description: 'Done', parameters: { type: 'object', properties: {} } }] });
  delete process.env.ANTHROPIC_BASE_URL;
  check('input tokens include the cached ones (OTel GenAI)', r.usage.input_tokens === 1050 && r.usage.cache_read_input_tokens === 900 && r.usage.cache_write_input_tokens === 50);
  check('the model that answered is kept', r.responseModel === 'claude-opus-5-5-20261001' && r.responseId === 'msg_1');
  check('the exact request and response are returned for the record', r.raw.request.model === 'claude-opus-5-5' && r.raw.response.id === 'msg_1');
  check('the system prompt, the last tool and the newest message are cache breakpoints', seen.body.system[0].cache_control && seen.body.tools.at(-1).cache_control && seen.body.messages.at(-1).content.at(-1).cache_control);
  check('native web search is offered', seen.body.tools.some((t) => t.type === 'web_search_20250305'));
  await srv.close();
}
{
  let seen = null;
  const srv = await server((req, res, body) => {
    seen = body;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'resp_1', model: 'gpt-6-luna-2026-09-30', status: 'completed', output: [], usage: { input_tokens: 1000, output_tokens: 5, input_tokens_details: { cached_tokens: 800 }, output_tokens_details: { reasoning_tokens: 3 } } }));
  });
  process.env.OPENAI_BASE_URL = `${srv.url}/v1`;
  const m = createOpenAI({ model: 'gpt-6-luna', apiKey: 'k' });
  const r = await m.complete({ messages: CONVO, tools: [{ name: 'tap', description: 'Tap', parameters: {} }, { name: 'taskComplete', description: 'Done', parameters: {} }], onlyTools: ['taskComplete'] });
  delete process.env.OPENAI_BASE_URL;
  check('nothing is stored at OpenAI, and encrypted reasoning is requested', seen.store === false && seen.include?.includes('reasoning.encrypted_content'));
  check('on a final step only the named tools are offered, and no search', seen.tools.length === 1 && seen.tools[0].name === 'taskComplete');
  check('cached and reasoning tokens are kept; input already includes the cached part', r.usage.input_tokens === 1000 && r.usage.cache_read_input_tokens === 800 && r.usage.reasoning_output_tokens === 3);
  await srv.close();
}

console.log(fail ? `\n❌ ${fail} FAILED, ${pass} passed` : `\n✅ ALL PASS: ${pass} passed, 0 failed`);
if (fail) process.exit(1);
