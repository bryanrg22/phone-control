// cli-args.mjs — pure argv parser for agent.mjs. argv in, config object out.
//
// Extracted from agent.mjs (D1/D2 refactor, 2026-07-17) so the CLI contract is
// unit-testable without spawning a process. NO top-level side effects, NO npm
// dependencies (CI runs the test suites without node_modules) — only ./models.mjs.
//
// Fixes the historical parser bug: the old hand-rolled loop treated the token
// following ANY --flag as that flag's value, so boolean flags swallowed the task
// (`node agent.mjs --phone "task"` → empty task → usage). This parser knows which
// flags are boolean and which take a value.
//
// Behavior contract (preserved from the original inline parser):
//   • The task is every positional token, joined with spaces; it may appear
//     before or after flags.
//   • Value flags: first occurrence wins; a missing trailing value falls back to
//     the flag's default (same as the old `args.find(...) || default`).
//   • Unknown --flags are an ERROR (exit 2) — catches typos. (NEW in D1; the old
//     parser silently ignored them.)
//   • Empty task → usage + exit 2. --help → full flag list + exit 0. (D1 contract;
//     the old code exited 1 on empty task.)
//   • Validation messages for --max-steps / --temperature / --prompt-mode are
//     byte-identical to the original, and fire in the original order. The
//     --udid-is-booted check is impure (simctl) and stays in agent.mjs, ordered
//     between the temperature and prompt-mode validations — hence error `stage`.

import { defaultModelFor, supportsTemperature } from './models.mjs';

export const PM_VALID = ['baseline', 'ios-conv', 'plain', 'xml-tagged', 'xml+ios-hints', 'xml+ios-hints+safety-tags'];

// Flags that take a value (the next argv token).
export const VALUE_FLAGS = new Set([
  '--max-steps', '--no-progress-abort', '--log-run-id', '--trace-dir',
  '--provider', '--model', '--temperature', '--backend', '--device-id',
  '--driver-port', '--driver-host', '--udid', '--agent-mode', '--vision-every-k',
  '--grounding', '--prompt-mode', '--askuser-timeout', '--landscape-rotate',
  '--runtime-guard', '--disable-tools',
  '--assert-sql', '--assert-app', '--assert-db', '--assert-expect',
]);

// Presence-only flags. --compress is a legacy no-op kept for backwards
// compatibility (frontend/server.mjs still passes it).
export const BOOLEAN_FLAGS = new Set([
  '--no-tools', '--use-tools', '--phone', '--no-compress', '--compress',
  '--procedures', '--assert-best-effort', '--help',
]);

