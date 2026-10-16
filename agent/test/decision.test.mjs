// decision.test.mjs — the decision-model mode (agent/decision/, providers
// openai-decisions and typesafe): the candidate actions built from a real
// screen, the phrases lifted from a task, the exact request each API gets, how
// each answer is read, the loop's stop rules, and the agent process end to end
// against a fake Decisions server and a fake Jev server. No network.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listElements } from '../elements.mjs';
import { candidateActions, phrasesOf, DONE_SUMMARY, MAX_TAP_CANDIDATES } from '../decision/candidates.mjs';
import { decisionState, INSTRUCTIONS } from '../decision/question.mjs';
import { runDecisionLoop } from '../decision/loop.mjs';
import { buildDecisionsRequest, parseDecisionsAnswer, createOpenAIDecisions } from '../providers/openai-decisions.mjs';
import { buildJevRequest, parseJevAnswer, createTypeSafe } from '../providers/typesafe.mjs';
import { createDecider, isDecisionProvider, KEY_ENV } from '../providers/index.mjs';
import { createDevice } from '../device.mjs';
import { createToolRunner } from '../tools.mjs';
import { createProgressMonitor } from '../stuck.mjs';
import { createRecorder } from '../record.mjs';
import { startFakeRunner, tree, el, SCREEN } from './rig/fake-runner.mjs';
import { createAgentOutputParser } from '../../server/src/agent-runner.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}
const HERE = dirname(fileURLToPath(import.meta.url));
const W = 402, H = 874;
const ADD_ALARM = readFileSync(join(HERE, 'fixtures', 'add-alarm-hierarchy.json'), 'utf8');
const TASK = "Set a new alarm for 6:45 AM labeled 'Gym' in the Clock app and confirm it's set.";
const APPS = ['Clock', 'CalTrack', 'Notes', 'SplitPay'];

