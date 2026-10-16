#!/usr/bin/env node
// regrade.test.mjs — rebuilding a conversation from its recorded events, which
// is what re-grading a finished run relies on.

import assert from 'node:assert/strict';
import { rebuildTurns, codeChecks } from '../grade.mjs';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

const EVENTS = [
  { turn: 1, type: 'user', text: 'Text Sam' },
  { turn: 1, type: 'model_call', usage: {} },
  { turn: 1, type: 'assistant_text', text: 'On it.' },
  { turn: 1, type: 'tool_call', name: 'run_phone_task', args: { task: 'Text Sam' }, result: { text: '{}' } },
  { turn: 1, type: 'assistant_text', text: 'Which Sam?' },
  { turn: 1, type: 'turn_end', status: 'ok' },
  { turn: 2, type: 'user', text: 'Sam Lee' },
  { turn: 2, type: 'tool_call', name: 'answer_question', args: { answer: 'Sam Lee' }, result: { text: '{}' } },
  { turn: 2, type: 'turn_end', status: 'ok' },
];

console.log('rebuilding a run');
ok('turns, replies and tool calls come back as they were recorded', () => {
  const t = rebuildTurns(EVENTS);
  assert.equal(t.length, 2);
  assert.equal(t[0].user, 'Text Sam');
  assert.equal(t[0].text, 'On it.\nWhich Sam?');
  assert.deepEqual(t[0].toolCalls.map((c) => c.name), ['run_phone_task']);
  assert.deepEqual(t[1].toolCalls[0].args, { answer: 'Sam Lee' });
  assert.equal(t[1].status, 'ok');
});
ok('the code checks give the same answers on a rebuilt run', () => {
  const kase = { checks: { must_not_call: [{ tool: 'answer_question', turn: 1 }], must_call: [{ tool: 'answer_question', turn: 2, args: { answer: '/sam lee/i' } }] } };
  const checks = codeChecks(kase, { turns: rebuildTurns(EVENTS), starts: [] });
  assert.ok(checks.every((c) => c.ok), JSON.stringify(checks));
});
ok('a run recorded before turn_end existed takes how a turn ended from its original checks', () => {
  const old = EVENTS.filter((e) => e.type !== 'turn_end');
  const t = rebuildTurns(old, [{ name: 'turn 2 ended normally', ok: false, detail: 'the turn ended with refusal' }]);
  assert.equal(t[0].status, 'ok');
  assert.equal(t[1].status, 'refusal');
});

console.log(`\n${passed} passed`);
