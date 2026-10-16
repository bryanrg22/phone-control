#!/usr/bin/env node
// user-sim.test.mjs — the simulated user (against stand-in clients, no API
// calls), the order-based answer check, and re-grading runs that had one.

import assert from 'node:assert/strict';
import { createSimulatedUser, simulatorHistory, parseUserReply, STOP, USER_SIM_PROMPT } from '../user-sim.mjs';
import { codeChecks, rebuildTurns } from '../grade.mjs';

let passed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

const TURNS = [
  { user: 'Book a table for two at Nopa tonight.', text: 'The phone found two: Nopa (Divisadero St) or Nopalito (9th Ave). Which one?', toolCalls: [{ name: 'run_phone_task', args: { task: 'secret task text' }, result: { text: '{"status":"awaiting_answer"}' } }] },
];

console.log('what the simulated user sees:');
await ok('roles are flipped as in τ-bench: its own lines are "assistant", the assistant\'s replies "user"', () => {
  assert.deepEqual(simulatorHistory(TURNS), [
    { role: 'assistant', content: TURNS[0].user },
    { role: 'user', content: TURNS[0].text },
  ]);
});
await ok('it never sees a tool call or its result, only what a person would', () => {
  const seen = JSON.stringify(simulatorHistory(TURNS));
  assert.ok(!seen.includes('secret task text') && !seen.includes('awaiting_answer'));
});
await ok('a reply with no text is shown as such, not as an empty message', () => {
  assert.equal(simulatorHistory([{ user: 'hi', text: '' }])[1].content, '(the assistant replied with no text)');
});

console.log('reading its reply:');
await ok('a line is taken as the next user message, surrounding quotes removed', () => {
  assert.deepEqual(parseUserReply('  "The one on Divisadero."  '), { stop: false, text: 'The one on Divisadero.' });
});
await ok(`${STOP} ends the conversation, alone or with text around it`, () => {
  assert.equal(parseUserReply(STOP).stop, true);
  assert.equal(parseUserReply(`Thanks! ${STOP}`).stop, true);
});
await ok('an empty reply is an error (a test error, never a silent stop)', () => {
  assert.ok(parseUserReply('   ').error);
});

console.log('the calls it makes:');
await ok('OpenAI: the instruction is in the prompt, low effort, nothing stored; usage recorded', async () => {
  const requests = [];
  const client = { responses: { create: async (r) => { requests.push(r); return { output_text: 'The one on Divisadero.', model: 'gpt-6.1-sol', usage: { input_tokens: 300, output_tokens: 9, input_tokens_details: { cached_tokens: 0 } } }; } } };
  const u = await createSimulatedUser({ provider: 'openai', model: 'gpt-6.1-sol', instruction: 'You want Nopa on Divisadero.', client });
  const r = await u.next(TURNS);
  assert.equal(r.text, 'The one on Divisadero.');
  assert.ok(requests[0].instructions.includes('You want Nopa on Divisadero.') && requests[0].instructions.startsWith(USER_SIM_PROMPT.split('\n')[0]));
  assert.equal(requests[0].store, false);
  assert.deepEqual(requests[0].reasoning, { effort: 'low' });
  assert.deepEqual(r.call.usage, { input_tokens: 300, output_tokens: 9, cache_read_input_tokens: 0, cache_write_input_tokens: 0 });
});
await ok('Anthropic: the conversation opens with a user turn, then alternates', async () => {
  const requests = [];
  const client = { messages: { create: async (r) => { requests.push(r); return { model: 'claude-opus-5-5', content: [{ type: 'text', text: STOP }], usage: { input_tokens: 200, output_tokens: 3 } }; } } };
  const u = await createSimulatedUser({ provider: 'anthropic', model: 'claude-opus-5-5', instruction: 'x', client });
  const r = await u.next(TURNS);
  assert.equal(r.stop, true);
  const roles = requests[0].messages.map((m) => m.role);
  assert.deepEqual(roles, ['user', 'assistant', 'user']);
});

console.log('answers sent only after the user gave them:');
const turn = (user, answers = []) => ({ user, text: '', status: 'ok', toolCalls: answers.map((a) => ({ name: 'answer_question', args: { answer: a } })) });
const KASE = { checks: { answers_after_user: [{ answer: '/divisadero/i', user_said: '/divisadero/i' }] } };
const check = (turns) => codeChecks(KASE, { turns, starts: [] })[0];
await ok('passes when the answer comes in the turn the user says it', () => assert.equal(check([turn('Nopa tonight'), turn('Divisadero one', ['Nopa (Divisadero St)'])]).ok, true));
await ok('passes when it comes later than that (the assistant asked something else first)', () => assert.equal(check([turn('Nopa tonight'), turn('Divisadero'), turn('7 PM', ['Nopa (Divisadero St)'])]).ok, true));
await ok('fails when the assistant answers before the user said it', () => {
  const c = check([turn('Nopa tonight', ['Nopa (Divisadero St)']), turn('Divisadero')]);
  assert.equal(c.ok, false); assert.match(c.detail, /in turn 1, before the user said it in turn 2/);
});
await ok('fails when the user never said it', () => assert.match(check([turn('Nopa tonight', ['Nopa (Divisadero St)'])]).detail, /never said it/));
await ok('fails when it is never sent', () => assert.equal(check([turn('Divisadero')]).detail, 'never sent'));
await ok('one early answer fails it even if a later one is fine', () => assert.equal(check([turn('Nopa', ['Divisadero']), turn('Divisadero', ['Divisadero'])]).ok, false));

console.log('counting only the answers the server accepted:');
const refused = { name: 'answer_question', args: { answer: 'Nopa on Divisadero' }, result: { isError: true, json: { ok: false, error: 'not_an_option' } } };
const sent = (a) => ({ name: 'answer_question', args: { answer: a }, result: { isError: false, json: { ok: true } } });
const limit = (delivered, calls) => codeChecks({ checks: { max_calls: [{ tool: 'answer_question', max: 2, ...(delivered ? { delivered: true } : {}) }] } }, { turns: [{ user: 'x', status: 'ok', toolCalls: calls }], starts: [] })[0];
await ok('a refused answer, then the exact option, is within a limit of two delivered answers', () => {
  const c = limit(true, [refused, sent('Nopa (Divisadero St)'), sent('7:00 PM')]);
  assert.equal(c.ok, true); assert.equal(c.detail, '2 call(s) (1 more refused by the server)');
});
await ok('a third answer the server accepted still breaks the limit', () => assert.equal(limit(true, [sent('a'), sent('b'), sent('c')]).ok, false));
await ok('without the flag every attempt counts, as before (retries against a locked phone)', () => assert.equal(limit(false, [refused, sent('a'), sent('b')]).ok, false));

console.log('re-grading a run that had a simulated user:');
await ok('the simulator\'s own calls and the stop do not become turns', () => {
  const events = [
    { turn: 1, type: 'user', text: 'Book Nopa' }, { turn: 1, type: 'assistant_text', text: 'Which?' }, { turn: 1, type: 'turn_end', status: 'ok' },
    { turn: 2, type: 'user_sim_call', text: 'Divisadero', stop: false }, { turn: 2, type: 'user', text: 'Divisadero' }, { turn: 2, type: 'turn_end', status: 'ok' },
    { turn: 3, type: 'user_sim_call', text: null, stop: true }, { turn: 2, type: 'user_stop' },
  ];
  const t = rebuildTurns(events);
  assert.equal(t.length, 2);
  assert.deepEqual(t.map((x) => x.user), ['Book Nopa', 'Divisadero']);
});

console.log(`\n${passed} passed`);