console.log('candidate actions on the real Add Alarm sheet (keyboard up):');
{
  const elements = listElements(ADD_ALARM, W, H);
  const c = candidateActions({ elements, task: TASK, apps: APPS, currentApp: 'Clock', keyboardUp: true });
  const values = c.map((x) => x.value);
  const by = (v) => c.find((x) => x.value === v);
  check('every candidate has a value, a description and a list of tool calls', c.every((x) => x.value && x.description && Array.isArray(x.actions) && x.actions.length && x.actions.every((a) => a.tool && typeof a.args === 'object')));
  const first = (x) => x.actions[0];
  check('values are unique', new Set(values).size === values.length);
  const save = c.find((x) => x.description.startsWith('Tap "Save"'));
  const saveEl = elements.find((e) => e.desc === '"Save"');
  check('Save is a tap at its centre, in percent, named as a button', save && first(save).tool === 'tap' && first(save).args.x === saveEl.x && first(save).args.y === saveEl.y && save.description === `Tap "Save" (button at ${saveEl.x}%, ${saveEl.y}%)`, JSON.stringify(save));
  const wheel = c.find((x) => x.description.includes('picker wheel = "6 o’clock"'));
  check('a picker wheel is a candidate with its value', wheel && first(wheel).tool === 'tap' && /\(picker wheel at/.test(wheel.description), JSON.stringify(wheel));
  check('keyboard keys are not candidates (29 keys would drown the rest)', !c.some((x) => /^Tap "[A-Z]" \(key/.test(x.description)) && !c.some((x) => x.description.includes('(key at')), c.filter((x) => x.description.includes('key')).map((x) => x.description).join('; '));
  check('the field being typed into is still a candidate', c.some((x) => x.description.includes('text field "Label" = "Gym"')));
  const label = elements.find((e) => e.desc.startsWith('text field "Label"'));
  const gym = by('type_0_0');
  check('a phrase is typed into the field on screen: tap the field, then type, in one option', gym && gym.description === 'Type "Gym" into text field "Label" = "Gym" (after its current text)' && gym.actions.length === 2 && gym.actions[0].tool === 'tap' && gym.actions[0].args.x === label.x && gym.actions[0].args.y === label.y && gym.actions[1].tool === 'inputText' && gym.actions[1].args.text === 'Gym', JSON.stringify(gym));
  const hour = elements.find((e) => e.desc.includes('6 o’clock'));
  const setHour = c.find((x) => x.description === 'Set picker wheel = "6 o’clock" by tapping it and typing "6:45 AM"');
  check('a phrase starting with a digit is also offered into each picker wheel (iOS wheels take typed digits)', setHour && setHour.actions[0].args.x === hour.x && setHour.actions[1].args.text === '6:45 AM' && !c.some((x) => /^Set picker wheel .* typing "Gym"/.test(x.description)), c.filter((x) => x.value.startsWith('type_')).map((x) => x.description).join('\n'));
  check('typing values are phrase × target', values.filter((v) => v.startsWith('type_')).join() === 'type_0_0,type_1_0,type_1_1,type_1_2,type_1_3', values.filter((v) => v.startsWith('type_')).join());
  check('Return is offered while the keyboard is up', first(by('press_return')).tool === 'pressKey' && first(by('press_return')).args.key === 'enter');
  check('scroll down, scroll up and home are always offered', first(by('scroll_down')).tool === 'scroll' && first(by('scroll_up')).tool === 'swipe' && first(by('home')).args.key === 'home');
  check('Clock is not offered to open: it is the app on screen', !values.includes('open_clock'));
  check('done and blocked are last, mapped to taskComplete and taskFailed', values.at(-2) === 'done' && first(by('done')).tool === 'taskComplete' && first(by('done')).args.summary === DONE_SUMMARY && values.at(-1) === 'blocked' && first(by('blocked')).tool === 'taskFailed');
  check('the status bar is not a candidate', !c.some((x) => /battery|Cellular|10:30/.test(x.description)));
}
{
  const elements = listElements(JSON.stringify(tree(el('Clock', { y: 300 }), el('Notes', { y: 400 }), el('Settings', { y: 500 }))), W, H);
  const c = candidateActions({ elements, task: TASK, apps: APPS, currentApp: 'SpringBoard', keyboardUp: false });
  const values = c.map((x) => x.value);
  check('on the home screen the app the task names is offered to open', c.find((x) => x.value === 'open_clock')?.actions[0].args.appName === 'Clock');
  check('apps the task does not name are not offered', !values.some((v) => v.startsWith('open_') && v !== 'open_clock'), values.join(','));
  check('no field on screen: no typing candidates, no Return', !values.some((v) => v.startsWith('type_')) && !values.includes('press_return'));
  check('an element without a frame is not tappable', !candidateActions({ elements: [{ desc: '"x"', kind: 'text', editable: false, x: null, y: null }], task: '', apps: [] }).some((x) => x.actions[0].tool === 'tap'));
  const empty = candidateActions({ elements: [{ desc: 'text field "Label" (empty)', kind: 'text field', editable: true, x: 50, y: 48.7 }], task: TASK, apps: APPS });
  check('an empty field: "into", no "after its current text"', empty.find((x) => x.value === 'type_0_0').description === 'Type "Gym" into text field "Label" (empty)');
}
{
  const many = Array.from({ length: 200 }, (_, i) => ({ desc: `"Row ${i}"`, kind: 'cell', editable: false, x: 50, y: i / 2 }));
  const c = candidateActions({ elements: many, task: 'x', apps: [] });
  check(`taps are capped at ${MAX_TAP_CANDIDATES} (Jev takes 255 options)`, c.filter((x) => x.actions[0].tool === 'tap').length === MAX_TAP_CANDIDATES && c.length < 255);
  const worst = candidateActions({ elements: [...many, ...Array.from({ length: 6 }, (_, i) => ({ desc: `text field "f${i}" (empty)`, kind: 'text field', editable: true, x: 50, y: 10 + i }))], task: Array.from({ length: 20 }, (_, i) => `'p${i}'`).join(' '), apps: [] });
  check('and typing at 12 phrases × 4 targets, so the worst screen stays under 255', worst.filter((x) => x.value.startsWith('type_')).length === 48 && worst.length < 255, String(worst.length));
  const f = candidateActions({ elements: many, task: 'x', apps: [], final: true });
  check('the final step offers only done and blocked', f.map((x) => x.value).join(',') === 'done,blocked');
}

console.log('phrases lifted from a task:');
{
  const p = (t) => phrasesOf(t, { apps: APPS });
  check('quoted strings, times', JSON.stringify(p(TASK)) === '["Gym","6:45 AM"]', JSON.stringify(p(TASK)));
  check('it\'s and What\'s are not quotes', !p("Confirm it's set. What's the total?").length);
  check('an amount is typed without its $', JSON.stringify(p("Send $32.50 to Maya Patel on SplitPay for 'dinner split'")) === '["dinner split","32.50","Maya Patel"]', JSON.stringify(p("Send $32.50 to Maya Patel on SplitPay for 'dinner split'")));
  check('a name that opens a sentence loses its verb', JSON.stringify(p('Find the Ali Wong show at Great American Music Hall.')) === '["Ali Wong","Great American Music Hall"]', JSON.stringify(p('Find the Ali Wong show at Great American Music Hall.')));
  check('an address, and a phrase inside it is dropped', JSON.stringify(p('from Home (410 Brannan St) to Oracle Park')) === '["410 Brannan St","Oracle Park"]', JSON.stringify(p('from Home (410 Brannan St) to Oracle Park')));
  check('airport codes, not AM/PM', JSON.stringify(p('Flights from SFO to JFK at 6:30 AM')) === '["6:30 AM","SFO","JFK"]', JSON.stringify(p('Flights from SFO to JFK at 6:30 AM')));
  check('app names are not phrases', !p('Open the Work folder in Notes').length, JSON.stringify(p('Open the Work folder in Notes')));
  check('emails', p('Email it to jordan.avery@example.com please')[0] === 'jordan.avery@example.com');
  check('at most 12', phrasesOf(Array.from({ length: 20 }, (_, i) => `'phrase ${i}'`).join(' ')).length === 12);
}

console.log('the state each model is asked about:');
{
  const st = decisionState({ task: TASK, history: [{ n: 1, description: 'Tap "Add"', changed: true }, { n: 2, description: 'Tap "Save"', changed: false }], elements: ['- "Save" at (87.3%, 10.9%) size 72x44'], currentApp: 'Clock', keyboardUp: true });
  check('the object carries the task, the history, the app, the keyboard and the elements', st.object.task === TASK && st.object.actions_so_far[1] === '2. Tap "Save" (the screen did not change)' && st.object.app_on_screen === 'Clock' && st.object.keyboard === 'open' && st.object.elements_on_screen[0] === '"Save" at (87.3%, 10.9%) size 72x44', JSON.stringify(st.object));
  check('the text says the same', st.text.includes(`Task: ${TASK}`) && st.text.includes('2. Tap "Save" (the screen did not change)') && st.text.includes('Keyboard: open') && st.text.includes('- "Save" at (87.3%'));
  const long = decisionState({ task: 't', history: Array.from({ length: 25 }, (_, i) => ({ n: i + 1, description: `a${i + 1}`, changed: true })), elements: [], currentApp: null, keyboardUp: false });
  check('a long history keeps the last 20 and says so', long.object.actions_so_far[0] === '(5 earlier steps omitted)' && long.object.actions_so_far.length === 21 && long.object.elements_on_screen[0] === '(no elements read)');
  check('the instruction names done and blocked', /"done"/.test(INSTRUCTIONS) && /"blocked"/.test(INSTRUCTIONS));
}

const CANDS = [{ value: 'tap_0', description: 'Tap "Save"' }, { value: 'done', description: 'Done' }, { value: 'blocked', description: 'Blocked' }];
console.log('the OpenAI Decisions API request and answer:');
{
  const req = buildDecisionsRequest({ model: 'gpt-6-luna', instructions: 'Which?', stateText: 'Task: t', candidates: CANDS });
  check('one choice question with value/description choices over the text state', req.model === 'gpt-6-luna' && req.input === 'Task: t' && req.questions.length === 1 && req.questions[0].type === 'choice' && req.questions[0].name === 'next_action' && req.questions[0].instructions === 'Which?' && JSON.stringify(req.questions[0].choices) === JSON.stringify([{ value: 'tap_0', description: 'Tap "Save"' }, { value: 'done', description: 'Done' }, { value: 'blocked', description: 'Blocked' }]));
  // The shape a real call returned on 2026-10-16.
  const a = parseDecisionsAnswer({ model: 'gpt-6-luna', answers: [{ type: 'choice', name: 'next_action', choice: 'tap_0', probabilities: [{ value: 'tap_0', probability: 0.45 }, { value: 'done', probability: 0.3 }, { value: 'blocked', probability: 0.25 }], confidence: 0.41 }] }, CANDS);
  check('the choice, its probability, the confidence and every probability are read', a.choice === 'tap_0' && a.probability === 0.45 && a.confidence === 0.41 && a.probabilities.done === 0.3);
  let err = null; try { parseDecisionsAnswer({ answers: [{ type: 'refusal', name: 'next_action' }] }, CANDS); } catch (e) { err = e; }
  check('a refusal is an error', /refused/.test(err?.message || ''));
  err = null; try { parseDecisionsAnswer({ answers: [{ type: 'choice', name: 'next_action', choice: 'tap_9', probabilities: [] }] }, CANDS); } catch (e) { err = e; }
  check('a choice that was not offered is an error', /not offered/.test(err?.message || ''));
}
console.log('the Jev request and answer:');
{
  const req = buildJevRequest({ model: 'jev-latest', instructions: 'Which?', stateObject: { task: 't' }, candidates: CANDS });
  check('one choice question keyed next_action, criteria as an option→description map, the state as an object', req.model === 'jev-latest' && req.state.task === 't' && Object.keys(req.questions).join() === 'next_action' && req.questions.next_action.type === 'choice' && req.questions.next_action.instructions === 'Which?' && JSON.stringify(req.questions.next_action.criteria) === JSON.stringify({ tap_0: 'Tap "Save"', done: 'Done', blocked: 'Blocked' }));
  const a = parseJevAnswer({ model: 'jev-1.13.0', answers: { next_action: { type: 'choice', choice: 'done', confidence: 0.9, probabilities: { tap_0: 0.05, done: 0.9, blocked: 0.05 } } }, usage: { input_tokens: 300, output_tokens: 30 } }, CANDS);
  check('the choice, its probability, the confidence and every probability are read', a.choice === 'done' && a.probability === 0.9 && a.confidence === 0.9 && a.probabilities.tap_0 === 0.05);
  let err = null; try { buildJevRequest({ model: 'jev-latest', instructions: 'w', stateObject: {}, candidates: Array.from({ length: 256 }, (_, i) => ({ value: `c${i}`, description: '' })) }); } catch (e) { err = e; }
  check('more than 255 options is refused before the request', /255/.test(err?.message || ''));
  err = null; try { parseJevAnswer({ answers: {} }, CANDS); } catch (e) { err = e; }
  check('a missing answer is an error', /no answer/.test(err?.message || ''));
}
console.log('the providers:');
{
  check('both are decision providers, with their key names', isDecisionProvider('typesafe') && isDecisionProvider('openai-decisions') && !isDecisionProvider('openai') && KEY_ENV.typesafe === 'TYPESAFE_API_KEY' && KEY_ENV['openai-decisions'] === 'OPENAI_API_KEY');
  check('createDecider picks the provider', createDecider({ provider: 'typesafe', model: 'jev-latest', apiKey: 'k' }).provider === 'typesafe' && createDecider({ provider: 'openai-decisions', model: 'gpt-6-luna', apiKey: 'k' }).provider === 'openai-decisions');
}

// A local server playing an API: records what it was asked, answers from a script.
async function fakeApi(reply) {
  const requests = [];
  const s = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      requests.push({ path: req.url, headers: req.headers, body });
      const out = reply(body, requests.length);
      res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': `req_${requests.length}` });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${s.address().port}`, requests, close: () => new Promise((r) => s.close(r)) };
}
const decisionsReply = (choose) => (body) => {
  const choices = body.questions[0].choices.map((c) => c.value);
  const pick = choose(choices, body);
  return { id: 'dec_1', model: 'gpt-6-luna', answers: [{ type: 'choice', name: 'next_action', choice: pick, probabilities: choices.map((v) => ({ value: v, probability: v === pick ? 0.9 : 0.1 / (choices.length - 1) })), confidence: 0.85 }], usage: { input_tokens: 800, input_tokens_details: { cached_tokens: 100, cache_write_tokens: 0 }, output_tokens: 0 } };
};
const jevReply = (choose) => (body) => {
  const options = Object.keys(body.questions.next_action.criteria);
  const pick = choose(options, body);
  return { model: 'jev-1.13.0', answers: { next_action: { type: 'choice', choice: pick, confidence: 0.7, probabilities: Object.fromEntries(options.map((v) => [v, v === pick ? 0.7 : 0.3 / (options.length - 1)])) } }, usage: { input_tokens: 500, output_tokens: 40 } };
};

console.log('the request path of each provider:');
{
  const api = await fakeApi(decisionsReply((choices) => choices[0]));
  process.env.OPENAI_BASE_URL = `${api.url}/v1`;
  const d = createOpenAIDecisions({ model: 'gpt-6-luna', apiKey: 'sk-test' });
  const a = await d.decide({ instructions: 'w', state: { object: {}, text: 'T' }, candidates: CANDS });
  delete process.env.OPENAI_BASE_URL;
  check('posts to /v1/decisions with a bearer key', api.requests[0].path === '/v1/decisions' && api.requests[0].headers.authorization === 'Bearer sk-test');
  check('usage follows OTel: input includes the cached part, output 0', a.usage.input_tokens === 800 && a.usage.cache_read_input_tokens === 100 && a.usage.output_tokens === 0);
  check('the answer and the exact exchange come back', a.choice === 'tap_0' && a.responseModel === 'gpt-6-luna' && a.raw.request.input === 'T' && a.raw.response.id === 'dec_1');
  await api.close();
}
{
  const api = await fakeApi(jevReply((o) => o.at(-2)));
  process.env.TYPESAFE_BASE_URL = api.url;
  const d = createTypeSafe({ model: 'jev-latest', apiKey: 'ts-test' });
  const a = await d.decide({ instructions: 'w', state: { object: { task: 't' }, text: 'T' }, candidates: CANDS });
  delete process.env.TYPESAFE_BASE_URL;
  check('posts to /v1/systemone with a bearer key and no image header', api.requests[0].path === '/v1/systemone' && api.requests[0].headers.authorization === 'Bearer ts-test' && !api.requests[0].headers['typesafe-danger-zone-images']);
  check('the state goes as an object', api.requests[0].body.state.task === 't');
  check('the served model version is kept (jev-latest → jev-1.13.0)', a.choice === 'done' && a.responseModel === 'jev-1.13.0' && a.usage.input_tokens === 500 && a.usage.output_tokens === 40);
  await api.close();
}

// ── the loop, in process, against the fake phone and a scripted decider ──
async function loopRun({ script, screen, maxSteps = 10, abortAfter = 8, traceDir = null }) {
  const runner = await startFakeRunner({ screen });
  const device = createDevice({ host: '127.0.0.1', port: runner.port, knownApps: ['com.apple.mobiletimer'] });
  const state = { keyboardUp: false, screen: () => SCREEN };
  const logs = [];
  const protocol = { emit: (type, data) => logs.push({ type, ...data }), log: () => {}, ask: async () => null };
  const runTool = createToolRunner({ device, apps: { Clock: 'com.apple.mobiletimer' }, screen: () => state.screen(), protocol, state });
  const asked = [];
  let i = 0;
  const decider = {
    provider: 'test', model: 'test-decider',
    async decide({ candidates, state: st }) {
      asked.push({ candidates, state: st });
      const step = script[Math.min(i++, script.length - 1)];
      if (step instanceof Error) throw step;
      const value = typeof step === 'function' ? step(candidates) : step;
      if (!candidates.some((c) => c.value === value)) throw new Error(`test script chose ${value}, not offered: ${candidates.map((c) => c.value).join(',')}`);
      return { choice: value, probability: 0.8, confidence: 0.6, probabilities: Object.fromEntries(candidates.map((c) => [c.value, c.value === value ? 0.8 : 0])), usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_write_input_tokens: null, reasoning_output_tokens: null }, responseId: null, responseModel: 'test', raw: {} };
    },
  };
  const recorder = createRecorder({ dir: traceDir, manifest: { task: 't', provider: 'test', model: 'test-decider' } });
  const outcome = await runDecisionLoop({ task: TASK, maxSteps, decider, device, runTool, apps: ['Clock'], protocol, recorder, progress: createProgressMonitor({ abortAfter }), state, autoAllowNotifications: async () => {} });
  recorder.finish(outcome);
  await runner.close();
  return { outcome, runner, asked, logs };
}

console.log('the loop:');
{
  // The fake phone shows the Clock icon until Clock is launched, then its Add and Save buttons.
  const screen = (s) => (s.app === 'com.apple.mobiletimer' ? tree(el('Add', { x: 300, y: 80 }), el('Save', { x: 350, y: 80 })) : tree(el('Clock', { x: 40, y: 300 })));
  const traceDir = mkdtempSync(join(tmpdir(), 'decision-trace-'));
  const { outcome, runner, asked, logs } = await loopRun({ script: ['open_clock', (c) => c.find((x) => x.description.startsWith('Tap "Add"')).value, 'done'], screen, traceDir });
  check('open, tap, done: the run completes with the fixed summary', outcome.status === 'completed' && outcome.summary === DONE_SUMMARY && outcome.steps === 3, JSON.stringify(outcome));
  check('the app was launched and the tap landed on the element\'s centre in points', runner.callsTo('/launchApp')[0]?.body.bundleId === 'com.apple.mobiletimer' && runner.callsTo('/touch').some((c) => c.body.x === 360 && c.body.y === 102), JSON.stringify(runner.callsTo('/touch').map((c) => c.body)));
  check('the second question saw the new screen and the first action in its history', asked[1].candidates.some((c) => c.description.startsWith('Tap "Add"')) && asked[1].state.object.actions_so_far[0] === '1. Open the Clock app');
  check('the third question records that the tap changed nothing (the fake screen stayed)', asked[2].state.object.actions_so_far[1].startsWith('2. Tap "Add"') && asked[2].state.object.actions_so_far[1].includes('did not change'), JSON.stringify(asked[2].state.object.actions_so_far));
  check('the server sees step, thinking, action and the tools by their real names', logs.filter((e) => e.type === 'action').map((e) => e.tool).join(',') === 'openApp,tap,taskComplete');
  const trace = readFileSync(join(traceDir, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const chats = trace.filter((r) => r.attributes?.['gen_ai.operation.name'] === 'chat');
  const tools = trace.filter((r) => r.attributes?.['gen_ai.operation.name'] === 'execute_tool');
  check('the record has a chat span per question with the decision under eval', chats.length === 3 && chats[0].eval.decision.choice === 'open_clock' && chats[0].eval.decision.probability === 0.8 && chats[0].eval.decision.confidence === 0.6 && chats[0].eval.decision.candidates > 3, JSON.stringify(chats[0]?.eval));
  check('and an execute_tool span per action, as the LLM mode writes them', tools.length === 3 && tools[1].attributes['gen_ai.tool.name'] === 'tap' && tools[2].attributes['gen_ai.tool.name'] === 'taskComplete' && tools[2].attributes['gen_ai.tool.call.arguments'].summary === DONE_SUMMARY);
  check('observations: the first screen and one after each action that could change it', trace.filter((r) => r.name === 'observation').length === 3);
  const manifest = JSON.parse(readFileSync(join(traceDir, 'manifest.json'), 'utf8'));
  check('the manifest totals the questions as model calls', manifest.totals.model_calls === 3 && manifest.totals.input_tokens === 30 && manifest.outcome.status === 'completed');
  check('the transcript is written', existsSync(join(traceDir, 'transcript.md')));
  rmSync(traceDir, { recursive: true, force: true });
}
{
  const field = { ...el('', { x: 60, y: 400, w: 280, h: 40, type: 49 }), placeholderValue: 'Label' };   // an unlabelled SwiftUI field, known by its placeholder
  const screen = () => tree(field, el('Save', { x: 260, y: 80 }));
  const traceDir = mkdtempSync(join(tmpdir(), 'decision-trace-'));
  const { outcome, runner, asked } = await loopRun({ script: ['type_0_0', 'done'], screen, traceDir });
  const touches = runner.callsTo('/touch').map((c) => c.body);
  check('a typing option taps the field, then types, in one step', outcome.status === 'completed' && touches.length === 1 && touches[0].x === 200 && touches[0].y === 420 && runner.state.typed === 'Gym', `${JSON.stringify(touches)} typed=${runner.state.typed} ${JSON.stringify(asked[0].candidates.map((c) => c.value))}`);
  const trace = readFileSync(join(traceDir, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const step1 = trace.filter((r) => r.attributes?.['gen_ai.operation.name'] === 'execute_tool' && r.eval.step === 1);
  check('both calls are recorded under the step, with their own ids', step1.length === 2 && step1[0].attributes['gen_ai.tool.name'] === 'tap' && step1[1].attributes['gen_ai.tool.name'] === 'inputText' && step1[0].attributes['gen_ai.tool.call.id'] !== step1[1].attributes['gen_ai.tool.call.id']);
  check('the history line is the option, not two tool calls', asked[1].state.object.actions_so_far[0] === '1. Type "Gym" into text field "Label" (empty) (the screen did not change)', asked[1].state.object.actions_so_far[0]);
  rmSync(traceDir, { recursive: true, force: true });
}
{
  const { outcome } = await loopRun({ script: ['blocked'], screen: () => tree(el('Home')) });
  check('blocked ends the run as failed', outcome.status === 'failed' && /impossible/.test(outcome.reason) && outcome.steps === 1, JSON.stringify(outcome));
}
{
  const { outcome, asked } = await loopRun({ script: ['scroll_down'], screen: () => tree(el('Home')), maxSteps: 3 });
  check('the last step offers done and blocked only, and the budget ends the run', asked[2].candidates.map((c) => c.value).join() === 'done,blocked' && asked.length === 3 && outcome.status === 'step_budget', `${asked.map((a) => a.candidates.length).join(',')} ${outcome.status}`);
  check('earlier steps saw the screen unchanged by the scroll', asked[1].state.object.actions_so_far[0].includes('did not change'));
}
{
  const { outcome, asked } = await loopRun({ script: ['scroll_down'], screen: () => tree(el('Home')), maxSteps: 20, abortAfter: 4 });
  // The first screen is not counted (as in loop.mjs): 4 unchanged screens after actions = 5 steps.
  check('a screen that never changes stops the run as no_progress', outcome.status === 'no_progress' && asked.length === 5, JSON.stringify(outcome));
}
{
  const hard = Object.assign(new Error('API error 401: bad key'), { nonRecoverable: true });
  const { outcome } = await loopRun({ script: [hard], screen: () => tree(el('Home')) });
  check('a non-recoverable API error ends the run as errored', outcome.status === 'errored' && /401/.test(outcome.reason));
  const soft = new Error('API error 500: boom');
  const { outcome: o2, asked } = await loopRun({ script: [soft, 'done'], screen: () => tree(el('Home')) });
  check('a request that failed loses its step; the next step goes on', o2.status === 'completed' && o2.steps === 2 && asked.length === 2);
}

// ── the agent process end to end: the real agent.mjs, a fake phone, a fake API ──
async function runAgentProcess({ provider, model, env, task = TASK, maxSteps = 8, runner }) {
  const tmp = mkdtempSync(join(tmpdir(), 'decision-agent-'));
  const traceDir = join(tmp, 'trace');
  const args = [join(HERE, '..', 'agent.mjs'), task, '--provider', provider, '--model', model, '--driver-host', '127.0.0.1', '--driver-port', String(runner.port), '--max-steps', String(maxSteps), '--trace-dir', traceDir, '--run-id', 'decision-test'];
  const events = [];
  const parser = createAgentOutputParser((e) => events.push(e));
  let output = '';
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmp, TMPDIR: tmp, PHONE_CONTROL_STATE_DIR: tmp, ...env } });
    const feed = (c) => { output += c; parser.feed(c); };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    const t = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.on('close', (c) => { clearTimeout(t); resolve(c); });
  });
  parser.end();
  const manifest = existsSync(join(traceDir, 'manifest.json')) ? JSON.parse(readFileSync(join(traceDir, 'manifest.json'), 'utf8')) : null;
  rmSync(tmp, { recursive: true, force: true });
  return { code, events, output, manifest };
}

