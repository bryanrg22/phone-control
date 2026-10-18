// irreversible.test.mjs — the decision and hybrid modes ask before a tap that
// cannot be undone (agent/decision/irreversible.mjs, the irreversible
// escalation, the hold on the LLM's taps, decision-only's question). No network.
//
// The fixtures are what the agent read on real iOSWorld screens (2026-10-16/17):
// every distinct element of 5,736 screens, and one screen per control of interest.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitOfLabel, commitOfElement, commitOfCall, elementAt, normaliseLabel, isConsent } from '../decision/irreversible.mjs';
import { candidateActions } from '../decision/candidates.mjs';
import { escalationReason, handoffMessage, CONFIRM_ASK, VERIFY_ASK } from '../decision/escalate.mjs';
import { runDecisionLoop, answerOf } from '../decision/loop.mjs';
import { createDevice } from '../device.mjs';
import { createToolRunner, toolDefinitions } from '../tools.mjs';
import { createProgressMonitor } from '../stuck.mjs';
import { createRecorder } from '../record.mjs';
import { createContext } from '../context.mjs';
import { startFakeRunner, tree, el, SCREEN } from './rig/fake-runner.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}
const HERE = dirname(fileURLToPath(import.meta.url));
const LABELS = JSON.parse(readFileSync(join(HERE, 'fixtures/iosworld-element-labels.json'), 'utf8'));
const SCREENS = JSON.parse(readFileSync(join(HERE, 'fixtures/iosworld-commit-screens.json'), 'utf8')).screens;
const MYBANK = 'Send $50 via Zelle to Maya Patel in MyBank and confirm the payment was sent.';
const TASKS = Object.fromEntries([
  ['mybank-003', MYBANK],
  ['splitpay-001', "Send $32.50 to Maya Patel on SplitPay for 'dinner split' from my SplitPay balance and confirm the payment was sent."],
  ['quickbite-001', 'Order a chicken bowl from Chipotle on QuickBite for delivery to 410 Brannan St and confirm the order was placed.'],
  ['cityride-001', "Request a CityRideX ride in CityRide from Home (410 Brannan St) to Oracle Park. What's the estimated fare and ETA?"],
  ['dinespot-001', "Search for restaurants in San Francisco with the 'Outdoor Seating' tag on DineSpot and make a reservation at Harborline Seafood. Confirm the reservation and give me the date, time, and party size."],
  ['teamchat-003', 'Check my DMs in TeamChat, find the most recent unread direct message, and send a reply. Who was it from, and confirm the reply was sent.'],
  ['lockedin-003', 'Search lockedin for a platform engineer and send them a message saying I admire their experience and would like to connect. Who did you message?'],
  ['mail-002', 'Filter my Inbox in Mail to show only the Transactions category, then archive a QuickBite receipt. Confirm it was archived.'],
  ['megamart-001', "Search for 'PS5 Controller' on MegaMart and add one to my cart. What's the product name and price?"],
  ['clock-001', "Set a new alarm for 6:45 AM labeled 'Gym' in the Clock app and confirm it's set."],
]);

// An element line as the agent reads it → the element listElements() gives (no kind in the line: "element").
const FIELD = /^(text field|search field|secure text field|text view)\b/;
function parseLine(line) {
  const m = /^- ([\s\S]*?)(?: at \(([\d.]+)%, ([\d.]+)%\) size (\d+)x(\d+))?$/.exec(line);
  const desc = m[1];
  const named = /^"([\s\S]*?)"(?: = "[\s\S]*")?$/.exec(desc);
  const editable = FIELD.test(desc);
  const name = named ? named[1] : (/"([\s\S]*?)"/.exec(desc)?.[1] ?? null);
  return { desc, name, text: name || '', kind: editable ? desc.match(FIELD)[1] : 'element', editable, x: m[2] ? +m[2] : null, y: m[3] ? +m[3] : null, w: m[4] ? +m[4] : null, h: m[5] ? +m[5] : null, top: m[3] ? +m[3] - (+m[5] / 2 / SCREEN.heightPoints) * 100 : null };
}
const elementsOf = (key) => SCREENS[key].elements.filter((l) => l.startsWith('- ')).map(parseLine);   // not the "(… more not shown)" line

