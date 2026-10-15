#!/usr/bin/env node
// The phone agent's stand-in for connector evals.
//
// The server starts it exactly as it starts agent/agent.mjs (same arguments,
// same events, same question-and-answer file), so everything between
// the assistant and the phone is real. Only the agent's behaviour is scripted,
// by the JSON file named in PHONE_AGENT_STUB_SCENARIO:
//
//   { "steps": [
//       { "progress": "Opening Settings" },             an action, shown as progress
//       { "wait": 3000 },                               milliseconds
//       { "ask": { "question": "…", "options": ["A", "B"] } },   waits for the answer
//       { "askText": { "question": "…", "hint": "…" } },          free-text answer
//       { "done": "Summary. {answer} is the last answer" },
//       { "fail": "why" },
//       { "infra": "what broke" }                       the phone connection was lost
//   ] }
//
// Every start is appended to <scenario>.calls.jsonl — the task text, model and
// provider the server passed on — so a case can check what the assistant asked
// for in code instead of asking a judge.

import { readFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const task = argv[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The agent's events (agent/protocol.mjs): one JSON object per line.
const emit = (type, data = {}) => console.log(`@agent-event ${JSON.stringify({ type, ...data })}`);
const scenarioFile = process.env.PHONE_AGENT_STUB_SCENARIO;
const scenario = JSON.parse(readFileSync(scenarioFile, 'utf8'));

appendFileSync(`${scenarioFile}.calls.jsonl`, `${JSON.stringify({
  at: new Date().toISOString(), task, model: flag('--model'), provider: flag('--provider'), maxSteps: Number(flag('--max-steps')),
})}\n`);

// The runner must really be up: a task only proceeds if automation started.
const base = `http://${flag('--driver-host')}:${flag('--driver-port')}`;
const info = await fetch(`${base}/deviceInfo`).catch((e) => ({ ok: false, statusText: e.message }));
if (!info.ok) { emit('infra', { detail: `the runner did not answer: ${info.statusText}` }); process.exit(43); }

async function waitForAnswer(timeoutMs) {
  const file = join(tmpdir(), 'agent-user-response.json');
  try { unlinkSync(file); } catch { /* none waiting */ }
  for (let waited = 0; waited < timeoutMs; waited += 250) {
    try {
      const { choice } = JSON.parse(readFileSync(file, 'utf8'));
      try { unlinkSync(file); } catch { /* already gone */ }
      return choice;
    } catch { /* not answered yet */ }
    await sleep(250);
  }
  return null;
}

const timeoutMs = Number(flag('--askuser-timeout') || 300) * 1000;
let answer = '';
let step = 0;
const total = Number(flag('--max-steps') || 25);
const started = Date.now();
for (const s of scenario.steps) {
  step += 1;
  emit('step', { step, total, elapsed: ((Date.now() - started) / 1000).toFixed(1) });
  if (s.progress) emit('action', { tool: 'tapText', args: { text: s.progress } });
  if (s.wait) await sleep(s.wait);
  if (s.ask) {
    emit('ask', { question: s.ask.question, options: s.ask.options || [], kind: 'options' });
    const got = await waitForAnswer(timeoutMs);
    if (got === null) { emit('ask_timeout'); continue; }
    emit('answer_seen');
    answer = got;
  }
  if (s.askText) {
    emit('ask', { question: s.askText.question, hint: s.askText.hint || '', kind: 'text' });
    const got = await waitForAnswer(timeoutMs);
    if (got === null) { emit('ask_timeout'); continue; }
    emit('answer_seen');
    answer = got;
  }
  if (s.done !== undefined) {
    emit('done', { summary: String(s.done).replaceAll('{answer}', answer) });
    process.exit(0);
  }
  if (s.fail !== undefined) {
    emit('failed', { reason: String(s.fail) });
    process.exit(1);
  }
  if (s.infra !== undefined) {
    emit('infra', { detail: String(s.infra) });
    process.exit(43);
  }
}
emit('failed', { reason: 'Reached the step limit without finishing.' });
process.exit(1);
