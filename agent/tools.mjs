// tools.mjs — the tools the model can call, and what each does on the phone.
//
// Coordinates are percentages of the screen (0-100); the device takes points,
// so every tool converts with the screen size from the latest observation.
//
// Each call returns { text, error?, changesScreen?, settle?, done?, failed? }:
//   text           what the model is told
//   error          the action did not happen (the rest of the step is skipped)
//   changesScreen  a fresh observation is needed before the next request
//   settle         wait for an iOS animation before observing (navigation)
//   done / failed  the model concluded: { summary } / { reason }

import { formatElements, capElements, findElement } from './elements.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (min, max, description) => ({ type: 'number', minimum: min, maximum: max, ...(description ? { description } : {}) });

export function toolDefinitions({ apps, braveSearch = false }) {
  return [
    { name: 'openApp', description: `Open an app by name. Available: ${Object.keys(apps).join(', ')}`, parameters: { type: 'object', properties: { appName: { type: 'string', description: 'App name' } }, required: ['appName'] } },
    { name: 'takeScreenshot', description: 'Capture the current screen. NOTE: screenshots are auto-captured after action tools (tap, type, etc.) so you usually do NOT need to call this separately. Only use for initial observation or to verify final task completion.', parameters: { type: 'object', properties: {} } },
    { name: 'getUIElements', description: 'Get all UI elements on screen with their text, IDs, and positions. Use this to find exact buttons/fields before tapping. More accurate than guessing coordinates from a screenshot.', parameters: { type: 'object', properties: {} } },
    { name: 'waitForText', description: 'Wait for text / an element to APPEAR on screen, polling up to N seconds in a SINGLE step. Use this for ASYNC results — a chat reply loading, search results coming back, any network round-trip — instead of repeatedly screenshotting to check whether something loaded. Returns as soon as the text appears, or times out.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'The visible text / accessibility label to wait for' }, timeoutSec: { type: 'number', description: 'Max seconds to wait (default 10, max 30)' } }, required: ['text'] } },
    { name: 'tap', description: 'Tap at screen coordinates. MUST be percentages 0-100 (NOT pixels). x=0 left edge, x=50 center, x=100 right edge. y=0 top, y=50 middle, y=100 bottom. Example: center of screen is x=50,y=50. USE DECIMALS: 1% is ~3.9pt wide and ~8.5pt tall, so a whole-number guess can land OUTSIDE a small control (a 44pt button is only ~5% tall). Give at least one decimal place (e.g. 43.7), and prefer coordinates from the bundled UI-element list over eyeballing the screenshot.', parameters: { type: 'object', properties: { x: num(0, 100, 'X percentage 0-100, decimals allowed (e.g. 43.75)'), y: num(0, 100, 'Y percentage 0-100, decimals allowed (e.g. 72.25)'), description: { type: 'string' } }, required: ['x', 'y'] } },
    { name: 'tapText', description: 'Tap a visible element by its EXACT accessibility label (not fuzzy). Call getUIElements first to read the exact label, then pass it verbatim.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'inputText', description: 'Type text into focused field. Only after tapping a text field. NOTE: this APPENDS — to CHANGE/REPLACE an existing value use replaceText instead.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'replaceText', description: 'CHANGE the value of an existing text field in ONE reliable step: it focuses the field, clears its current contents, then types the new value. ALWAYS prefer this over inputText when a field ALREADY HAS text you need to change (set/edit/update a value) — inputText only appends, which is the #1 cause of getting stuck fumbling select-all/delete. Pass the field\'s EXACT accessibility label (from getUIElements) and the new value.', parameters: { type: 'object', properties: { field: { type: 'string', description: 'Exact a11y label of the text field (from getUIElements)' }, value: { type: 'string', description: 'The new value to set (fully replaces the old one)' } }, required: ['field', 'value'] } },
    // The runner's /pressKey takes exactly these keys and 400s on anything else;
    // home and lock are hardware buttons on /pressButton.
    { name: 'pressKey', description: 'Press a keyboard key or hardware button.', parameters: { type: 'object', properties: { key: { type: 'string', enum: ['enter', 'return', 'delete', 'tab', 'space', 'escape', 'home', 'lock'], description: 'Keyboard key (enter/return/delete/tab/space/escape) or hardware button (home/lock)' } }, required: ['key'] } },
    { name: 'scroll', description: 'Scroll down.', parameters: { type: 'object', properties: {} } },
    { name: 'swipe', description: 'Swipe gesture (quick flick). Coordinates as percentages.', parameters: { type: 'object', properties: { startX: num(0, 100), startY: num(0, 100), endX: num(0, 100), endY: num(0, 100) }, required: ['startX', 'startY', 'endX', 'endY'] } },
    { name: 'drag', description: 'Drag-and-drop: long press to pick up, move slowly to destination, release. Use for moving cards, rearranging items, drag-and-drop games. Coordinates as percentages.', parameters: { type: 'object', properties: { startX: num(0, 100, 'Start X percentage (pick up)'), startY: num(0, 100, 'Start Y percentage (pick up)'), endX: num(0, 100, 'End X percentage (drop)'), endY: num(0, 100, 'End Y percentage (drop)'), holdDuration: { type: 'number', description: 'Seconds to hold before dragging (default 0.5)' }, dragDuration: { type: 'number', description: 'Seconds for the drag movement (default 1.0)' } }, required: ['startX', 'startY', 'endX', 'endY'] } },
    { name: 'hideKeyboard', description: 'Dismiss the keyboard.', parameters: { type: 'object', properties: {} } },
    { name: 'typeAndSubmit', description: 'Tap a text field, type text, and press enter/send — all in one step. Use this instead of separate tap + inputText + pressKey calls. Much faster for search bars, message fields, form inputs. This tool HANDLES SENDING — do NOT tap the send button after calling this. Instead, take a screenshot to verify the message was sent.', parameters: { type: 'object', properties: { elementText: { type: 'string', description: 'Text of the field to tap (e.g. "Search", "Message") — uses tapText' }, text: { type: 'string', description: 'Text to type' }, submitKey: { type: 'string', enum: ['enter', 'send'], description: 'How to submit after typing (default: enter). "send" taps the Messages blue-arrow button; "enter" presses the keyboard return key.' } }, required: ['elementText', 'text'] } },
    ...(braveSearch ? [{ name: 'webSearch', description: 'Search the web for information. Use when you encounter an unfamiliar app, game, or interface and need to understand how it works before interacting. Also useful for looking up facts, instructions, or context the user might expect you to know.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query (e.g. "how to play LinkedIn Pinpoint game")' } }, required: ['query'] } }] : []),
    { name: 'askUser', description: 'Ask the user a CLOSED question — one with a known small set of answers (2-4 preset options). Use for: confirmation ("Yes / No"), disambiguation ("Mom — 555-1234 / Mom Tracy — 555-9876"), or category-pick. Do NOT use for routine actions like tapping, scrolling, or opening apps. Do NOT use when the answer is freeform (email, password, OTP, search string) — use askUserText for those.', parameters: { type: 'object', properties: { question: { type: 'string', description: 'The question to ask the user' }, options: { type: 'array', items: { type: 'string' }, description: 'List of options for the user to choose from (2-4 options)' } }, required: ['question', 'options'] } },
    { name: 'askUserText', description: 'Ask the user an OPEN/freeform question — when the answer cannot reasonably be enumerated. Use for: email address, username, OTP / 2FA code, search query, password (when explicitly needed), free-text input. The UI will show the user a text field. Do NOT use for confirmations (use askUser with Yes/No options) or for actions you can perform yourself.', parameters: { type: 'object', properties: { question: { type: 'string', description: 'The question to ask the user' }, hint: { type: 'string', description: 'Optional format hint shown as placeholder (e.g. "firstname.lastname@nvidia.com" or "6-digit code")' } }, required: ['question'] } },
    { name: 'taskComplete', description: 'Task is done. Call when verified complete.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
    { name: 'taskFailed', description: 'Task cannot be completed.', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
  ];
}