console.log('labels that commit, and labels that only open a screen:');
{
  const confirm = ['Send now', 'Pay', 'Pay $32.50', 'Place Order', 'Confirm & Place Order', 'Request CityRideX · $9.80', 'Buy Now', 'Delete', 'Delete Alarm', 'Erase', 'Empty Trash', 'Subscribe $9.99/mo', 'Place order ($20.70)', 'Confirm payment', 'Transfer now', 'Book · $259'];
  for (const l of confirm) check(`"${l}" is asked about first`, commitOfLabel(l, { task: MYBANK })?.policy === 'confirm', JSON.stringify(commitOfLabel(l, { task: MYBANK })));
  const verify = ['Send', 'send', 'Post', 'Submit', 'Confirm Reservation', 'Reserve', 'Book', 'Publish'];
  for (const l of verify) check(`"${l}" is checked by the LLM, not asked about`, commitOfLabel(l, { task: 'Text Sam hello' })?.policy === 'verify', JSON.stringify(commitOfLabel(l)));
  const none = ['Send | Zelle®', 'Pay/Request', 'Pay bills', 'Pay &\ntransfer', 'Book a\nFlight', 'Order history', 'Orders', 'Reply', 'Transfer', 'Request', 'Deleted', 'Recently Deleted', 'Save', 'Done', 'Add to cart', 'Add to Cart · $5.99', 'Archive', 'Like', 'Remove', 'Close', 'Cancel', 'Send with Zelle', 'Send to, Maya Patel', 'Confirmed', 'Checkout', 'I confirm this charge on my saved MyBank card.', '$20,491.50', ''];
  for (const l of none) check(`"${l.replace(/\n/g, '\\n')}" commits nothing`, commitOfLabel(l, { task: MYBANK }) === null, JSON.stringify(commitOfLabel(l, { task: MYBANK })));
  check('"Send now" moves money only in a task that does', commitOfLabel('Send now', { task: MYBANK }).policy === 'confirm' && commitOfLabel('Send now', { task: 'Email the report to Ana' }).policy === 'verify');
  check('a price is taken off the end, with its separator', normaliseLabel('Request CityRideX · $12.80').head === 'request cityridex' && normaliseLabel('Pay credit card now, $4,588.98').head === 'pay credit card now' && normaliseLabel('Pay').priced === false);
  check('a field\'s contents are never a button name', commitOfElement({ desc: 'text field "Message" = "Send"', name: 'Message', text: 'Send', editable: true, kind: 'text field' }) === null);
  check('nor is a keyboard key ("delete")', commitOfElement({ desc: '"delete"', name: 'delete', text: 'delete', editable: false, kind: 'key' }) === null);
}

console.log('every element on 5,736 saved iOSWorld screens:');
{
  const hits = new Map();
  for (const e of LABELS.elements) {
    const p = parseLine(`- ${e.desc}`);
    if (p.editable) continue;
    const label = /^"([\s\S]*?)"(?: = "[\s\S]*")?$/.exec(e.desc)?.[1];
    if (label === undefined) continue;
    const task = e.tasks.some((t) => ['mybank-003', 'splitpay-001'].includes(t)) ? MYBANK : '';
    const c = commitOfLabel(label, { task });
    if (c) hits.set(label, c.policy);
  }
  // The whole list, so a broadened rule shows here as a diff.
  const expected = {
    'Book': 'verify', 'Buy Now': 'confirm', 'Confirm & Place Order': 'confirm', 'Confirm Reservation': 'verify', 'Delete': 'confirm',
    'Pay': 'confirm', 'Pay credit card now, $4,588.98': 'confirm', 'Pay credit card now, $4,608.73': 'confirm', 'Pay credit card now, $4,623.97': 'confirm', 'Pay credit card now, $4,643.72': 'confirm',
    'Place Order': 'confirm', 'Post': 'verify', 'Request CityRideX · $12.80': 'confirm', 'Request CityRideX · $9.58': 'confirm', 'Request CityRideX · $9.80': 'confirm',
    'Reserve': 'verify', 'Reserve now': 'verify', 'Send': 'verify', 'Send now': 'confirm', 'delete': 'confirm', 'send': 'verify',
  };
  const got = Object.fromEntries([...hits].sort());
  check(`exactly ${Object.keys(expected).length} of ${LABELS.elements.length} distinct elements commit (lowercase "delete" is the keyboard key, left out by kind on a real screen)`, JSON.stringify(got) === JSON.stringify(Object.fromEntries(Object.entries(expected).sort())), JSON.stringify(got));
}

