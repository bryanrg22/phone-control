// hybrid.test.mjs — the hybrid mode: a decision model drives, an LLM takes the
// steps it cannot (agent/decision/escalate.mjs, the llm branch of
// agent/decision/loop.mjs, --provider hybrid). No network.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escalationReason, handoffMessage, DEFAULT_THRESHOLD, STUCK_STEPS, STICKY_MAX, ESCALATION_MODES } from '../decision/escalate.mjs';
import { candidateActions } from '../decision/candidates.mjs';
import { runDecisionLoop } from '../decision/loop.mjs';
import { parseHybridModel, HYBRID_PROVIDER } from '../providers/index.mjs';
import { parseAgentArgs } from '../cli-args.mjs';
import { createDevice } from '../device.mjs';
import { createToolRunner, toolDefinitions } from '../tools.mjs';
import { createProgressMonitor } from '../stuck.mjs';
import { createRecorder } from '../record.mjs';
import { createContext } from '../context.mjs';
import { startFakeRunner, tree, el, SCREEN } from './rig/fake-runner.mjs';
import { createAgentOutputParser } from '../../server/src/agent-runner.mjs';
import { usageOf } from '../../evals/phone-agent/trajectory.mjs';
import { buildReport, reportMarkdown } from '../../evals/phone-agent/report.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}
const HERE = dirname(fileURLToPath(import.meta.url));
const TASK = "Set a new alarm for 6:45 AM labeled 'Gym' in the Clock app and confirm it's set.";
const tap = { value: 'tap_3', description: 'Tap "Save" (button at 87%, 11%)' };

console.log('when a step is handed to the LLM:');
{
  const r = (o) => escalationReason({ chosen: tap, probability: 0.9, unchangedStreak: 0, final: false, ...o });
  check('a confident tap stays with the decision model', r({}) === null);
  check('done and blocked are the LLM\'s, whatever the probability', r({ chosen: { value: 'done' }, probability: 0.99 })?.reason === 'conclusion' && r({ chosen: { value: 'blocked' } })?.reason === 'conclusion');
  check('"write into a field" is the LLM\'s', r({ chosen: { value: 'write_0', description: 'Write into text field "Label"' } })?.reason === 'free_text');
  check(`a probability below the threshold (${DEFAULT_THRESHOLD}) is the LLM's, with the option named`, r({ probability: 0.3 })?.reason === 'low_confidence' && /Tap "Save"/.test(r({ probability: 0.3 }).detail));
  check('exactly the threshold is not below it', r({ probability: 0.5 }) === null);
  check('the threshold can be set', r({ probability: 0.6, threshold: 0.7 })?.reason === 'low_confidence' && r({ probability: 0.3, threshold: 0.2 }) === null);
  check(`${STUCK_STEPS} unchanged steps are the LLM's`, r({ unchangedStreak: STUCK_STEPS })?.reason === 'stuck' && r({ unchangedStreak: STUCK_STEPS - 1 }) === null);
  check('the final step is the LLM\'s before anything else', r({ final: true, chosen: { value: 'done' } })?.reason === 'final');
  check('a missing probability does not count as low', r({ probability: null }) === null);
}
{
  const since = [{ n: 1, description: 'Open the Clock app', changed: true }, { n: 2, description: 'Tap "Add"', changed: false, result: 'Tapped' }];
  const m = handoffMessage({ since, why: { reason: 'conclusion', detail: 'the decision model chose "done" (p=0.9)' }, first: true });
  check('the first handoff explains the decision model and lists its steps', /A fast decision model has been operating/.test(m) && /1\. Open the Clock app\n {2}2\. Tap "Add" → Tapped \(the screen did not change\)/.test(m), m);
  check('and says why and what to do', /because the decision model chose "done" \(p=0\.9\)\. Check the screen/.test(m));
  const later = handoffMessage({ since: [], why: { reason: 'free_text', detail: 'x' }, first: false });
  check('a later handoff is shorter and asks for the text', /took the steps below since your last one/.test(later) && /no steps since/.test(later) && /Write the text the task calls for/.test(later));
}

