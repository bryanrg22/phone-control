#!/usr/bin/env node
// agent.mjs — operate the iPhone until a task is done. See README.md in this directory.
//
//   node agent/agent.mjs "<task>" --provider anthropic --model claude-opus-5-5 --driver-host 100.64.0.11
//
// This file only wires the parts together and turns the outcome into events
// and an exit code; the loop itself is loop.mjs.

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAgentArgs, helpText } from './cli-args.mjs';
import { createProtocol } from './protocol.mjs';
import { createDevice, installedApps } from './device.mjs';
import { createModel, createDecider, isDecisionProvider, parseHybridModel, HYBRID_PROVIDER, KEY_ENV } from './providers/index.mjs';
import { toolDefinitions, createToolRunner } from './tools.mjs';
import { systemPrompt } from './prompt.mjs';
import { createContext } from './context.mjs';
import { createStuckDetector, createProgressMonitor } from './stuck.mjs';
import { createRecorder } from './record.mjs';
import { runLoop } from './loop.mjs';
import { runDecisionLoop } from './decision/loop.mjs';
import { INSTRUCTIONS as DECISION_INSTRUCTIONS } from './decision/question.mjs';
import { STICKY_MAX } from './decision/escalate.mjs';
import { releaseOf, commitOf } from '../server/src/version.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXIT = { completed: 0, failed: 1, step_budget: 1, no_progress: 1, stopped: 1, errored: 42, device_lost: 43 };
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

const parsed = parseAgentArgs(process.argv.slice(2));
if (parsed.help) { console.log(helpText()); process.exit(0); }
if (parsed.error) { console.error(parsed.error.message); process.exit(parsed.error.exitCode); }
const cfg = parsed.config;

const protocol = createProtocol({ askUserTimeoutSec: cfg.askUserTimeoutSec });
const { emit, log } = protocol;
// Hybrid: a decision model (the chooser) and an LLM, each with its own key.
const hybrid = cfg.provider === HYBRID_PROVIDER ? parseHybridModel(cfg.model) : null;
const keyFor = (provider) => {
  const key = process.env[KEY_ENV[provider]];
  if (!key) { log(`ERROR: set ${KEY_ENV[provider]} for --provider ${cfg.provider}`); process.exit(1); }
  return key;
};
const apiKey = hybrid ? null : keyFor(cfg.provider);
const hybridKeys = hybrid ? { chooser: keyFor(hybrid.chooser.provider), llm: keyFor(hybrid.llm.provider) } : null;

// ─── the phone ───
const { apps, source: appsSource } = await installedApps({ simulatorUdid: cfg.simulator });
const device = createDevice({ host: cfg.driverHost, port: cfg.driverPort, knownApps: Object.values(apps) });
let screenInfo;
try { screenInfo = await device.info(); } catch (e) {
  emit('infra', { detail: `the runner on the phone is not answering at ${device.address}: ${e.message}` });
  process.exit(EXIT.device_lost);
}
log(`[setup] runner ${device.address} · screen ${screenInfo.widthPoints}x${screenInfo.heightPoints} pt · ${Object.keys(apps).length} apps (${appsSource})`);

// ─── the model, the tools, the prompt ───
// Three modes: an LLM converses with the tools (loop.mjs); a decision model
// picks one of the actions the harness enumerates from the screen (decision/);
// hybrid: the decision model picks, and hands some steps to an LLM (decision/escalate.mjs).
const decision = isDecisionProvider(cfg.provider) || !!hybrid;
const llmSpec = hybrid ? hybrid.llm : (decision ? null : { provider: cfg.provider, model: cfg.model });
const model = hybrid
  ? createDecider({ provider: hybrid.chooser.provider, model: hybrid.chooser.model, apiKey: hybridKeys.chooser, log })
  : decision
    ? createDecider({ provider: cfg.provider, model: cfg.model, apiKey, log })
    : createModel({ provider: cfg.provider, model: cfg.model, apiKey, temperature: cfg.temperature, log });
const llmModel = hybrid ? createModel({ provider: hybrid.llm.provider, model: hybrid.llm.model, apiKey: hybridKeys.llm, log }) : null;
const nativeSearch = llmSpec?.provider !== 'gemini';
const sticky = !!hybrid && cfg.escalationMode === 'sticky';
const toolDefs = toolDefinitions({ apps, braveSearch: !nativeSearch, handBack: sticky });
const llmSystem = llmSpec ? systemPrompt({ apps: Object.keys(apps), searchTool: nativeSearch ? 'web_search' : 'webSearch' }) : null;
const system = decision && !hybrid ? DECISION_INSTRUCTIONS : llmSystem;
const context = createContext({ system });
const state = { keyboardUp: false, screen: () => screenInfo };
const runTool = createToolRunner({ device, apps, screen: () => state.screen(), protocol, state });