console.log('the screens, as the decision model is offered them:');
{
  const commits = (key) => candidateActions({ elements: elementsOf(key), task: TASKS[SCREENS[key].task] }).filter((c) => c.commit).map((c) => `${c.commit.label}:${c.commit.policy}`);
  check('MyBank\'s Zelle form: only "Send now", asked about', JSON.stringify(commits('mybank-zelle-form')) === '["Send now:confirm"]', JSON.stringify(commits('mybank-zelle-form')));
  check('MyBank\'s home: "Send | Zelle®", "Pay bills" and "Pay & transfer" open screens; only the card payment row commits', JSON.stringify(commits('mybank-home')) === '["Pay credit card now, $4,588.98:confirm"]', JSON.stringify(commits('mybank-home')));
  check('SplitPay\'s amount pad: "Pay", not "Request"', JSON.stringify(commits('splitpay-amount')) === '["Pay:confirm"]', JSON.stringify(commits('splitpay-amount')));
  check('SplitPay\'s home: "Pay/Request" opens the pad', JSON.stringify(commits('splitpay-home')) === '[]', JSON.stringify(commits('splitpay-home')));
  check('QuickBite\'s cart and its checkout sheet', JSON.stringify(commits('quickbite-cart')) === '["Place Order:confirm"]' && JSON.stringify(commits('quickbite-confirm')) === '["Confirm & Place Order:confirm"]', `${commits('quickbite-cart')} / ${commits('quickbite-confirm')}`);
  check('CityRide\'s priced request', commits('cityride-request').includes('Request CityRideX · $9.80:confirm'), JSON.stringify(commits('cityride-request')));
  check('DineSpot\'s review sheet: checked, not asked', JSON.stringify(commits('dinespot-reserve')) === '["Confirm Reservation:verify"]', JSON.stringify(commits('dinespot-reserve')));
  check('TeamChat\'s thread: "Send" checked', commits('teamchat-thread').every((c) => c.endsWith(':verify')) && commits('teamchat-thread').length >= 1, JSON.stringify(commits('teamchat-thread')));
  check('Mail in selection: "Delete" asked, "Archive" not', commits('mail-select').includes('Delete:confirm') && !commits('mail-select').some((c) => c.startsWith('Archive')), JSON.stringify(commits('mail-select')));
  check('MegaMart\'s product page: "Buy Now" asked, "Add to Cart" not', commits('megamart-product').includes('Buy Now:confirm') && !commits('megamart-product').some((c) => /cart/i.test(c)), JSON.stringify(commits('megamart-product')));
  check('Clock\'s Add Alarm sheet: nothing', JSON.stringify(commits('clock-add-alarm')) === '[]', JSON.stringify(commits('clock-add-alarm')));
  const plain = candidateActions({ elements: elementsOf('mybank-zelle-form'), task: MYBANK });
  const send = plain.find((c) => c.commit);
  check('the option the model sees is worded as before', send.description === 'Tap "Send now" (element at 50%, 63.1%)' && send.actions.length === 1 && send.actions[0].tool === 'tap', JSON.stringify(send));
}

console.log('where a tap lands:');
{
  const els = elementsOf('mybank-zelle-form');
  check('(50, 63.1) is "Send now", not the full-screen "MyBank" behind it', elementAt(els, 50, 63.1, SCREEN)?.name === 'Send now');
  check('an edge of the button is still the button', elementAt(els, 5, 65, SCREEN)?.name === 'Send now');
  check('a tap on "Close" commits nothing', commitOfCall('tap', { x: 13.3, y: 11.4 }, { elements: els, screen: SCREEN, task: MYBANK }) === null);
  check('a tap on "Send now" pays', commitOfCall('tap', { x: 50, y: 63.1 }, { elements: els, screen: SCREEN, task: MYBANK })?.label === 'Send now');
  check('tapText "Send now" pays, judged by its text', commitOfCall('tapText', { text: 'Send now' }, { elements: [], screen: SCREEN, task: MYBANK })?.policy === 'confirm');
  const keys = [{ name: 'delete', text: 'delete', kind: 'key', editable: false, x: 90, y: 85, w: 50, h: 40 }];
  check('tapText "delete" on the keyboard deletes no data', commitOfCall('tapText', { text: 'delete' }, { elements: keys, screen: SCREEN, task: '' }) === null);
  check('typing commits nothing', commitOfCall('inputText', { text: 'Send now' }, { elements: els, screen: SCREEN, task: MYBANK }) === null);
}