console.log('the write options:');
{
  const field = { desc: 'text field "Label" (empty)', kind: 'text field', name: 'Label', editable: true, x: 50, y: 48.7, top: 46 };
  const w = candidateActions({ elements: [field], task: TASK, apps: [], writer: true }).find((c) => c.value === 'write_0');
  check('a hybrid run offers "write into the field" with no tool call of its own', w && /Write into text field "Label" \(empty\) the text the task calls for/.test(w.description) && w.actions.length === 0, JSON.stringify(w));
  check('a plain decision run does not', !candidateActions({ elements: [field], task: TASK, apps: [] }).some((c) => c.value.startsWith('write_')));
}

console.log('the hybrid model spec:');
{
  const h = parseHybridModel('openai-decisions:gpt-6-luna+openai:gpt-6-luna');
  check('"<chooser>:<model>+<llm>:<model>"', h.chooser.provider === 'openai-decisions' && h.chooser.model === 'gpt-6-luna' && h.llm.provider === 'openai' && h.llm.model === 'gpt-6-luna');
  check('Jev as the chooser, Claude as the LLM', parseHybridModel('typesafe:jev-latest+anthropic:claude-haiku-5-5').llm.provider === 'anthropic');
  const bad = (s) => { try { parseHybridModel(s); return null; } catch (e) { return e.message; } };
  check('an LLM as the chooser is refused', /chooser/.test(bad('openai:gpt-6-luna+openai:gpt-6-luna')));
  check('a decision model as the LLM is refused', /LLM/.test(bad('openai-decisions:gpt-6-luna+typesafe:jev-latest')));
  check('one half is refused', /hybrid model is/.test(bad('openai-decisions:gpt-6-luna')));
  const c = parseAgentArgs(['t', '--simulator', 'x', '--provider', HYBRID_PROVIDER]).config;
  check('--provider hybrid has a default pair and a 0.5 threshold', c.model === 'openai-decisions:gpt-6-luna+openai:gpt-6-luna' && c.escalationThreshold === 0.5);
  check('--escalation-threshold is read and bounded', parseAgentArgs(['t', '--simulator', 'x', '--provider', 'hybrid', '--escalation-threshold', '0.7']).config.escalationThreshold === 0.7 && /escalation-threshold/.test(parseAgentArgs(['t', '--simulator', 'x', '--provider', 'hybrid', '--escalation-threshold', '2']).error?.message || ''));
  check('a bad pair is an argument error', /hybrid model/.test(parseAgentArgs(['t', '--simulator', 'x', '--provider', 'hybrid', '--model', 'nope']).error?.message || ''));
}

