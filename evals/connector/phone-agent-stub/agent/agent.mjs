#!/usr/bin/env node
// The phone agent's stand-in for connector evals.
//
// The server starts it exactly as it starts agent/agent.mjs (same arguments,
// same output markers, same question-and-answer file), so everything between
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
const scenarioFile = process.env.PHONE_AGENT_STUB_SCENARIO;
const scenario = JSON.parse(readFileSync(scenarioFile, 'utf8'));

appendFileSync(`${scenarioFile}.calls.jsonl`, `${JSON.stringify({
  at: new Date().toISOString(), task, model: flag('--model'), provider: flag('--provider'), maxSteps: Number(flag('--max-steps')),
})}\n`);

// The runner must really be up: a task only proceeds if automation started.
const base = `http://${flag('--driver-host')}:${flag('--driver-port')}`;
const info = await fetch(`${base}/deviceInfo`).catch((e) => ({ ok: false, statusText: e.message }));
if (!info.ok) { console.log(`❌ INFRA: the runner did not answer: ${info.statusText}`); process.exit(1); }

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
  console.log(`--- Step ${step}/${total} --- (${((Date.now() - started) / 1000).toFixed(1)}s total)`);
  if (s.progress) console.log(`[Tool] tapText(${JSON.stringify({ text: s.progress })})`);
  if (s.wait) await sleep(s.wait);
  if (s.ask) {
    console.log(`__ASK_USER__:${JSON.stringify({ question: s.ask.question, options: s.ask.options || [] })}`);
    const got = await waitForAnswer(timeoutMs);
    if (got === null) { console.log(`[askUser] No response after ${timeoutMs / 1000}s — giving up (unattended run).`); continue; }
    console.log(`[askUser] User responded: "${got}"`);
    answer = got;
  }
  if (s.askText) {
    console.log(`__ASK_USER_TEXT__:${JSON.stringify({ question: s.askText.question, hint: s.askText.hint || '' })}`);
    const got = await waitForAnswer(timeoutMs);
    if (got === null) { console.log(`[askUserText] No response after ${timeoutMs / 1000}s — giving up (unattended run).`); continue; }
    console.log(`[askUserText] User typed: "${got}"`);
    answer = got;
  }
  if (s.done !== undefined) {
    console.log('✅ TASK COMPLETED');
    console.log(String(s.done).replaceAll('{answer}', answer));
    process.exit(0);
  }
  if (s.fail !== undefined) {
    console.log(`❌ TASK FAILED: ${s.fail}`);
    process.exit(0);
  }
  if (s.infra !== undefined) {
    console.log(`❌ INFRA: ${s.infra}`);
    process.exit(43);
  }
}
console.log('⏱️  MAX STEPS REACHED');
process.exit(0);