// ─── the record ───
const commit = commitOf(REPO);
const recorder = createRecorder({
  dir: cfg.traceDir,
  manifest: {
    task: cfg.task, run_id: cfg.runId, provider: cfg.provider, model: cfg.model,
    agent: { release: releaseOf(REPO), commit: commit.commit, dirty: commit.dirty },
    settings: {
      mode: hybrid ? 'hybrid' : (decision ? 'decision' : 'llm'), max_steps: cfg.maxSteps, askuser_timeout_s: cfg.askUserTimeoutSec, no_progress_abort: cfg.noProgressAbort, temperature: cfg.temperature, reasoning: 'provider default', image_width: 768,
      // The decision APIs are previews whose formats may change: what was used is recorded.
      ...(decision ? { decision: { ...model.api, screenshot_sent: false, instructions_sha256: sha(DECISION_INSTRUCTIONS) } } : {}),
      ...(hybrid ? { hybrid: { chooser: hybrid.chooser, llm: hybrid.llm, escalation_threshold: cfg.escalationThreshold, escalation_mode: cfg.escalationMode, ...(sticky ? { sticky_max: STICKY_MAX } : {}), escalation: 'conclusion, free_text, low_confidence (below the threshold), stuck (3 unchanged screens), final' } } : {}),
    },
    prompt_sha256: system ? sha(system) : null, tools_sha256: sha(JSON.stringify(toolDefs)),
    device: { address: device.address, simulator: cfg.simulator, screen: screenInfo, apps: Object.keys(apps).length, apps_source: appsSource },
    node: process.version,
  },
});

// A first-launch "Would Like to Send You Notifications" alert, answered Allow
// without spending a step, unless the task is about permissions. Kept as the
// product behaved before the restructure; whether an agent should grant this
// on its own is an open product decision.
let notificationsHandled = false;
async function autoAllowNotifications(step) {
  if (notificationsHandled || step > 4 || /notif|permission|\ballow\b|\bdeny\b|don.?t\s*allow/i.test(cfg.task)) return;
  let root;
  try { root = JSON.parse(await device.hierarchy()); } catch { return; }
  let alert = false; let allow = null;
  (function walk(n) {
    if (!n) return;
    if (/Would Like to Send You Notifications/i.test(n.label || n.title || '')) alert = true;
    if (!allow && (n.label === 'Allow' || n.title === 'Allow') && n.frame) allow = n;
    for (const c of n.children || []) walk(c);
  })(root?.axElement || root);
  if (!alert || !allow) return;
  await device.tap(Math.round(allow.frame.X + allow.frame.Width / 2), Math.round(allow.frame.Y + allow.frame.Height / 2)).catch(() => {});
  notificationsHandled = true;
  log('[setup] a notifications permission prompt was answered Allow');
  recorder.note('A notifications permission prompt was answered Allow by the agent, without a model step.');
}

// A stop from the server arrives as SIGTERM: keep the record.
let finished = false;
function finish(outcome) {
  if (finished) return;
  finished = true;
  recorder.finish(outcome);
  if (outcome.status === 'completed') emit('done', { summary: outcome.summary });
  else if (outcome.status === 'device_lost') emit('infra', { detail: outcome.reason });
  else if (outcome.status !== 'errored' && outcome.status !== 'stopped') emit('failed', { reason: outcome.reason });
  log(`[outcome] ${outcome.status}${outcome.summary || outcome.reason ? `: ${outcome.summary || outcome.reason}` : ''}`);
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { finish({ status: 'stopped', reason: `stopped (${sig})` }); process.exit(EXIT.stopped); });

const progress = createProgressMonitor({ abortAfter: cfg.noProgressAbort });
const outcome = decision
  ? await runDecisionLoop({
    task: cfg.task, maxSteps: cfg.maxSteps, decider: model, device, runTool, apps: Object.keys(apps), protocol, recorder, progress, state, autoAllowNotifications,
    llm: hybrid ? { model: llmModel, context, toolDefs, threshold: cfg.escalationThreshold, sticky } : null,
  })
  : await runLoop({
    task: cfg.task, maxSteps: cfg.maxSteps, model, device, runTool, toolDefs, context, protocol, recorder, state,
    stuck: createStuckDetector(), progress, autoAllowNotifications,
  });
finish(outcome);
process.exit(EXIT[outcome.status] ?? 1);