console.log('consent:');
{
  check('"Yes, send $50" agrees; "No, cancel", "Don\'t send" and silence do not', isConsent('Yes, send $50') && isConsent('Yes') && !isConsent('No, cancel') && !isConsent("Don't send") && !isConsent('Cancel') && !isConsent(null) && !isConsent(''));
  check('an answer to another question is no consent ("Maya Patel", to "Which Maya?")', !isConsent('Maya Patel') && !isConsent('The second one') && isConsent('Send it') && isConsent('OK'));
  check('the answer is read from askUser\'s result', answerOf('User chose: "Yes, send $50"') === 'Yes, send $50' && answerOf('No response from the user (timed out — unattended run). You are NOT authorized') === null);
}

console.log('the escalation:');
{
  const send = candidateActions({ elements: elementsOf('mybank-zelle-form'), task: MYBANK }).find((c) => c.commit);
  const close = candidateActions({ elements: elementsOf('mybank-zelle-form'), task: MYBANK }).find((c) => /Close/.test(c.description));
  const r = (o) => escalationReason({ chosen: send, probability: 0.87, unchangedStreak: 0, final: false, ...o });
  check('"Send now" at p 0.87 (mybank-003) goes to the LLM as irreversible', r({})?.reason === 'irreversible' && /tap "Send now", which would send money \(p=0\.87\)/.test(r({}).detail), JSON.stringify(r({})));
  check('at any probability', r({ probability: 0.999 })?.reason === 'irreversible' && r({ probability: 0.2 })?.reason === 'irreversible');
  check('the final step still comes first', r({ final: true })?.reason === 'final');
  check('an ordinary confident tap stays with the decision model', escalationReason({ chosen: close, probability: 0.9, unchangedStreak: 0, final: false }) === null);
  const m = handoffMessage({ since: [], why: r({}), first: false, sticky: true });
  check('the handoff says to check the screen and ask with askUser before paying', m.includes(CONFIRM_ASK) && /call askUser with a Yes\/No question/.test(m) && /do not tap it in the same step/.test(m) && /call taskFailed/.test(m), m);
  const v = handoffMessage({ since: [], why: { reason: 'irreversible', detail: 'x', commit: { policy: 'verify' } }, first: false });
  check('a send is checked, not asked about', v.includes(VERIFY_ASK) && !/askUser/.test(v));
}