// ── the loop, in process: a scripted chooser and a scripted LLM, a fake phone ──
const toolCall = (name, args, id = `call_${Math.random().toString(36).slice(2, 8)}`) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
async function hybridRun({ chooser, llm, screen, maxSteps = 10, threshold = 0.5, abortAfter = 8, traceDir = null, sticky = false }) {
  const runner = await startFakeRunner({ screen });
  const device = createDevice({ host: '127.0.0.1', port: runner.port, knownApps: ['com.apple.mobiletimer'] });
  const state = { keyboardUp: false, screen: () => SCREEN };
  const logs = [];
  const protocol = { emit: (type, data) => logs.push({ type, ...data }), log: () => {}, ask: async () => null };
  const apps = { Clock: 'com.apple.mobiletimer' };
  const runTool = createToolRunner({ device, apps, screen: () => state.screen(), protocol, state });
  const asked = [];
  const llmCalls = [];
  let i = 0; let j = 0;
  const decider = {
    provider: 'test-decider', model: 'chooser',
    async decide({ candidates, state: st }) {
      asked.push({ candidates, state: st });
      const step = chooser[Math.min(i++, chooser.length - 1)];
      const [value, p] = typeof step === 'function' ? step(candidates) : step;
      if (!candidates.some((c) => c.value === value)) throw new Error(`test chose ${value}, not offered: ${candidates.map((c) => c.value).join(',')}`);
      return { choice: value, probability: p, confidence: p, probabilities: Object.fromEntries(candidates.map((c) => [c.value, c.value === value ? p : 0])), usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_write_input_tokens: null, reasoning_output_tokens: null }, responseId: null, responseModel: 'chooser', raw: {} };
    },
  };
  const model = {
    provider: 'test-llm', model: 'writer',
    async complete({ messages, tools, onlyTools }) {
      llmCalls.push({ messages: JSON.parse(JSON.stringify(messages.map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.map((c) => (c.type === 'image_url' ? { type: 'image_url' } : c)) } : m)))), tools, onlyTools });
      const step = llm[Math.min(j++, llm.length - 1)];
      if (step instanceof Error) throw step;
      const message = typeof step === 'function' ? step({ messages, tools, onlyTools }) : step;
      return { message, finishReasons: ['tool_calls'], responseId: 'r', responseModel: 'writer', usage: { input_tokens: 500, output_tokens: 20, cache_read_input_tokens: 0, cache_write_input_tokens: null, reasoning_output_tokens: null }, raw: {} };
    },
  };
  const recorder = createRecorder({ dir: traceDir, manifest: { task: 't', provider: 'hybrid', model: 'chooser+writer' } });
  const outcome = await runDecisionLoop({
    task: TASK, maxSteps, decider, device, runTool, apps: Object.keys(apps), protocol, recorder, progress: createProgressMonitor({ abortAfter }), state, autoAllowNotifications: async () => {},
    llm: { model, context: createContext({ system: 'You are an agent.' }), toolDefs: toolDefinitions({ apps, handBack: sticky }), threshold, sticky },
  });
  recorder.finish(outcome);
  await runner.close();
  return { outcome, runner, asked, llmCalls, logs };
}
const alarmScreen = (s) => (s.app === 'com.apple.mobiletimer' ? tree(el('Add', { x: 300, y: 80 }), el('Save', { x: 260, y: 80 })) : tree(el('Clock', { x: 40, y: 300 })));

