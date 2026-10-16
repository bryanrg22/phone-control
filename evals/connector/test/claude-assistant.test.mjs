#!/usr/bin/env node
// claude-assistant.test.mjs — what the Claude assistant sends and how it counts
// tokens, against a stand-in client (no API calls).

import assert from 'node:assert/strict';
import { createClaudeAssistant, SYSTEM_PROMPT } from '../assistants/claude.mjs';
import { costOf } from '../../lib/prices.mjs';

let passed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

// Answers with one tool call, then with text; usage as the API reports it
// (input_tokens EXCLUDES the cached parts).
function fakeClient() {
  const requests = [];
  const replies = [
    { model: 'claude-haiku-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'get_phone_status', input: {} }], usage: { input_tokens: 40, cache_creation_input_tokens: 1500, cache_read_input_tokens: 0, output_tokens: 20 } },
    { model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ready.' }], usage: { input_tokens: 30, cache_creation_input_tokens: 60, cache_read_input_tokens: 1540, output_tokens: 5 } },
  ];
  return { requests, messages: { create: async (r) => { requests.push(structuredClone(r)); return replies.shift(); } } };
}

const client = fakeClient();
const events = [];
const assistant = createClaudeAssistant({ model: 'claude-haiku-5-5', client });
await assistant.runTurn({
  userText: 'Is my phone ready?',
  tools: [{ name: 'get_phone_status', description: 'status', inputSchema: { type: 'object', properties: {} } }],
  callTool: async () => ({ text: '{"ready":true}', isError: false, json: { ready: true } }),
  emit: (e) => events.push(e),
});
const calls = events.filter((e) => e.type === 'model_call');

console.log('prompt caching:');
await ok('the system prompt carries a cache breakpoint (caching the tools before it too)', () => {
  for (const r of client.requests) assert.deepEqual(r.system, [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]);
});
await ok('every request turns on automatic caching of the conversation', () => {
  assert.equal(client.requests.length, 2);
  for (const r of client.requests) assert.deepEqual(r.cache_control, { type: 'ephemeral' });
});
await ok('no message content carries its own marker (automatic caching places it; 4 slots at most)', () => {
  for (const r of client.requests) assert.ok(!JSON.stringify(r.messages).includes('cache_control'));
});
await ok('the prefix is identical from one request to the next (else nothing is read back)', () => {
  const [a, b] = client.requests;
  assert.deepEqual(a.system, b.system); assert.deepEqual(a.tools, b.tools);
  assert.deepEqual(b.messages.slice(0, a.messages.length), a.messages);
});

console.log('token counts (OpenTelemetry GenAI convention):');
await ok('input_tokens includes the cached and cache-written parts', () => {
  assert.deepEqual(calls[0].usage, { input_tokens: 1540, output_tokens: 20, cache_read_input_tokens: 0, cache_write_input_tokens: 1500 });
  assert.deepEqual(calls[1].usage, { input_tokens: 1630, output_tokens: 5, cache_read_input_tokens: 1540, cache_write_input_tokens: 60 });
});
await ok('a cache read is billed at the cache rate, not the input rate', () => {
  // Haiku 5.5: input 0.1, cache write 0.125, cache read 0.01, output 0.5 per MTok
  const expected = (30 * 0.1 + 60 * 0.125 + 1540 * 0.01 + 5 * 0.5) / 1e6;
  assert.ok(Math.abs(costOf('claude-haiku-5-5', calls[1].usage) - expected) < 1e-12);
});

console.log(`\n${passed} passed`);