// ── the loop on a fake phone: MyBank's Zelle form ──
const toolCall = (name, args) => ({ id: `call_${Math.random().toString(36).slice(2, 8)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const say = (...calls) => ({ role: 'assistant', content: '', tool_calls: calls });
function nodeOf(e) {
  const f = { x: (e.x / 100) * SCREEN.widthPoints - e.w / 2, y: (e.y / 100) * SCREEN.heightPoints - e.h / 2, w: e.w, h: e.h };
  if (e.editable) return { ...el('', { ...f, type: 49 }), placeholderValue: e.name };
  return el(e.name, f);
}
const zelleForm = () => tree(...elementsOf('mybank-zelle-form').slice(1).map(nodeOf));
const SEND_NOW = [201, 551];   // "Send now"'s centre in points (50%, 63.1%)
const tappedSendNow = (runner) => runner.callsTo('/touch').some((c) => Math.abs(c.body.x - SEND_NOW[0]) < 3 && Math.abs(c.body.y - SEND_NOW[1]) < 3);

async function run({ chooser, llm = null, answer = null, sticky = false, maxSteps = 6, task = MYBANK, screen = zelleForm }) {
  const runner = await startFakeRunner({ screen });
  const device = createDevice({ host: '127.0.0.1', port: runner.port, knownApps: ['com.example.mybank'] });
  const state = { keyboardUp: false, screen: () => SCREEN };
  const logs = []; const questions = [];
  const protocol = { emit: () => {}, log: (s) => logs.push(s), ask: async (q) => { questions.push(q); return typeof answer === 'function' ? answer(q) : answer; } };
  const apps = { MyBank: 'com.example.mybank' };
  const runTool = createToolRunner({ device, apps, screen: () => state.screen(), protocol, state });
  const llmCalls = []; let i = 0; let j = 0;
  const decider = {
    provider: 'test-decider', model: 'chooser',
    async decide({ candidates }) {
      const step = chooser[Math.min(i++, chooser.length - 1)];
      const [pick, p] = step;
      const c = typeof pick === 'function' ? candidates.find(pick) : candidates.find((x) => x.value === pick);
      if (!c) throw new Error(`test choice not offered: ${candidates.map((x) => x.description).join(' | ')}`);
      return { choice: c.value, probability: p, confidence: p, probabilities: { [c.value]: p }, usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_write_input_tokens: null, reasoning_output_tokens: null }, responseId: null, responseModel: 'chooser', raw: {} };
    },
  };
  const model = llm && {
    provider: 'test-llm', model: 'llm',
    async complete({ messages }) {
      llmCalls.push(JSON.parse(JSON.stringify(messages.map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.filter((c) => c.type === 'text') } : m)))));
      return { message: llm[Math.min(j++, llm.length - 1)], finishReasons: ['tool_calls'], responseId: 'r', responseModel: 'llm', usage: { input_tokens: 500, output_tokens: 20, cache_read_input_tokens: 0, cache_write_input_tokens: null, reasoning_output_tokens: null }, raw: {} };
    },
  };
  const recorder = createRecorder({ dir: null, manifest: { task, provider: 'test', model: 'test' } });
  const toolCalls = [];
  const rec = { ...recorder, toolCall: (o) => { toolCalls.push(o); return recorder.toolCall(o); }, modelCall: (o) => recorder.modelCall(o), observation: (o) => recorder.observation(o), note: (t) => { logs.push(`note: ${t}`); recorder.note(t); }, finish: (o) => recorder.finish(o) };
  const outcome = await runDecisionLoop({
    task, maxSteps, decider, device, runTool, apps: Object.keys(apps), protocol, recorder: rec, progress: createProgressMonitor({ abortAfter: 20 }), state, autoAllowNotifications: async () => {},
    llm: model ? { model, context: createContext({ system: 'You are an agent.' }), toolDefs: toolDefinitions({ apps, handBack: sticky }), threshold: 0.5, sticky } : null,
  });
  await runner.close();
  return { outcome, runner, logs, questions, llmCalls, toolCalls };
}
const isSend = (c) => c.commit?.label === 'Send now';

console.log('hybrid: the decision model picks "Send now":');
{
  const r = await run({ chooser: [[isSend, 0.87]], llm: [say(toolCall('tapText', { text: 'Send now' })), say(toolCall('askUser', { question: 'Send $50 to Maya Patel via Zelle?', options: ['Yes, send $50', 'No, cancel'] })), say(toolCall('taskFailed', { reason: 'The user did not confirm the $50 payment.' }))] });
  check('the step is handed to the LLM, with the reason', r.logs.some((l) => /→ LLM: the decision model chose to tap "Send now", which would send money \(p=0\.87\)/.test(l)) && /It cannot be undone[\s\S]*call askUser/.test(JSON.stringify(r.llmCalls[0])), r.logs.join('\n'));
  check('the LLM\'s tap without asking is held: "Send now" is never pressed', !tappedSendNow(r.runner), JSON.stringify(r.runner.callsTo('/touch')));
  check('the LLM is told why, and what to do', /Not run: \\"Send now\\" would send money[\s\S]*Call askUser first/.test(JSON.stringify(r.llmCalls[1])), JSON.stringify(r.llmCalls[1]).slice(-900));
  check('it asks; nobody answers; the run fails, unpaid', r.questions.length === 1 && r.outcome.status === 'failed' && !tappedSendNow(r.runner), JSON.stringify(r.outcome));
}
{
  const r = await run({ chooser: [[isSend, 0.87]], answer: 'Yes, send $50', llm: [say(toolCall('askUser', { question: 'Send $50 to Maya Patel via Zelle?', options: ['Yes, send $50', 'No, cancel'] }), toolCall('tapText', { text: 'Send now' })), say(toolCall('taskComplete', { summary: 'Sent.' }))] });
  check('the user says yes: the tap goes through', tappedSendNow(r.runner) && r.outcome.status === 'completed', JSON.stringify(r.outcome));
}
{
  const r = await run({ chooser: [[isSend, 0.87]], answer: null, llm: [say(toolCall('askUser', { question: 'Send $50?', options: ['Yes', 'No'] }), toolCall('tapText', { text: 'Send now' })), say(toolCall('taskFailed', { reason: 'No confirmation.' }))] });
  check('an ask and a tap in one response, unanswered: the tap is held (the result arrived before the tap ran)', !tappedSendNow(r.runner) && r.outcome.status === 'failed');
}
{
  const r = await run({ chooser: [[isSend, 0.87]], answer: 'No, cancel', llm: [say(toolCall('askUser', { question: 'Send $50?', options: ['Yes, send $50', 'No, cancel'] }), toolCall('tap', { x: 50, y: 63.1 })), say(toolCall('taskFailed', { reason: 'The user declined.' }))] });
  check('the user says no: a tap by coordinates is held too', !tappedSendNow(r.runner) && r.outcome.status === 'failed');
}
{
  const r = await run({ chooser: [[(c) => /Close/.test(c.description), 0.9], ['done', 0.9]], llm: [say(toolCall('taskComplete', { summary: 'ok' }))] });
  check('regression: a confident ordinary tap is the decision model\'s, and is made', r.runner.callsTo('/touch').length === 1 && r.llmCalls.length === 1 && !r.logs.some((l) => /irreversible|held/.test(l)), r.logs.join('\n'));
}
{
  // Sticky: the LLM takes over on a low-confidence choice and, holding control, goes for "Send now" itself (mybank-003, 3 of 3 sticky runs).
  const r = await run({ sticky: true, chooser: [[(c) => /Close/.test(c.description), 0.3]], llm: [say(toolCall('tap', { x: 50, y: 41.2 })), say(toolCall('tapText', { text: 'Send now' })), say(toolCall('taskFailed', { reason: 'stopped' }))] });
  check('sticky: the LLM holding control cannot pay without asking either', !tappedSendNow(r.runner) && r.logs.some((l) => /held tapText on "Send now"/.test(l)) && r.logs.some((l) => /^note: A tapText on "Send now"/.test(l)), r.logs.join('\n'));
  check('its other taps are made', r.runner.callsTo('/touch').length === 1);
}

{
  const r = await run({ chooser: [[isSend, 0.87]], answer: (q) => (/Which/.test(q.question) ? 'Maya Patel' : null), llm: [say(toolCall('askUser', { question: 'Which Maya?', options: ['Maya Patel', 'Maya Lin'] }), toolCall('tapText', { text: 'Send now' })), say(toolCall('taskFailed', { reason: 'stopped' }))] });
  check('the answer to a disambiguation does not unlock the payment', !tappedSendNow(r.runner) && r.logs.some((l) => /held tapText on "Send now"/.test(l)));
}

console.log('decision-only: the decision model picks "Send now":');
{
  const r = await run({ chooser: [[isSend, 0.87]] });
  check('the harness asks the user first, naming the button and what it does', r.questions.length === 1 && /would tap "Send now", which would send money\. It cannot be undone/.test(r.questions[0].question) && r.questions[0].options[0] === 'Yes, tap "Send now"', JSON.stringify(r.questions));
  check('no answer: not pressed, and the run fails saying why', !tappedSendNow(r.runner) && r.outcome.status === 'failed' && /Stopped before tapping "Send now": it would send money/.test(r.outcome.reason), JSON.stringify(r.outcome));
  check('the record has the question, the untapped button and the taskFailed (the judge reads the answer from it)', JSON.stringify(r.toolCalls.map((t) => [t.name, !!t.skipped])) === '[["askUser",false],["tap",true],["taskFailed",false]]', JSON.stringify(r.toolCalls.map((t) => [t.name, t.skipped])));
}
{
  const r = await run({ chooser: [[isSend, 0.87], ['done', 0.9]], answer: (q) => q.options[0] });
  check('the user says yes: pressed, and the run goes on', tappedSendNow(r.runner) && r.outcome.status === 'completed', JSON.stringify(r.outcome));
}
{
  const chat = () => tree(el('Send', { x: 340, y: 780, w: 44, h: 44 }), el('Maya', { x: 150, y: 80, w: 100, h: 30 }));
  const r = await run({ chooser: [[(c) => c.commit?.label === 'Send', 0.9], ['done', 0.9]], task: 'Text Maya "see you at 7"', screen: chat });
  check('a send goes ahead without a question, as the LLM\'s rule has it', r.questions.length === 0 && r.runner.callsTo('/touch').length === 1 && r.outcome.status === 'completed');
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed · ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
