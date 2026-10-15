// agent/tools.mjs — tool registry + executor for agent.mjs (D4 extraction, 2026-08).
//
// Pattern follows llm-client.mjs (D2): NO module-global mutable state. agent.mjs
// owns every mutable run value (currentAppId, keyboard state, screen dims, the
// device transport) and threads them in via a ctx object — plain values for
// per-run constants, getter/setter properties for values the loop also mutates.
// That seam is what makes the executor unit-testable with a mock transport:
// see agent/test/tools.test.mjs.
//
// ctx contract (createToolExecutor):
//   constants: isPhone, appMap, driverHost, driverPort, useDirectHttp,
//              requestUserApproval, requestUserText, ASKUSER_TIMEOUT_SENTINEL,
//              llmConfig, apiKey, modelName, disabledTools, pendingMemories
//   accessors: maestro, simUdid, currentAppId (r/w), keyboardLikelyUp (r/w),
//              askUserCalls (r/w), phoneScreenWidth, phoneScreenHeight
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { runShell } from './device-backend.mjs';

import { STATE_DIR } from './state-dir.mjs';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── ZoomClick (crop region, send zoomed view, get refined coordinates) ───
async function zoomAndRefine(screenshotBuffer, roughX, roughY, _screenW, _screenH) {
  const sharp = (await import('sharp')).default;
  const metadata = await sharp(screenshotBuffer).metadata();
  const imgW = metadata.width;
  const imgH = metadata.height;

  // Convert percentage to pixel in image space
  const pixX = Math.round((roughX / 100) * imgW);
  const pixY = Math.round((roughY / 100) * imgH);

  // Crop a region around the rough point (25% of screen in each direction)
  const cropSize = Math.round(Math.min(imgW, imgH) * 0.25);
  const cropX = Math.max(0, Math.min(imgW - cropSize, pixX - Math.round(cropSize / 2)));
  const cropY = Math.max(0, Math.min(imgH - cropSize, pixY - Math.round(cropSize / 2)));
  const cropW = Math.min(cropSize, imgW - cropX);
  const cropH = Math.min(cropSize, imgH - cropY);

  // Crop and resize to 2x for clarity
  const croppedBuffer = await sharp(screenshotBuffer)
    .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
    .resize(cropW * 2, cropH * 2, { kernel: 'lanczos3' })
    .png()
    .toBuffer();

  // Return the cropped image + metadata for mapping coordinates back
  return {
    buffer: croppedBuffer,
    cropX, cropY, cropW, cropH,
    imgW, imgH,
    // To convert from zoomed percentage back to full-screen percentage:
    mapBack: (zoomedPctX, zoomedPctY) => {
      const localPixX = (zoomedPctX / 100) * cropW;
      const localPixY = (zoomedPctY / 100) * cropH;
      const fullPixX = cropX + localPixX;
      const fullPixY = cropY + localPixY;
      return {
        x: Math.round((fullPixX / imgW) * 100),
        y: Math.round((fullPixY / imgH) * 100),
      };
    },
  };
}

// MaestroMCP (the maestro-cli MCP transport) now lives in device-backend.mjs.

// ─── Element-list cap (context hygiene, 2026-08-04) ───
// The bundled UI-element list was uncapped: a content-heavy screen (long Settings
// page, social feed) could ship hundreds of lines into EVERY subsequent request.
// Claude Code caps per-tool output (Bash 30k chars, Read 2k lines) for the same
// reason; browser-use caps its element list at 40k chars. 150 items ≈ 6-9k chars
// comfortably covers every real screen we've bundled (typical: 16-71 elements)
// while bounding the pathological case. Shared by getUIElements and the per-step
// auto-bundle in agent.mjs so both paths stay consistent.
export const MAX_BUNDLED_ELEMENTS = 150;
export function capElementList(elems, max = MAX_BUNDLED_ELEMENTS) {
  if (elems.length <= max) return elems;
  return [...elems.slice(0, max), `(… ${elems.length - max} more elements not shown — scroll or use tapText with an exact label …)`];
}

// ─── View hierarchy → element list ───
// Extracted from the `getUIElements` case (2026-08-08) so it is importable and
// unit-testable with zero side effects, like every other seam in agent/.
//
// It exists as a function at all because a bug hid in it for months. Measured
// against a REAL Claude.app hierarchy captured from a phone, the old
// inline version emitted 72 lines from 106 labelled rectangles — it silently
// deleted 32% of the screen. Two independent causes, both fixed here:
//
//  1. **Dedupe keyed on the label alone.** The first element bearing a name won
//     and every later one was dropped no matter where it sat. On Claude's drawer
//     the wordmark and the primary button BOTH carry the label "New chat", so
//     the button at (177,782) vanished behind the wordmark at (16,72) and the
//     agent could not see — let alone tap — the main action on the screen.
//     Keying on label+centre still collapses the nested wrappers that share one
//     visual frame, which is the duplication the check was actually aiming at.
//
//  2. **'AM'/'PM' filtered by substring.** Intended to drop the status-bar
//     clock; also drops any label CONTAINING those letters — "TEAM", "EXAM",
//     "AMAZON". Now matched as a whole label.
//
// Size is reported alongside the centre because a centre alone cannot tell a
// 110×36 button from an 18pt-tall wordmark, and the integer percentages are
// coarse: 1% ≈ 4pt across and ≈9pt down on a 393×852pt screen.
const AX_NOISE = ['scroll bar', 'battery', 'Cellular', 'Wi-Fi bars', 'No signal', 'Not charging',
  'signal strength', 'battery power', 'location services', 'Location tracking'];
// U+202F NARROW NO-BREAK SPACE is what iOS actually puts before AM/PM. Written
// as an escape rather than the literal character so it is visible in review
// (and so eslint's no-irregular-whitespace does not flag it).
const AX_CLOCK = /^\d{1,2}:\d{2}([\s\u202f]?(AM|PM))?$/;
// The status-bar clock is noise only IN the status bar. Matched by text alone it
// also deleted every alarm time ("6:45 AM") from the Clock app (2026-10-15 eval).
// The status bar sits in the top ~7% of the screen (its items centre at y≈22-26pt
// on an 874pt-tall iPhone 17 Pro).
const STATUS_BAR = 0.07;
const isAxNoise = (label, cy, screenH) =>
  (AX_CLOCK.test(label) && (cy === null || cy < screenH * STATUS_BAR)) || AX_NOISE.some(n => label.includes(n));

