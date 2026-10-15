#!/usr/bin/env node
/**
 * mobile-use agent with tools + Maestro MCP server
 * Just describe what you want — the AI picks the right app and action.
 * Maestro boots once, all taps/inputs are fast after that.
 */
import 'dotenv/config';
import { exec, execSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, appendFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { STATE_DIR } from './state-dir.mjs';
import * as procedures from './procedures.mjs';
import { checkRuntimeGuard, formatActionForUser } from './runtime-guard.mjs';
// Extracted modules (D2 refactor 2026-07-17) — importable/testable seams. Each is
// side-effect-free at import time; all mutable state stays HERE in agent.mjs.
import { parseAgentArgs, buildHelpText } from './cli-args.mjs';
import { createStuckDetector } from './stuck-detector.mjs';
import { LLM_CONFIG, createLLMClient } from './llm-client.mjs';
import { runShell, MaestroMCP, createDirectHttpDriver, captureRawScreenshot } from './device-backend.mjs';
import { buildToolDefs, createToolExecutor, capElementList } from './tools.mjs';
import { runAssertSql as runAssertSqlEngine } from './sql-assert.mjs';
// sharp's native libvips dylib triggers macOS Gatekeeper signature verification
// on first load per system-session — ~50s the first time, ~28ms after that
// (verification is cached at the kernel level). Importing here at module init
// pays that cost during agent.mjs startup, before the first step's timer starts,
// so it is not counted as screenshot time.
import sharp from 'sharp';

// ─── Parse args (cli-args.mjs — real parser with an explicit boolean-flag set; D1) ───
// The old inline parser treated the token following ANY --flag as that flag's value,
// so `node agent.mjs --phone "task"` swallowed the task. parseAgentArgs is pure
// (argv in, config out), knows which flags are boolean, errors on unknown flags
// (exit 2), and is unit-tested in agent/test/agent-cli.test.mjs. Per-flag defaults,
// semantics, and validation messages live there, unchanged from the inline originals.
const parsed = parseAgentArgs(process.argv.slice(2));
if (parsed.help) {
  console.log(buildHelpText());
  process.exit(0);
}
// Parse-stage errors (unknown flag, bad --max-steps / --temperature) — exit 2.
if (parsed.error && parsed.error.stage === 'parse') {
  console.log(parsed.error.message);
  process.exit(parsed.error.exitCode);
}
// Informational parse notes (e.g. the [Temperature] unsupported-pin line) — printed
// at the same point in the output as the old inline parser printed them.
for (const line of parsed.notes) console.log(line);
const {
  task, maxSteps, noProgressAbortN, logRunId, traceDir,
  provider, modelName,
  noToolsMode, hasPhoneFlag, backend, isPhone, useDirectHttp,
  phoneDeviceId, driverPort, driverHost, simUdid,
  agentMode, visionEveryK, grounding,
  promptMode, pmStructured, pmIosHints, pmConventions, pmSafetyTags,
  askUserTimeoutMs, useCompression,
  runtimeGuardPolicy, noProcedures,
  assertSql, assertApp, assertDb, assertBestEffort, assertExpect,
  disabledTools,
} = parsed.config;
// Degrees to rotate a landscape screenshot upright for the VLM (see cli-args.mjs).
const LANDSCAPE_ROTATE_DEG = parsed.config.landscapeRotateDeg;
// Mutable temperature state — the runtime 400-fallback (markTemperatureUnsupported) clears it.
let { requestedTemperature, effectiveTemperature } = parsed.config;
// Runtime backstop for models the static rule doesn't know: if a request 400s on the
// temperature param anyway, drop it, record unsupported, and retry once (in callLLM).
function markTemperatureUnsupported() {
  requestedTemperature = null;
  effectiveTemperature = `unsupported:${modelName}`;
  console.log(`[Temperature] provider rejected the temperature param at runtime — retrying without it; recording "${effectiveTemperature}"`);
}
// Validate an explicit --udid is actually booted, so a typo/stale UDID fails FAST with a clear
// message instead of silently mis-targeting (screenshotting one sim while tapping another via
// the runner). Simulator path only — the phone path doesn't use simctl. Impure (simctl), so it
// stays here; it runs BEFORE the --prompt-mode validation, matching the original check order.
if (simUdid !== 'booted' && !hasPhoneFlag) {
  try {
    if (!execSync('xcrun simctl list devices booted', { encoding: 'utf8' }).includes(simUdid)) {
      console.log(`ERROR: --udid ${simUdid} is not a booted simulator. Boot it first:  xcrun simctl boot ${simUdid}`);
      process.exit(2);
    }
  } catch { /* simctl unavailable — skip rather than block a non-sim context */ }
}
// Post-udid validation errors (--prompt-mode) — exit 2.
if (parsed.error) {
  console.log(parsed.error.message);
  process.exit(parsed.error.exitCode);
}
if (!task) {
  console.log(buildHelpText());
  process.exit(2);
}
const ASKUSER_TIMEOUT_SENTINEL = '__NO_RESPONSE_TIMEOUT__';
// Per-step trajectory persistence: write step-NN.{jpg|png} (the EXACT image the model
// saw — post-rotation, post-compression, post-grid) + step-NN-elements.txt (the UI-element
// text bundled with it) into this dir. Turns the jsonl action trace into a reviewable
// "film strip" for trajectory judging, error taxonomy, and post-mortems (case-motivated
// 2026-07-06: the contacts Done-tap mystery was unclosable from the action trace alone).
// Tracing must NEVER break a run — every write is fire-and-forget.
let _traceDirReady = false;
function saveTraceStep(stepNo, buffer, elementsText) {
  if (!traceDir) return;
  try {
    if (!_traceDirReady) { mkdirSync(traceDir, { recursive: true }); _traceDirReady = true; }
    const nn = String(stepNo).padStart(2, '0');
    const ext = buffer[0] === 0xFF && buffer[1] === 0xD8 ? 'jpg' : 'png';
    writeFileSync(join(traceDir, `step-${nn}.${ext}`), buffer);
    if (elementsText) writeFileSync(join(traceDir, `step-${nn}-elements.txt`), elementsText);
  } catch { /* tracing is best-effort */ }
}
// ─── Provider config (LLM_CONFIG now lives in llm-client.mjs) ───
const llmConfig = LLM_CONFIG[provider];
if (!llmConfig) { console.log(`ERROR: Unknown provider "${provider}". Use: openai, gemini, anthropic, or local`); process.exit(1); }

// Local providers (Ollama) need no API key — use a dummy the server ignores.
const apiKey = process.env[llmConfig.keyEnv] || (llmConfig.noKey ? 'ollama' : undefined);
if (!apiKey) { console.log(`ERROR: Set ${llmConfig.keyEnv} (${llmConfig.keyHint})`); process.exit(1); }

// ─── Helpers ───
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Programmatic askUser — extracted from the askUser tool case so it's
// reusable from the runtime guard. Same protocol the server already
// understands: emit __ASK_USER__: marker on stdout, wait for the response
// file at tmpdir()/agent-user-response.json (server writes it when the
// user picks an option via Dynamic Island / notification banner / sheet).
async function requestUserApproval(question, options) {
  console.log(`[askUser] "${question}" — options: ${options.join(', ')}`);
  console.log(`__ASK_USER__:${JSON.stringify({ question, options })}`);
  console.log(`[askUser] Waiting for user response...`);
  const responseFile = join(tmpdir(), 'agent-user-response.json');
  try { unlinkSync(responseFile); } catch {}
  const userChoice = await new Promise((resolve) => {
    let waited = 0;
    const interval = setInterval(() => {
      try {
        const data = readFileSync(responseFile, 'utf-8');
        const { choice } = JSON.parse(data);
        clearInterval(interval);
        try { unlinkSync(responseFile); } catch {}
        resolve(choice);
        return;
      } catch {}
      waited += 500;
      if (askUserTimeoutMs > 0 && waited >= askUserTimeoutMs) {
        clearInterval(interval);
        console.log(`[askUser] No response after ${askUserTimeoutMs / 1000}s — giving up (unattended run).`);
        resolve(ASKUSER_TIMEOUT_SENTINEL);
      }
    }, 500);
  });
  if (userChoice === ASKUSER_TIMEOUT_SENTINEL) return userChoice;
  console.log(`[askUser] User responded: "${userChoice}"`);
  return userChoice;
}

// Freeform question — used when the answer can't reasonably be enumerated
// (email address, OTP, search string, free text). Emits `__ASK_USER_TEXT__:`
// so a client can render a text input instead of option buttons.
// Same `/tmp/agent-user-response.json` polling mechanism on the response side.
async function requestUserText(question, hint = '') {
  console.log(`[askUserText] "${question}"${hint ? ' (hint: ' + hint + ')' : ''}`);
  console.log(`__ASK_USER_TEXT__:${JSON.stringify({ question, hint })}`);
  console.log(`[askUserText] Waiting for user text response...`);
  const responseFile = join(tmpdir(), 'agent-user-response.json');
  try { unlinkSync(responseFile); } catch {}
  const userText = await new Promise((resolve) => {
    let waited = 0;
    const interval = setInterval(() => {
      try {
        const data = readFileSync(responseFile, 'utf-8');
        const { choice } = JSON.parse(data);
        clearInterval(interval);
        try { unlinkSync(responseFile); } catch {}
        resolve(choice);
        return;
      } catch {}
      waited += 500;
      if (askUserTimeoutMs > 0 && waited >= askUserTimeoutMs) {
        clearInterval(interval);
        console.log(`[askUserText] No response after ${askUserTimeoutMs / 1000}s — giving up (unattended run).`);
        resolve(ASKUSER_TIMEOUT_SENTINEL);
      }
    }, 500);
  });
  if (userText === ASKUSER_TIMEOUT_SENTINEL) return userText;
  console.log(`[askUserText] User typed: "${userText}"`);
  return userText;
}

// runShell now lives in device-backend.mjs (imported at the top).

// ─── Grid overlay (draws percentage grid lines + labels on screenshot) ───
async function addGridOverlay(imageBuffer) {
  const sharp = (await import('sharp')).default;
  const metadata = await sharp(imageBuffer).metadata();
  const w = metadata.width;
  const h = metadata.height;

  // Create SVG overlay with grid lines every 10% and labels every 20%
  const lines = [];
  const labels = [];

  // Vertical lines
  for (let pct = 10; pct <= 90; pct += 10) {
    const x = Math.round((pct / 100) * w);
    const opacity = pct % 20 === 0 ? 0.4 : 0.2;
    const strokeW = pct % 20 === 0 ? 2 : 1;
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="rgba(255,255,0,${opacity})" stroke-width="${strokeW}"/>`);
    if (pct % 20 === 0) {
      labels.push(`<text x="${x + 4}" y="28" fill="rgba(255,255,0,0.8)" font-size="24" font-family="Arial" font-weight="bold">${pct}</text>`);
    }
  }

  // Horizontal lines
  for (let pct = 10; pct <= 90; pct += 10) {
    const y = Math.round((pct / 100) * h);
    const opacity = pct % 20 === 0 ? 0.4 : 0.2;
    const strokeW = pct % 20 === 0 ? 2 : 1;
    lines.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="rgba(255,255,0,${opacity})" stroke-width="${strokeW}"/>`);
    if (pct % 20 === 0) {
      labels.push(`<text x="4" y="${y - 6}" fill="rgba(255,255,0,0.8)" font-size="24" font-family="Arial" font-weight="bold">${pct}</text>`);
    }
  }

  const svg = `<svg width="${w}" height="${h}">${lines.join('')}${labels.join('')}</svg>`;

  const result = await sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();

  return result;
}


// ─── Setup ───
const MODE_LABEL = backend === 'phone-direct' ? 'Physical iPhone (direct HTTP)' : backend === 'direct-http-sim' ? 'Simulator (direct HTTP — fast path)' : 'Simulator (Maestro CLI — baseline)';
console.log(`[Setup] Mode: ${MODE_LABEL}`);
console.log('[Setup] Detecting apps...');
const appMap = {};
const knownBundleIds = {
  Safari: 'com.apple.mobilesafari', Maps: 'com.apple.Maps', Messages: 'com.apple.MobileSMS',
  Calendar: 'com.apple.mobilecal', Photos: 'com.apple.mobileslideshow', Camera: 'com.apple.camera',
  Settings: 'com.apple.Preferences', Notes: 'com.apple.mobilenotes', Reminders: 'com.apple.reminders',
  Contacts: 'com.apple.MobileAddressBook', Phone: 'com.apple.mobilephone', Mail: 'com.apple.mobilemail',
  Weather: 'com.apple.weather', Clock: 'com.apple.mobiletimer', Files: 'com.apple.DocumentsApp',
  News: 'com.apple.news', Health: 'com.apple.Health', Wallet: 'com.apple.Passbook',
  Shortcuts: 'com.apple.shortcuts', Music: 'com.apple.Music', Podcasts: 'com.apple.podcasts',
  'App Store': 'com.apple.AppStore', Calculator: 'com.apple.calculator', Compass: 'com.apple.compass',
  'Voice Memos': 'com.apple.VoiceMemos', Measure: 'com.apple.measure', TV: 'com.apple.tv',
  Passwords: 'com.apple.Passwords', Clips: 'com.apple.clips',
  // Common third-party apps
  Spotify: 'com.spotify.client', Instagram: 'com.burbn.instagram', Snapchat: 'com.toyopagroup.picaboo',
  TikTok: 'com.zhiliaoapp.musically', YouTube: 'com.google.ios.youtube', Gmail: 'com.google.Gmail',
  WhatsApp: 'net.whatsapp.WhatsApp', Telegram: 'ph.telegra.Telegraph', Discord: 'com.hammerandchisel.discord',
  Uber: 'com.ubercab.UberClient', Starbucks: 'com.starbucks.mystarbucks', Amazon: 'com.amazon.Amazon',
  Twitter: 'com.atebits.Tweetie2', Reddit: 'com.reddit.Reddit', Netflix: 'com.netflix.Netflix',
  Notion: 'notion.id', Slack: 'com.tinyspeck.chatlyio', ChatGPT: 'com.openai.chat',
  LinkedIn: 'com.linkedin.LinkedIn', GitHub: 'com.github.stormbreaker.prod', Zoom: 'us.zoom.videomeetings',
  Outlook: 'com.microsoft.Office.Outlook', 'Google Calendar': 'com.google.calendar',
  'Nike Run Club': 'com.nike.nrc', Robinhood: 'com.robinhood.release.Robinhood',
  GroupMe: 'com.groupme.iphone', Expedia: 'com.expedia.app',
  SNKRS: 'com.nike.snkrs', Supreme: 'com.supremenewyork.supreme',
};

