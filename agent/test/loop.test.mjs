// loop.test.mjs — the agent process end to end, against a fake phone and a fake model.
//
// These pin the contract the server depends on (server/src/agent-runner.mjs):
// the arguments it passes, the events its parser reads from the agent's
// output, the answer file for questions, and the exit codes. They run the real
// agent.mjs, so they hold across any rewrite of its insides.

import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeRunner, tree, el } from './rig/fake-runner.mjs';
import { startFakeModel, toolUse, text, httpError } from './rig/fake-model.mjs';
import { runAgent } from './rig/run-agent.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}
const types = (events) => events.map((e) => e.type).filter((t) => t !== 'thinking' && t !== 'step');

async function scenario(name, { script, screen, ...opts }, assert) {
  console.log(name);
  const runner = await startFakeRunner({ screen });
  const model = await startFakeModel(typeof script === 'function' ? script(runner) : script);
  try {
    const r = await runAgent({ runner, model, ...opts });
    await assert({ ...r, runner, model });
  } finally {
    await runner.close(); await model.close();
  }
}

await scenario('a task that finishes', {
  script: [toolUse('openApp', { appName: 'Clock' }), toolUse('tap', { x: 50, y: 50 }), toolUse('taskComplete', { summary: 'Alarm set for 6:45 AM.' })],
}, ({ code, events, runner }) => {
  check('exits 0', code === 0, `exit ${code}`);
  check('the server sees each action, then done with the summary', JSON.stringify(types(events)) === JSON.stringify(['action', 'action', 'action', 'done']) && events.at(-1).summary === 'Alarm set for 6:45 AM.', JSON.stringify(events));
  check('the server sees step numbers out of the budget', events.some((e) => e.type === 'step' && e.step === 1 && e.total === 10));
  check('the app is launched by its bundle ID', runner.callsTo('/launchApp').some((c) => c.body.bundleId === 'com.apple.mobiletimer'));
  check('a tap at 50%/50% lands at the centre of the screen, in points', runner.callsTo('/touch').some((c) => c.body.x === 201 && c.body.y === 437), JSON.stringify(runner.callsTo('/touch').map((c) => c.body)));
});

await scenario('a task the agent gives up on', {
  script: [toolUse('taskFailed', { reason: 'There is no contact named Jordan.' })],
}, ({ code, events }) => {
  check('exits 1', code === 1, `exit ${code}`);
  check('the server sees failed with the reason', events.some((e) => e.type === 'failed' && /Jordan/.test(e.reason || '')), JSON.stringify(events));
});

await scenario('the step budget runs out', {
  script: [toolUse('tap', { x: 10, y: 10 }), toolUse('tap', { x: 20, y: 20 }), toolUse('tap', { x: 30, y: 30 })], maxSteps: 3,
}, ({ code, events, model }) => {
  check('exits 1', code === 1, `exit ${code}`);
  check('the server sees a failure', events.some((e) => e.type === 'failed'), JSON.stringify(events));
  const last = model.requests.at(-1).body.tools.map((t) => t.name);
  check('the last step offers only the two ways to finish', last.length === 2 && last.includes('taskComplete') && last.includes('taskFailed'), last.join(','));
});

await scenario('a question the user answers', {
  script: [toolUse('askUser', { question: 'Which Sam?', options: ['Sam Lee', 'Sam Patel'] }),
    (req) => toolUse('taskComplete', { summary: `Texted ${JSON.stringify(req.messages).includes('Sam Lee') ? 'Sam Lee' : 'nobody'}.` })],
  onAsk: (ask, answer) => setTimeout(() => answer('Sam Lee'), 300),
}, ({ code, events }) => {
  check('the server sees the question with its options', events.some((e) => e.type === 'ask' && e.question === 'Which Sam?' && e.options.join('|') === 'Sam Lee|Sam Patel'), JSON.stringify(events));
  check('the server sees the answer arrive', events.some((e) => e.type === 'answer_seen'));
  check('the answer reaches the model, and the run finishes', code === 0 && events.some((e) => e.type === 'done' && e.summary === 'Texted Sam Lee.'), JSON.stringify(events.at(-1)));
});