// Controls whose VALUE is what a person reads: the wheels of a time picker
// carry no label at all, only "6 o'clock"; a text field's contents are its
// value. Without these the element list showed an Add Alarm sheet with no
// picker and no text field, and a model setting the time could see no change
// (2026-10-15 eval). XCUIElement.ElementType raw values, confirmed on a live
// hierarchy: 39 picker wheel, 49 text field.
const VALUE_TYPES = {
  33: 'slider', 37: 'segmented control', 39: 'picker wheel', 40: 'switch', 41: 'toggle',
  45: 'search field', 49: 'text field', 50: 'secure text field', 51: 'date picker', 52: 'text view', 79: 'stepper',
};
const MAX_VALUE = 80;
const clip = (v) => (v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v);

/** How one element reads in the list: `"Label"`, `"Label" = "value"`, or `picker wheel = "value"`. */
export function describeElement(node) {
  const label = (node.label || '').trim();
  const value = node.value === null || node.value === undefined ? '' : String(node.value).trim();
  const type = VALUE_TYPES[node.elementType];
  if (label && value && type && value !== label) return `"${label}" = "${clip(value)}"`;
  if (label) return `"${label}"`;
  if (value && type) return `${type} = "${clip(value)}"`;
  return null;
}

export function formatUIElements(text, screenW, screenH) {
  const found = [];
  const seen = new Set();
  const push = (desc, label, cx, cy, w, h) => {
    if (isAxNoise(label, cy, screenH)) return;
    if (cx === null) {
      if (!seen.has(desc)) { seen.add(desc); found.push(`- ${desc}`); }
      return;
    }
    const pctX = Math.round(cx / screenW * 100);
    const pctY = Math.round(cy / screenH * 100);
    const key = `${desc}@${pctX},${pctY}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(`- ${desc} at (${pctX}%, ${pctY}%) size ${Math.round(w)}x${Math.round(h)}`);
  };

  // The direct-HTTP viewHierarchy returns nested JSON; the MCP path returns CSV.
  try {
    const json = JSON.parse(text);
    (function collect(node) {
      if (!node) return;
      const desc = describeElement(node);
      if (desc) {
        const label = (node.label || '').trim() || String(node.value ?? '').trim();
        if (node.frame) push(desc, label, node.frame.X + node.frame.Width / 2,
          node.frame.Y + node.frame.Height / 2, node.frame.Width, node.frame.Height);
        else push(desc, label, null);
      }
      if (node.children) node.children.forEach(collect);
    })(json?.axElement || json);
  } catch {
    const boundsRegex = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/;
    for (const line of text.split('\n')) {
      const labelMatch = line.match(/accessibilityText[="] *:? *"?([^";,\n]+)/);
      if (!labelMatch) continue;
      const label = labelMatch[1].trim();
      if (!label) continue;
      const bm = line.match(boundsRegex);
      if (bm) {
        const x1 = +bm[1], y1 = +bm[2], x2 = +bm[3], y2 = +bm[4];
        push(`"${label}"`, label, (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1);
      } else push(`"${label}"`, label, null);
    }
  }
  return found;
}

/**
 * What identifies a screen for the no-progress check: every element's
 * description (label and value), without positions, sorted. A moving picker or
 * a field being typed into changes it; a tap that did nothing does not.
 */
export function screenSignature(elementLines) {
  return elementLines.map((l) => l.replace(/^- /, '').replace(/ at \(.*$/, '')).filter((l) => !l.startsWith('(… ')).sort().join('|');
}


// ─── Tool definitions ───
export function buildToolDefs({ appMap, isPhone, grounding }) {
  return [
    { name: 'searchMaps', description: 'Search Apple Maps for a location or place. Instant.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Place to search' } }, required: ['query'] } },
    { name: 'getDirections', description: 'Get directions to a destination on Apple Maps. Instant.', parameters: { type: 'object', properties: { destination: { type: 'string', description: 'Destination' } }, required: ['destination'] } },
    { name: 'openURL', description: 'Open a URL in Safari. Instant.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL (with or without https://)' } }, required: ['url'] } },
    { name: 'googleSearch', description: 'Search Google in Safari. Instant.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } },
    { name: 'composeMessage', description: 'Open Messages to compose a new text. Optionally pre-fill body.', parameters: { type: 'object', properties: { body: { type: 'string', description: 'Message body (optional)' } } } },
    { name: 'setAppearance', description: 'Switch dark mode or light mode. Instant.', parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['dark', 'light'], description: 'Appearance mode' } }, required: ['mode'] } },
    { name: 'setLocation', description: 'Set GPS location. Instant.', parameters: { type: 'object', properties: { latitude: { type: 'number' }, longitude: { type: 'number' }, name: { type: 'string', description: 'Location name' } }, required: ['latitude', 'longitude'] } },
    ...(!isPhone ? [{ name: 'copyToClipboard', description: 'Copy text to device clipboard.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] : []),
    { name: 'openApp', description: `Open an app by name. Available: ${Object.keys(appMap).join(', ')}`, parameters: { type: 'object', properties: { appName: { type: 'string', description: 'App name' } }, required: ['appName'] } },
    { name: 'takeScreenshot', description: 'Capture the current screen. NOTE: screenshots are auto-captured after action tools (tap, type, etc.) so you usually do NOT need to call this separately. Only use for initial observation or to verify final task completion.', parameters: { type: 'object', properties: {} } },
    { name: 'getUIElements', description: 'Get all UI elements on screen with their text, IDs, and positions. Use this to find exact buttons/fields before tapping. More accurate than guessing coordinates from a screenshot.', parameters: { type: 'object', properties: {} } },
    { name: 'waitForText', description: 'Wait for text / an element to APPEAR on screen, polling up to N seconds in a SINGLE step. Use this for ASYNC results — a chat reply loading, search results coming back, any network round-trip — instead of repeatedly screenshotting to check whether something loaded. Returns as soon as the text appears, or times out.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'The visible text / accessibility label to wait for' }, timeoutSec: { type: 'number', description: 'Max seconds to wait (default 10, max 30)' } }, required: ['text'] } },
    { name: 'tap', description: 'Tap at screen coordinates. MUST be percentages 0-100 (NOT pixels). x=0 left edge, x=50 center, x=100 right edge. y=0 top, y=50 middle, y=100 bottom. Example: center of screen is x=50,y=50. USE DECIMALS: 1% is ~3.9pt wide and ~8.5pt tall, so a whole-number guess can land OUTSIDE a small control (a 44pt button is only ~5% tall). Give at least one decimal place (e.g. 43.7), and prefer coordinates from the bundled UI-element list over eyeballing the screenshot.', parameters: { type: 'object', properties: { x: { type: 'number', minimum: 0, maximum: 100, description: 'X percentage 0-100, decimals allowed (e.g. 43.75)' }, y: { type: 'number', minimum: 0, maximum: 100, description: 'Y percentage 0-100, decimals allowed (e.g. 72.25)' }, description: { type: 'string' } }, required: ['x', 'y'] } },
    { name: 'tapText', description: 'Tap a visible element by its EXACT accessibility label (not fuzzy). Call getUIElements first to read the exact label, then pass it verbatim.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'inputText', description: 'Type text into focused field. Only after tapping a text field. NOTE: this APPENDS — to CHANGE/REPLACE an existing value use replaceText instead.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'replaceText', description: 'CHANGE the value of an existing text field in ONE reliable step: it focuses the field, clears its current contents, then types the new value. ALWAYS prefer this over inputText when a field ALREADY HAS text you need to change (set/edit/update a value) — inputText only appends, which is the #1 cause of getting stuck fumbling select-all/delete. Pass the field\'s EXACT accessibility label (from getUIElements) and the new value.', parameters: { type: 'object', properties: { field: { type: 'string', description: 'Exact a11y label of the text field (from getUIElements)' }, value: { type: 'string', description: 'The new value to set (fully replaces the old one)' } }, required: ['field', 'value'] } },
    // Key names are an ENUM matching what the XCTest runner actually accepts —
    // /pressKey takes exactly {enter,return,delete,tab,space,escape} and 400s on
    // anything else (vendor/.../PressKeyRequest.swift); home/lock are hardware
    // buttons on a separate /pressButton route. Free-string typing here let the
    // model invent key names that died on-device (observed live 2026-08-04).
    { name: 'pressKey', description: 'Press a keyboard key or hardware button.', parameters: { type: 'object', properties: { key: { type: 'string', enum: ['enter', 'return', 'delete', 'tab', 'space', 'escape', 'home', 'lock'], description: 'Keyboard key (enter/return/delete/tab/space/escape) or hardware button (home/lock)' } }, required: ['key'] } },
    { name: 'scroll', description: 'Scroll down.', parameters: { type: 'object', properties: {} } },
    { name: 'swipe', description: 'Swipe gesture (quick flick). Coordinates as percentages.', parameters: { type: 'object', properties: { startX: { type: 'number', minimum: 0, maximum: 100 }, startY: { type: 'number', minimum: 0, maximum: 100 }, endX: { type: 'number', minimum: 0, maximum: 100 }, endY: { type: 'number', minimum: 0, maximum: 100 } }, required: ['startX', 'startY', 'endX', 'endY'] } },
    { name: 'drag', description: 'Drag-and-drop: long press to pick up, move slowly to destination, release. Use for moving cards, rearranging items, drag-and-drop games. Coordinates as percentages.', parameters: { type: 'object', properties: { startX: { type: 'number', minimum: 0, maximum: 100, description: 'Start X percentage (pick up)' }, startY: { type: 'number', minimum: 0, maximum: 100, description: 'Start Y percentage (pick up)' }, endX: { type: 'number', minimum: 0, maximum: 100, description: 'End X percentage (drop)' }, endY: { type: 'number', minimum: 0, maximum: 100, description: 'End Y percentage (drop)' }, holdDuration: { type: 'number', description: 'Seconds to hold before dragging (default 0.5)' }, dragDuration: { type: 'number', description: 'Seconds for the drag movement (default 1.0)' } }, required: ['startX', 'startY', 'endX', 'endY'] } },
    { name: 'hideKeyboard', description: 'Dismiss the keyboard.', parameters: { type: 'object', properties: {} } },
    { name: 'typeAndSubmit', description: 'Tap a text field, type text, and press enter/send — all in one step. Use this instead of separate tap + inputText + pressKey calls. Much faster for search bars, message fields, form inputs. This tool HANDLES SENDING — do NOT tap the send button after calling this. Instead, take a screenshot to verify the message was sent.', parameters: { type: 'object', properties: { elementText: { type: 'string', description: 'Text of the field to tap (e.g. "Search", "Message") — uses tapText' }, text: { type: 'string', description: 'Text to type' }, submitKey: { type: 'string', enum: ['enter', 'send'], description: 'How to submit after typing (default: enter). "send" taps the Messages blue-arrow button; "enter" presses the keyboard return key.' } }, required: ['elementText', 'text'] } },
    ...(grounding === 'zoomclick' ? [{
      name: 'zoomAndTap',
      description: 'Zoom into a region of the screen for precise tapping. Use this instead of tap when: (1) targeting small icons, (2) multiple elements are close together, (3) you need precision. Provide the rough area to zoom into, and you will get a zoomed view to tap more precisely.',
      parameters: { type: 'object', properties: { x: { type: 'number', minimum: 0, maximum: 100, description: 'Rough X percentage (0-100) of the area to zoom into' }, y: { type: 'number', minimum: 0, maximum: 100, description: 'Rough Y percentage (0-100) of the area to zoom into' }, description: { type: 'string', description: 'What you are trying to tap' } }, required: ['x', 'y', 'description'] }
    }] : []),
    // saveMemory intentionally disabled — memory is read-only (hardcoded in memories/user.md)
    { name: 'recallMemory', description: 'Read all saved memory. Use at the start of tasks involving personal info if you need to check what you know.', parameters: { type: 'object', properties: {} } },
    { name: 'recallHistory', description: 'Read past task history. Use when the user asks about previous tasks, what you did earlier, or wants to repeat a past action.', parameters: { type: 'object', properties: {} } },
    { name: 'webSearch', description: 'Search the web for information. Use when you encounter an unfamiliar app, game, or interface and need to understand how it works before interacting. Also useful for looking up facts, instructions, or context the user might expect you to know.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query (e.g. "how to play LinkedIn Pinpoint game")' } }, required: ['query'] } },
    { name: 'askUser', description: 'Ask the user a CLOSED question — one with a known small set of answers (2-4 preset options). Use for: confirmation ("Yes / No"), disambiguation ("Mom — 555-1234 / Mom Tracy — 555-9876"), or category-pick. Do NOT use for routine actions like tapping, scrolling, or opening apps. Do NOT use when the answer is freeform (email, password, OTP, search string) — use askUserText for those.', parameters: { type: 'object', properties: { question: { type: 'string', description: 'The question to ask the user' }, options: { type: 'array', items: { type: 'string' }, description: 'List of options for the user to choose from (2-4 options)' } }, required: ['question', 'options'] } },
    { name: 'askUserText', description: 'Ask the user an OPEN/freeform question — when the answer cannot reasonably be enumerated. Use for: email address, username, OTP / 2FA code, search query, password (when explicitly needed), free-text input. The UI will show the user a text field. Do NOT use for confirmations (use askUser with Yes/No options) or for actions you can perform yourself.', parameters: { type: 'object', properties: { question: { type: 'string', description: 'The question to ask the user' }, hint: { type: 'string', description: 'Optional format hint shown as placeholder (e.g. "firstname.lastname@nvidia.com" or "6-digit code")' } }, required: ['question'] } },
    { name: 'taskComplete', description: 'Task is done. Call when verified complete.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
    { name: 'taskFailed', description: 'Task cannot be completed.', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
  ];
}

// ─── Tool executor ───
export function createToolExecutor(ctx) {
  const { isPhone, appMap, driverHost, driverPort, useDirectHttp,
    requestUserApproval, requestUserText, ASKUSER_TIMEOUT_SENTINEL, llmConfig,
    apiKey, modelName, disabledTools, pendingMemories } = ctx;

  return async function executeTool(name, args) {
  // --disable-tools removes tools from the LLM's schema, but a model can still
  // emit a non-schema name (and the local/no-tools adapter can map to any tool).
  // Without this gate a disabled simctl shortcut would EXECUTE — silently breaking
  // the sim↔phone parity they are disabled for.
  if (disabledTools.includes(name)) {
    return `ERROR: tool "${name}" is disabled for this run (--disable-tools). Use the cross-platform UI tools instead (openApp/tap/tapText/inputText/scroll/swipe/pressKey).`;
  }
  switch (name) {
    // === INSTANT TOOLS ===
    case 'searchMaps': {
      if (isPhone) {
        await ctx.maestro.launchApp('com.apple.Maps');
        ctx.currentAppId = 'com.apple.Maps';
        return `Opened Maps. Now use takeScreenshot, then tap the search bar and type "${args.query}" to search.`;
      }
      await runShell(`xcrun simctl openurl ${ctx.simUdid} "maps://?q=${encodeURIComponent(args.query)}"`);
      ctx.currentAppId = 'com.apple.Maps';
      return `Searched Maps for "${args.query}"`;
    }
    case 'getDirections': {
      if (isPhone) {
        await ctx.maestro.launchApp('com.apple.Maps');
        ctx.currentAppId = 'com.apple.Maps';
        return `Opened Maps. Now search for "${args.destination}" and tap Directions.`;
      }
      await runShell(`xcrun simctl openurl ${ctx.simUdid} "maps://?daddr=${encodeURIComponent(args.destination)}"`);
      ctx.currentAppId = 'com.apple.Maps';
      return `Getting directions to "${args.destination}"`;
    }
    case 'openURL': {
      if (isPhone) {
        await ctx.maestro.launchApp('com.apple.mobilesafari');
        ctx.currentAppId = 'com.apple.mobilesafari';
        const url = args.url.startsWith('http') ? args.url : `https://${args.url}`;
        return `Opened Safari. Now tap the address bar and type "${url}" to navigate.`;
      }
      const url = args.url.startsWith('http') ? args.url : `https://${args.url}`;
      await runShell(`xcrun simctl openurl ${ctx.simUdid} "${url}"`);
      ctx.currentAppId = 'com.apple.mobilesafari';
      return `Opened ${url}`;
    }
    case 'googleSearch': {
      if (isPhone) {
        await ctx.maestro.launchApp('com.apple.mobilesafari');
        ctx.currentAppId = 'com.apple.mobilesafari';
        return `Opened Safari. Now tap the address bar, type "google.com", navigate there, then search for "${args.query}".`;
      }
      await runShell(`xcrun simctl openurl ${ctx.simUdid} "https://google.com/search?q=${encodeURIComponent(args.query)}"`);
      ctx.currentAppId = 'com.apple.mobilesafari';
      return `Searched Google for "${args.query}"`;
    }
    case 'composeMessage': {
      if (isPhone) {
        await ctx.maestro.launchApp('com.apple.MobileSMS');
        ctx.currentAppId = 'com.apple.MobileSMS';
        return `Opened Messages. Now tap compose to start a new message.`;
      }
      const link = args.body ? `sms:&body=${encodeURIComponent(args.body)}` : 'sms:';
      await runShell(`xcrun simctl openurl ${ctx.simUdid} "${link}"`);
      ctx.currentAppId = 'com.apple.MobileSMS';
      return args.body ? `Opened Messages with: "${args.body}"` : 'Opened Messages';
    }
    case 'setAppearance': {
      if (isPhone) return `Cannot toggle appearance on physical device. Navigate to Settings > Display & Brightness manually.`;
      await runShell(`xcrun simctl ui ${ctx.simUdid} appearance ${args.mode}`);
      return `Switched to ${args.mode} mode`;
    }
    case 'setLocation': {
      if (isPhone) return `Cannot set location on physical device.`;
      await runShell(`xcrun simctl location ${ctx.simUdid} set ${args.latitude},${args.longitude}`);
      return `Location set to ${args.name || `${args.latitude},${args.longitude}`}`;
    }
    case 'copyToClipboard': {
      if (isPhone) return `Cannot copy to clipboard on physical device.`;
      await runShell(`printf '%s' "${args.text.replace(/"/g, '\\"')}" | xcrun simctl pbcopy ${ctx.simUdid}`);
      return `Copied to clipboard`;
    }
    case 'openApp': {
      const bid = appMap[args.appName];
      if (!bid) {
        // Bundle ID unknown. Don't take any destructive action (e.g.,
        // pressing Home would yank the user out of an app the agent is
        // currently working in — bad if the task is "finish this LinkedIn
        // game for me" and the agent mistakenly tries to openApp something
        // else). Return a clear error so the LLM can pick a different
        // approach: try a different name, abandon the openApp call, ask
        // the user, or report task failure.
        return `App "${args.appName}" not found in appMap. ` +
               `Available: ${Object.keys(appMap).slice(0, 30).join(', ')}${Object.keys(appMap).length > 30 ? `, ... (${Object.keys(appMap).length} total)` : ''}. ` +
               `If the app is installed but not listed, pymobiledevice3 may not have enumerated it correctly — try a different display name, or do not call openApp and let the user task continue without launching a new app.`;
      }
      if (isPhone) {
        await ctx.maestro.launchApp(bid);
      } else {
        await runShell(`xcrun simctl launch ${ctx.simUdid} ${bid}`);
      }
      ctx.currentAppId = bid;
      return `Opened ${args.appName}`;
    }

    // === SCREENSHOT & UI INSPECTION ===
    case 'takeScreenshot': return '__SCREENSHOT__';
    case 'waitForText': {
      // Poll the view hierarchy for a target string up to timeoutSec, in ONE step. Lets the
      // agent handle async transitions (loading replies, search results) without burning steps
      // re-screenshotting. (Round-3 feedback: "wait for an async result" was the hardest thing.)
      const target = String(args.text || '').toLowerCase();
      const timeoutSec = Math.min(Math.max(Number(args.timeoutSec) || 10, 1), 30);
      const start = Date.now();
      let polls = 0;
      while (Date.now() - start < timeoutSec * 1000) {
        polls++;
        let hv;
        try { hv = await ctx.maestro.viewHierarchy(); } catch { hv = { text: '' }; }
        if (target && String(hv.text || '').toLowerCase().includes(target)) {
          return `Found "${args.text}" after ${((Date.now() - start) / 1000).toFixed(1)}s (${polls} poll${polls === 1 ? '' : 's'}).`;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      return `TIMEOUT: "${args.text}" did not appear within ${timeoutSec}s (${polls} polls). It may not exist, or the screen is stuck — try a different approach or verify with getUIElements.`;
    }
    case 'getUIElements': {
      const result = await ctx.maestro.viewHierarchy();
      const found = formatUIElements(
        result.text || '',
        useDirectHttp ? ctx.phoneScreenWidth : 402,
        useDirectHttp ? ctx.phoneScreenHeight : 874,
      );
      return `Tappable elements on screen:\n${capElementList(found).join('\n')}\n\nUse tap(x, y) with the coordinates above for precise tapping, or tapText("exact text") to tap by label.`;
    }

    // === INTERACTION TOOLS ===
    case 'tap': {
      if (args.x > 100 || args.y > 100) {
        return `ERROR: Coordinates must be percentages 0-100, not pixels. You sent x=${args.x}, y=${args.y}. Divide by screen size to get percentages. Example: bottom-right corner is x=95, y=95.`;
      }
      if (useDirectHttp && ctx.maestro.touchPoint) {
        // Direct HTTP: convert percentage to pixel coordinates
        const px = Math.round((args.x / 100) * ctx.phoneScreenWidth);
        const py = Math.round((args.y / 100) * ctx.phoneScreenHeight);
        await ctx.maestro.touchPoint(px, py);
      } else {
        const header = ctx.currentAppId ? `appId: ${ctx.currentAppId}\n---\n` : 'appId: any\n---\n';
        await ctx.maestro.runFlow(`${header}- tapOn:\n    point: "${args.x}%, ${args.y}%"`);
      }
      return `Tapped (${args.x}%, ${args.y}%)${args.description ? ' - ' + args.description : ''}`;
    }
    case 'tapText': {
      // Find element bounds from view hierarchy, then tap by coordinates (much faster than text search)
      const hierarchy = await ctx.maestro.viewHierarchy();
      const hText = hierarchy.text || '';
      // Support both CSV format (bounds in brackets) and JSON format
      const boundsRegex = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/;

      // Try CSV format first (MCP style)
      const hLines = hText.split('\n');
      const csvMatch = hLines.find(l => l.includes(`accessibilityText=${args.text}`));
      if (csvMatch) {
        const bm = csvMatch.match(boundsRegex);
        if (bm) {
          const screenW = useDirectHttp ? ctx.phoneScreenWidth : 402;
          const screenH = useDirectHttp ? ctx.phoneScreenHeight : 874;
          const cx = Math.round(((parseInt(bm[1]) + parseInt(bm[3])) / 2) / screenW * 100);
          const cy = Math.round(((parseInt(bm[2]) + parseInt(bm[4])) / 2) / screenH * 100);
          if (useDirectHttp && ctx.maestro.touchPoint) {
            await ctx.maestro.touchPoint(parseInt(bm[1]) + parseInt(bm[3]) >> 1, parseInt(bm[2]) + parseInt(bm[4]) >> 1);
          } else {
            const header = ctx.currentAppId ? `appId: ${ctx.currentAppId}\n---\n` : 'appId: any\n---\n';
            await ctx.maestro.runFlow(`${header}- tapOn:\n    point: "${cx}%, ${cy}%"`);
          }
          return `Tapped "${args.text}" at (${cx}%, ${cy}%)`;
        }
      }

      // Try JSON format (direct HTTP viewHierarchy returns nested JSON)
      try {
        const jsonData = JSON.parse(hText);
        function findElement(node) {
          if (!node) return null;
          if (node.label === args.text || node.title === args.text || node.identifier === args.text) return node;
          if (node.children) {
            for (const child of node.children) {
              const found = findElement(child);
              if (found) return found;
            }
          }
          return null;
        }
        const el = findElement(jsonData?.axElement || jsonData);
        if (el && el.frame) {
          const cx = Math.round(el.frame.X + el.frame.Width / 2);
          const cy = Math.round(el.frame.Y + el.frame.Height / 2);
          if (useDirectHttp && ctx.maestro.touchPoint) {
            await ctx.maestro.touchPoint(cx, cy);
          } else {
            const pctX = Math.round(cx / (useDirectHttp ? ctx.phoneScreenWidth : 402) * 100);
            const pctY = Math.round(cy / (useDirectHttp ? ctx.phoneScreenHeight : 874) * 100);
            const header = ctx.currentAppId ? `appId: ${ctx.currentAppId}\n---\n` : 'appId: any\n---\n';
            await ctx.maestro.runFlow(`${header}- tapOn:\n    point: "${pctX}%, ${pctY}%"`);
          }
          return `Tapped "${args.text}" at pixel (${cx}, ${cy})`;
        }
      } catch {}

      // Element not in hierarchy — return immediately so AI can try a different approach
      return `ERROR: Element "${args.text}" not found in view hierarchy. Use getUIElements to see available elements, or use tap with coordinates instead.`;
    }
    case 'inputText': {
      ctx.keyboardLikelyUp = true; // typing summons the keyboard — used for the occlusion warning
      await ctx.maestro.inputText(args.text);
      return `Typed "${args.text}"`;
    }
    case 'replaceText': {
      // CHANGE an existing field's value in one step — focus → clear → type. Sizes the erase from the
      // field's live a11y `value` so it clears exactly what's there (round-5: replacing a field value
      // was the #1 agent stall — vision models fumble select-all/cursor/delete).
      const label = args.field || args.text;
      const value = String(args.value ?? '');
      const hierarchy = await ctx.maestro.viewHierarchy();
      let el = null;
      try {
        const j = JSON.parse(hierarchy.text || '');
        (function find(node) { if (!node || el) return; if (node.label === label || node.title === label || node.identifier === label) { el = node; return; } (node.children || []).forEach(find); })(j?.axElement || j);
      } catch {}
      if (!el || !el.frame) return `ERROR: field "${label}" not found in view hierarchy. Call getUIElements to read the exact field label, then retry replaceText.`;
      const cx = Math.round(el.frame.X + el.frame.Width / 2), cy = Math.round(el.frame.Y + el.frame.Height / 2);
      // Prefer the runner's ELEMENT-TARGETED /setText (XCUIElement clear+type — the only reliable
      // universal clear, incl. SwiftUI numeric TextFields where the triple-tap GESTURE doesn't
      // select-all; round-7). Falls back to triple-tap select-all if the runner lacks that route.
      if (useDirectHttp) {
        let setOk = false;
        try {
          const appIds = ctx.currentAppId ? ['com.apple.springboard', ctx.currentAppId] : ['com.apple.springboard'];
          const resp = await fetch(`http://${driverHost}:${driverPort}/setText`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, text: value, appIds }), signal: AbortSignal.timeout(15000) });
          setOk = resp.ok && resp.status === 200;
        } catch { setOk = false; }
        if (setOk) return `Replaced "${label}" → "${value}" via /setText (element-targeted clear+type). Screenshot to verify.`;
      }
      if (useDirectHttp && ctx.maestro.touchPoint) {
        // Fallback: focus → TRIPLE-TAP to select ALL → type. Works on text fields; a SwiftUI numeric
        // field may not select-all on the gesture, so /setText above is the real fix once the runner has it.
        await ctx.maestro.touchPoint(cx, cy);
        await sleep(250);
        await ctx.maestro.touchPoint(cx, cy); await ctx.maestro.touchPoint(cx, cy); await ctx.maestro.touchPoint(cx, cy);
        await sleep(200);
        await ctx.maestro.inputText(value);
      } else {
        const pctX = Math.round(cx / (useDirectHttp ? ctx.phoneScreenWidth : 402) * 100);
        const pctY = Math.round(cy / (useDirectHttp ? ctx.phoneScreenHeight : 874) * 100);
        const header = ctx.currentAppId ? `appId: ${ctx.currentAppId}\n---\n` : 'appId: any\n---\n';
        // Maestro YAML: bare eraseText clears the WHOLE focused field (length-independent), then type.
        await ctx.maestro.runFlow(`${header}- tapOn:\n    point: "${pctX}%, ${pctY}%"\n- eraseText\n- inputText: ${JSON.stringify(value)}`);
      }
      return `Replaced "${label}" → "${value}" (selected all + typed). Take a screenshot to verify the field shows the new value.`;
    }
    case 'pressKey': {
      // Executor-level validation on top of the schema enum: the schema doesn't
      // protect the no-tools/local-model path (JSON-action protocol bypasses tool
      // schemas entirely), and the runner 400s on unknown keys. Normalize common
      // aliases the models actually emit, reject the rest with the valid list.
      const KEY_ALIASES = { search: 'enter', go: 'enter', done: 'enter', backspace: 'delete', esc: 'escape' };
      const RUNNER_KEYS = ['enter', 'return', 'delete', 'tab', 'space', 'escape'];
      const BUTTONS = ['home', 'lock'];
      let key = String(args.key || '').toLowerCase().trim();
      if (KEY_ALIASES[key]) key = KEY_ALIASES[key];
      if (!RUNNER_KEYS.includes(key) && !BUTTONS.includes(key)) {
        return `ERROR: unknown key "${args.key}". Valid keys: ${RUNNER_KEYS.join(', ')} (keyboard) or ${BUTTONS.join(', ')} (hardware buttons).`;
      }
      if (useDirectHttp && BUTTONS.includes(key) && ctx.maestro.pressButton) {
        // home/lock are hardware buttons — the runner serves them on /pressButton,
        // and /pressKey 400s on them (PressKeyRequest.swift's enum).
        await ctx.maestro.pressButton(key);
      } else if (useDirectHttp && ctx.maestro.pressKey) {
        await ctx.maestro.pressKey(key);
      } else {
        const header = ctx.currentAppId ? `appId: ${ctx.currentAppId}\n---\n` : 'appId: any\n---\n';
        await ctx.maestro.runFlow(`${header}- pressKey: ${key}`);
      }
      return `Pressed ${key}`;
    }
    case 'scroll': {
      if (useDirectHttp && ctx.maestro.swipe) {
        // Simulate scroll: swipe from center-bottom to center-top
        const midX = Math.round(ctx.phoneScreenWidth / 2);
        await ctx.maestro.swipe(midX, Math.round(ctx.phoneScreenHeight * 0.7), midX, Math.round(ctx.phoneScreenHeight * 0.3));
      } else {
        const header = ctx.currentAppId ? `appId: ${ctx.currentAppId}\n---\n` : 'appId: any\n---\n';
        await ctx.maestro.runFlow(`${header}- scroll`);
      }
      return 'Scrolled down';
    }
    case 'swipe': {
      if (useDirectHttp && ctx.maestro.swipe) {
        const sx = Math.round((args.startX / 100) * ctx.phoneScreenWidth);
        const sy = Math.round((args.startY / 100) * ctx.phoneScreenHeight);
        const ex = Math.round((args.endX / 100) * ctx.phoneScreenWidth);
        const ey = Math.round((args.endY / 100) * ctx.phoneScreenHeight);
        await ctx.maestro.swipe(sx, sy, ex, ey);
      } else {
        const header = ctx.currentAppId ? `appId: ${ctx.currentAppId}\n---\n` : 'appId: any\n---\n';
        await ctx.maestro.runFlow(`${header}- swipe:\n    start: "${args.startX}%, ${args.startY}%"\n    end: "${args.endX}%, ${args.endY}%"`);
      }
      return 'Swiped';
    }
    case 'drag': {
      const holdDuration = args.holdDuration || 0.5;
      const dragDuration = args.dragDuration || 1.0;
      if (useDirectHttp && ctx.maestro.drag) {
        const sx = Math.round((args.startX / 100) * ctx.phoneScreenWidth);
        const sy = Math.round((args.startY / 100) * ctx.phoneScreenHeight);
        const ex = Math.round((args.endX / 100) * ctx.phoneScreenWidth);
        const ey = Math.round((args.endY / 100) * ctx.phoneScreenHeight);
        await ctx.maestro.drag(sx, sy, ex, ey, holdDuration, dragDuration);
      } else {
        // Simulator fallback: no combined press+hold+drag YAML primitive (ctx.maestro issue #1203).
        // Long-duration swipe approximates continuous drag; won't trigger long-press-gated modes.
        const durationMs = Math.round((holdDuration + dragDuration) * 1000);
        const header = ctx.currentAppId ? `appId: ${ctx.currentAppId}\n---\n` : 'appId: any\n---\n';
        await ctx.maestro.runFlow(`${header}- swipe:\n    start: "${args.startX}%, ${args.startY}%"\n    end: "${args.endX}%, ${args.endY}%"\n    duration: ${durationMs}`);
      }
      return `Dragged from (${args.startX}%, ${args.startY}%) to (${args.endX}%, ${args.endY}%) — hold ${holdDuration}s, drag ${dragDuration}s`;
    }
    case 'hideKeyboard': {
      // NOT A FIXED TAP (2026-08-16, mirrors OnDeviceAgent+Tools). Tapping
      // (width/2, 50pt) is the top edge of the screen: on the Settings-search
      // overlay that is the sheet grabber, and it COLLAPSES the overlay — the
      // model read the receding Settings as "the app switcher" and spiralled.
      // A keyboard is dismissed the way a person does it: Return, which never
      // navigates. Fall back to a tap only on a spot the hierarchy says is
      // empty.
      ctx.keyboardLikelyUp = false;
      if (useDirectHttp && ctx.maestro.touchPoint) {
        try { await ctx.maestro.pressKey?.('enter'); } catch { /* no field focused */ }
        await new Promise((r) => setTimeout(r, 350));
        const stillUp = await ctx.maestro.keyboardVisible?.().catch(() => false);
        if (stillUp) {
          const spot = await ctx.maestro.emptySpotAboveKeyboard?.().catch(() => null);
          if (spot) {
            await ctx.maestro.touchPoint(spot.x, spot.y);
            await new Promise((r) => setTimeout(r, 350));
            // Check again: many SwiftUI fields ignore both Return and a tap
            // outside. Reporting "hidden" without looking sent a model round
            // in circles on iOSWorld's Add Alarm sheet (2026-10-15 eval).
            if (!(await ctx.maestro.keyboardVisible?.().catch(() => false))) return 'Keyboard hidden (tapped an empty area)';
          }
          ctx.keyboardLikelyUp = true;
          return 'Keyboard is still up: Return and a tap on an empty area did not close it. It does not block controls above it: tap Save, Done or the next field directly, or use the field\'s own Done/Search key.';
        }
        return 'Keyboard hidden';
      }
      await ctx.maestro.runFlow('- hideKeyboard');
      return 'Keyboard hidden';
    }
    case 'typeAndSubmit': {
      // Compound tool: tap field + type + submit in one call
      // Step 1: Tap the text field
      try {
        await executeTool('tapText', { text: args.elementText });
      } catch {
        // Fallback: try tapping by coordinates if text tap fails
      }
      await sleep(500);
      // Step 2: Type the text
      await executeTool('inputText', { text: args.text });
      await sleep(300);
      // Step 3: Submit
      const key = args.submitKey || 'enter';
      if (key === 'send') {
        // iOS Messages: find the send button via hierarchy (position changes when keyboard is open)
        let sendTapped = false;
        try {
          const hier = await ctx.maestro.viewHierarchy();
          const hText = hier.text || '';
          const screenW = useDirectHttp ? ctx.phoneScreenWidth : 402;
          const screenH = useDirectHttp ? ctx.phoneScreenHeight : 874;
          // Search hierarchy for send button (label varies: "Send", "sendButton", arrow icon)
          try {
            const json = JSON.parse(hText);
            function findSend(node) {
              if (!node) return null;
              const label = (node.label || node.identifier || '').toLowerCase();
              if ((label.includes('send') || label === 'arrow.up.circle.fill') && node.frame) return node;
              if (node.children) {
                for (const child of node.children) {
                  const found = findSend(child);
                  if (found) return found;
                }
              }
              return null;
            }
            const sendEl = findSend(json?.axElement || json);
            if (sendEl && sendEl.frame) {
              const cx = Math.round(sendEl.frame.X + sendEl.frame.Width / 2);
              const cy = Math.round(sendEl.frame.Y + sendEl.frame.Height / 2);
              const pctX = Math.round(cx / screenW * 100);
              const pctY = Math.round(cy / screenH * 100);
              console.log(`[typeAndSubmit] Send button found at (${pctX}%, ${pctY}%) — label: "${sendEl.label || sendEl.identifier}"`);
              if (useDirectHttp && ctx.maestro.touchPoint) {
                await ctx.maestro.touchPoint(cx, cy);
              } else {
                const header = ctx.currentAppId ? `appId: ${ctx.currentAppId}\n---\n` : 'appId: any\n---\n';
                await ctx.maestro.runFlow(`${header}- tapOn:\n    point: "${pctX}%, ${pctY}%"`);
              }
              sendTapped = true;
              await sleep(500); // Wait for send animation to complete
            }
          } catch {}
        } catch {}
        // Fallback: use pressKey enter if hierarchy lookup failed
        if (!sendTapped) {
          console.log('[typeAndSubmit] Send button NOT found in hierarchy — falling back to pressKey enter');
          await executeTool('pressKey', { key: 'enter' });
        }
      } else {
        await executeTool('pressKey', { key });
      }
      return key === 'send'
        ? `Message sent: "${args.text}" — the send button was tapped automatically. Do NOT tap send again. Take a screenshot to verify.`
        : `Typed "${args.text}" into "${args.elementText}" and submitted via ${key}`;
    }
    case 'zoomAndTap': {
      // ZoomClick: crop around rough area, send zoomed image to AI for precise targeting
      // Step 1: Get current screenshot
      const ssResult = await ctx.maestro.screenshot();
      const ssBuffer = Buffer.from(ssResult.data, 'base64');

      // Step 2: Crop and zoom
      const zoom = await zoomAndRefine(ssBuffer, args.x, args.y, ctx.phoneScreenWidth, ctx.phoneScreenHeight);
      const zoomedB64 = zoom.buffer.toString('base64');

      // Step 3: Ask AI for precise coordinates in zoomed view
      const zoomMessages = [
        { role: 'system', content: `You are looking at a ZOOMED-IN portion of a mobile screen. The user wants to tap: "${args.description}". This zoomed view shows the area around (${args.x}%, ${args.y}%) of the full screen. Respond with ONLY a JSON object: {"x": <percentage 0-100 within THIS zoomed image>, "y": <percentage 0-100 within THIS zoomed image>}` },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${zoomedB64}` } },
          { type: 'text', text: `Where exactly is "${args.description}" in this zoomed view? Respond with {"x": N, "y": N} as percentages within this image.` }
        ]}
      ];

      const zoomResp = await fetch(llmConfig.url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, messages: zoomMessages }),
      });
      const zoomData = await zoomResp.json();
      const zoomText = zoomData.choices?.[0]?.message?.content || '';
      const zoomMatch = zoomText.match(/\{[\s\S]*\}/);

      if (zoomMatch) {
        const zoomCoords = JSON.parse(zoomMatch[0]);
        // Map back to full-screen coordinates
        const fullCoords = zoom.mapBack(zoomCoords.x, zoomCoords.y);
        console.log(`[ZoomClick] Rough (${args.x}%,${args.y}%) → Zoomed (${zoomCoords.x}%,${zoomCoords.y}%) → Final (${fullCoords.x}%,${fullCoords.y}%)`);

        // Execute the tap
        if (useDirectHttp && ctx.maestro.touchPoint) {
          const px = Math.round((fullCoords.x / 100) * ctx.phoneScreenWidth);
          const py = Math.round((fullCoords.y / 100) * ctx.phoneScreenHeight);
          await ctx.maestro.touchPoint(px, py);
        } else {
          const header = ctx.currentAppId ? `appId: ${ctx.currentAppId}\n---\n` : 'appId: any\n---\n';
          await ctx.maestro.runFlow(`${header}- tapOn:\n    point: "${fullCoords.x}%, ${fullCoords.y}%"`);
        }
        return `ZoomTapped "${args.description}" at (${fullCoords.x}%, ${fullCoords.y}%) [refined from rough (${args.x}%, ${args.y}%)]`;
      }
      // Fallback: use rough coordinates
      if (useDirectHttp && ctx.maestro.touchPoint) {
        const px = Math.round((args.x / 100) * ctx.phoneScreenWidth);
        const py = Math.round((args.y / 100) * ctx.phoneScreenHeight);
        await ctx.maestro.touchPoint(px, py);
      }
      return `Tapped "${args.description}" at rough (${args.x}%, ${args.y}%) [zoom refinement failed]`;
    }

    // === MEMORY ===
    case 'saveMemory': {
      // Defer actual write to after task completion — just queue it
      pendingMemories.push(args.fact);
      console.log(`[Memory] Queued: "${args.fact}" (will save after task completes)`);
      return `Will remember: "${args.fact}"`;
    }
    case 'recallMemory': {
      const memFile = join(STATE_DIR, 'memories', 'user.md');
      if (existsSync(memFile)) {
        const content = readFileSync(memFile, 'utf-8');
        console.log(`[Memory] Recalled ${content.split('\n').length - 1} facts`);
        return content || '(no memories saved yet)';
      }
      return '(no memories saved yet)';
    }
    case 'recallHistory': {
      const logFile = join(STATE_DIR, 'logs', 'tasks.jsonl');
      if (existsSync(logFile)) {
        const lines = readFileSync(logFile, 'utf-8').trim().split('\n');
        const recent = lines.slice(-10).flatMap(l => {
          // Guard every line: a single torn JSONL row (e.g. a SIGKILL between two writes)
          // must not crash a live agent mid-task — skip the bad line instead.
          try {
            const e = JSON.parse(l);
            return [`[${e.timestamp.split('T')[0]}] "${e.task}" — ${e.success ? 'completed' : 'failed'} in ${e.steps} steps (${e.time}s)`];
          } catch { return []; }
        }).join('\n');
        console.log(`[History] Recalled ${lines.length} tasks`);
        return `Recent task history:\n${recent}`;
      }
      return '(no task history yet)';
    }

    // === WEB SEARCH ===
    case 'webSearch': {
      const braveKey = process.env.BRAVE_API_KEY;
      if (!braveKey) {
        return 'ERROR: BRAVE_API_KEY not set in .env. Cannot perform web search.';
      }
      try {
        const url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.searchParams.set('q', args.query);
        url.searchParams.set('count', '5');
        const res = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': braveKey,
          },
        });
        if (!res.ok) {
          return `ERROR: Brave Search API returned ${res.status}`;
        }
        const data = await res.json();
        const results = (data.web?.results ?? []).slice(0, 5);
        if (results.length === 0) return 'No search results found.';
        const formatted = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description || ''}`).join('\n\n');
        console.log(`[WebSearch] "${args.query}" → ${results.length} results`);
        return `Web search results for "${args.query}":\n\n${formatted}`;
      } catch (e) {
        return `ERROR: Web search failed: ${e.message}`;
      }
    }

    // === HUMAN-IN-THE-LOOP ===
    case 'askUser': {
      ctx.askUserCalls++;
      const userChoice = await requestUserApproval(args.question, args.options);
      if (userChoice === ASKUSER_TIMEOUT_SENTINEL) {
        return `No response from the user (timed out — unattended run). You are NOT authorized to assume an answer. Continue without it if the task can still proceed, otherwise call taskFailed explaining that user input was required and unavailable.`;
      }
      return `User chose: "${userChoice}"`;
    }
    case 'askUserText': {
      ctx.askUserCalls++;
      const userText = await requestUserText(args.question, args.hint || '');
      if (userText === ASKUSER_TIMEOUT_SENTINEL) {
        return `No response from the user (timed out — unattended run). You are NOT authorized to fabricate this input. Continue without it if the task can still proceed, otherwise call taskFailed explaining that user input was required and unavailable.`;
      }
      return `User typed: "${userText}"`;
    }

    // === COMPLETION ===
    case 'taskComplete': return `__DONE__:${args.summary}`;
    case 'taskFailed': return `__FAILED__:${args.reason}`;
    default: return `Unknown tool: ${name}`;
  }
};
}
