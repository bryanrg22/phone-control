// Unit tests for agent/tools.mjs (D4 extraction, 2026-08) — the tool registry
// builder and the tool executor, run against a MOCK device transport. Until
// this extraction the executor was untestable without a booted device; these
// pin the pure behaviors: registry shape per config, the disabled-tools gate,
// coordinate validation + %→pixel conversion, state threading through ctx,
// and the loop's sentinel contract (__SCREENSHOT__/__DONE__/__FAILED__).
import { buildToolDefs, createToolExecutor } from '../tools.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}

// ─── Mock ctx factory ───
function mockCtx(overrides = {}) {
  const calls = [];
  const maestro = {
    touchPoint: async (x, y) => calls.push(['touchPoint', x, y]),
    swipe: async (sx, sy, ex, ey) => calls.push(['swipe', sx, sy, ex, ey]),
    drag: async (...a) => calls.push(['drag', ...a]),
    launchApp: async (bid) => calls.push(['launchApp', bid]),
    inputText: async (t) => calls.push(['inputText', t]),
    pressKey: async (k) => calls.push(['pressKey', k]),
    pressButton: async (b) => calls.push(['pressButton', b]),
    viewHierarchy: async () => ({ text: JSON.stringify(overrides.hierarchy ?? { axElement: { label: '', children: [] } }) }),
    screenshot: async () => ({ data: '' }),
  };
  const state = {
    currentAppId: null, keyboardLikelyUp: false, askUserCalls: 0,
    phoneScreenWidth: 393, phoneScreenHeight: 852,
  };
  const ctx = {
    isPhone: true, useDirectHttp: true,
    appMap: { Maps: 'com.apple.Maps', Safari: 'com.apple.mobilesafari' },
    driverHost: 'localhost', driverPort: 6001,
    requestUserApproval: async () => 'Yes, proceed',
    requestUserText: async () => 'typed answer',
    ASKUSER_TIMEOUT_SENTINEL: '__NO_RESPONSE_TIMEOUT__',
    llmConfig: { url: 'http://unused', keyEnv: 'X' },
    apiKey: 'k', modelName: 'm',
    disabledTools: [], pendingMemories: [],
    get maestro() { return maestro; },
    get simUdid() { return 'SIM'; },
    get currentAppId() { return state.currentAppId; },
    set currentAppId(v) { state.currentAppId = v; },
    get keyboardLikelyUp() { return state.keyboardLikelyUp; },
    set keyboardLikelyUp(v) { state.keyboardLikelyUp = v; },
    get askUserCalls() { return state.askUserCalls; },
    set askUserCalls(v) { state.askUserCalls = v; },
    get phoneScreenWidth() { return state.phoneScreenWidth; },
    get phoneScreenHeight() { return state.phoneScreenHeight; },
    ...overrides.ctx,
  };
  return { ctx, calls, state };
}

// ─── buildToolDefs: registry shape follows config ───
console.log('buildToolDefs — registry shape per config:');
{
  const base = { appMap: { Maps: 'x' }, isPhone: true, grounding: 'none' };
  const defs = buildToolDefs(base);
  const names = defs.map(d => d.name);
  check('core tools present', ['openApp', 'tap', 'tapText', 'inputText', 'drag', 'taskComplete', 'taskFailed'].every(n => names.includes(n)));
  check('no zoomAndTap unless grounding=zoomclick', !names.includes('zoomAndTap'));
  check('zoomAndTap present with grounding=zoomclick', buildToolDefs({ ...base, grounding: 'zoomclick' }).map(d => d.name).includes('zoomAndTap'));
  check('copyToClipboard excluded on phone', !names.includes('copyToClipboard'));
  check('copyToClipboard included on simulator', buildToolDefs({ ...base, isPhone: false }).map(d => d.name).includes('copyToClipboard'));
  check('openApp description lists app names', defs.find(d => d.name === 'openApp').description.includes('Maps'));
}