if (isPhone) {
  // Two-layer app enumeration on physical iPhone:
  //
  //  Layer 1 (safety net): hardcoded `knownBundleIds` — covers ~50 common
  //                        apps. Always available, even without USB or
  //                        pymobiledevice3 installed. Worst case behavior.
  //
  //  Layer 2 (overlay):    pymobiledevice3 apps list — enumerates EVERY
  //                        app installed on the connected device, with
  //                        accurate bundle IDs straight from
  //                        installation_proxy. Requires pymobiledevice3
  //                        on PATH (already a project dep — see
  //                        docs/wireless-setup.md) and the phone to be
  //                        connected (USB or wireless tunnel).
  //
  // We start with Layer 1 then OVERLAY Layer 2 — so if pymobiledevice3
  // succeeds it dominates, but if it fails for any reason (phone
  // unplugged, pymobiledevice3 not installed, JSON parse error) the
  // hardcoded list is still there as a graceful fallback. Either way
  // the agent has SOME apps to work with at startup, and the home-screen
  // tap fallback in `openApp` (further below) catches anything still
  // missing at runtime.
  Object.assign(appMap, knownBundleIds);

  try {
    // 30s timeout — pymobiledevice3 typically responds in 1-3s but the
    // first call after a fresh device pair can be slower while
    // installation_proxy initializes.
    //
    // No `2>/dev/null` here — when pymobiledevice3 fails it logs to
    // stderr ("ERROR Device is not connected", etc.). Suppressing stderr
    // would make every failure look like an "unexpected error" because
    // the error message would just be a generic JSON parse failure on
    // empty stdout. Letting stderr through means exec() captures it in
    // the error.message when the exit code is non-zero — which is how
    // we see the actual cause of the failure below.
    const appsRaw = await runShell('pymobiledevice3 apps list', 30000);
    const apps = JSON.parse(appsRaw);
    let discovered = 0;
    for (const [bid, info] of Object.entries(apps)) {
      // CFBundleDisplayName is the human-readable name (what the user
      // sees on the home screen). CFBundleName is the fallback —
      // sometimes apps don't set DisplayName.
      const name = (info?.CFBundleDisplayName || info?.CFBundleName || '').trim();
      if (name && typeof bid === 'string') {
        appMap[name] = bid;
        discovered++;
      }
    }
    if (discovered > 0) {
      console.log(`[Setup] Auto-discovered ${discovered} apps via pymobiledevice3 (overlaying ${Object.keys(knownBundleIds).length} hardcoded fallbacks)`);
    }
  } catch (e) {
    // Common reasons: phone not plugged in / paired, pymobiledevice3 not
    // installed, output format changed in a newer version. Hardcoded
    // fallback already loaded above — agent can still drive ~50 apps;
    // any unknown app surfaces as an explicit error from openApp so the
    // LLM can choose a different approach (Spotlight search, etc.)
    // instead of taking a destructive default action.
    const errMsg = (e.message || '').slice(0, 250);
    let hint;
    if (errMsg.includes('not connected')) {
      hint = 'phone not connected (plug in via USB or run wireless tunnel)';
    } else if (errMsg.includes('not found') || errMsg.includes('command not found')) {
      hint = 'pymobiledevice3 not on PATH (`pip install pymobiledevice3`)';
    } else if (errMsg.includes('Expecting value') || errMsg.includes('Unexpected token') || errMsg.includes('JSON')) {
      hint = `non-JSON output (run \`pymobiledevice3 apps list\` manually to see the actual error)`;
    } else {
      // Surface the real error so the failure is debuggable instead of
      // silently bucketed as "unexpected".
      hint = `error: ${errMsg.replace(/\n/g, ' ').slice(0, 150)}`;
    }
    console.log(`[Setup] pymobiledevice3 unavailable — ${hint}`);
    console.log(`[Setup] Falling back to ${Object.keys(knownBundleIds).length} hardcoded apps. For any other app, the LLM can use Spotlight search (swipe down on home, type, tap result).`);
  }
} else {
  const appListRaw = await runShell(`xcrun simctl listapps ${simUdid}`);
  const lines = appListRaw.split('\n');
  let currentName = '';
  for (const line of lines) {
    const nm = line.match(/CFBundleDisplayName\s*=\s*"?([^";]+)"?/);
    const id = line.match(/CFBundleIdentifier\s*=\s*"?([^";]+)"?/);
    if (nm) currentName = nm[1].trim();
    if (id && currentName) {
      const bid = id[1].trim();
      if (!bid.includes('Preview') && !bid.includes('PreviewShell') && currentName !== 'Watch' && currentName !== 'Web') {
        appMap[currentName] = bid;
      }
      currentName = '';
    }
  }
}
// Names only, comma-joined — the LLM calls openApp(name) and the code resolves
// the bundle ID internally via appMap, so bundle IDs in the (cached) system
// prompt are tokens the model never uses. Dropping them is negligible on the
// simulator (~16 apps) but saves ~2.5k cache-prefix tokens on a phone with
// ~470 installed apps. Comma-joined is also more compact than newline-joined.
const appListStr = Object.keys(appMap).join(', ');
console.log(`[Setup] Found ${Object.keys(appMap).length} apps`);

// Start Maestro
let maestro;
let currentAppId = null;
let phoneScreenWidth = 393; // iPhone 15 Pro default
let phoneScreenHeight = 852;
// Keyboard-occlusion tracking: the app-scoped view hierarchy does NOT contain the
// keyboard (verified 2026-07-06 — zero key elements even with excludeKeyboardElements:
// false), so the element list can point the model at coordinates that are visually
// BEHIND the keyboard; tapping them presses a KEY and corrupts the text (the contacts
// "add phone at 66%" trap: taps landed on the 'T' key). Typing sets this; hideKeyboard
// clears it; the per-step element list carries a warning while it's set.
let keyboardLikelyUp = false;

// HITL-confirmation accounting (structured — the guard matrix must NOT scrape logs):
// guardApprovalsRequired = runtime-guard interceptions; askUserCalls = the agent's own
// prompt-level confirmations (askUser/askUserText). Recall for dangerous tasks credits
// EITHER layer (the metric is "was the action gated behind a human?"); the guard-off
// arm measures the prompt layer's baseline. Recorded in every tasks.jsonl entry.
let guardApprovalsRequired = 0;
let askUserCalls = 0;

// Pixel dimensions of the image ACTUALLY sent to the LLM last turn (768 when compressed,
// native width with --no-compress). The local-adapter converts a model's pixel coords → %
// using these — hardcoding 768 was audit finding #2/#10.
let lastSentImageWidth = 768, lastSentImageHeight = 768;

if (useDirectHttp) {
  // Direct-HTTP path — same client code for both phone-direct (port 6001 via maestro-ios-device)
  // and direct-http-sim (port 22087 direct to Maestro's runner inside the simulator).
  // driverHost defaults to localhost; can be overridden with --driver-host to talk
  // to a remote runner (Tailscale virtual IP, LAN IP for cross-network control).
  console.log(`[Setup] Direct HTTP to XCTest runner on port ${driverPort}`);
  if (backend === 'phone-direct') {
    const teamIdHint = process.env.PHONE_TEAM_ID || '$PHONE_TEAM_ID';
    console.log('[Setup] Make sure maestro-ios-device bridge is running:');
    console.log(`[Setup]   maestro-ios-device --team-id ${teamIdHint} --device ${phoneDeviceId || '$PHONE_DEVICE_ID'}`);
    if (!process.env.PHONE_TEAM_ID || !phoneDeviceId) {
      console.log('[Setup] Set PHONE_TEAM_ID and PHONE_DEVICE_ID in .env (see .env.example).');
      console.log('[Setup] First-time setup: docs/onboarding-your-device.md');
    }
  } else {
    console.log('[Setup] Make sure the simulator runner is running (launched separately):');
    console.log('[Setup]   ./scripts/start-sim-runner.sh');
  }

  // The direct-HTTP driver (xctest client + wrapper methods) now lives in
  // device-backend.mjs. currentAppId stays owned HERE — the driver reads it
  // through the getter on every call, so flow/typing scoping is unchanged.
  maestro = createDirectHttpDriver({ driverHost, driverPort, phoneDeviceId, getCurrentAppId: () => currentAppId });

  // Check if XCTest runner is already alive (from a previous run)
  console.log('[Setup] Checking XCTest runner...');
  const warmStart = Date.now();
  let runnerAlive = false;
  try {
    const resp = await fetch(`http://${driverHost}:${driverPort}/deviceInfo`, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) runnerAlive = true;
  } catch {}

  if (!runnerAlive) {
    if (backend === 'direct-http-sim') {
      console.log(`[Setup] ERROR: Simulator runner not responding on port ${driverPort}.`);
      console.log('[Setup] Start it in another terminal:');
      console.log('[Setup]   ./scripts/start-sim-runner.sh');
      process.exit(1);
    }
    // phone-direct: wake it up with one Maestro CLI call (the only JVM hit)
    console.log('[Setup] Waking up XCTest runner (one-time, ~5s)...');
    try {
      const flowPath = join(tmpdir(), `maestro-warm-${Date.now()}.yaml`);
      writeFileSync(flowPath, 'appId: any\n---\n- pressKey: space');
      const cmd = `maestro --driver-host-port ${driverPort} --device ${phoneDeviceId} test ${flowPath}`;
      await new Promise((resolve) => {
        exec(cmd, { timeout: 60000 }, (_error) => {
          try { unlinkSync(flowPath); } catch {}
          // Ignore errors — the runner starts regardless
          resolve();
        });
      });
    } catch {}
  }
  console.log(`[Setup] XCTest runner ready (${((Date.now() - warmStart) / 1000).toFixed(1)}s)`);

  // Verify direct HTTP works
  console.log('[Setup] Testing direct HTTP...');
  try {
    const infoStart = Date.now();
    const info = await maestro.deviceInfo();
    phoneScreenWidth = info.widthPoints;
    phoneScreenHeight = info.heightPoints;
    console.log(`[Setup] Direct HTTP OK (${((Date.now() - infoStart) / 1000).toFixed(1)}s) | Screen: ${phoneScreenWidth}x${phoneScreenHeight}`);

    // Test screenshot
    const ssStart = Date.now();
    await maestro.screenshot();
    console.log(`[Setup] Screenshot OK (${((Date.now() - ssStart) / 1000).toFixed(1)}s)`);

    // Auto-detect apps from home screen
    console.log('[Setup] Detecting installed apps from home screen...');
    try {
      // Go to home screen first. Home is a hardware BUTTON (/pressButton), not a
      // keyboard key — /pressKey 400'd on it silently for months (the .catch hid it),
      // so app detection always ran against whatever app was foregrounded.
      await (maestro.pressButton ? maestro.pressButton('home') : maestro.pressKey('home')).catch(() => {});
      await sleep(500);
      const hier = await maestro.viewHierarchy();
      const hierText = hier.text || '';
      const detectedApps = [];
      try {
        const json = JSON.parse(hierText);
        function findApps(node) {
          if (!node) return;
          if (node.label && node.label.trim()) detectedApps.push(node.label.trim());
          if (node.children) node.children.forEach(findApps);
        }
        findApps(json?.axElement || json);
      } catch {}
      // Filter to likely app names (exclude noise like times, percentages, etc.)
      const appNoise = ['Dock', 'Search', 'Horizontal scroll bar', 'Vertical scroll bar', 'Current Location',
        'TOMORROW', 'Today', 'Utilities folder', 'Zoom lens', 'Location Services', 'High of', 'Low of'];
      const detected = [...new Set(detectedApps)].filter(name =>
        name.length > 1 && name.length < 30 &&
        !appNoise.some(n => name.includes(n)) &&
        !name.match(/^\d/) && !name.includes('°') && !name.includes('http') &&
        !name.includes('battery') && !name.includes('signal') && !name.includes('Wi-Fi') &&
        !name.includes('PM') && !name.includes('AM') && !name.includes('scroll bar')
      );
      // Add detected apps that aren't already in appMap
      for (const name of detected) {
        if (!appMap[name] && knownBundleIds[name]) {
          appMap[name] = knownBundleIds[name];
        }
      }
      console.log(`[Setup] Detected ${detected.length} apps on home screen, ${Object.keys(appMap).length} total with bundle IDs`);
    } catch (e) {
      console.log(`[Setup] App detection skipped: ${e.message}`);
    }
  } catch (e) {
    console.log(`[Setup] Direct HTTP failed: ${e.message}`);
    console.log('[Setup] Falling back to Maestro CLI (slower).');
  }
} else {
  // maestro-cli backend: use MCP server (slow baseline for comparison figures)
  console.log('[Setup] Starting Maestro MCP server (baseline)...');
  maestro = new MaestroMCP({ simUdid });
  const mcpStart = Date.now();
  await maestro.start();
  const device = await maestro.detectDevice();
  console.log(`[Setup] Maestro ready (${((Date.now() - mcpStart) / 1000).toFixed(1)}s) | Device: ${device.name}`);

  console.log('[Setup] Warming up device connection...');
  const warmStart = Date.now();
  try { await maestro.viewHierarchy(); } catch {}
  console.log(`[Setup] Device warmed up (${((Date.now() - warmStart) / 1000).toFixed(1)}s)`);
}