console.log('the hybrid loop:');
{
  const traceDir = mkdtempSync(join(tmpdir(), 'hybrid-trace-'));
  const { outcome, asked, llmCalls } = await hybridRun({
    chooser: [['open_clock', 0.99], ['done', 0.9]],
    llm: [{ role: 'assistant', content: 'The alarm is set.', tool_calls: [toolCall('taskComplete', { summary: 'Alarm set for 6:45 AM, labelled Gym.' })] }],
    screen: alarmScreen, traceDir,
  });
  check('"done" goes to the LLM, which writes the real summary', outcome.status === 'completed' && outcome.summary === 'Alarm set for 6:45 AM, labelled Gym.' && outcome.steps === 2, JSON.stringify(outcome));
  check('the decision model was asked twice, the LLM once', asked.length === 2 && llmCalls.length === 1);
  const user = llmCalls[0].messages.filter((m) => m.role === 'user');
  check('the LLM saw the system prompt, the screenshot with the element list, and the handoff', llmCalls[0].messages[0].role === 'system' && user[0].content.some((c) => c.type === 'image_url') && /UI elements on screen/.test(user[0].content.find((c) => c.type === 'text').text) && /A fast decision model has been operating[\s\S]*1\. Open the Clock app[\s\S]*chose "done" \(p=0\.9\)/.test(user[1].content), JSON.stringify(user).slice(0, 600));
  check('the LLM was offered the full tool set, not only the conclusions', llmCalls[0].tools.length > 2 && llmCalls[0].onlyTools === null);
  const trace = readFileSync(join(traceDir, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const chats = trace.filter((r) => r.attributes?.['gen_ai.operation.name'] === 'chat');
  check('the record: a decision span (escalated, no tool call) then an LLM span with the reason', chats.length === 3 && chats[1].eval.decision.escalated === 'conclusion' && chats[1].attributes['gen_ai.output.messages'][0].parts.every((p) => p.type !== 'tool_call') && chats[2].eval.escalation.reason === 'conclusion' && chats[2].attributes['gen_ai.provider.name'] === 'test-llm', JSON.stringify(chats.map((c) => [c.attributes['gen_ai.provider.name'], c.eval.decision?.escalated, c.eval.escalation?.reason])));
  const tools = trace.filter((r) => r.attributes?.['gen_ai.operation.name'] === 'execute_tool');
  check('the LLM\'s taskComplete is an execute_tool span under step 2', tools.at(-1).attributes['gen_ai.tool.name'] === 'taskComplete' && tools.at(-1).eval.step === 2);
  const u = usageOf(trace);
  check('usage counts the LLM steps and prices each call by its own model', u.llm_steps === 1 && u.model_calls === 3 && Object.keys(u.by_model).join() === 'test-decider:chooser,test-llm:writer' && u.cost_usd === null);
  rmSync(traceDir, { recursive: true, force: true });
}
{
  const { outcome, asked, llmCalls, runner } = await hybridRun({
    chooser: [['open_clock', 0.99], (c) => [c.find((x) => x.description.startsWith('Tap "Add"')).value, 0.2], ['done', 0.95]],
    llm: [{ role: 'assistant', content: null, tool_calls: [toolCall('tapText', { text: 'Save' })] }, { role: 'assistant', content: null, tool_calls: [toolCall('taskComplete', { summary: 'ok' })] }],
    screen: alarmScreen,
  });
  check('a low-confidence choice goes to the LLM, which acts; the decision model takes the next step', outcome.status === 'completed' && llmCalls.length === 2 && asked.length === 3 && runner.callsTo('/touch').length === 1, `${outcome.status} llm=${llmCalls.length} asked=${asked.length}`);
  check('the decision model\'s next state lists the LLM\'s step', asked[2].state.object.actions_so_far[1] === '2. LLM: tapText(Save) (the screen did not change)', JSON.stringify(asked[2].state.object.actions_so_far));
  check('the LLM\'s second handoff says why and lists nothing new', /The decision model took the steps below[\s\S]*chose "done"/.test(llmCalls[1].messages.filter((m) => m.role === 'user').at(-1).content));
}
{
  const field = { ...el('', { x: 60, y: 400, w: 280, h: 40, type: 49 }), placeholderValue: 'Label' };
  const { outcome, llmCalls, runner } = await hybridRun({
    chooser: [['write_0', 0.8], ['done', 0.9]],
    llm: [{ role: 'assistant', content: null, tool_calls: [toolCall('tap', { x: 50, y: 48 }), toolCall('inputText', { text: 'Gym' })] }, { role: 'assistant', content: null, tool_calls: [toolCall('taskComplete', { summary: 'ok' })] }],
    screen: () => tree(field, el('Save', { x: 260, y: 80 })),
  });
  check('"write into the field" goes to the LLM, which types the text', outcome.status === 'completed' && /chose: Write into text field "Label"/.test(llmCalls[0].messages.at(-1).content) && runner.state.typed === 'Gym', `${outcome.status} typed=${runner.state.typed}`);
}
{
  const { llmCalls, asked } = await hybridRun({
    chooser: [['scroll_down', 0.9], ['scroll_down', 0.9], ['scroll_down', 0.9], ['scroll_down', 0.9], ['done', 0.9]],
    llm: [{ role: 'assistant', content: null, tool_calls: [toolCall('taskFailed', { reason: 'stuck' })] }],
    screen: () => tree(el('Home')), abortAfter: 0,
  });
  check(`after ${STUCK_STEPS} unchanged steps the LLM is asked, with the reason`, llmCalls.length === 1 && asked.length === 4 && /not changed for 3 steps/.test(llmCalls[0].messages.at(-1).content), `llm=${llmCalls.length} asked=${asked.length}`);
}
{
  const { outcome, llmCalls, asked } = await hybridRun({
    chooser: [['scroll_down', 0.9]],
    llm: [{ role: 'assistant', content: null, tool_calls: [toolCall('taskFailed', { reason: 'out of steps' })] }],
    screen: () => tree(el('Home')), maxSteps: 3, abortAfter: 0,
  });
  check('the final step is the LLM\'s, with the conclusions only, and it is told so', outcome.status === 'failed' && outcome.steps === 3 && asked.length === 2 && llmCalls[0].onlyTools.join() === 'taskComplete,taskFailed' && llmCalls[0].messages.some((m) => typeof m.content === 'string' && m.content.startsWith('FINAL STEP')), `${outcome.status} asked=${asked.length}`);
}
{
  const { outcome, llmCalls } = await hybridRun({
    chooser: [['done', 0.9]],
    llm: [new Error('API error 500'), { role: 'assistant', content: 'No tool.', tool_calls: [] }, { role: 'assistant', content: null, tool_calls: [toolCall('taskComplete', { summary: 'ok' })] }],
    screen: () => tree(el('Home')),
  });
  check('a failed LLM request loses the step; a reply without a tool call is recorded and the run goes on', outcome.status === 'completed' && llmCalls.length === 3 && outcome.steps === 3, JSON.stringify(outcome));
}
{
  const hard = Object.assign(new Error('API error 401'), { nonRecoverable: true });
  const { outcome } = await hybridRun({ chooser: [['done', 0.9]], llm: [hard], screen: () => tree(el('Home')) });
  check('a non-recoverable LLM error ends the run as errored', outcome.status === 'errored');
}

console.log('sticky escalation:');
{
  check('two modes, step the default', ESCALATION_MODES.join() === 'step,sticky' && parseAgentArgs(['t', '--simulator', 'x', '--provider', 'hybrid']).config.escalationMode === 'step');
  check('--escalation-mode sticky is read; anything else is an error', parseAgentArgs(['t', '--simulator', 'x', '--provider', 'hybrid', '--escalation-mode', 'sticky']).config.escalationMode === 'sticky' && /escalation-mode/.test(parseAgentArgs(['t', '--simulator', 'x', '--provider', 'hybrid', '--escalation-mode', 'always']).error?.message || ''));
  const plain = toolDefinitions({ apps: { Clock: 'x' } });
  const withBack = toolDefinitions({ apps: { Clock: 'x' }, handBack: true });
  check('handBack is offered only in sticky mode: the LLM mode\'s tool list is unchanged', !plain.some((t) => t.name === 'handBack') && withBack.at(-1).name === 'handBack' && JSON.stringify(withBack.slice(0, -1)) === JSON.stringify(plain));
  const first = handoffMessage({ since: [], why: { reason: 'low_confidence', detail: 'p=0.2' }, first: true, sticky: true });
  check('a sticky handoff tells the LLM it keeps control and how to hand back', /You keep control after this step until you conclude or call handBack/.test(first));
  check('a step-mode handoff does not', !/handBack/.test(handoffMessage({ since: [], why: { reason: 'low_confidence', detail: 'p=0.2' }, first: true })));
  check('the continuation note is one line', /^\[Control\] You still have control \(step 2 of at most 5 in a row\)\./.test(handoffMessage({ since: [], why: { reason: 'sticky', detail: 'step 2 of at most 5 in a row' }, first: false, sticky: true })));
}
{
  // After one low-confidence handoff, the LLM keeps control: no decision calls until it hands back.
  const { outcome, asked, llmCalls } = await hybridRun({
    sticky: true,
    chooser: [['open_clock', 0.99], (c) => [c.find((x) => x.description.startsWith('Tap "Add"')).value, 0.2], ['done', 0.95]],
    llm: [
      { role: 'assistant', content: null, tool_calls: [toolCall('tapText', { text: 'Add' })] },
      { role: 'assistant', content: null, tool_calls: [toolCall('tapText', { text: 'Save' })] },
      { role: 'assistant', content: null, tool_calls: [toolCall('handBack', { reason: 'only Save is left' })] },
      { role: 'assistant', content: null, tool_calls: [toolCall('taskComplete', { summary: 'Alarm set.' })] },
    ],
    screen: alarmScreen,
  });
  check('the LLM took three steps in a row with no decision call between them', asked.length === 3 && llmCalls.length === 4 && outcome.status === 'completed', `asked=${asked.length} llm=${llmCalls.length} ${outcome.status}`);
  check('after handBack the decision model chose again (its "done" went to the LLM to conclude)', /chose "done"/.test(llmCalls[3].messages.filter((m) => m.role === 'user').at(-1).content));
  check('the continuation steps carried the one-line control note', llmCalls[1].messages.filter((m) => m.role === 'user').some((m) => typeof m.content === 'string' && m.content.startsWith('[Control] You still have control (step 2')));
  check('an unchanged screen is not sent again as an image', llmCalls[1].messages.filter((m) => m.role === 'user').some((m) => m.content === '(The screen has not changed since your last step.)') && llmCalls[1].messages.filter((m) => Array.isArray(m.content)).length === 1, JSON.stringify(llmCalls[1].messages.map((m) => (typeof m.content === 'string' ? m.content.slice(0, 50) : '[image+text]'))));
  check('the decision model\'s state lists the LLM\'s steps and the hand-back', asked[2].state.object.actions_so_far.some((l) => /LLM: handBack\(only Save is left\)/.test(l)), JSON.stringify(asked[2].state.object.actions_so_far));
}
{
  // An LLM that never hands back gets control back after STICKY_MAX steps.
  const { asked, llmCalls } = await hybridRun({
    sticky: true, abortAfter: 0, maxSteps: 12,
    chooser: [['scroll_down', 0.2], ['blocked', 0.9]],
    llm: [{ role: 'assistant', content: null, tool_calls: [toolCall('scroll', {})] }, { role: 'assistant', content: null, tool_calls: [toolCall('scroll', {})] }, { role: 'assistant', content: null, tool_calls: [toolCall('scroll', {})] }, { role: 'assistant', content: null, tool_calls: [toolCall('scroll', {})] }, { role: 'assistant', content: null, tool_calls: [toolCall('scroll', {})] }, { role: 'assistant', content: null, tool_calls: [toolCall('taskFailed', { reason: 'blocked' })] }],
    screen: () => tree(el('Home')),
  });
  check(`control returns to the decision model after ${STICKY_MAX} LLM steps`, asked.length === 2 && llmCalls.length === STICKY_MAX + 1, `asked=${asked.length} llm=${llmCalls.length}`);
}
{
  // Step mode is unchanged: the decision model chooses after every LLM step.
  const { asked, llmCalls } = await hybridRun({
    chooser: [['scroll_down', 0.2], ['scroll_down', 0.2], ['done', 0.9]],
    llm: [{ role: 'assistant', content: null, tool_calls: [toolCall('scroll', {})] }, { role: 'assistant', content: null, tool_calls: [toolCall('scroll', {})] }, { role: 'assistant', content: null, tool_calls: [toolCall('taskComplete', { summary: 'ok' })] }],
    screen: () => tree(el('Home')), abortAfter: 0,
  });
  check('step mode still asks the decision model before every step', asked.length === 3 && llmCalls.length === 3, `asked=${asked.length} llm=${llmCalls.length}`);
}

console.log('the report:');
{
  const rec = (extra) => ({ task: 'a', category: 'single_app', status: 'ok', steps: 5, model_calls: 5, agent_seconds: 20, model_seconds: 5, input_tokens: 100, output_tokens: 10, tool_calls: 5, tool_errors: 0, ask_user_calls: 0, cost_usd: 0.01, ended: 'completed', served_models: ['m'], ...extra });
  const pass_ = { success: true, score: 1, rubric_results: [{ satisfied: true }] };
  const [h, l] = buildReport([
    { model: { provider: 'hybrid', model: 'a+b' }, trials: [{ trial: 1, records: [rec({ llm_steps: 2 })], evaluations: { a: pass_ } }] },
    { model: { provider: 'openai', model: 'b' }, trials: [{ trial: 1, records: [rec({})], evaluations: { a: pass_ } }] },
  ]);
  check('a hybrid row reports the LLM\'s share of steps; an LLM row does not', h.llm_steps === 2 && h.llm_step_share === 0.4 && l.llm_steps === undefined);
  const md = reportMarkdown([h, l], { judgeModel: 'j', maxSteps: 50, pricesAsOf: 'd' });
  check('and the markdown shows it', /\| hybrid:a\+b \| completed 1 \| 0% of 5 \| 0 \| 40% \(2\) \|/.test(md) && /\| openai:b \| completed 1 \| 0% of 5 \| 0 \| – \|/.test(md), md.split('\n').filter((x) => x.includes('hybrid:a+b') || x.includes('openai:b |')).join('\n'));
}

// ── the agent process end to end: --provider hybrid, one fake server for both OpenAI endpoints ──
console.log('the agent process with --provider hybrid:');
{
  const runner = await startFakeRunner({ screen: alarmScreen });
  const requests = [];
  const api = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      requests.push({ path: req.url, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/v1/decisions') {
        const choices = body.questions[0].choices.map((c) => c.value);
        const pick = body.input.includes('1. ') ? 'done' : 'open_clock';
        res.end(JSON.stringify({ id: 'dec', model: 'gpt-6-luna', answers: [{ type: 'choice', name: 'next_action', choice: pick, probabilities: choices.map((v) => ({ value: v, probability: v === pick ? 0.9 : 0 })), confidence: 0.9 }], usage: { input_tokens: 700, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 0 } }));
      } else if (req.url === '/v1/responses') {
        res.end(JSON.stringify({ id: 'resp', model: 'gpt-6-luna', status: 'completed', output: [{ type: 'function_call', call_id: 'c1', name: 'taskComplete', arguments: JSON.stringify({ summary: 'The 6:45 AM Gym alarm is set.' }) }], usage: { input_tokens: 3000, output_tokens: 30, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 10 } } }));
      } else { res.end('{}'); }
    });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${api.address().port}/v1`;
  const tmp = mkdtempSync(join(tmpdir(), 'hybrid-agent-'));
  const traceDir = join(tmp, 'trace');
  const args = [join(HERE, '..', 'agent.mjs'), TASK, '--provider', 'hybrid', '--model', 'openai-decisions:gpt-6-luna+openai:gpt-6-luna', '--driver-host', '127.0.0.1', '--driver-port', String(runner.port), '--max-steps', '8', '--trace-dir', traceDir];
  const events = [];
  const parser = createAgentOutputParser((e) => events.push(e));
  let output = '';
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmp, TMPDIR: tmp, PHONE_CONTROL_STATE_DIR: tmp, OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: url } });
    const feed = (c) => { output += c; parser.feed(c); };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    const t = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.on('close', (c) => { clearTimeout(t); resolve(c); });
  });
  parser.end();
  const manifest = existsSync(join(traceDir, 'manifest.json')) ? JSON.parse(readFileSync(join(traceDir, 'manifest.json'), 'utf8')) : null;
  const trace = existsSync(join(traceDir, 'trace.jsonl')) ? readFileSync(join(traceDir, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  check('exits 0 with the LLM\'s summary', code === 0 && events.some((e) => e.type === 'done' && e.summary === 'The 6:45 AM Gym alarm is set.'), `exit ${code}\n${output.slice(-800)}`);
  check('two Decisions calls, then one Responses call with the handoff', requests.map((r) => r.path).join() === '/v1/decisions,/v1/decisions,/v1/responses' && JSON.stringify(requests[2].body.input).includes('A fast decision model'), requests.map((r) => r.path).join());
  check('the manifest says hybrid, names both halves and the threshold', manifest?.settings.mode === 'hybrid' && manifest.settings.hybrid.chooser.provider === 'openai-decisions' && manifest.settings.hybrid.llm.model === 'gpt-6-luna' && manifest.settings.hybrid.escalation_threshold === 0.5 && manifest.provider === 'hybrid', JSON.stringify(manifest?.settings));
  const u = usageOf(trace);
  check('the trace prices each call by its own model: 2 × 700 input at $0.10/M plus the LLM call', u.llm_steps === 1 && Math.abs(u.cost_usd - ((2 * 700 * 0.1 + 3000 * 0.1 + 30 * 0.5) / 1e6)) < 1e-9 && u.by_model['openai-decisions:gpt-6-luna'].calls === 2 && u.by_model['openai:gpt-6-luna'].calls === 1, JSON.stringify(u));
  rmSync(tmp, { recursive: true, force: true });
  await new Promise((r) => api.close(r)); await runner.close();
}
console.log('the agent process with --escalation-mode sticky:');
{
  const runner = await startFakeRunner({ screen: alarmScreen });
  const requests = [];
  const api = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      requests.push({ path: req.url, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/v1/decisions') {
        const choices = body.questions[0].choices.map((c) => c.value);
        res.end(JSON.stringify({ id: 'dec', model: 'gpt-6-luna', answers: [{ type: 'choice', name: 'next_action', choice: 'done', probabilities: choices.map((v) => ({ value: v, probability: v === 'done' ? 0.9 : 0 })), confidence: 0.9 }], usage: { input_tokens: 700, output_tokens: 0 } }));
      } else {
        res.end(JSON.stringify({ id: 'resp', model: 'gpt-6-luna', status: 'completed', output: [{ type: 'function_call', call_id: 'c1', name: 'taskComplete', arguments: JSON.stringify({ summary: 'ok' }) }], usage: { input_tokens: 3000, output_tokens: 30 } }));
      }
    });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const tmp = mkdtempSync(join(tmpdir(), 'hybrid-agent-'));
  const traceDir = join(tmp, 'trace');
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, '..', 'agent.mjs'), TASK, '--provider', 'hybrid', '--escalation-mode', 'sticky', '--driver-host', '127.0.0.1', '--driver-port', String(runner.port), '--max-steps', '8', '--trace-dir', traceDir], { env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmp, TMPDIR: tmp, PHONE_CONTROL_STATE_DIR: tmp, OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `http://127.0.0.1:${api.address().port}/v1` } });
    child.stdout.resume(); child.stderr.resume();
    child.on('close', resolve);
  });
  const manifest = existsSync(join(traceDir, 'manifest.json')) ? JSON.parse(readFileSync(join(traceDir, 'manifest.json'), 'utf8')) : null;
  const llmReq = requests.find((r) => r.path === '/v1/responses');
  check('exits 0; the manifest records sticky mode and its cap', code === 0 && manifest?.settings.hybrid.escalation_mode === 'sticky' && manifest.settings.hybrid.sticky_max === STICKY_MAX, JSON.stringify(manifest?.settings.hybrid));
  check('the LLM request offers handBack', llmReq?.body.tools.some((t) => t.name === 'handBack'), JSON.stringify(llmReq?.body.tools.map((t) => t.name)));
  rmSync(tmp, { recursive: true, force: true });
  await new Promise((r) => api.close(r)); await runner.close();
}
{
  const runner = await startFakeRunner({ screen: () => tree(el('Clock')) });
  const tmp = mkdtempSync(join(tmpdir(), 'hybrid-agent-'));
  let output = '';
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, '..', 'agent.mjs'), 't', '--provider', 'hybrid', '--model', 'typesafe:jev-latest+openai:gpt-6-luna', '--driver-host', '127.0.0.1', '--driver-port', String(runner.port)], { env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmp, TMPDIR: tmp, PHONE_CONTROL_STATE_DIR: tmp, OPENAI_API_KEY: 'sk-test' } });
    child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });
    child.on('close', resolve);
  });
  check('each half needs its key: no TYPESAFE_API_KEY exits 1 before touching the phone', code === 1 && /TYPESAFE_API_KEY/.test(output) && runner.calls.length === 0, `exit ${code} ${output.slice(0, 200)}`);
  rmSync(tmp, { recursive: true, force: true });
  await runner.close();
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