await scenario('a question nobody answers', {
  script: [toolUse('askUser', { question: 'Which Sam?', options: ['Sam Lee', 'Sam Patel'] }),
    (req) => toolUse('taskFailed', { reason: /no response|did not respond|not respond|unanswered|timed out/i.test(JSON.stringify(req.messages)) ? 'No answer.' : 'Model was not told.' })],
  askUserTimeoutSec: 1,
}, ({ events }) => {
  check('the server sees the question time out', events.some((e) => e.type === 'ask_timeout'), JSON.stringify(events));
  check('the model is told nobody answered', events.some((e) => e.type === 'failed' && e.reason === 'No answer.'), JSON.stringify(events.at(-1)));
});

await scenario('the model API refuses the key', {
  script: [httpError(401, 'invalid x-api-key')],
}, ({ code, events }) => {
  check('exits 42: errored, not failed', code === 42, `exit ${code}`);
  check('the server is told neither done nor failed', !events.some((e) => e.type === 'done' || e.type === 'failed'), JSON.stringify(events));
});

await scenario('the phone stops answering mid-task', {
  script: (runner) => [toolUse('openApp', { appName: 'Clock' }), () => { runner.kill(); return toolUse('tap', { x: 50, y: 50 }); }, toolUse('tap', { x: 50, y: 50 })],
}, ({ code, events }) => {
  check('exits 43: the device connection died', code === 43, `exit ${code}`);
  check('the server sees an infrastructure failure', events.some((e) => e.type === 'infra'), JSON.stringify(events));
});

await scenario('a reply with text but no tool call', {
  script: [text('I think the alarm is set.'), toolUse('taskComplete', { summary: 'Alarm set.' })],
}, ({ code, model }) => {
  check('the agent asks the model to use a tool and carries on', code === 0 && model.requests.length === 2);
});

await scenario('taskComplete ends the step: what came after it does not run', {
  script: [toolUse([['tap', { x: 10, y: 10 }], ['taskComplete', { summary: 'Done.' }], ['tap', { x: 90, y: 90 }]])],
}, ({ code, runner, model }) => {
  check('exits 0', code === 0);
  check('only the tap before taskComplete reached the phone', runner.callsTo('/touch').length === 1, JSON.stringify(runner.callsTo('/touch').map((c) => c.body)));
  check('no model request after the conclusion', model.requests.length === 1);
});

await scenario('an action that fails ends the step: the rest is reported "not run"', {
  script: [toolUse([['tapText', { text: 'Missing' }], ['tap', { x: 90, y: 90 }]]), toolUse('taskFailed', { reason: 'Stopped.' })],
}, ({ runner, model }) => {
  check('the tap after the failed action never reached the phone', runner.callsTo('/touch').length === 0);
  const results = model.requests[1].body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c.type === 'tool_result');
  check('every call got a result, the skipped one marked as an error', results.length === 2 && results[1].is_error === true && /Not run/.test(results[1].content), JSON.stringify(results));
});

await scenario('the agent does not leave the app the user is in', {
  script: [toolUse('taskComplete', { summary: 'Done.' })],
}, ({ runner }) => {
  check('no Home press unless the model asks for one', runner.callsTo('/pressButton').length === 0);
});

await scenario('older screens do not stay in the conversation', {
  script: [toolUse('tap', { x: 10, y: 10 }), toolUse('tap', { x: 20, y: 20 }), toolUse('taskComplete', { summary: 'Done.' })],
  screen: (s) => tree(el(`Screen ${s.calls ?? ''}`), el('Save', { x: 300, y: 70 })),
}, ({ model }) => {
  const third = model.requests[2].body.messages;
  const images = third.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c.type === 'image');
  const lists = JSON.stringify(third).split('UI elements on screen').length - 1;
  check('one screenshot in the request', images.length === 1, `${images.length}`);
  check('one element list in the request, the current one', lists === 1, `${lists}`);
  check('the task is still there', JSON.stringify(third).includes('Task: Do the thing'));
});