// ─── executor: gates + validation + conversion + sentinels ───
console.log('createToolExecutor — behavior against a mock transport:');
await (async () => {
  {
    const { ctx } = mockCtx();
    ctx.disabledTools = ['setAppearance'];
    const exec = createToolExecutor(ctx);
    const r = await exec('setAppearance', { mode: 'dark' });
    check('disabled tool is gated at the executor', r.startsWith('ERROR: tool "setAppearance" is disabled'), r);
  }
  {
    const { ctx } = mockCtx();
    const exec = createToolExecutor(ctx);
    check('unknown tool → readable error', (await exec('nonsense', {})) === 'Unknown tool: nonsense');
    check('takeScreenshot → sentinel', (await exec('takeScreenshot', {})) === '__SCREENSHOT__');
    check('taskComplete → __DONE__ sentinel', (await exec('taskComplete', { summary: 'ok' })) === '__DONE__:ok');
    check('taskFailed → __FAILED__ sentinel', (await exec('taskFailed', { reason: 'no' })) === '__FAILED__:no');
  }
  {
    const { ctx, calls } = mockCtx();
    const exec = createToolExecutor(ctx);
    const r = await exec('tap', { x: 500, y: 50 });
    check('tap rejects pixel-looking coords (>100)', r.startsWith('ERROR: Coordinates must be percentages'), r);
    check('…and does NOT touch the device', calls.length === 0);
    await exec('tap', { x: 50, y: 50 });
    check('tap converts % → pixels against live dims', calls[0][0] === 'touchPoint' && calls[0][1] === Math.round(393 / 2) && calls[0][2] === Math.round(852 / 2), JSON.stringify(calls));
  }
  {
    const { ctx, calls } = mockCtx();
    const exec = createToolExecutor(ctx);
    await exec('scroll', {});
    const [, sx, sy, ex, ey] = calls[0];
    check('scroll swipes bottom(0.7)→top(0.3) at center-x', calls[0][0] === 'swipe' && sx === ex && sy === Math.round(852 * 0.7) && ey === Math.round(852 * 0.3), JSON.stringify(calls));
  }
  {
    const { ctx, calls, state } = mockCtx();
    const exec = createToolExecutor(ctx);
    const r = await exec('openApp', { appName: 'DoesNotExist' });
    check('openApp unknown → error listing available apps (no Home press)', r.includes('not found') && r.includes('Maps') && calls.length === 0, r);
    await exec('openApp', { appName: 'Maps' });
    check('openApp known → launch + currentAppId threaded back', calls[0][0] === 'launchApp' && calls[0][1] === 'com.apple.Maps' && state.currentAppId === 'com.apple.Maps');
  }
  {
    const { ctx, state } = mockCtx();
    const exec = createToolExecutor(ctx);
    await exec('inputText', { text: 'hi' });
    check('inputText sets keyboardLikelyUp via ctx setter', state.keyboardLikelyUp === true);
    await exec('hideKeyboard', {});
    check('hideKeyboard clears keyboardLikelyUp', state.keyboardLikelyUp === false);
  }
  // hideKeyboard must report what the screen shows, not what it attempted.
  for (const [name, visible, spot, expectHidden, expectFlag] of [
    ['Return closes it', [false], null, true, false],
    ['a tap on an empty area closes it', [true, false], { x: 10, y: 10 }, true, false],
    ['nothing closes it (the 2026-10-15 Add Alarm case)', [true, true], { x: 10, y: 10 }, false, true],
    ['no empty spot to tap', [true], null, false, true],
  ]) {
    const { ctx, calls, state } = mockCtx();
    const seq = [...visible];
    ctx.maestro.keyboardVisible = async () => seq.shift();
    ctx.maestro.emptySpotAboveKeyboard = async () => spot;
    const r = await createToolExecutor(ctx)('hideKeyboard', {});
    check(`hideKeyboard, ${name}: says ${expectHidden ? 'hidden' : 'still up'}`, r.startsWith(expectHidden ? 'Keyboard hidden' : 'Keyboard is still up'), r);
    check(`hideKeyboard, ${name}: keyboard flag ${expectFlag}`, state.keyboardLikelyUp === expectFlag);
    if (spot) check(`hideKeyboard, ${name}: tapped the empty spot`, calls.some((c) => c[0] === 'touchPoint' && c[1] === 10));
  }
  {
    const { ctx } = mockCtx();
    const exec = createToolExecutor(ctx);
    await exec('saveMemory', { fact: 'likes tacos' });
    check('saveMemory queues to pendingMemories (deferred write)', ctx.pendingMemories.length === 1 && ctx.pendingMemories[0] === 'likes tacos');
  }
  {
    const { ctx, state } = mockCtx();
    const exec = createToolExecutor(ctx);
    const r = await exec('askUser', { question: 'Q?', options: ['A', 'B'] });
    check('askUser returns the chosen option + bumps counter', r === 'User chose: "Yes, proceed"' && state.askUserCalls === 1, r);
  }
  {
    const saved = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;
    const { ctx } = mockCtx();
    const exec = createToolExecutor(ctx);
    const r = await exec('webSearch', { query: 'x' });
    check('webSearch without key → clear error, no crash', r.startsWith('ERROR: BRAVE_API_KEY'), r);
    if (saved !== undefined) process.env.BRAVE_API_KEY = saved;
  }
  {
    const hierarchy = { axElement: { label: '', children: [{ label: 'Send', frame: { X: 300, Y: 700, Width: 40, Height: 40 } }] } };
    const { ctx, calls } = mockCtx({ hierarchy });
    const exec = createToolExecutor(ctx);
    await exec('tapText', { text: 'Send' });
    check('tapText finds element in hierarchy and taps its center', calls[0][0] === 'touchPoint' && calls[0][1] === 320 && calls[0][2] === 720, JSON.stringify(calls));
    const miss = await exec('tapText', { text: 'Nope' });
    check('tapText miss → error steering to getUIElements', miss.startsWith('ERROR: Element "Nope" not found'), miss);
  }
  {
    // pressKey validation + routing (2026-08-04): the runner's /pressKey accepts
    // exactly six keyboard keys and 400s on anything else; home/lock live on
    // /pressButton. Aliases cover names models actually emit ("search" observed live).
    const { ctx, calls } = mockCtx();
    const exec = createToolExecutor(ctx);
    await exec('pressKey', { key: 'enter' });
    check('pressKey valid key → /pressKey', calls.at(-1)[0] === 'pressKey' && calls.at(-1)[1] === 'enter', JSON.stringify(calls.at(-1)));
    await exec('pressKey', { key: 'search' });
    check('pressKey alias "search" normalizes to enter', calls.at(-1)[0] === 'pressKey' && calls.at(-1)[1] === 'enter', JSON.stringify(calls.at(-1)));
    await exec('pressKey', { key: 'Home' });
    check('pressKey home routes to /pressButton (case-insensitive)', calls.at(-1)[0] === 'pressButton' && calls.at(-1)[1] === 'home', JSON.stringify(calls.at(-1)));
    const before = calls.length;
    const bad = await exec('pressKey', { key: 'shift' });
    check('pressKey unknown key → error listing valid keys, device untouched', bad.startsWith('ERROR: unknown key "shift"') && bad.includes('enter') && calls.length === before, bad);
  }
})();

console.log(fail === 0 ? `\n✅ ALL PASS: ${pass} passed, 0 failed` : `\n❌ ${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
