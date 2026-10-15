// fake-model.mjs — a scripted stand-in for the Anthropic Messages API.
//
// The agent is pointed at it with ANTHROPIC_BASE_URL. Each request gets the
// next scripted reply; every request body is kept, so a test can assert what
// the agent sent (the tools it offered, the messages, the images).
//
//   const model = await startFakeModel([
//     toolUse('openApp', { appName: 'Clock' }),
//     toolUse('taskComplete', { summary: 'Done.' }),
//   ]);

import { createServer } from 'node:http';

let seq = 0;
/** A reply that calls one or more tools: toolUse('tap', {x, y}) or toolUse([['tap', {...}], ['taskComplete', {...}]]). */
export function toolUse(nameOrCalls, input = {}) {
  const calls = Array.isArray(nameOrCalls) ? nameOrCalls : [[nameOrCalls, input]];
  return { stop_reason: 'tool_use', content: calls.map(([name, args]) => ({ type: 'tool_use', id: `toolu_${++seq}`, name, input: args })) };
}
/** A reply with text and no tool call. */
export const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
/** A reply that is an HTTP error from the API. */
export const httpError = (status, message = 'error') => ({ httpError: { status, body: { type: 'error', error: { type: 'api_error', message } } } });

/**
 * @param {Array<object|((req) => object)>} script  one reply per request; the last one repeats
 */
export async function startFakeModel(script) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      requests.push({ path: req.url, headers: req.headers, body: json });
      const i = Math.min(requests.length - 1, script.length - 1);
      const step = typeof script[i] === 'function' ? script[i](json) : script[i];
      if (step.httpError) {
        res.writeHead(step.httpError.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(step.httpError.body));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_fake_${requests.length}` });
      res.end(JSON.stringify({
        id: `msg_fake_${requests.length}`, type: 'message', role: 'assistant', model: json.model,
        content: step.content, stop_reason: step.stop_reason, stop_sequence: null,
        usage: { input_tokens: 1000 + requests.length, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}