export function parseAgentArgs(argv, env = process.env) {
  const flags = {};          // value flags — first occurrence wins
  const bools = new Set();
  const positionals = [];
  const notes = [];          // log lines agent.mjs prints (in order) when there is no parse error

  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      if (BOOLEAN_FLAGS.has(t)) { bools.add(t); continue; }
      if (VALUE_FLAGS.has(t)) {
        const next = argv[i + 1];
        if (!(t in flags)) flags[t] = next;          // may be undefined (trailing flag → default)
        if (next !== undefined && !next.startsWith('--')) i++;   // consume the value token
        continue;
      }
      return { help: false, notes, config: null, error: { message: `ERROR: unknown flag "${t}". Run "node agent.mjs --help" for the full flag list.`, exitCode: 2, stage: 'parse' } };
    }
    positionals.push(t);
  }

  if (bools.has('--help')) return { help: true, notes, config: null, error: null };

  const err = (message, stage = 'parse') => ({ help: false, notes, config: null, error: { message, exitCode: 2, stage } });

  const task = positionals.join(' ');

  // ── --max-steps (default 100, sanity-clamped to 300) ──
  const rawMaxSteps = flags['--max-steps'];
  let maxSteps = parseInt(rawMaxSteps || '100', 10);
  if (!Number.isFinite(maxSteps) || maxSteps < 1) {
    return err(`ERROR: --max-steps must be a positive integer (got "${rawMaxSteps}").`);
  }
  maxSteps = Math.min(maxSteps, 300); // a fat-finger like 999999 can't burn the account unattended

  // ── --no-progress-abort (default 8; 0 disables; invalid → default, no error) ──
  let noProgressAbortN = parseInt(flags['--no-progress-abort'] || '8', 10);
  if (!Number.isFinite(noProgressAbortN) || noProgressAbortN < 0) noProgressAbortN = 8;

  const logRunId = flags['--log-run-id'] || null;
  const traceDir = flags['--trace-dir'] || null;

  const provider = flags['--provider'] || 'anthropic';
  const defaultModel = defaultModelFor(provider);
  const modelName = flags['--model'] || defaultModel;

  // ── --temperature (omitted → provider default; unsupported model → recorded, not sent) ──
  const temperatureArg = flags['--temperature'] ?? null;
  let requestedTemperature = null;                 // number | null — what callLLM actually sends
  let effectiveTemperature = 'provider-default';   // logged into every tasks.jsonl record
  if (temperatureArg !== null) {
    const t = Number(temperatureArg);
    if (!Number.isFinite(t) || t < 0 || t > 2) {
      return err(`ERROR: --temperature must be a number in [0, 2] (got "${temperatureArg}").`);
    }
    if (supportsTemperature(provider, modelName, t)) {
      requestedTemperature = t;
      effectiveTemperature = t;
    } else {
      effectiveTemperature = `unsupported:${modelName}`;
      notes.push(`[Temperature] --temperature ${t} NOT supported by ${provider}:${modelName} (reasoning models accept only the default) — running at provider default; recording "${effectiveTemperature}"`);
    }
  }

  const noToolsMode = (bools.has('--no-tools') || provider === 'local') && !bools.has('--use-tools');
  const hasPhoneFlag = bools.has('--phone');
  const backend = flags['--backend'] || (hasPhoneFlag ? 'phone-direct' : 'maestro-cli');
  const isPhone = backend === 'phone-direct';
  const useDirectHttp = backend === 'phone-direct' || backend === 'direct-http-sim';
  const phoneDeviceId = flags['--device-id'] || env.PHONE_DEVICE_ID || '';
  const driverPort = parseInt(flags['--driver-port'] || (backend === 'direct-http-sim' ? '22087' : '6001'));
  const driverHost = flags['--driver-host'] || 'localhost';
  const simUdid = flags['--udid'] || 'booted';
  const agentMode = flags['--agent-mode'] || 'single-image';
  const visionEveryK = parseInt(flags['--vision-every-k'] || '5');
  const grounding = flags['--grounding'] || 'baseline'; // baseline | grid | zoomclick

  const promptMode = flags['--prompt-mode'] || 'baseline';
  // NOTE: stage 'post-udid' — the original validated --prompt-mode AFTER the impure
  // --udid-is-booted check, so agent.mjs runs that check before surfacing this error.
  const promptModeError = PM_VALID.includes(promptMode) ? null
    : { message: `ERROR: --prompt-mode must be one of: ${PM_VALID.join(' | ')} (got "${promptMode}")`, exitCode: 2, stage: 'post-udid' };
  const pmStructured = promptMode !== 'plain';
  const pmIosHints = ['baseline', 'ios-conv', 'xml+ios-hints', 'xml+ios-hints+safety-tags'].includes(promptMode);
  const pmConventions = ['ios-conv', 'xml+ios-hints', 'xml+ios-hints+safety-tags'].includes(promptMode);
  const pmSafetyTags = promptMode === 'xml+ios-hints+safety-tags';

  const askUserTimeoutMs = parseInt(flags['--askuser-timeout'] || '0') * 1000;
  const landscapeRotateDeg = parseInt(flags['--landscape-rotate'] || '270');
  const useCompression = !bools.has('--no-compress');
  const runtimeGuardPolicy = flags['--runtime-guard'] || 'auto-conservative';
  const noProcedures = !bools.has('--procedures'); // procedures disabled by default, use --procedures to enable
  const assertSql = flags['--assert-sql'] || null;
  const assertApp = flags['--assert-app'] || null;
  const assertDb = flags['--assert-db'] || null;
  const assertBestEffort = bools.has('--assert-best-effort');
  const assertExpect = flags['--assert-expect'] || '>0';
  const disabledTools = (flags['--disable-tools'] || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  return {
    help: false,
    notes,
    error: promptModeError,
    config: {
      task, maxSteps, noProgressAbortN, logRunId, traceDir,
      provider, defaultModel, modelName,
      temperatureArg, requestedTemperature, effectiveTemperature,
      noToolsMode, hasPhoneFlag, backend, isPhone, useDirectHttp,
      phoneDeviceId, driverPort, driverHost, simUdid,
      agentMode, visionEveryK, grounding,
      promptMode, pmStructured, pmIosHints, pmConventions, pmSafetyTags,
      askUserTimeoutMs, landscapeRotateDeg, useCompression,
      runtimeGuardPolicy, noProcedures,
      assertSql, assertApp, assertDb, assertBestEffort, assertExpect,
      disabledTools,
    },
  };
}