await scenario('a screen that never changes stops the run', {
  script: [toolUse('tap', { x: 50, y: 50 })], maxSteps: 20,
  screen: () => tree(el('Nothing happens here')),
}, ({ code, events, model }) => {
  check('exits 1', code === 1);
  check('the server sees a failure that says why', events.some((e) => e.type === 'failed' && /no progress/.test(e.reason || '')), JSON.stringify(events.at(-1)));
  check('it stopped long before the budget', model.requests.length < 12, `${model.requests.length}`);
});

{
  console.log('the record of a run');
  const dir = mkdtempSync(join(tmpdir(), 'agent-trace-'));
  const runner = await startFakeRunner({ screen: () => tree(el('Clock')) });
  const model = await startFakeModel([toolUse([['openApp', { appName: 'Clock' }], ['tap', { x: 50, y: 50 }]]), toolUse('taskComplete', { summary: 'Alarm set.' })]);
  const r = await runAgent({ runner, model, extraArgs: ['--trace-dir', dir] });
  await runner.close(); await model.close();
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const trace = readFileSync(join(dir, 'trace.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const chats = trace.filter((t) => t.attributes?.['gen_ai.operation.name'] === 'chat');
  const toolSpans = trace.filter((t) => t.attributes?.['gen_ai.operation.name'] === 'execute_tool');
  const observations = trace.filter((t) => t.name === 'observation');
  check('exits 0, and the manifest records the outcome and the model', r.code === 0 && manifest.outcome.status === 'completed' && manifest.model === 'claude-test-model' && manifest.totals.model_calls === 2);
  check('one chat span per model request, with OTel GenAI names', chats.length === 2 && chats[0].attributes['gen_ai.provider.name'] === 'anthropic' && chats[0].attributes['gen_ai.request.model'] === 'claude-test-model' && Number.isInteger(chats[0].attributes['gen_ai.usage.input_tokens']));
  check('one execute_tool span per tool call, with arguments and result', toolSpans.length === 3 && toolSpans[0].attributes['gen_ai.tool.name'] === 'openApp' && toolSpans[0].attributes['gen_ai.tool.call.arguments'].appName === 'Clock' && /Opened Clock/.test(toolSpans[0].attributes['gen_ai.tool.call.result']));
  check('the run itself is a span, the parent of the others', trace.at(-1).name === 'invoke_agent phone-agent' && chats.every((c) => c.parent_span_id === trace.at(-1).span_id));
  check('every screen the model was shown is recorded, from step 0', observations.length === 2 && observations[0].eval.step === 0 && existsSync(join(dir, observations[0].eval.image)));
  const raw = JSON.parse(readFileSync(join(dir, chats[0].eval.raw.request.$blob), 'utf8'));
  check('the exact request is kept, its image replaced by a reference to the stored bytes', raw.model === 'claude-test-model' && JSON.stringify(raw).includes('"$blob"') && !JSON.stringify(raw).includes('base64,'));
  check('the exact response is kept', JSON.parse(readFileSync(join(dir, chats[0].eval.raw.response.$blob), 'utf8')).id === 'msg_fake_1');
  const everything = readdirSync(join(dir, 'blobs', 'sha256')).map((f) => readFileSync(join(dir, 'blobs', 'sha256', f), 'latin1')).join('') + readFileSync(join(dir, 'trace.jsonl'), 'utf8') + readFileSync(join(dir, 'manifest.json'), 'utf8');
  check('the API key appears nowhere in the record', !everything.includes('test-key'));
  check('a transcript a person can read', readFileSync(join(dir, 'transcript.md'), 'utf8').includes('openApp'));
  rmSync(dir, { recursive: true, force: true });
}

console.log(fail ? `\n❌ ${fail} FAILED, ${pass} passed` : `\n✅ ALL PASS: ${pass} passed, 0 failed`);
if (fail) process.exit(1);
