// cli-args.mjs — the agent's arguments: argv in, config out. Pure; unit-tested
// in test/agent-cli.test.mjs.
//
//   node agent/agent.mjs "<task>" --provider anthropic --model claude-opus-5-5 --driver-host 100.64.0.11
//
// The task is every non-flag token, joined with spaces. An unknown flag is an
// error (exit 2), so a typo cannot silently change a run.

import { defaultModelFor, supportsTemperature } from './models.mjs';

export const VALUE_FLAGS = new Set([
  '--provider', '--model', '--temperature',
  '--driver-host', '--driver-port', '--simulator',
  '--max-steps', '--askuser-timeout', '--no-progress-abort',
  '--trace-dir', '--run-id',
]);
export const BOOLEAN_FLAGS = new Set(['--help']);
const PROVIDERS = ['anthropic', 'openai', 'gemini'];

export function parseAgentArgs(argv) {
  const flags = {};
  const bools = new Set();
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) { words.push(t); continue; }
    if (BOOLEAN_FLAGS.has(t)) { bools.add(t); continue; }
    if (!VALUE_FLAGS.has(t)) return fail(`unknown flag "${t}". Run with --help for the list.`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return fail(`${t} needs a value.`);
    if (!(t in flags)) flags[t] = v;
    i++;
  }
  if (bools.has('--help')) return { help: true, config: null, error: null };

  const task = words.join(' ').trim();
  if (!task) return fail('no task given.');

  const provider = flags['--provider'] || 'anthropic';
  if (!PROVIDERS.includes(provider)) return fail(`--provider must be one of ${PROVIDERS.join(', ')} (got "${provider}").`);
  const model = flags['--model'] || defaultModelFor(provider);

  const int = (name, dflt, min, max) => {
    const raw = flags[name];
    if (raw === undefined) return dflt;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) return NaN;
    return Math.min(n, max);
  };
  const maxSteps = int('--max-steps', 25, 1, 300);            // capped: a typo cannot burn an account unattended
  if (Number.isNaN(maxSteps)) return fail(`--max-steps must be a whole number of at least 1 (got "${flags['--max-steps']}").`);
  const driverPort = int('--driver-port', 22087, 1, 65535);
  if (Number.isNaN(driverPort)) return fail(`--driver-port must be a port number (got "${flags['--driver-port']}").`);
  const askUserTimeoutSec = int('--askuser-timeout', 300, 0, 86400);   // 0 = wait forever
  if (Number.isNaN(askUserTimeoutSec)) return fail(`--askuser-timeout must be whole seconds (got "${flags['--askuser-timeout']}").`);
  const noProgressAbort = int('--no-progress-abort', 8, 0, 300);      // 0 = never stop for lack of progress
  if (Number.isNaN(noProgressAbort)) return fail(`--no-progress-abort must be a whole number (got "${flags['--no-progress-abort']}").`);

  let temperature = null;
  if (flags['--temperature'] !== undefined) {
    const t = Number(flags['--temperature']);
    if (!Number.isFinite(t) || t < 0 || t > 2) return fail(`--temperature must be a number from 0 to 2 (got "${flags['--temperature']}").`);
    if (!supportsTemperature(provider, model, t)) return fail(`${model} does not accept --temperature (reasoning models use their default).`);
    temperature = t;
  }

  const simulator = flags['--simulator'] || null;
  const driverHost = flags['--driver-host'] || (simulator ? '127.0.0.1' : null);
  if (!driverHost) return fail('--driver-host is required: the address of the phone\'s runner (or pass --simulator <udid>).');

  return {
    help: false, error: null,
    config: {
      task, provider, model, temperature,
      driverHost, driverPort, simulator,
      maxSteps, askUserTimeoutSec, noProgressAbort,
      traceDir: flags['--trace-dir'] || null,
      runId: flags['--run-id'] || null,
    },
  };
}

function fail(message) { return { help: false, config: null, error: { message: `ERROR: ${message}`, exitCode: 2 } }; }

export function helpText() {
  return `Usage: node agent/agent.mjs "<task>" [flags]

Operates an iPhone through the XCTest runner on it until the task is done.

Model:
  --provider P           anthropic | openai | gemini (default: anthropic)
  --model M              model ID (default: the provider's default in models.mjs)
  --temperature T        0-2; only for models that accept it

Device:
  --driver-host H        the phone's runner address (required for a phone)
  --driver-port N        the runner's port (default: 22087)
  --simulator UDID       drive a booted simulator instead: lists its apps with simctl;
                         --driver-host defaults to 127.0.0.1

Limits:
  --max-steps N          model requests before the run must conclude (default: 25, at most 300)
  --askuser-timeout S    seconds to wait for an answer to a question (default: 300; 0 = forever)
  --no-progress-abort N  stop after N steps without the screen changing (default: 8; 0 = never)

Record:
  --trace-dir D          write the full record of the run here (see agent/README.md)
  --run-id R             an identifier stamped into the record

Exit codes: 0 done · 1 not done · 2 bad arguments · 42 the model API failed · 43 the phone stopped answering`;
}