// Cleanup on exit
process.on('exit', () => maestro.stop());
process.on('SIGINT', () => { maestro.stop(); process.exit(0); });
process.on('SIGTERM', () => { maestro.stop(); process.exit(0); });

// ─── Tool definitions (built in tools.mjs; D4 extraction 2026-08) ───
const toolDefs = buildToolDefs({ appMap, isPhone, grounding });

// Native web search (2026-08): OpenAI (Responses API web_search tool) and
// Anthropic (server-side web_search_20250305) run search inside the provider —
// better-tuned per model, no Brave key needed. Drop the Brave webSearch
// function so the model never sees two search tools. Gemini + local keep
// Brave: Gemini's google_search grounding only composes with function calling
// on Gemini 3 models (docs, verified 2026-08-02), and local models have no
// server-side anything.
const nativeWebSearch = provider === 'openai' || provider === 'anthropic';
if (nativeWebSearch) {
  const idx = toolDefs.findIndex(t => t.name === 'webSearch');
  if (idx !== -1) {
    toolDefs.splice(idx, 1);
    console.log(`[Setup] Web search: native (${provider}) — Brave webSearch tool removed from registry`);
  }
} else {
  console.log(`[Setup] Web search: Brave tool (${provider} has no composable native search)`);
}


// Apply --disable-tools filter. Runs once at startup so both OpenAI and Claude
// tool-schema conversions below pick up the filtered list automatically.
if (disabledTools.length > 0) {
  const before = toolDefs.length;
  const removed = [];
  for (let i = toolDefs.length - 1; i >= 0; i--) {
    if (disabledTools.includes(toolDefs[i].name)) {
      removed.unshift(toolDefs[i].name);
      toolDefs.splice(i, 1);
    }
  }
  const unmatched = disabledTools.filter(n => !removed.includes(n));
  console.log(`[Setup] --disable-tools: removed ${removed.length > 0 ? removed.join(', ') : '(none matched)'} (${before} → ${toolDefs.length} tools)${unmatched.length > 0 ? ` | unknown names ignored: ${unmatched.join(', ')}` : ''}`);
}

const openaiTools = toolDefs.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));

// ─── Tool executor (tools.mjs; mutable state threaded via ctx getters — llm-client D2 pattern) ───
// pendingMemories must be declared BEFORE this ctx object is built: the D4 extraction
// originally referenced the declaration that lived down in the loop-state block (~line
// 1000), which is a temporal-dead-zone ReferenceError — every `node agent.mjs` run
// crashed at startup while `npm test` stayed green (the unit suites import modules,
// they never boot this file). Caught 2026-08-04; test-agent-smoke.mjs now guards it.
const pendingMemories = [];
const executeTool = createToolExecutor({
  isPhone, appMap, driverHost, driverPort, useDirectHttp,
  requestUserApproval, requestUserText, ASKUSER_TIMEOUT_SENTINEL, llmConfig,
  apiKey, modelName, disabledTools, pendingMemories,
  get maestro() { return maestro; },
  get simUdid() { return simUdid; },
  get currentAppId() { return currentAppId; },
  set currentAppId(v) { currentAppId = v; },
  get keyboardLikelyUp() { return keyboardLikelyUp; },
  set keyboardLikelyUp(v) { keyboardLikelyUp = v; },
  get askUserCalls() { return askUserCalls; },
  set askUserCalls(v) { askUserCalls = v; },
  get phoneScreenWidth() { return phoneScreenWidth; },
  get phoneScreenHeight() { return phoneScreenHeight; },
});

// ─── LLM client (llm-client.mjs) ───
// The whole provider-adaptation layer — LLM_CONFIG, isNonRecoverableAPIError,
// fetchLLMWithRetry (429/529/5xx backoff), the temperature 400-fallback, the
// Claude message/response conversion, and the no-tools JSON-action injection —
// now lives in llm-client.mjs, unit-tested in agent/test/nonrecoverable.test.mjs.
// All mutable state stays HERE and is threaded through getters, so importing
// llm-client.mjs never executes agent behavior.
const { callLLM } = createLLMClient({
  provider, modelName, apiKey, url: llmConfig.url, noToolsMode,
  toolDefs, openaiTools, nativeWebSearch,
  getTemperature: () => requestedTemperature,
  markTemperatureUnsupported,
  getSentImageSize: () => ({ w: lastSentImageWidth, h: lastSentImageHeight }),
});

// Runtime-guard LLM judge — calls the same provider/model as the planner
// with a simple system+user message pair, returns the raw text. Used by
// runtime-guard.mjs to implement Magentic-UI's "ActionGuard judge" stage.
// We pass the planner's messages-history shape (role + content) so callLLM
// reuses its existing per-provider handling (Claude system-block split,
// OpenAI/Gemini chat-completions, prompt-cache disable on this fresh call).
// ─── --assert-sql: post-run state assertion against the app's SQLite DB ───
// The engine (compareExpect + store discovery + WAL-aware query loop) now lives in
// sql-assert.mjs; this binds it to the run's flags. Verdict semantics unchanged.
const runAssertSql = () => runAssertSqlEngine({ assertSql, assertApp, assertDb, assertExpect, simUdid, runShell });

// ─── Terminal verdict: the DB assertion judges EVERY outcome, not just self-reported "done" ───
// Round-6: the assert used to run ONLY when the agent called taskComplete, so a task that genuinely
// succeeded but hit the step cap (because the agent didn't notice its own success) was falsely
// reported as a failure and the DB was never consulted. Now every terminal path (done / max-steps /
// abort / fail) calls assertOutcome() first — when an assert exists, the DB is the source of truth.
//   'pass' → SUCCESS regardless of step count   |   'fail' → FAILED regardless of the agent's claim
//   'skip' → no assert, or best-effort inconclusive → fall back to the path's own verdict
async function assertOutcome() {
  if (!assertSql) return 'skip';
  const ar = await runAssertSql();
  if (ar.inconclusive && assertBestEffort) { console.log(`  ⚠️  ASSERT INCONCLUSIVE (best-effort): ${ar.detail} — keeping the step/completion verdict`); return 'skip'; }
  console.log(ar.passed ? `  ✅ ASSERT PASS: ${ar.detail}` : `  ❌ ASSERT FAIL: ${ar.detail}`);
  return ar.passed ? 'pass' : 'fail';
}
// Per-phase wall-clock totals: "agent thinking" (t_llm) separately from "device
// I/O" (t_tools), so a slow task can be attributed to the model or to the phone.
// Screenshot/settle time is the remainder (time - tLlm - tTools) — derivable, not stored.
function timingTotals() {
  let tLlm = 0, tTools = 0;
  for (const s of stepTraces) {
    tLlm += s.aiTime || 0;
    for (const t of s.tools || []) tTools += t.time || 0;
  }
  return { tLlmS: +tLlm.toFixed(1), tToolsS: +tTools.toFixed(1) };
}