console.log('the agent process with --provider openai-decisions:');
{
  const runner = await startFakeRunner({ screen: () => tree(el('Clock', { x: 40, y: 300 })) });
  const api = await fakeApi(decisionsReply((choices, body) => (body.input.includes('1. ') ? 'done' : choices.find((v) => v === 'open_clock') || choices[0])));
  const r = await runAgentProcess({ provider: 'openai-decisions', model: 'gpt-6-luna', env: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${api.url}/v1` }, runner });
  check('exits 0 with done', r.code === 0 && r.events.some((e) => e.type === 'done' && e.summary === DONE_SUMMARY), `exit ${r.code}; ${JSON.stringify(r.events.filter((e) => e.type !== 'step' && e.type !== 'thinking'))}\n${r.output.slice(-600)}`);
  check('the first question offered to open Clock (named in the task) and the API answered it', api.requests[0]?.body.questions[0].choices.some((c) => c.value === 'open_clock') && runner.callsTo('/launchApp').length === 1);
  check('the manifest says decision mode, the API and that no screenshot was sent', r.manifest?.settings.mode === 'decision' && r.manifest.settings.decision.api === 'OpenAI Decisions API' && r.manifest.settings.decision.screenshot_sent === false && r.manifest.provider === 'openai-decisions', JSON.stringify(r.manifest?.settings));
  check('the key is never in the record', !JSON.stringify(r.manifest).includes('sk-test'));
  await api.close(); await runner.close();
}
console.log('the agent process with --provider typesafe:');
{
  const runner = await startFakeRunner({ screen: () => tree(el('Clock', { x: 40, y: 300 })) });
  const api = await fakeApi(jevReply((options, body) => (body.state.actions_so_far[0] !== '(none yet)' ? 'blocked' : 'open_clock')));
  const r = await runAgentProcess({ provider: 'typesafe', model: 'jev-latest', env: { TYPESAFE_API_KEY: 'ts-test', TYPESAFE_BASE_URL: api.url }, runner });
  check('exits 1 with failed when Jev says blocked', r.code === 1 && r.events.some((e) => e.type === 'failed' && /impossible/.test(e.reason)), `exit ${r.code}; ${r.output.slice(-600)}`);
  check('the state went as an object with the task and the elements', api.requests[0]?.body.state.task === TASK && Array.isArray(api.requests[0].body.state.elements_on_screen));
  check('the manifest records the served model', r.manifest?.model === 'jev-latest' && r.manifest.settings.decision.api.startsWith('TypeSafe'));
  await api.close(); await runner.close();
}
{
  const runner = await startFakeRunner({ screen: () => tree(el('Clock')) });
  const r = await runAgentProcess({ provider: 'typesafe', model: 'jev-latest', env: {}, runner });
  check('no TYPESAFE_API_KEY: exits 1 before touching the phone', r.code === 1 && /TYPESAFE_API_KEY/.test(r.output) && runner.calls.length === 0, `exit ${r.code}`);
  await runner.close();
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