const KEYS = ['enter', 'return', 'delete', 'tab', 'space', 'escape'];
const BUTTONS = ['home', 'lock'];
const KEY_ALIASES = { search: 'enter', go: 'enter', done: 'enter', backspace: 'delete', esc: 'escape' };

/**
 * @param {object} ctx
 * @param {object} ctx.device          device.mjs
 * @param {object} ctx.apps            { name: bundleId }
 * @param {() => {widthPoints, heightPoints}} ctx.screen   the latest screen size, in points
 * @param {object} ctx.protocol        protocol.mjs (for questions)
 * @param {object} ctx.state           { keyboardUp } — shared with the loop
 */
export function createToolRunner({ device, apps, screen, protocol, state }) {
  const pt = (pctX, pctY) => {
    const s = screen();
    return [Math.round((pctX / 100) * s.widthPoints), Math.round((pctY / 100) * s.heightPoints)];
  };
  const elementsNow = async () => {
    const s = screen();
    return formatElements(await device.hierarchy(), s.widthPoints, s.heightPoints);
  };

  async function tapByLabel(label) {
    const el = findElement(await device.hierarchy(), label);
    if (!el) return null;
    const cx = Math.round(el.frame.X + el.frame.Width / 2);
    const cy = Math.round(el.frame.Y + el.frame.Height / 2);
    await device.tap(cx, cy);
    return { cx, cy };
  }

  const tools = {
    async openApp({ appName }) {
      const bid = apps[appName];
      // No Home press or home-screen search: leaving the app the user is in
      // would break a task like "finish this game I have open".
      if (!bid) {
        const names = Object.keys(apps);
        return { error: true, text: `App "${appName}" not found. Available: ${names.slice(0, 30).join(', ')}${names.length > 30 ? `, … (${names.length} in all)` : ''}. Use the exact name from the list, or reach the app another way.` };
      }
      await device.launchApp(bid);
      return { text: `Opened ${appName}`, changesScreen: true };
    },

    async takeScreenshot() { return { text: 'Screenshot taken', changesScreen: true }; },

    async getUIElements() {
      return { text: `Tappable elements on screen:\n${capElements(await elementsNow()).join('\n')}\n\nUse tap(x, y) with the coordinates above for precise tapping, or tapText("exact text") to tap by label.` };
    },

    async waitForText({ text, timeoutSec }) {
      const target = String(text || '').toLowerCase();
      const limit = Math.min(Math.max(Number(timeoutSec) || 10, 1), 30);
      const start = Date.now();
      let polls = 0;
      while (Date.now() - start < limit * 1000) {
        polls += 1;
        const h = await device.hierarchy().catch(() => '');
        if (target && h.toLowerCase().includes(target)) return { text: `Found "${text}" after ${((Date.now() - start) / 1000).toFixed(1)}s (${polls} poll${polls === 1 ? '' : 's'}).`, changesScreen: true };
        await sleep(1000);
      }
      return { text: `TIMEOUT: "${text}" did not appear within ${limit}s (${polls} polls). It may not exist, or the screen is stuck — try a different approach or verify with getUIElements.`, changesScreen: true };
    },

    async tap({ x, y, description }) {
      if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) {
        return { error: true, text: `ERROR: Coordinates must be percentages 0-100, not pixels. You sent x=${x}, y=${y}. Divide by screen size to get percentages. Example: bottom-right corner is x=95, y=95.` };
      }
      await device.tap(...pt(x, y));
      return { text: `Tapped (${x}%, ${y}%)${description ? ` - ${description}` : ''}`, changesScreen: true, settle: true };
    },

    async tapText({ text }) {
      const hit = await tapByLabel(text);
      if (!hit) return { error: true, text: `ERROR: Element "${text}" not found in view hierarchy. Use getUIElements to see available elements, or use tap with coordinates instead.` };
      return { text: `Tapped "${text}" at (${hit.cx}, ${hit.cy}) pt`, changesScreen: true, settle: true };
    },

    async inputText({ text }) {
      state.keyboardUp = true;
      await device.type(text);
      return { text: `Typed "${text}"`, changesScreen: true };
    },

    async replaceText({ field, value }) {
      const el = findElement(await device.hierarchy(), field);
      if (!el) return { error: true, text: `ERROR: field "${field}" not found in view hierarchy. Call getUIElements to read the exact field label, then retry replaceText.` };
      const cx = Math.round(el.frame.X + el.frame.Width / 2);
      const cy = Math.round(el.frame.Y + el.frame.Height / 2);
      // Focus, then triple-tap to select everything, then type over it.
      await device.tap(cx, cy);
      await sleep(250);
      await device.tap(cx, cy); await device.tap(cx, cy); await device.tap(cx, cy);
      await sleep(200);
      await device.type(String(value ?? ''));
      state.keyboardUp = true;
      return { text: `Replaced "${field}" → "${value}" (selected all + typed). Take a screenshot to verify the field shows the new value.`, changesScreen: true };
    },

    async pressKey({ key }) {
      let k = String(key || '').toLowerCase().trim();
      if (KEY_ALIASES[k]) k = KEY_ALIASES[k];
      if (BUTTONS.includes(k)) { await device.pressButton(k); return { text: `Pressed ${k}`, changesScreen: true, settle: true }; }
      if (!KEYS.includes(k)) return { error: true, text: `ERROR: unknown key "${key}". Valid keys: ${KEYS.join(', ')} (keyboard) or ${BUTTONS.join(', ')} (hardware buttons).` };
      await device.pressKey(k);
      return { text: `Pressed ${k}`, changesScreen: true };
    },

    async scroll() {
      const s = screen();
      const midX = Math.round(s.widthPoints / 2);
      await device.swipe(midX, Math.round(s.heightPoints * 0.7), midX, Math.round(s.heightPoints * 0.3));
      return { text: 'Scrolled down', changesScreen: true, settle: true };
    },

    async swipe({ startX, startY, endX, endY }) {
      await device.swipe(...pt(startX, startY), ...pt(endX, endY));
      return { text: 'Swiped', changesScreen: true, settle: true };
    },

    async drag({ startX, startY, endX, endY, holdDuration = 0.5, dragDuration = 1.0 }) {
      await device.drag(...pt(startX, startY), ...pt(endX, endY), holdDuration, dragDuration);
      return { text: `Dragged from (${startX}%, ${startY}%) to (${endX}%, ${endY}%) — hold ${holdDuration}s, drag ${dragDuration}s`, changesScreen: true, settle: true };
    },

    async hideKeyboard() {
      // Return first: it closes most keyboards and never navigates. A tap is
      // tried only on a spot the hierarchy says is empty — a fixed tap at the
      // top edge once hit a sheet's grabber and collapsed it.
      try { await device.pressKey('enter'); } catch { /* no field focused */ }
      await sleep(350);
      if (await device.keyboardVisible().catch(() => false)) {
        const spot = await device.emptySpotAboveKeyboard().catch(() => null);
        if (spot) {
          await device.tap(spot.x, spot.y);
          await sleep(350);
        }
        // Report what the screen shows, not what was attempted: many SwiftUI
        // fields ignore both (iOSWorld's Add Alarm sheet, 2026-10-15).
        if (await device.keyboardVisible().catch(() => false)) {
          state.keyboardUp = true;
          return { text: 'Keyboard is still up: Return and a tap on an empty area did not close it. It does not block controls above it: tap Save, Done or the next field directly, or use the field\'s own Done/Search key.', changesScreen: true };
        }
        state.keyboardUp = false;
        return { text: 'Keyboard hidden (tapped an empty area)', changesScreen: true };
      }
      state.keyboardUp = false;
      return { text: 'Keyboard hidden', changesScreen: true };
    },

    async typeAndSubmit({ elementText, text, submitKey = 'enter' }) {
      const field = await tapByLabel(elementText);
      // Typing into whatever happens to be focused could send the text somewhere else.
      if (!field) return { error: true, text: `ERROR: field "${elementText}" not found, so nothing was typed or sent. Use getUIElements to read the exact field label.` };
      await sleep(500);
      state.keyboardUp = true;
      await device.type(text);
      await sleep(300);
      if (submitKey === 'send') {
        // Messages' send button: its label varies ("Send", "sendButton", an arrow icon).
        let root; try { root = JSON.parse(await device.hierarchy()); } catch { root = null; }
        let send = null;
        (function walk(n) {
          if (!n || send) return;
          const l = String(n.label || n.identifier || '').toLowerCase();
          if ((l === 'send' || l === 'sendbutton' || l === 'arrow.up.circle.fill') && n.frame) { send = n; return; }
          for (const c of n.children || []) walk(c);
        })(root?.axElement || root);
        if (!send) return { error: true, text: `Typed "${text}" into "${elementText}", but found no Send button, so NOTHING WAS SENT. Look at the screen and tap the send button yourself.`, changesScreen: true };
        await device.tap(Math.round(send.frame.X + send.frame.Width / 2), Math.round(send.frame.Y + send.frame.Height / 2));
        await sleep(500);
        return { text: `Typed "${text}" and tapped "${send.label || send.identifier}" to send. Do NOT tap send again; check the screenshot to confirm it was sent.`, changesScreen: true, settle: true };
      }
      await device.pressKey('enter');
      return { text: `Typed "${text}" into "${elementText}" and submitted via enter`, changesScreen: true, settle: true };
    },

    async webSearch({ query }) {
      const key = process.env.BRAVE_API_KEY;
      if (!key) return { error: true, text: 'ERROR: web search is not configured (BRAVE_API_KEY).' };
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', '5');
      const res = await fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': key }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) return { error: true, text: `ERROR: web search returned ${res.status}` };
      const results = ((await res.json()).web?.results ?? []).slice(0, 5);
      if (!results.length) return { text: 'No search results found.' };
      return { text: `Web search results for "${query}":\n\n${results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description || ''}`).join('\n\n')}` };
    },

    async askUser({ question, options }) {
      const answer = await protocol.ask({ question, options: Array.isArray(options) ? options.map(String) : [], kind: 'options' });
      if (answer === null) return { text: 'No response from the user (timed out — unattended run). You are NOT authorized to assume an answer. Continue without it if the task can still proceed, otherwise call taskFailed explaining that user input was required and unavailable.' };
      return { text: `User chose: "${answer}"` };
    },

    async askUserText({ question, hint = '' }) {
      const answer = await protocol.ask({ question, hint, kind: 'text' });
      if (answer === null) return { text: 'No response from the user (timed out — unattended run). You are NOT authorized to fabricate this input. Continue without it if the task can still proceed, otherwise call taskFailed explaining that user input was required and unavailable.' };
      return { text: `User typed: "${answer}"` };
    },

    async taskComplete({ summary }) { return { text: String(summary ?? ''), done: { summary: String(summary ?? '') } }; },
    async taskFailed({ reason }) { return { text: String(reason ?? ''), failed: { reason: String(reason ?? '') } }; },
  };

  /** Run one tool call. Throws only when the device itself failed (the loop counts those). */
  return async function run(name, args) {
    const fn = tools[name];
    if (!fn) return { error: true, text: `Unknown tool: ${name}` };
    return fn(args || {});
  };
}