// Append one terminal record to logs/tasks.jsonl (success → summary, failure → reason).
function logTaskResult(success, msg, steps) {
  try {
    const logDir = join(STATE_DIR, 'logs'); mkdirSync(logDir, { recursive: true });
    const totalTime = ((Date.now() - totalStart) / 1000).toFixed(1);
    const rec = { timestamp: new Date().toISOString(), runId: logRunId ?? undefined, task, steps, time: totalTime, success, mode: agentMode, grounding, promptMode, guard: runtimeGuardPolicy, guardFired: guardApprovalsRequired, askUserCalls, timing: timingTotals(), inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: modelName, provider, temperature: effectiveTemperature, promptHash, trace: stepTraces, agentLogs };
    if (success) rec.summary = msg; else rec.reason = msg;
    appendFileSync(join(logDir, 'tasks.jsonl'), JSON.stringify(rec) + '\n');
  } catch (e) { console.error(`[History] FAILED to write task log: ${e.message}`); }
}
// A failure-side terminal path calls this FIRST: if the DB assertion passes, the task actually
// succeeded (the agent just didn't notice) → emit a success verdict + log + exit 0, and return true
// so the caller skips its own failure handling. Returns false to let the caller proceed as a failure.
async function dbOverrodeToSuccess(context, steps) {
  if (await assertOutcome() !== 'pass') return false;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ✅ TASK COMPLETED (DB-verified) — ${context}`);
  console.log(`  __DONE__: assert-sql confirmed the task succeeded (${context})`);
  console.log(`${'='.repeat(50)}`);
  logTaskResult(true, `assert-sql verified success (${context})`, steps);
  return true;
}

// Auto-dismiss the first-launch "<App> Would Like to Send You Notifications" system alert (round-6).
// It pops over a freshly-installed app and otherwise costs the agent ~1-2 steps (often what pushes a
// 3-action task over the cap). Tap "Allow" straight from the hierarchy — no LLM step spent. Scoped to
// NOTIFICATIONS only (lowest-risk, most common) and skipped when the TASK itself concerns permissions,
// so an intended Allow/Don't-Allow choice is never overridden.
let _notifDialogHandled = false;
async function autoDismissNotificationDialog() {
  if (_notifDialogHandled) return false;
  if (/notif|permission|\ballow\b|\bdeny\b|don.?t\s*allow/i.test(task)) return false;
  let root;
  try { root = JSON.parse((await maestro.viewHierarchy()).text || ''); root = root?.axElement || root; } catch { return false; }
  let hasNotifAlert = false, allowBtn = null;
  (function walk(n) {
    if (!n) return;
    const l = n.label || n.title || '';
    if (/Would Like to Send You Notifications/i.test(l)) hasNotifAlert = true;
    if (!allowBtn && (n.label === 'Allow' || n.title === 'Allow') && n.frame) allowBtn = n;
    (n.children || []).forEach(walk);
  })(root);
  if (!hasNotifAlert || !allowBtn) return false;
  const cx = Math.round(allowBtn.frame.X + allowBtn.frame.Width / 2), cy = Math.round(allowBtn.frame.Y + allowBtn.frame.Height / 2);
  try {
    if (useDirectHttp && maestro.touchPoint) await maestro.touchPoint(cx, cy);
    else {
      const header = currentAppId ? `appId: ${currentAppId}\n---\n` : 'appId: any\n---\n';
      await maestro.runFlow(`${header}- tapOn:\n    point: "${Math.round(cx / (useDirectHttp ? phoneScreenWidth : 402) * 100)}%, ${Math.round(cy / (useDirectHttp ? phoneScreenHeight : 874) * 100)}%"`);
    }
    console.log(`[Auto-dismiss] "Notifications" permission dialog → tapped Allow (no agent step spent)`);
    _notifDialogHandled = true;
    return true;
  } catch { return false; }
}

async function runtimeGuardJudge(messages) {
  // Fast-fail the JUDGE (maxRetries:1, not 8): it's a SECONDARY safety check, so a rate-limited
  // judge must NOT 8×-retry (~3 min) and dominate the run's budget. On 429 it fails quickly →
  // checkRuntimeGuard's catch → fail-open-smart (benign actions proceed). (Round-3 feedback #2.)
  const data = await callLLM(messages, { useTools: false, maxRetries: 1 });
  return data?.choices?.[0]?.message?.content || '';
}

// ─── Load persistent memory ───
const memDir = join(STATE_DIR, 'memories');
let memoryContext = '';
try {
  const memFile = join(memDir, 'user.md');
  if (existsSync(memFile)) {
    const content = readFileSync(memFile, 'utf-8').trim();
    if (content && content !== '# User Memory') {
      memoryContext = content;
      console.log(`[Memory] Loaded ${content.split('\n').length - 1} facts`);
    }
  }
} catch {}

// ─── System prompt ───
const systemPrompt = `<SYSTEM_CAPABILITY>
* You are an AI agent controlling an iPhone 15 Pro running iOS 26 (latest, with Liquid Glass design).
* You see real iOS screenshots and interact with native iOS apps via tool calls.
* You understand iOS UI patterns: translucent navigation bars at top, tab bars at bottom, swipe gestures, modal sheets, the status bar, the home indicator, and standard Apple app layouts.
* Coordinates are PERCENTAGES (0-100), NOT pixels. x=0 is left edge, x=100 is right edge, y=0 is top, y=100 is bottom.
* After EVERY action, a screenshot is auto-captured. Verify it worked before moving on — do NOT call takeScreenshot again if you already received one this step.
* For ASYNC results — a reply/message loading, search results, a network round-trip — call waitForText("expected text") to poll until it appears (one step), instead of repeatedly screenshotting to check if something finished loading. Do NOT re-confirm the same screen multiple times; use waitForText.
* ALWAYS chain multiple tool calls in a single response when they are independent. For example: openApp + takeScreenshot, tapText + inputText. Do NOT make one tool call per response when you can batch them. This is critical for speed.
* The current date is ${new Date().toLocaleDateString()}.
</SYSTEM_CAPABILITY>

${memoryContext ? `<USER_MEMORY>
${memoryContext}
Use these facts when relevant. Memory is read-only — do not attempt to modify it.
</USER_MEMORY>

` : ''}<AVAILABLE_APPS>
${appListStr}
</AVAILABLE_APPS>

<STRATEGY>
${isPhone ? `1. Use openApp to launch the right app for the task.
2. Every screenshot automatically includes UI elements with exact coordinates. Use these coordinates with tap(x, y) for precise tapping — do NOT guess coordinates from the screenshot.
2b. OCCLUSION WARNING: the element list does NOT know what the keyboard covers. When the keyboard is visible in the screenshot (it appears after typing), any listed element in the bottom ~45% of the screen may be BEHIND the keyboard — tapping its coordinates will press a KEY instead (corrupting your text). Call hideKeyboard FIRST, take note of the refreshed layout, then tap.
3. If you need to refresh UI elements without a screenshot, call getUIElements.
4. After completing actions: takeScreenshot to VERIFY the task is actually done, then taskComplete.
NOTE: This is a PHYSICAL iPhone. Deep link shortcuts (searchMaps, googleSearch, openURL) will open the app but you must then navigate the UI manually.`
: `1. Use INSTANT tools when possible: searchMaps, googleSearch, openURL, getDirections, composeMessage, setAppearance, setLocation. These complete in one step.
2. Every screenshot automatically includes UI elements with exact coordinates. Use these coordinates with tap(x, y) for precise tapping — do NOT guess coordinates from the screenshot.
2b. OCCLUSION WARNING: the element list does NOT know what the keyboard covers. When the keyboard is visible in the screenshot (it appears after typing), any listed element in the bottom ~45% of the screen may be BEHIND the keyboard — tapping its coordinates will press a KEY instead (corrupting your text). Call hideKeyboard FIRST, take note of the refreshed layout, then tap.
3. If you need to refresh UI elements without a screenshot, call getUIElements.
4. Use takeScreenshot only when you need to visually verify the result.
5. After instant tools or completing actions: takeScreenshot to verify, then taskComplete.`}
</STRATEGY>

${pmConventions ? `<IOS_CONVENTIONS>
General iOS navigation priors — use when the view hierarchy is ambiguous or multiple elements could match. The hierarchy is always the source of truth; these are only priors for when it is not.
- Back navigation: chevron in the top-left corner, or swipe from the left edge.
- Tab bar: 3–5 icons at the bottom of the screen; switches the app's main sections.
- Settings / more: usually a gear icon in the top-right, sometimes "..." (three dots), or the user's avatar.
- Profile / account: often the user's avatar — typically top-left in social apps (Instagram, LinkedIn, X), top-right in productivity apps (Gmail, Slack).
- Search: magnifier icon usually top-right, or pull down on a scroll view to reveal a search bar.
- Action sheets and share menus: slide up from the bottom of the screen.
- Pull-to-refresh: swipe down from the top of any scrollable list.
- Keyboard dismiss: tap outside the text field, or swipe down on the keyboard.
- Destructive actions (Delete, Remove, Sign Out): typically shown in red text.
- Floating compose/new buttons: typically a filled circle in the bottom-right corner.
</IOS_CONVENTIONS>

` : ''}${pmIosHints ? `<IMPORTANT>
* iOS Messages: the SEND button is a BLUE UP-ARROW circle INSIDE the text input bar on the far right. Its position changes when the keyboard is open — always use coordinates from the auto-bundled UI elements, NOT hardcoded values. Do NOT tap the text effects/formatting button. To message a specific contact, find their existing conversation first — do NOT tap "New Message" unless they have no existing thread.
* iOS Photos: the MOST RECENT photo/image is at the BOTTOM-RIGHT of the grid. Scroll DOWN first if needed.
* iOS Maps: the search bar is at the BOTTOM of the screen, not the top.
</IMPORTANT>

` : ''}<RULES>
- If the same action fails 2 times with no change, your coordinates are WRONG. Check the UI elements list bundled with the screenshot for exact coordinates, or scroll to reveal hidden elements, or try a completely different approach.
${isPhone ? '- Use openApp to launch apps, then navigate UI with tap/tapText/inputText' : '- Prefer instant tools over tapping'}
- Prefer using tap(x, y) with coordinates from the auto-bundled UI elements list. These coordinates come directly from the view hierarchy and are exact.
- Use tapText when you know the exact accessibility text. Use getUIElements only if you need to refresh the element list without taking a screenshot.
- CHANGING A FIELD VALUE: to set/edit/replace text that a field ALREADY contains, use replaceText(field, value) — it focuses, clears, and types in one step. Do NOT use inputText for this: inputText only APPENDS, so you end up with "oldvalue"+"newvalue" and then waste steps trying to select-all and delete. inputText is only for an empty/freshly-focused field.
- SYSTEM PERMISSION DIALOGS: a system popup (Allow Notifications / Tracking / Location / Contacts), usually right after first launch, is NOT part of your task. Dismiss it in ONE tap — tap "Allow" / "Allow While Using" (or "Don't Allow" only if the task implies declining) — then continue. Don't deliberate over it or let it derail the task.
- BEFORE calling taskComplete, you MUST takeScreenshot and verify the task is actually done on screen.
- If the task asks for INFORMATION (a count, a name, a price, any value) and the answer is visible on the current screen, call taskComplete IMMEDIATELY with the answer in the summary. NEVER state the answer as plain text without a tool call — that wastes a full extra step re-deriving what you already know.
- SCREEN UNDERSTANDING (do this BEFORE every action on a new or changed screen): (1) Describe what app/screen you see, (2) Read ALL visible text — especially instructions, labels, and placeholders, (3) Identify interactive elements — text fields, buttons, toggles — from the UI elements list, (4) Determine the correct interaction: should you tap, type, scroll, or something else? Only THEN choose your action. This is critical for unfamiliar apps, games, and non-standard interfaces.
- UNFAMILIAR APPS: If after reading the screen you still don't understand how to interact, use webSearch to look up how the app works BEFORE acting. Do NOT blindly tap UI elements.
- GAMES: When playing any game, BEFORE your first move: (1) webSearch for strategy tips specific to this game, (2) SCAN the full screen — identify your resources, cards, pieces, score, and the opponent's state, (3) Plan your first move in 1 sentence, then act. For real-time games: DEFEND FIRST — if under attack, counter the threat before attacking. Never cap resources — if at max, spend immediately. Speed over perfection. Do NOT call takeScreenshot between actions — execute 2-3 actions in one response, then the auto-captured screenshot after your last action is your verification. Use it in the next step to verify AND plan. For card games like Clash Royale: ALWAYS use drag to deploy cards directly from your hand to the arena — never tap-select-tap-place. Batch 2-3 drags per response. For turn-based/puzzle games: think 2-3 moves ahead, eliminate impossible options first, track what you've tried — never repeat a failed move.
- WEB SEARCH: For factual information (weather, scores, prices, news, how-to, definitions), ALWAYS use webSearch first — it returns results in 0.6s without leaving the current app. Do NOT open Safari, Weather, or any other app just to look up information that webSearch can provide. Only navigate to an app when the task requires YOUR personal data (your calendar, your photos, your messages, your contacts) that isn't available on the web. NEVER open result URLs on the device — read the search results from the tool response.
- CRITICAL — askUser RULES: The user's command IS the confirmation. If they said "text Emiliano hello", JUST DO IT — do NOT ask "do you want to send this?" Only call askUser when: (1) contact is ambiguous (multiple people match), (2) purchases or payments, (3) deleting data, (4) the task is genuinely vague and you need clarification. NEVER re-confirm an explicit command. NEVER parrot the task back as a question.
- askUser vs askUserText: Use askUser (closed, with options array) when the answer is a small enumerable set — Yes/No, pick-this-contact, pick-this-category. Use askUserText (freeform, with optional hint) when the answer is open — email address, OTP code, search string, password, any text the user has to type. NEVER call askUser with a freeform question and no real options; that produces an unanswerable prompt for the user. If you're tempted to write options like ["Type the answer manually", "Cancel"], that's a sign you should be calling askUserText instead.
- MEMORY: User facts are loaded from memory at startup. Use them when relevant.${grounding === 'grid' ? `
- GRID OVERLAY: The screenshot has yellow grid lines at every 10% with labels at 20%, 40%, 60%, 80%. Use these to estimate tap coordinates accurately.` : ''}${grounding === 'zoomclick' ? `
- ZOOM TAP: When you need to tap a SMALL icon or when elements are close together, use zoomAndTap instead of tap for precise targeting.` : ''}
</RULES>${pmSafetyTags ? `

<REQUIRES_CONFIRMATION>
Call askUser BEFORE executing any of these, even mid-flow:
- payments, purchases, money transfers, or entering payment credentials
- sending anything visible to another person (message, email, post, reaction) UNLESS the task explicitly commands sending it
- deleting user data (contacts, calendar events, files, photos, message threads)
- account or security changes (passwords, 2FA, sign-out, permission grants)
- system-wide settings changes that outlive this task
</REQUIRES_CONFIRMATION>

<NEVER_DO>
- never enter passwords, OTP codes, or full card numbers yourself — use askUserText and let the user provide or decline
- never confirm an Apple Pay / payment sheet
- never erase, factory-reset, or sign out of the device or an account
</NEVER_DO>

<TAKEOVER_REQUIRED>
Hardware confirmations (Face ID, Touch ID, double-click side button for Apple Pay) can only be performed by the human. Announce via askUser and stop — do not attempt to bypass.
</TAKEOVER_REQUIRED>

Before EVERY action, silently classify your intent as one of: read | navigate | write | destructive | financial. If the intent is destructive or financial and the task did not explicitly command that exact action, call askUser first.` : ''}${agentMode === 'vision-gated' ? `

<VISION_GATE>
Screenshots are only allowed when the screen content changes (detected via UI hierarchy hashing), on step 1, after errors, when stuck, or every ${visionEveryK} steps as a safety fallback. If your takeScreenshot call is denied, use getUIElements instead. Save takeScreenshot for verifying task completion.
</VISION_GATE>` : ''}`;

// ─── Hierarchy helpers (for hash-based vision gate) ───
const hierarchyNoise = ['scroll bar', 'battery', 'Cellular', 'Wi-Fi bars', 'PM', 'AM', 'No signal', 'Not charging', 'signal strength', 'battery power', 'location services', 'Location tracking'];

function flattenHierarchy(text) {
  const labels = [];
  // Try JSON format first
  try {
    const json = JSON.parse(text);
    function collect(node) {
      if (!node) return;
      if (node.label && node.label.trim()) {
        const l = node.label.trim();
        if (!hierarchyNoise.some(n => l.includes(n)) && !labels.includes(l)) labels.push(l);
      }
      if (node.children) node.children.forEach(collect);
    }
    collect(json?.axElement || json);
    if (labels.length > 0) return labels;
  } catch {}
  // Fall back to CSV/regex
  for (const m of text.matchAll(/accessibilityText[="] *:? *"?([^";,\n]+)/g)) {
    const label = m[1].trim();
    if (!label) continue;
    if (hierarchyNoise.some(n => label.includes(n))) continue;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

function hashLabels(labels) {
  return [...labels].sort().join('|');
}

// ─── Token accounting (covers procedure-matching, main loop, and procedure-extraction) ───
let totalInputTokens = 0;
let totalOutputTokens = 0;

// ─── Procedural memory: match before loop ───
let matchedProcedure = null;
let procedureContext = '';
if (!noProcedures) {
  const procCount = procedures.getCount();
  if (procCount > 0) {
    console.log(`[Procedures] Checking ${procCount} procedures for match...`);
    const matchPrompt = procedures.buildMatchingPrompt(task);
    if (matchPrompt) {
      try {
        const matchData = await callLLM([{ role: 'user', content: matchPrompt }], { useTools: false });
        totalInputTokens += matchData.usage?.prompt_tokens || 0;
        totalOutputTokens += matchData.usage?.completion_tokens || 0;
        const matchContent = matchData.choices?.[0]?.message?.content || '';
        const matched = procedures.parseMatch(matchContent);
        if (matched) {
          matchedProcedure = matched;
          procedureContext = procedures.promptInjection(matched);
          console.log(`[Procedures] Matched: "${matched.pattern}" (reliability: ${Math.round(matched.successCount / (matched.successCount + matched.failCount) * 100)}%)`);
        } else {
          console.log(`[Procedures] No match found`);
        }
      } catch (e) {
        console.log(`[Procedures] Match check failed: ${e.message}`);
      }
    }
  } else {
    console.log(`[Procedures] No procedures stored yet`);
  }
} else {
  console.log(`[Procedures] Disabled`);
}

// ─── Agent loop ───
let finalSystemPrompt = procedureContext ? `${systemPrompt}\n\n${procedureContext}` : systemPrompt;
// plain mode: strip the XML section tags (content identical, structure removed) —
// isolates the STRUCTURE variable of the prompt-mode ablation. Only our ALL-CAPS
// section tags match; inline lowercase mentions (e.g. the word "<intent>") survive.
if (!pmStructured) {
  finalSystemPrompt = finalSystemPrompt.replace(/<\/?[A-Z][A-Z_0-9]*>/g, '').replace(/\n{3,}/g, '\n\n');
}
// Tool-less models get the tool list + the JSON-action protocol described in-prompt, since
// no `tools` param is sent to them (callLLM parses the JSON they emit back into tool_calls).
if (noToolsMode) {
  const toolList = toolDefs.map(t => `- ${t.name}(${Object.keys(t.parameters?.properties || {}).join(', ')}) — ${t.description}`).join('\n');
  finalSystemPrompt += `\n\n<NO_FUNCTION_CALLING>
You CANNOT call functions directly. Respond with EXACTLY ONE JSON object and NOTHING else — no prose, no markdown fences. Use the EXACT tool name from the list and put arguments nested under "args" with the EXACT argument names shown.
Examples (copy this format precisely):
  to open an app:      {"tool": "openApp", "args": {"appName": "Settings"}}
  to tap a point:      {"tool": "tap", "args": {"x": 50, "y": 50}}
  to type text:        {"tool": "inputText", "args": {"text": "hello"}}
  when finished:       {"tool": "taskComplete", "args": {"summary": "..."}}
Coordinates are PERCENTAGES (0-100). Pick the single best next action. Available tools — use these EXACT names:
${toolList}
</NO_FUNCTION_CALLING>`;
}

// Prompt provenance (B3): sha256 of the FULLY-assembled system prompt — post prompt-mode /
// backend / procedure / no-tools branches. Logged in every tasks.jsonl record so any
// result is tied to the exact prompt text it ran with. First 12 hex chars (48 bits).
const promptHash = createHash('sha256').update(finalSystemPrompt).digest('hex').slice(0, 12);

// Capture initial screenshot so the AI sees what's currently on screen
let initialUserContent = task;
// Dismiss a first-launch notification-permission alert BEFORE the initial screenshot is captured, so
// the LLM never sees the dialog and can't waste step 1 tapping it (round-7: the auto-dismiss was racing
// the first screenshot — it tapped Allow, but the agent had already seen the dialog and tapped Don't Allow).
try { await autoDismissNotificationDialog(); } catch {}
try {
  console.log('[Initial] Capturing current screen...');
  const ssResult = useDirectHttp ? await maestro.screenshot() : null;
  const hierResult = await maestro.viewHierarchy();
  if (ssResult) {
    let buffer = Buffer.from(ssResult.data, 'base64');
    // Unify step-0 with the per-step pipeline: rotate landscape upright, then compress to
    // 768px — so the model sees the SAME geometry on step 0 as every later step, and the
    // local-adapter's pixel→% conversion has one consistent width. (Audit #11: the initial
    // shot previously shipped as a raw, uncompressed, unrotated PNG.)
    try {
      let di = null; try { di = await maestro.deviceInfo(); } catch {}
      if (di && di.widthPoints > di.heightPoints) {
        const m = await sharp(buffer).metadata();
        if (m.height > m.width) buffer = await sharp(buffer).rotate(LANDSCAPE_ROTATE_DEG).toBuffer();
      }
      if (useCompression) {
        const m = await sharp(buffer).metadata();
        if (m.width > 768) buffer = await sharp(buffer).resize(768, null, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
      }
    } catch (e) { console.log(`[Initial] image processing skipped: ${e.message}`); }
    const meta = await sharp(buffer).metadata().catch(() => ({ width: 768, height: 768 }));
    lastSentImageWidth = meta.width; lastSentImageHeight = meta.height;
    const b64 = buffer.toString('base64');
    const imgMime = buffer[0] === 0xFF && buffer[1] === 0xD8 ? 'image/jpeg' : 'image/png';
    const hText = hierResult?.text || '';
    saveTraceStep(0, buffer, hText ? `initial hierarchy:\n${hText.slice(0, 20000)}` : '');
    const labels = flattenHierarchy(hText);
    const elemText = labels.length > 0 ? `\n\nUI elements on screen:\n${capElementList(labels.map(l => `- "${l}"`)).join('\n')}` : '';
    initialUserContent = [
      { type: 'image_url', image_url: { url: `data:${imgMime};base64,${b64}` } },
      { type: 'text', text: `Task: ${task}\n\nThis is what is currently on my screen. If the task can be completed from here, do it directly — do NOT open another app unless needed.${elemText}` },
    ];
    console.log(`[Initial] Screenshot (${meta.width}x${meta.height}${useCompression ? ', compressed' : ''}) + ${labels.length} elements captured`);
  }
} catch (e) {
  console.log(`[Initial] Screenshot failed (${e.message}), starting with text only`);
}

const messages = [
  { role: 'system', content: finalSystemPrompt },
  { role: 'user', content: initialUserContent },
];
const totalStart = Date.now();
const stepTraces = [];

console.log(`\n${'='.repeat(50)}`);
console.log(`  Task:      ${task}`);
console.log(`  Model:     ${modelName} (${provider})`);
console.log(`  Max Steps: ${maxSteps}`);
console.log(`  Apps:      ${Object.keys(appMap).length} detected`);
console.log(`  Device:    ${isPhone ? 'Physical iPhone' : 'iOS Simulator'}`);
console.log(`  Grounding: ${grounding}${useCompression ? ' + compress' : ''}`);
console.log(`  Temp:      ${effectiveTemperature} · prompt-hash ${promptHash}`);
console.log(`  Prompt:    ${promptMode} (structured=${pmStructured} iosHints=${pmIosHints} conventions=${pmConventions} safetyTags=${pmSafetyTags})`);
const modeLabel = agentMode === 'baseline' ? '(all screenshots kept)'
  : agentMode === 'vision-gated' ? `(vision gated, hash-based + every ${visionEveryK} steps fallback)`
  : '(single image + rolling summary)';
console.log(`  Mode:      ${agentMode} ${modeLabel}`);
console.log(`  Guard:     ${runtimeGuardPolicy}${runtimeGuardPolicy === 'off' ? '' : ' (Magentic-UI Action Guard pattern)'}`);
// Unattended footgun (round-5 #5b): the guard pauses on a risky action to ask for approval. With no
// human AND no askUser timeout, that pause hangs the whole run. The MCP/audit surfaces already default
// the guard off + set a timeout; this warns anyone running the bare CLI unattended. (We do NOT flip
// the CLI default — for an interactive operator the guard is a wanted safety net.)
if (runtimeGuardPolicy !== 'off' && askUserTimeoutMs === 0) {
  console.log(`  ⚠ Running unattended? The guard can pause for approval that never comes → the run hangs. Pass --runtime-guard off, or --askuser-timeout <seconds> to auto-proceed.`);
}
if (matchedProcedure) console.log(`  Procedure: "${matchedProcedure.pattern}"`);
console.log(`${'='.repeat(50)}\n`);

const stepLog = [];
const stuckDetector = createStuckDetector();
const agentLogs = [];
const _originalLog = console.log;
console.log = (...args) => {
  const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  agentLogs.push(line);
  _originalLog(...args);
};
const rollingSummary = [];
let visionSteps = 0;
let gatedSteps = 0;
let prevScreenHash = null;
let currentUILabels = [];
let prevScreenSig = null;       // content signature of the on-screen element labels (no-progress detection)
let unchangedScreenCount = 0;   // drives the mid-run NUDGE (read screen / webSearch) — resets after firing
let noProgressStreak = 0;       // consecutive identical-screen steps → drives the hard CIRCUIT BREAKER (does NOT reset on nudge)
let recentSigs = [];            // rolling window of recent screen signatures → catches OSCILLATION/thrash (screen changes each step but bounces among ≤2 states with no real progress; round-5)

let consecutiveErrorSteps = 0;  // circuit breaker: abort fast if the device transport dies mid-run
let transportDiedAtStep = 0;    // >0 → the breaker fired; post-loop exits 43 (infra) instead of logging a fake task failure
for (let step = 1; step <= maxSteps; step++) {
  // Stuck detection (stuck-detector.mjs, 2026-08-04): normalized action keys over a
  // rolling window with escalating nudges (3/5/8), plus the original 3-consecutive
  // signal. The old inline check compared raw arg-JSON of ONLY the last 3 actions,
  // so alternating thrash (tap → type → hideKeyboard → tap …) sailed through a
  // whole 12-step run undetected (observed live).
  const stuckAssessment = stuckDetector.assess();
  const stuckThisStep = stuckAssessment.stuck;
  if (stuckAssessment.nudge) {
    console.log(`[Stuck] ${stuckThisStep ? 'STUCK' : 'repeat-nudge'} — injecting guidance`);
    messages.push({ role: 'user', content: stuckAssessment.nudge });
  }

  // Vision gate: decide if screenshots are allowed this step
  let visionAllowed = true;
  if (agentMode === 'vision-gated') {
    const hashChanged = prevScreenHash === null || hashLabels(currentUILabels) !== prevScreenHash;
    const emptyHierarchy = currentUILabels.length === 0;
    visionAllowed = (step === 1) || emptyHierarchy || hashChanged || stuckThisStep || (step % visionEveryK === 0);
    if (step > 1) {
      console.log(`[Vision Gate] hash ${hashChanged ? 'CHANGED' : 'same'} | ${currentUILabels.length} labels | ${visionAllowed ? 'VISION' : 'GATED'}`);
    }
  }

  const stepStart = Date.now();
  const elapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  const entry = { step, aiTime: 0, tools: [] };
  console.log(`\n--- Step ${step}/${maxSteps} (${elapsed}s total) ---`);

  // Dismiss a first-launch notification-permission alert for free, before the LLM spends a step on it.
  // Scoped to the early launch window (the alert appears right after an app first opens).
  if (step <= 4 && !_notifDialogHandled) await autoDismissNotificationDialog();

  // Inject rolling summary + UI labels as context (single-image and vision-gated modes).
  // APPENDED at the tail, not spliced at index 2 (2026-08-04): the old head-insertion
  // rewrote message position 2 every step, which invalidated the provider's prompt-cache
  // prefix for the ENTIRE conversation on every call. Tail placement keeps the shared
  // prefix byte-stable (only the last few messages change step-over-step) and puts the
  // action history right next to the screenshot the model is about to reason over.
  if ((agentMode === 'single-image' || agentMode === 'vision-gated') && (rollingSummary.length > 0 || currentUILabels.length > 0)) {
    // Remove the previous context message (it lives near the tail, so this only
    // dirties the last few positions, not the head).
    const prevIdx = messages.findIndex(m => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[Context]'));
    if (prevIdx !== -1) messages.splice(prevIdx, 1);
    let ctx = '';
    // Cap the replayed history at the last 20 steps — on long runs the summary
    // itself was an unbounded per-step token tax.
    const summaryView = rollingSummary.length > 20
      ? [`(… ${rollingSummary.length - 20} earlier steps elided …)`, ...rollingSummary.slice(-20)]
      : rollingSummary;
    if (rollingSummary.length > 0) ctx += `Action history:\n${summaryView.join('\n')}`;
    if (currentUILabels.length > 0) ctx += `${ctx ? '\n\n' : ''}Current screen elements:\n${currentUILabels.map(l => `- "${l}"`).join('\n')}`;
    messages.push({ role: 'user', content: `[Context] ${ctx}` });
  }

  // Forced-done final step (2026-08-04, browser-use pattern): on the last step the
  // model receives ONLY taskComplete/taskFailed plus an explicit "conclude now"
  // instruction, so every run ends with the agent's own verdict instead of silent
  // budget exhaustion (previously the #1 shape of unexplained max-steps failures:
  // the agent never even considered whether the task was feasible).
  const finalStep = step === maxSteps;
  if (finalStep) {
    console.log('[Final step] Restricting tools to taskComplete/taskFailed — the agent must conclude.');
    messages.push({ role: 'user', content: 'FINAL STEP — your step budget ends with this response. You MUST conclude now: call taskComplete with a summary ONLY if the task is verifiably done on the current screen, otherwise call taskFailed explaining exactly what was accomplished, what remains, and why (including if the task is impossible on this device). No other tools are available.' });
  }

  // Call LLM
  const aiStart = Date.now();
  console.log(`[AI] Sending to ${modelName}...`);
  let data;
  try {
    data = await callLLM(messages, finalStep ? { onlyTools: ['taskComplete', 'taskFailed'] } : {});
  } catch (e) {
    // Non-recoverable (auth/billing/quota): abort the WHOLE run now. Looping would
    // burn every step on a dead API and record it as the agent FAILING the task.
    // Exit 42 means "errored, not failed". We deliberately log NO tasks.jsonl result
    // here — an infra outage must not leave a task-failure record.
    if (e.nonRecoverable) {
      // Distinguish a RATE/TIER limit (429/529 that survived every retry) from a true
      // auth/billing problem. They demand opposite fixes: the former = slow down / raise
      // tier (credits are fine); the latter = add credits / fix the key. Conflating them
      // sent the user to "add credits" right after they'd refilled — misleading.
      const rateLimited = e.status === 429 || e.status === 529;
      const providerIncident = [500, 502, 503, 504].includes(e.status);
      const networkErr = e.status === 0;
      console.log(`\n[FATAL] ${rateLimited ? 'Rate/tier limit exhausted' : providerIncident ? 'Provider incident (5xx) exhausted retries' : networkErr ? 'Network/transport failure' : 'Non-recoverable API error'} — aborting this run (exit 42 → ERRORED, excluded from pass@1).`);
      console.log(`[FATAL] ${e.message}`);
      if (rateLimited) {
        console.log(`[FATAL] Provider "${provider}" (env ${llmConfig.keyEnv}) kept returning ${e.status} after retries — a PER-MINUTE rate/tier limit, NOT a billing problem (credits are fine).`);
        console.log(`[FATAL] Fix: raise the API tier, pace the run (fewer cells / longer gaps), or stop other clients sharing this org's tokens-per-minute limit — then re-run.`);
      } else if (providerIncident) {
        console.log(`[FATAL] Provider "${provider}" kept returning ${e.status} after retries — a provider-side outage/incident, NOT billing and NOT a task failure. Check the provider's status page and re-run later.`);
      } else if (networkErr) {
        console.log(`[FATAL] The LLM request kept timing out / failing (network blip, or the machine slept mid-call) after retries — transient infra, NOT billing or a task failure. Just re-run.`);
      } else {
        console.log(`[FATAL] This is an auth/billing/quota problem with provider "${provider}" (env ${llmConfig.keyEnv}), NOT a task failure.`);
        console.log(`[FATAL] Fix the account (add credits / check the API key), then re-run.`);
      }
      maestro.stop();
      process.exit(42);
    }
    console.log(`[AI] ERROR: ${e.message}`);
    await sleep(2000);
    continue;
  }

  const msg = data.choices?.[0]?.message;
  if (!msg) { console.log('[AI] No response'); continue; }

  entry.aiTime = (Date.now() - aiStart) / 1000;
  totalInputTokens += data.usage?.prompt_tokens || 0;
  totalOutputTokens += data.usage?.completion_tokens || 0;
  const cacheWrite = data.usage?.cache_creation_input_tokens ?? 0;
  const cacheRead = data.usage?.cache_read_input_tokens ?? 0;
  const cacheTag = (cacheWrite || cacheRead) ? ` | Cache: ${cacheRead} read / ${cacheWrite} write` : '';
  console.log(`[AI] Responded in ${entry.aiTime.toFixed(1)}s | Tokens: ${data.usage?.prompt_tokens ?? '?'} in / ${data.usage?.completion_tokens ?? '?'} out${cacheTag}`);

  if (msg.content) console.log(`[AI] ${msg.content.slice(0, 200)}`);

  // Process tool calls
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    messages.push(msg);

    let needsScreenshot = false;
    let needsSettleDelay = false;
    let isDone = false;
    let isFailed = false;
    let doneMsg = '';
    let errorThisStep = false;
    const stepToolTraces = [];

    for (const tc of msg.tool_calls) {
      const toolName = tc.function.name;
      let toolArgs;
      try {
        toolArgs = JSON.parse(tc.function.arguments);
      } catch {
        // Model-authored garbage must not crash the whole run:
        // feed the parse failure back as the tool result so the model corrects itself
        // next step. NOT errorThisStep — that counter means TRANSPORT death (exit 43),
        // and a babbling model is not a dead runner.
        console.log(`[Tool] ${toolName}: malformed JSON arguments (${String(tc.function.arguments).slice(0, 80)}) — telling the model`);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'ERROR: your tool arguments were not valid JSON. Re-issue the call with valid JSON arguments.' });
        continue;
      }
      console.log(`[Tool] ${toolName}(${JSON.stringify(toolArgs)})`);
      stuckDetector.record(toolName, toolArgs);

      let result;
      const execStart = Date.now();
      try {
        // Runtime-guard check (Magentic-UI Action Guard, §6.4 of arXiv:2507.22358).
        // Two-stage gate: per-tool tag (deterministic) → if "maybe", LLM judge
        // (uses the planner's provider) decides whether to ask the user.
        // The judge's "Visible UI text" context + the auto-permissive PAYMENT_SIGNAL
        // check must see the ACTUAL screen, not the planner's reasoning — so pull the
        // text from the most-recent USER message (UI hierarchy is bundled with the
        // screenshot there), NOT msg.content (the assistant's own thoughts).
        let approvalGranted = true;
        if (runtimeGuardPolicy !== 'off') {
          const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
          let screenText = '';
          if (lastUserMsg) {
            screenText = typeof lastUserMsg.content === 'string'
              ? lastUserMsg.content
              : (Array.isArray(lastUserMsg.content)
                  ? lastUserMsg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
                  : '');
          }
          const guardCtx = { recentScreenText: screenText.slice(-2000) };
          const guardResult = await checkRuntimeGuard({
            toolName,
            toolArgs,
            context: guardCtx,
            judgeLLM: runtimeGuardJudge,
            policy: runtimeGuardPolicy,
          });
          if (guardResult.requiresApproval) {
            guardApprovalsRequired++;
            console.log(`[Guard] Requiring approval for ${toolName} — source: ${guardResult.source}`);
            const userChoice = await requestUserApproval(
              `Confirm action: ${formatActionForUser(toolName, toolArgs)}`,
              ['Yes, proceed', 'No, cancel'],
            );
            approvalGranted = userChoice === 'Yes, proceed';
          }
        }

        if (!approvalGranted) {
          result = `Action denied by user via runtime guard. The action "${formatActionForUser(toolName, toolArgs)}" was NOT executed. Reconsider the task or call askUser to clarify what to do next.`;
          console.log(`[Guard] User declined ${toolName} — action cancelled.`);
        } else {
          result = await executeTool(toolName, toolArgs);
        }
        const execMs = Date.now() - execStart;
        const execTime = (execMs / 1000).toFixed(1);

        if (result === '__SCREENSHOT__') {
          // Vision gate: check if screenshot is allowed this step
          const hasTaskComplete = msg.tool_calls.some(t => t.function.name === 'taskComplete');
          const gateOverride = hasTaskComplete || errorThisStep;
          if (agentMode === 'vision-gated' && !visionAllowed && !gateOverride) {
            needsScreenshot = false;
            result = '[Vision gated] Screenshot skipped this step. Use getUIElements to see what is on screen instead.';
            entry.tools.push({ name: toolName, time: execMs / 1000, gated: true });
            entry.visionGated = true;
            gatedSteps++;
            console.log(`[Tool] → takeScreenshot GATED (step ${step}, next vision at step ${Math.ceil(step / visionEveryK) * visionEveryK})`);
          } else {
            needsScreenshot = true;
            result = 'Screenshot taken';
            entry.tools.push({ name: toolName, time: execMs / 1000 });
            if (agentMode === 'vision-gated') visionSteps++;
            console.log(`[Tool] → takeScreenshot (${execTime}s)`);
          }
        } else if (result.startsWith('__DONE__:')) {
          isDone = true;
          doneMsg = result.slice(9);
          result = doneMsg;
          console.log(`[Tool] → DONE: ${doneMsg}`);
        } else if (result.startsWith('__FAILED__:')) {
          isFailed = true;
          doneMsg = result.slice(11);
          result = doneMsg;
          console.log(`[Tool] → FAILED: ${doneMsg}`);
        } else {
          entry.tools.push({ name: toolName, time: execMs / 1000 });
          // Don't log full UI element lists — too noisy
          if (toolName === 'getUIElements') {
            const count = (result.match(/^- "/gm) || []).length;
            console.log(`[Tool] → Found ${count} elements (${execTime}s)`);
          } else {
            console.log(`[Tool] → ${result} (${execTime}s)`);
          }
          // Auto-capture: action tools automatically trigger a screenshot
          // drag + zoomAndTap MUST be here: they change visible state (card placed, shape
          // drawn, region zoomed), so without an auto-screenshot the model acts blind on
          // the next step — silently corrupting drawing/drag_game scores on every backend.
          const actionTools = ['openApp', 'tap', 'tapText', 'inputText', 'pressKey', 'scroll', 'swipe', 'drag', 'zoomAndTap', 'typeAndSubmit', 'hideKeyboard'];
          if (actionTools.includes(toolName) && !needsScreenshot) {
            needsScreenshot = true;
            // Track if this was a navigation action (needs settle delay for iOS animations)
            const navActions = ['tap', 'tapText', 'scroll', 'swipe', 'drag', 'zoomAndTap', 'typeAndSubmit'];
            if (navActions.includes(toolName)) needsSettleDelay = true;
            console.log(`[Auto-capture] Screenshot queued after ${toolName}`);
          }
        }
      } catch (e) {
        const execMs = Date.now() - execStart;
        result = `Error: ${e.message}`;
        entry.tools.push({ name: toolName, time: execMs / 1000, error: true });
        errorThisStep = true;
        console.log(`[Tool] → ERROR: ${e.message} (${(execMs / 1000).toFixed(1)}s)`);
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });

      // Record structured trace for procedural memory
      const traceableTools = ['openApp', 'tap', 'tapText', 'inputText', 'pressKey', 'scroll', 'swipe', 'typeAndSubmit', 'hideKeyboard', 'webSearch'];
      if (traceableTools.includes(toolName)) {
        const traceArgs = {};
        for (const [k, v] of Object.entries(toolArgs)) traceArgs[k] = String(v);
        let traceTarget = null;
        if (toolName === 'tapText') traceTarget = toolArgs.text;
        else if (toolName === 'openApp') traceTarget = toolArgs.appName || toolArgs.bundleId;
        else if (toolName === 'typeAndSubmit') traceTarget = toolArgs.elementText;
        else if (toolArgs.description) traceTarget = toolArgs.description;
        stepToolTraces.push({
          tool: toolName,
          args: traceArgs,
          result: (result || '').slice(0, 100),
          target: traceTarget,
          time: (Date.now() - execStart) / 1000,
        });
      }
    }

    // Collect step trace
    if (stepToolTraces.length > 0) {
      stepTraces.push({ step, tools: stepToolTraces, aiTime: entry.aiTime });
    }

    // Circuit breaker: if the device transport (XCTest runner / bridge) dies mid-run, EVERY tool
    // call errors and each failed XCTest call waits ~30s. Don't burn the whole step budget against
    // a dead transport — bail after a few consecutive all-error steps so the caller (an audit, a
    // script) can fall back / move on. A successful step resets the counter. (The startup probe
    // already catches a transport that's down BEFORE the run; this catches death DURING it.)
    if (errorThisStep) {
      consecutiveErrorSteps++;
      if (consecutiveErrorSteps >= 4) {
        transportDiedAtStep = step;
        console.log(`\n  ❌ INFRA: device transport unreachable — ${consecutiveErrorSteps} consecutive tool-error steps. The XCTest runner (:${driverPort}) or device bridge appears to have died mid-run. Aborting instead of burning the remaining step budget.`);
        break;
      }
    } else {
      consecutiveErrorSteps = 0;
    }

    // Build rolling summary for this step
    if (agentMode === 'single-image' || agentMode === 'vision-gated') {
      const toolSummaries = msg.tool_calls.map(tc => {
        const name = tc.function.name;
        let args = {};
        try { args = JSON.parse(tc.function.arguments); } catch { /* malformed — summarize as bare name */ }
        const argStr = Object.values(args).map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(', ');
        return argStr ? `${name}(${argStr.slice(0, 60)})` : name;
      });
      rollingSummary.push(`Step ${step}: ${toolSummaries.join(', ')}`);
    }

    if (isDone) {
      stepLog.push(entry);
      const totalTime = ((Date.now() - totalStart) / 1000).toFixed(1);
      const totalAI = stepLog.reduce((a, s) => a + s.aiTime, 0);
      const totalTools = stepLog.reduce((a, s) => a + s.tools.reduce((b, t) => b + t.time, 0), 0);
      const totalSS = stepLog.reduce((a, s) => a + (s.screenshotTime || 0), 0);
      console.log(`\n${'='.repeat(50)}`);
      console.log(`  ✅ TASK COMPLETED`);
      console.log(`  ${doneMsg}`);
      console.log(`${'─'.repeat(50)}`);
      console.log(`  Total time:    ${totalTime}s`);
      console.log(`  Steps:         ${step}`);
      console.log(`  AI time:       ${totalAI.toFixed(1)}s (${((totalAI / parseFloat(totalTime)) * 100).toFixed(0)}%)`);
      console.log(`  Tool time:     ${totalTools.toFixed(1)}s (${((totalTools / parseFloat(totalTime)) * 100).toFixed(0)}%)`);
      console.log(`  Screenshot:    ${totalSS.toFixed(1)}s (${((totalSS / parseFloat(totalTime)) * 100).toFixed(0)}%)`);
      console.log(`  Overhead:      ${(parseFloat(totalTime) - totalAI - totalTools - totalSS).toFixed(1)}s`);
      if (agentMode === 'vision-gated') {
        console.log(`${'─'.repeat(50)}`);
        console.log(`  Vision calls:  ${visionSteps}`);
        console.log(`  Gated calls:   ${gatedSteps}`);
        console.log(`  Vision rate:   ${visionSteps + gatedSteps > 0 ? ((visionSteps / (visionSteps + gatedSteps)) * 100).toFixed(0) : 0}%`);
      }
      console.log(`${'='.repeat(50)}`);
      // --assert-sql: trust-but-verify "done" against the app's DB. A failed assertion → the task
      // is FAILED regardless of the agent's completion claim — this is what makes an unattended
      // verdict trustworthy (Round-3 feedback #4). Runs BEFORE the success side-effects below.
      if (assertSql) {
        const ar = await runAssertSql();
        if (ar.inconclusive && assertBestEffort) {
          // Best-effort assertion that couldn't be evaluated (a guessed table/column missed). Do NOT
          // flip a completed task to FAILED on a broken proxy — fall back to the agent's own verdict,
          // but LOUDLY so a silently-wrong assertion is visible and can be corrected. (Surfaced live
          // 2026-06-02: scenario-gen guessed ZREMINDER; the real Reminders table is ZREMCDREMINDER.)
          console.log(`  ⚠️  ASSERT INCONCLUSIVE (best-effort): ${ar.detail}`);
          console.log(`     Falling back to the agent's self-reported verdict. Fix the query/table for a DB-verified result.`);
        } else {
          console.log(ar.passed ? `  ✅ ASSERT PASS: ${ar.detail}` : `  ❌ ASSERT FAIL: ${ar.detail}`);
          if (!ar.passed) {
            console.log(`  __FAILED__: assert-sql — ${ar.detail}`);
            try {
              const logDir = join(STATE_DIR, 'logs');
              mkdirSync(logDir, { recursive: true });
              appendFileSync(join(logDir, 'tasks.jsonl'), JSON.stringify({ timestamp: new Date().toISOString(), runId: logRunId ?? undefined, task, reason: `assert-sql failed: ${ar.detail}`, steps: step, time: totalTime, success: false, mode: agentMode, grounding, promptMode, guard: runtimeGuardPolicy, guardFired: guardApprovalsRequired, askUserCalls, timing: timingTotals(), inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: modelName, provider, temperature: effectiveTemperature, promptHash, trace: stepTraces, agentLogs }) + '\n');
            } catch {}
            process.exit(1);
          }
        }
      }
      // Flush pending memories to disk
      if (pendingMemories.length > 0) {
        try {
          const memDir = join(STATE_DIR, 'memories');
          const memFile = join(memDir, 'user.md');
          mkdirSync(memDir, { recursive: true });
          const timestamp = new Date().toISOString().split('T')[0];
          const existing = existsSync(memFile) ? readFileSync(memFile, 'utf-8') : '# User Memory\n';
          const newEntries = pendingMemories.map(f => `- [${timestamp}] ${f}`).join('\n');
          writeFileSync(memFile, existing + newEntries + '\n');
          console.log(`[Memory] Saved ${pendingMemories.length} facts to disk`);
        } catch {}
      }
      // Procedural memory: update existing or extract new
      if (!noProcedures) {
        if (matchedProcedure) {
          procedures.recordSuccess(matchedProcedure.id);
          console.log(`[Procedures] Updated "${matchedProcedure.pattern}" — success recorded`);
        } else if (stepTraces.length >= 3) {
          console.log(`[Procedures] Extracting procedure from ${stepTraces.length}-step trace...`);
          try {
            const extractPrompt = procedures.buildExtractionPrompt(task, stepTraces);
            const extractData = await callLLM([{ role: 'user', content: extractPrompt }], { useTools: false });
            totalInputTokens += extractData.usage?.prompt_tokens || 0;
            totalOutputTokens += extractData.usage?.completion_tokens || 0;
            const extractContent = extractData.choices?.[0]?.message?.content || '';
            if (procedures.parseAndStore(extractContent, task)) {
              console.log(`[Procedures] New procedure saved (total: ${procedures.getCount()})`);
            } else {
              console.log(`[Procedures] Extraction skipped (duplicate or parse failure)`);
            }
          } catch (e) {
            console.log(`[Procedures] Extraction failed: ${e.message}`);
          }
        }
      }
      // Log task to history (after procedure-extraction so its tokens are included)
      try {
        const logDir = join(STATE_DIR, 'logs');
        mkdirSync(logDir, { recursive: true });
        const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), runId: logRunId ?? undefined, task, summary: doneMsg, steps: step, time: totalTime, success: true, mode: agentMode, grounding, promptMode, guard: runtimeGuardPolicy, guardFired: guardApprovalsRequired, askUserCalls, timing: timingTotals(), inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: modelName, provider, temperature: effectiveTemperature, promptHash, trace: stepTraces, agentLogs }) + '\n';
        const logFile = join(logDir, 'tasks.jsonl');
        appendFileSync(logFile, logEntry); // append-only: never read-modify-rewrite (torn-file safe)
        console.log(`[History] Task logged`);
      } catch (e) { console.error(`[History] FAILED to write task log: ${e.message}`); }
      process.exit(0);
    }

    if (isFailed) {
      // Even an explicit taskFailed is overruled by the DB: if the assertion passes, the desired
      // state exists, so the task succeeded regardless of the agent's pessimism (round-6: trust the DB).
      if (await dbOverrodeToSuccess('the DB confirms the change despite the agent reporting failure', step)) process.exit(0);
      const totalTime = ((Date.now() - totalStart) / 1000).toFixed(1);
      console.log(`\n${'='.repeat(50)}`);
      console.log(`  ❌ TASK FAILED (${totalTime}s)`);
      console.log(`  ${doneMsg}`);
      console.log(`${'='.repeat(50)}`);
      // Log failed task to history (with trace)
      try {
        const logDir = join(STATE_DIR, 'logs');
        mkdirSync(logDir, { recursive: true });
        const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), runId: logRunId ?? undefined, task, reason: doneMsg, steps: step, time: totalTime, success: false, mode: agentMode, grounding, promptMode, guard: runtimeGuardPolicy, guardFired: guardApprovalsRequired, askUserCalls, timing: timingTotals(), inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: modelName, provider, temperature: effectiveTemperature, promptHash, trace: stepTraces, agentLogs }) + '\n';
        const logFile = join(logDir, 'tasks.jsonl');
        appendFileSync(logFile, logEntry); // append-only: torn-file safe
        console.log(`[History] Task logged`);
      } catch (e) { console.error(`[History] FAILED to write task log: ${e.message}`); }
      // Record procedure failure
      if (!noProcedures && matchedProcedure) {
        procedures.recordFailure(matchedProcedure.id);
        console.log(`[Procedures] Updated "${matchedProcedure.pattern}" — failure recorded`);
      }
      process.exit(1);
    }

    // Settle delay: only after navigation actions (tap, scroll, swipe) on physical device
    // openApp, inputText, pressKey don't trigger iOS transition animations
    if (needsScreenshot && isPhone && needsSettleDelay) {
      await sleep(350); // iOS animations: nav push 330ms, keyboard 250ms, modals 350ms
    }
    if (needsScreenshot) {
      // In single-image/vision-gated mode, strip old screenshots so only the latest image is sent
      if (agentMode === 'single-image' || agentMode === 'vision-gated') {
        for (let i = 0; i < messages.length; i++) {
          const m = messages[i];
          if (Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')) {
            const textParts = m.content.filter(c => c.type === 'text').map(c => c.text).join(' ');
            const summaryCtx = rollingSummary.length > 0 ? ` | Context: ${rollingSummary[rollingSummary.length - 1]}` : '';
            messages[i] = { role: m.role, content: `[Previous screenshot${summaryCtx}] ${textParts}` };
          }
        }
      }
      try {
        const ssStart = Date.now();

        // ─── Orientation handling (landscape fix, 2026-05-28) ───
        // VERIFIED root cause: /screenshot (XCUIScreen.main.screenshot) returns
        // the raw PHYSICAL portrait framebuffer even when the app is landscape,
        // so landscape content comes back rotated 90° ("sideways"). A VLM fed a
        // sideways image reasons about it as portrait → every coordinate it
        // picks is wrong. Fix: detect orientation via the runner's
        // orientation-aware deviceInfo, rotate the image UPRIGHT before the VLM
        // sees it, and update the tap dims to the live (landscape-logical)
        // frame so the runner's orientationAwarePoint maps taps correctly.
        //
        // SAFETY: this is a strict NO-OP in portrait (the common, working path)
        // — rotation only fires when deviceInfo reports landscape AND the raw
        // pixels are still portrait-aspect (so we never double-rotate a source
        // that already orients, e.g. a future runner or simctl variant).
        //
        // LIMITATION (documented): deviceInfo exposes dims but not the
        // landscapeLeft/Right enum, so we rotate by a single direction
        // (LANDSCAPE_ROTATE_DEG, pinned empirically). The opposite physical
        // landscape would need the orientation enum surfaced in deviceInfo — a
        // small runner follow-up. See STATE.md landscape thread.
        let devInfo = null;
        try { devInfo = await maestro.deviceInfo(); } catch {}
        if (devInfo?.widthPoints && devInfo?.heightPoints) {
          // Live dims → the NEXT tap converts % against the current orientation,
          // matching the (possibly rotated) screenshot the VLM is about to see.
          phoneScreenWidth = devInfo.widthPoints;
          phoneScreenHeight = devInfo.heightPoints;
        }
        const deviceLandscape = !!(devInfo && devInfo.widthPoints > devInfo.heightPoints);

        // Run screenshot and hierarchy fetch in parallel (both are independent HTTP calls)
        const screenshotPromise = (async () => {
          // Raw bytes via device-backend.mjs (phone: runner /screenshot; sim: simctl io).
          let buffer = await captureRawScreenshot({ isPhone, maestro, simUdid });
          // Rotate to upright FIRST (before resize/grid) if landscape + raw is portrait-aspect.
          if (deviceLandscape) {
            try {
              const m = await sharp(buffer).metadata();
              if (m.height > m.width) {
                buffer = await sharp(buffer).rotate(LANDSCAPE_ROTATE_DEG).toBuffer();
                console.log(`[Orientation] landscape (${devInfo.widthPoints}x${devInfo.heightPoints}pt) — rotated screenshot ${LANDSCAPE_ROTATE_DEG}° upright`);
              }
            } catch (e) { console.log(`[Orientation] rotate skipped: ${e.message}`); }
          }
          if (useCompression) {
            try {
              // sharp is pre-imported at top of file so this resolves from Node's
              // module cache instantly — no per-screenshot dylib-load tax. See the
              // import block at lines 14-17 for the macOS-Gatekeeper rationale.
              const metadata = await sharp(buffer).metadata();
              if (metadata.width > 768) {
                buffer = await sharp(buffer).resize(768, null, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
              }
            } catch {}
          }
          if (grounding === 'grid') {
            try { buffer = await addGridOverlay(buffer); } catch (e) { console.log(`[Grid] Overlay failed: ${e.message}`); }
          }
          return buffer;
        })();

        const hierarchyPromise = (async () => {
          try {
            const hierResult = await maestro.viewHierarchy();
            const hText = hierResult.text || '';
            const uiNoise = ['scroll bar', 'battery', 'Cellular', 'Wi-Fi bars', 'PM', 'AM', 'No signal', 'Not charging', 'signal strength', 'battery power', 'location services', 'Location tracking'];
            const elems = [];
            const sw = useDirectHttp ? phoneScreenWidth : 402;
            const sh = useDirectHttp ? phoneScreenHeight : 874;
            try {
              const json = JSON.parse(hText);
              function collectAuto(node) {
                if (!node) return;
                if (node.label && node.label.trim()) {
                  const label = node.label.trim();
                  if (!uiNoise.some(n => label.includes(n))) {
                    let e;
                    if (node.frame) {
                      const px = Math.round((node.frame.X + node.frame.Width / 2) / sw * 100);
                      const py = Math.round((node.frame.Y + node.frame.Height / 2) / sh * 100);
                      e = `- "${label}" at (${px}%, ${py}%)`;
                    } else {
                      e = `- "${label}"`;
                    }
                    if (!elems.some(f => f.startsWith(`- "${label}"`))) elems.push(e);
                  }
                }
                if (node.children) node.children.forEach(collectAuto);
              }
              collectAuto(json?.axElement || json);
            } catch {
              const boundsRe = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/;
              for (const line of hText.split('\n')) {
                const lm = line.match(/accessibilityText[="] *:? *"?([^";,\n]+)/);
                if (!lm) continue;
                const label = lm[1].trim();
                if (!label || uiNoise.some(n => label.includes(n))) continue;
                const bm = line.match(boundsRe);
                let e;
                if (bm) {
                  const px = Math.round(((parseInt(bm[1]) + parseInt(bm[3])) / 2) / sw * 100);
                  const py = Math.round(((parseInt(bm[2]) + parseInt(bm[4])) / 2) / sh * 100);
                  e = `- "${label}" at (${px}%, ${py}%)`;
                } else {
                  e = `- "${label}"`;
                }
                if (!elems.some(f => f.startsWith(`- "${label}"`))) elems.push(e);
              }
            }
            if (elems.length > 0) {
              console.log(`[Auto-UI] ${elems.length} elements bundled with screenshot${elems.length > 150 ? ' (capped at 150)' : ''}`);
              const occlusionNote = keyboardLikelyUp
                ? `\n⚠️ KEYBOARD LIKELY OPEN (you typed recently): listed elements below ~55% of the screen may be BEHIND the keyboard — tapping their coordinates presses a KEY instead and corrupts your text. Call hideKeyboard first, then tap.`
                : '';
              return `\n\nUI elements on screen:\n${capElementList(elems).join('\n')}\nUse tap(x, y) with coordinates above for precise tapping.${occlusionNote}`;
            }
          } catch (e) {
            console.log(`[Auto-UI] Hierarchy fetch failed: ${e.message}`);
          }
          return '';
        })();

        const [buffer, uiElementsText] = await Promise.all([screenshotPromise, hierarchyPromise]);
        saveTraceStep(step, buffer, uiElementsText);
        const b64 = buffer.toString('base64');
        const imgMime = buffer[0] === 0xFF && buffer[1] === 0xD8 ? 'image/jpeg' : 'image/png';
        // Track the ACTUAL sent-image dimensions so the local-adapter converts the model's
        // pixel coords → % against the right width (audit #2/#10), not a hardcoded 768.
        try { const mm = await sharp(buffer).metadata(); lastSentImageWidth = mm.width; lastSentImageHeight = mm.height; } catch {}
        const ssTime = ((Date.now() - ssStart) / 1000).toFixed(1);
        entry.screenshotTime = (Date.now() - ssStart) / 1000;
        console.log(`[Screenshot] OK (${Math.round(buffer.length / 1024)} KB, ${ssTime}s${useCompression ? ' +compressed' : ''}${grounding === 'grid' ? ' +grid' : ''})`);

        // No-progress detection — signature is the SET of on-screen element labels (clock stripped,
        // sorted), so a genuine "screen didn't change" is distinguished from a coincidentally-equal
        // element COUNT (the old heuristic false-matched two different screens with the same count).
        // Two escalating responses share this signal: a mid-run NUDGE at 3 (read the screen / try
        // webSearch), and a hard CIRCUIT BREAKER at noProgressAbortN — abort rather than burn the
        // rest of the step budget tapping with zero effect (round-4 feedback #3: the S3/S6 loops).
        // Keyboard state is part of the signature (2026-08-04): a keyboard-open and
        // keyboard-closed view of the SAME screen must count as two distinct states,
        // so an agent cycling type → hideKeyboard → type registers as oscillating
        // between 2 states (breaker-eligible) instead of "making progress".
        const screenSig = (keyboardLikelyUp ? 'KB|' : '') + [...uiElementsText.matchAll(/^- "([^"]+)"/gm)].map(m => m[1])
          .filter(l => !/^\d{1,2}:\d{2}/.test(l))   // drop the status-bar clock so a minute tick isn't "progress"
          .sort().join('|');
        let unchangedWarning = '';
        if (screenSig && screenSig === prevScreenSig) {
          unchangedScreenCount++;
          noProgressStreak++;
          if (unchangedScreenCount >= 3) {
            unchangedWarning = '\n\nWARNING: The screen has NOT changed after 3 actions — your taps are having no effect. You may not understand how this app or screen works. STOP tapping and try: 1) Read ALL text on screen carefully for instructions, 2) Use webSearch to look up how this app/game works, 3) Look for text fields or buttons you may have missed.';
            console.log(`[Unchanged] Screen unchanged for ${unchangedScreenCount} steps — suggesting webSearch`);
            unchangedScreenCount = 0; // Reset the NUDGE counter after firing (breaker streak keeps climbing)
          }
        } else {
          unchangedScreenCount = 0;
          noProgressStreak = 0;
        }
        prevScreenSig = screenSig;
        // Rolling window for OSCILLATION detection (round-5 feedback #3): the frozen-streak above only
        // fires when the screen is IDENTICAL step-over-step. A thrashing agent makes a DIFFERENT change
        // each step (delete a char, retype, …) so the streak keeps resetting — yet it's bouncing among
        // a tiny set of states with no real progress. Window size = the abort threshold.
        if (noProgressAbortN > 0) { recentSigs.push(screenSig); if (recentSigs.length > noProgressAbortN) recentSigs.shift(); }

        // Hard circuit breaker. Two stuck signatures, both gated by noProgressAbortN (0 disables — e.g.
        // drawing/canvas tasks, where a static a11y tree is normal):
        //   FROZEN     — screen identical for N consecutive steps (no-op taps).
        //   OSCILLATING — over a full window of N steps the screen visited ≤2 distinct states (the
        //                 agent keeps changing things but circles the same 1–2 screens; round-5).
        // Either way: abort with a logged FAILURE instead of burning the rest of the budget (+ tokens).
        const distinctRecent = new Set(recentSigs.filter(Boolean)).size;
        const frozen = noProgressAbortN > 0 && noProgressStreak >= noProgressAbortN;
        // Oscillation = EXACTLY 2 distinct states over a full window (bouncing A↔B). distinct==1 is the
        // FROZEN case — let the streak path own it so its "unchanged for N steps" message stays accurate.
        const oscillating = noProgressAbortN > 0 && recentSigs.length >= noProgressAbortN && distinctRecent === 2 && !frozen;
        if (frozen || oscillating) {
          const tt = ((Date.now() - totalStart) / 1000).toFixed(1);
          const reason = frozen
            ? `on-screen elements unchanged for ${noProgressStreak} consecutive steps`
            : `screen oscillated among only ${distinctRecent} state(s) over the last ${recentSigs.length} steps (thrashing, no progress)`;
          // DB is the source of truth: if the assertion already passes, the task succeeded before it
          // got stuck (e.g. the change persisted, then it looped) → report SUCCESS, not a breaker fail.
          if (await dbOverrodeToSuccess('the DB state changed before the agent got stuck', step)) process.exit(0);
          console.log(`\n${'='.repeat(50)}`);
          console.log(`  ❌ TASK FAILED: no-progress circuit breaker — ${reason} (${tt}s).`);
          console.log(`  The agent's actions aren't advancing the task; aborting instead of burning the remaining ${maxSteps - step} step(s). (Override with --no-progress-abort 0 for drawing/canvas tasks.)`);
          console.log(`${'='.repeat(50)}`);
          try {
            const logDir = join(STATE_DIR, 'logs');
            mkdirSync(logDir, { recursive: true });
            appendFileSync(join(logDir, 'tasks.jsonl'), JSON.stringify({ timestamp: new Date().toISOString(), runId: logRunId ?? undefined, task, reason: `no-progress circuit breaker: ${reason}`, steps: step, time: tt, success: false, mode: agentMode, grounding, promptMode, guard: runtimeGuardPolicy, guardFired: guardApprovalsRequired, askUserCalls, timing: timingTotals(), inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: modelName, provider, temperature: effectiveTemperature, promptHash, trace: stepTraces, agentLogs }) + '\n');
            console.log(`[History] Task logged (no-progress failure)`);
          } catch (e) { console.error(`[History] FAILED to write task log: ${e.message}`); }
          process.exit(1);
        }

        messages.push({
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${imgMime};base64,${b64}` } },
            { type: 'text', text: `Here is the current screen. Continue with the task.${uiElementsText}${unchangedWarning}` },
          ],
        });
      } catch (e) {
        console.log(`[Screenshot] FAILED: ${e.message}`);
        messages.push({ role: 'user', content: 'Screenshot failed. Try a different approach.' });
      }
    }
  } else {
    // No tool calls. If the model also returned no/empty text, do NOT push it
    // to history — Anthropic's API rejects assistant turns with empty content
    // blocks ("messages: text content blocks must be non-empty"), which
    // corrupts every subsequent request. Instead, push a synthesized turn
    // so the model has *something* to react to next step. (Bug observed
    // 2026-05-13: Step 13 returned 2 output tokens of whitespace, Steps
    // 14-20 all 400'd identically.)
    const textContent = (typeof msg.content === 'string' ? msg.content : '').trim();
    if (textContent.length > 0) {
      messages.push(msg);
      // The text may already BE the answer (the model reads a value off the
      // screen as prose instead of calling taskComplete) — steer the retry
      // to conclude instead of re-deriving it on a full extra round-trip.
      messages.push({ role: 'user', content: 'You responded with text but called no tool. If that text already contains the final answer or result of the task, call taskComplete NOW with it as the summary — do not re-verify. Otherwise, continue the task using the available tools.' });
    } else {
      console.log('[AI] Model returned empty text and no tool calls — substituting placeholder turn to keep history valid.');
      messages.push({ role: 'assistant', content: '(no response — will try again)' });
      messages.push({ role: 'user', content: 'Please use the available tools to complete the task.' });
    }
  }

  // Auto-fetch hierarchy for hash-based vision gate (next step's decision)
  if (agentMode === 'vision-gated') {
    try {
      const hierResult = await maestro.viewHierarchy();
      const labels = flattenHierarchy(hierResult.text || '');
      prevScreenHash = hashLabels(currentUILabels); // save current as previous before updating
      currentUILabels = labels;
    } catch {
      prevScreenHash = hashLabels(currentUILabels);
      currentUILabels = []; // empty = force vision next step
    }
  }

  const stepTime = ((Date.now() - stepStart) / 1000).toFixed(1);
  stepLog.push(entry);
  const toolTotal = entry.tools.reduce((a, t) => a + t.time, 0).toFixed(1);
  const visionTag = agentMode === 'vision-gated' ? (entry.visionGated ? ' | GATED' : entry.screenshotTime ? ' | VISION' : '') : '';
  console.log(`[Step ${step}] ${stepTime}s (AI: ${entry.aiTime.toFixed(1)}s | Tools: ${toolTotal}s${entry.screenshotTime ? ` | Screenshot: ${entry.screenshotTime.toFixed(1)}s` : ''}${visionTag})`);
  await sleep(500);
}

// Transport death is an INFRA failure, not an agent verdict: the runner/bridge died
// mid-run, so the remaining steps were never attempted. Previously this fell through
// to the max-steps block below and was logged as "Max steps reached" with
// steps=maxSteps — a fake task FAILURE.
// Mirror the fatal-API-error contract instead: consult the DB first (the change may
// have landed before the death), otherwise exit 43 with NO tasks.jsonl record: an
// error, not a failure.
if (transportDiedAtStep > 0) {
  if (await dbOverrodeToSuccess('the device transport died, but the DB confirms the task succeeded', transportDiedAtStep)) process.exit(0);
  console.log(`\n  ❌ INFRA ERROR: device transport died at step ${transportDiedAtStep} — no task verdict (exit 43). Restart the runner/bridge and re-run.`);
  process.exit(43);
}

const totalTime = ((Date.now() - totalStart) / 1000).toFixed(1);
// Round-6 PRIMARY FIX: hitting the step cap without a self-reported "done" is the #1 source of FALSE
// failures — the agent often succeeded and just failed to NOTICE (e.g. it deleted the row, then wasted
// its last step re-tapping). Consult the DB FIRST: if the assertion passes, the state changed → this
// is a SUCCESS, and the step count is irrelevant. Only a failing/absent assertion is a real max-steps fail.
if (await dbOverrodeToSuccess('reached the step cap, but the DB confirms the task succeeded', maxSteps)) process.exit(0);
console.log(`\n${'='.repeat(50)}`);
console.log(`  ⏱️  MAX STEPS REACHED (${totalTime}s)`);
console.log(`${'='.repeat(50)}`);
// Log max-steps as a task FAILURE (success:false), mirroring the taskFailed
// path, so "the agent ran out of steps" is recorded as the failure it is.
try {
  const logDir = join(STATE_DIR, 'logs');
  mkdirSync(logDir, { recursive: true });
  const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), runId: logRunId ?? undefined, task, reason: 'Max steps reached without completing the task', steps: maxSteps, time: totalTime, success: false, mode: agentMode, grounding, promptMode, guard: runtimeGuardPolicy, guardFired: guardApprovalsRequired, askUserCalls, timing: timingTotals(), inputTokens: totalInputTokens, outputTokens: totalOutputTokens, model: modelName, provider, temperature: effectiveTemperature, promptHash, trace: stepTraces, agentLogs }) + '\n';
  const logFile = join(logDir, 'tasks.jsonl');
  appendFileSync(logFile, logEntry); // append-only: torn-file safe
  console.log(`[History] Task logged (max-steps failure)`);
} catch (e) { console.error(`[History] FAILED to write task log: ${e.message}`); }
process.exit(1);