// Complete flag reference — printed by --help (exit 0) and on an empty task (exit 2).
export function buildHelpText() {
  return `Usage: node agent.mjs "your task" [flags]

The task is every non-flag token, joined with spaces; it may appear before or after flags.

Provider & model:
  --provider P           openai | gemini | anthropic | local (default: anthropic)
  --model MODEL          model ID (default: the provider's pinned default in models.mjs)
  --temperature N        pin sampling temperature in [0, 2] (reproducible runs). Omitted = provider default.
                         Models that reject a non-default temperature (OpenAI gpt-5*/o*-series) run at their
                         default and the tasks.jsonl record shows "unsupported:<model>" instead of the number.
  --no-tools             drive via the JSON-action text protocol instead of native tool calling
                         (auto-on for --provider local)
  --use-tools            force native tool calling even when --no-tools / --provider local would disable it

Device & backend:
  --backend B            maestro-cli      simulator via Maestro MCP + YAML (slow baseline; default)
                         direct-http-sim  simulator via direct HTTP to Maestro runner on localhost:22087
                                          (fast; launch runner with scripts/start-sim-runner.sh)
                         phone-direct     physical iPhone via maestro-ios-device bridge on localhost:6001
  --phone                shorthand for --backend phone-direct
  --udid SIM_UDID        pin simctl ops to a specific booted simulator (default: booted)
  --device-id UDID       physical iPhone UDID (default: $PHONE_DEVICE_ID from .env)
  --driver-host HOST     override the XCTest runner host (default: localhost). Use a Tailscale virtual IP
                         or LAN IP to drive a remote device.
  --driver-port PORT     override the runner port (default: 22087 for direct-http-sim, 6001 for phone-direct)

Run control:
  --max-steps N          step budget (default: 100, clamped to 300)
  --no-progress-abort N  abort after N consecutive identical-screen steps (default: 8; 0 = off — use 0 for
                         drawing/canvas tasks, where a static a11y tree is normal)
  --askuser-timeout S    max seconds to wait for a human HITL answer (default: 0 = wait forever;
                         unattended runs MUST pass a positive value)
  --runtime-guard P      off | never | always | auto-permissive | auto-conservative (default: auto-conservative)
  --procedures           enable procedural memory (disabled by default)
  --disable-tools a,b    comma-separated tool names to disable at startup (e.g. webSearch without BRAVE_API_KEY)

Agent modes & ablations:
  --agent-mode M         baseline | single-image (default) | vision-gated
  --vision-every-k N     vision-gated mode: force a screenshot every N steps (default: 5)
  --grounding G          baseline (default) | grid | zoomclick
  --prompt-mode PM       baseline (default) | ios-conv | plain | xml-tagged | xml+ios-hints | xml+ios-hints+safety-tags
  --no-compress          send full-resolution screenshots (default: 768px-wide JPEG q85).
                         The legacy --compress flag is accepted as a no-op.
  --landscape-rotate D   degrees to rotate a landscape screenshot upright for the VLM (default: 270)

Verification:
  --log-run-id ID        stamp this ID into the logs/tasks.jsonl record
  --trace-dir DIR        save per-step screenshots + UI-element lists (the reviewable "film strip") into DIR
  --assert-sql "QUERY" --assert-app BUNDLE_ID [--assert-db PATH] [--assert-expect ">=N"] [--assert-best-effort]
                         post-run: fail the task unless the app DB query matches (trustworthy verdicts).
                         --assert-best-effort: a query that can't execute (guessed-wrong table/column) is
                         INCONCLUSIVE → fall back to the agent verdict instead of failing.

Exit codes:
  0 task completed · 1 task failed / max-steps · 2 usage error · 42 non-recoverable API infra · 43 device transport died

Examples:
  node agent.mjs "search for USC on Maps"                                   # slow simulator (baseline)
  node agent.mjs "search for USC on Maps" --backend direct-http-sim        # fast simulator
  node agent.mjs "search for USC on Maps" --phone                           # fast physical iPhone
  node agent.mjs "search for USC on Maps" --phone --grounding zoomclick
  node agent.mjs "open Settings" --phone --driver-host 100.64.0.5            # remote phone over Tailscale`;
}
