// Regression tests for the agent.mjs CLI contract (D1 refactor, 2026-07-17).
//
// Two layers:
//   1. Unit tests of the pure parser (cli-args.mjs) — run everywhere, incl. CI
//      without node_modules (cli-args.mjs imports only ./models.mjs).
//   2. Spawn tests of `node agent.mjs` asserting the observable exit-code
//      contract (0 help→0, empty task→2, unknown flag→2, bad values→2, missing
//      API key→1). These need agent.mjs's npm deps (dotenv/sharp), so they are
//      SKIPPED when node_modules is absent (the device-free CI runs without it).
//
// The headline regression this pins: the old inline parser treated the token
// after ANY --flag as that flag's value, so `node agent.mjs --phone "task"`
// swallowed the task and printed usage. That must never come back.
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseAgentArgs, VALUE_FLAGS, BOOLEAN_FLAGS } from '../cli-args.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}

// ─── Layer 1: pure parser ───
console.log('parseAgentArgs — task position vs boolean flags (the historical bug):');
{
  const r = parseAgentArgs(['--phone', 'open maps']);
  check('task AFTER --phone is not swallowed', r.config?.task === 'open maps', JSON.stringify(r.config?.task));
  check('--phone sets phone-direct backend', r.config?.backend === 'phone-direct' && r.config?.isPhone === true);
}
{
  const r = parseAgentArgs(['open maps', '--phone']);
  check('task BEFORE --phone parses the same', r.config?.task === 'open maps' && r.config?.isPhone === true);
}
{
  const r = parseAgentArgs(['--provider', 'openai', 'do', 'the thing', '--no-compress']);
  check('multi-token task between flags joins with spaces', r.config?.task === 'do the thing', JSON.stringify(r.config?.task));
  check('--provider value consumed (not a task token)', r.config?.provider === 'openai');
  check('--no-compress disables compression', r.config?.useCompression === false);
}

console.log('parseAgentArgs — flag semantics & defaults:');
{
  const r = parseAgentArgs([]);
  const c = r.config;
  check('empty argv → empty task (caller prints usage, exit 2)', c.task === '');
  check('defaults: provider anthropic / backend maestro-cli / maxSteps 100', c.provider === 'anthropic' && c.backend === 'maestro-cli' && c.maxSteps === 100);
  check('defaults: agent-mode single-image / grounding baseline / prompt-mode baseline', c.agentMode === 'single-image' && c.grounding === 'baseline' && c.promptMode === 'baseline');
  check('defaults: guard auto-conservative / compression on / procedures off', c.runtimeGuardPolicy === 'auto-conservative' && c.useCompression === true && c.noProcedures === true);
  check('defaults: driverPort 6001 (maestro-cli/phone family) / driverHost localhost / udid booted', c.driverPort === 6001 && c.driverHost === 'localhost' && c.simUdid === 'booted');
  check('defaults: temperature provider-default, nothing sent', c.requestedTemperature === null && c.effectiveTemperature === 'provider-default');
}
{
  const r = parseAgentArgs(['t', '--backend', 'direct-http-sim']);
  check('direct-http-sim default driverPort 22087', r.config?.driverPort === 22087 && r.config?.useDirectHttp === true);
}
{
  const r = parseAgentArgs(['t', '--backend', 'direct-http-sim', '--driver-port', '9999', '--driver-host', '100.64.0.5']);
  check('--driver-port/--driver-host overrides', r.config?.driverPort === 9999 && r.config?.driverHost === '100.64.0.5');
}
{
  const phone = parseAgentArgs(['t', '--phone']).config;
  check('the phone backend uses the phone toolset', phone?.deviceProfile === 'phone' && phone?.isPhone === true);
  const sim = parseAgentArgs(['t', '--backend', 'direct-http-sim']).config;
  check('a simulator uses the simulator toolset by default', sim?.deviceProfile === 'simulator' && sim?.isPhone === false);
  const both = parseAgentArgs(['t', '--backend', 'direct-http-sim', '--device-profile', 'phone']).config;
  check('--device-profile phone runs the phone toolset on a simulator', both?.isPhone === true && both?.backend === 'direct-http-sim' && both?.useDirectHttp === true);
  check('--device-profile phone needs a direct-HTTP backend', parseAgentArgs(['t', '--device-profile', 'phone']).error?.exitCode === 2);
  check('--device-profile simulator cannot drive a real iPhone', parseAgentArgs(['t', '--phone', '--device-profile', 'simulator']).error?.exitCode === 2);
  check('--device-profile rejects unknown values', parseAgentArgs(['t', '--backend', 'direct-http-sim', '--device-profile', 'tablet']).error?.exitCode === 2);
}
{
  const r = parseAgentArgs(['t', '--max-steps', '999999']);
  check('--max-steps clamps to 300', r.config?.maxSteps === 300);
}
{
  const r = parseAgentArgs(['t', '--max-steps', 'abc']);
  check('--max-steps abc → parse error exit 2', r.error?.exitCode === 2 && /--max-steps must be a positive integer \(got "abc"\)/.test(r.error?.message || ''));
}
{
  const r = parseAgentArgs(['t', '--no-progress-abort', '0']);
  check('--no-progress-abort 0 disables the breaker', r.config?.noProgressAbortN === 0);
  const r2 = parseAgentArgs(['t', '--no-progress-abort', 'x']);
  check('--no-progress-abort invalid silently defaults to 8 (legacy semantics)', r2.config?.noProgressAbortN === 8 && !r2.error);
}
{
  const r = parseAgentArgs(['t', '--model', 'a', '--model', 'b']);
  check('repeated value flag: first occurrence wins (legacy find() semantics)', r.config?.modelName === 'a');
}
{
  const r = parseAgentArgs(['t', '--disable-tools', 'searchMaps, googleSearch,,openURL']);
  check('--disable-tools trims + drops empties', JSON.stringify(r.config?.disabledTools) === JSON.stringify(['searchMaps', 'googleSearch', 'openURL']));
}
{
  const r = parseAgentArgs(['t', '--compress']);
  check('legacy --compress accepted as a no-op (frontend/server.mjs passes it)', !r.error && r.config?.useCompression === true);
}
{
  const r = parseAgentArgs(['t', '--device-id', 'ABC'], { PHONE_DEVICE_ID: 'ENVID' });
  check('--device-id beats $PHONE_DEVICE_ID', r.config?.phoneDeviceId === 'ABC');
  const r2 = parseAgentArgs(['t'], { PHONE_DEVICE_ID: 'ENVID' });
  check('$PHONE_DEVICE_ID env fallback', r2.config?.phoneDeviceId === 'ENVID');
}
{
  check('--no-tools forces JSON-action mode', parseAgentArgs(['t', '--no-tools']).config?.noToolsMode === true);
  check('provider local auto-enables no-tools', parseAgentArgs(['t', '--provider', 'local']).config?.noToolsMode === true);
  check('--use-tools overrides local auto-no-tools', parseAgentArgs(['t', '--provider', 'local', '--use-tools']).config?.noToolsMode === false);
}

console.log('parseAgentArgs — temperature pin:');
{
  const r = parseAgentArgs(['t', '--temperature', '5']);
  check('--temperature 5 → error exit 2', r.error?.exitCode === 2 && /must be a number in \[0, 2\]/.test(r.error?.message || ''));
  const r2 = parseAgentArgs(['t', '--provider', 'anthropic', '--temperature', '0']);
  check('anthropic --temperature 0 pins + records 0', r2.config?.requestedTemperature === 0 && r2.config?.effectiveTemperature === 0);
  const r3 = parseAgentArgs(['t', '--provider', 'openai', '--temperature', '0']);
  check('openai gpt-5.5 --temperature 0 NOT sent, recorded unsupported', r3.config?.requestedTemperature === null && String(r3.config?.effectiveTemperature).startsWith('unsupported:'));
  check('…and emits the [Temperature] note line', r3.notes.length === 1 && r3.notes[0].startsWith('[Temperature] --temperature 0 NOT supported by openai:'));
  const r4 = parseAgentArgs(['t', '--provider', 'openai', '--temperature', '1']);
  check('openai --temperature 1 (explicit default) is sent', r4.config?.requestedTemperature === 1);
}

console.log('parseAgentArgs — errors, help, ordering:');
{
  const r = parseAgentArgs(['t', '--bogus']);
  check('unknown flag → error exit 2, stage parse', r.error?.exitCode === 2 && r.error?.stage === 'parse' && /unknown flag "--bogus"/.test(r.error?.message || ''));
}
{
  check('--help wins', parseAgentArgs(['--help']).help === true && parseAgentArgs(['task', '--help', '--phone']).help === true);
}
{
  const r = parseAgentArgs(['t', '--prompt-mode', 'nope']);
  check('bad --prompt-mode → post-udid error (fires AFTER the impure udid check)', r.error?.stage === 'post-udid' && /--prompt-mode must be one of/.test(r.error?.message || ''));
  check('…and the rest of the config still parses', r.config?.task === 't');
}
{
  // Every flag agent.mjs supports must be in exactly one of the two sets.
  const overlap = [...VALUE_FLAGS].filter(f => BOOLEAN_FLAGS.has(f));
  check('no flag is both value and boolean', overlap.length === 0, overlap.join(','));
}

// ─── Layer 2: spawn contract (needs node_modules for agent.mjs's imports) ───
const haveDeps = existsSync(join(ROOT, 'node_modules'));
if (!haveDeps) {
  console.log('spawn tests: SKIPPED (node_modules absent — device-free CI). Layer-1 covers the parser.');
} else {
  console.log('spawn `node agent.mjs` — exit-code contract:');
  // Blank ALL provider keys so no scenario can reach an LLM; dotenv does not
  // override keys that already exist in the environment (even empty ones).
  const env = { ...process.env, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', BRAVE_API_KEY: '', PHONE_CONTROL_STATE_DIR: mkdtempSync(join(tmpdir(), 'agent-cli-')) };
  const run = (args) => spawnSync('node', ['agent/agent.mjs', ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });

  {
    const r = run(['--help']);
    check('--help exits 0', r.status === 0, `status=${r.status}`);
    const allFlags = [...VALUE_FLAGS, ...BOOLEAN_FLAGS].filter(f => f !== '--help');
    const missing = allFlags.filter(f => !r.stdout.includes(f));
    check('--help lists EVERY supported flag', missing.length === 0, `missing: ${missing.join(', ')}`);
  }
  {
    const r = run([]);
    check('no task → usage + exit 2', r.status === 2 && r.stdout.includes('Usage: node agent.mjs'), `status=${r.status}`);
  }
  {
    const r = run(['--bogus-flag', 'task']);
    check('unknown flag → exit 2 with message', r.status === 2 && r.stdout.includes('unknown flag "--bogus-flag"'), `status=${r.status}`);
  }
  {
    // THE historical bug: boolean flag directly before the task. Must get PAST
    // arg parsing (i.e., NOT print usage) and die on the blanked API key, exit 1.
    const r = run(['--phone', 'task', '--max-steps', '1']);
    check('--phone "task" does NOT swallow the task (no usage screen)', !r.stdout.includes('Usage: node agent.mjs'), r.stdout.slice(0, 120));
    check('…and exits 1 on the missing API key (today\'s behavior)', r.status === 1 && r.stdout.includes('ERROR: Set ANTHROPIC_API_KEY'), `status=${r.status} out=${r.stdout.slice(0, 120)}`);
  }
  {
    const r = run(['task', '--max-steps', 'abc']);
    check('bad --max-steps → exit 2', r.status === 2 && r.stdout.includes('--max-steps must be a positive integer'), `status=${r.status}`);
  }
  {
    const r = run(['task', '--temperature', '9']);
    check('bad --temperature → exit 2', r.status === 2 && r.stdout.includes('--temperature must be a number in [0, 2]'), `status=${r.status}`);
  }
  {
    const r = run(['task', '--provider', 'bogusprov']);
    check('unknown provider → exit 1 (legacy contract)', r.status === 1 && r.stdout.includes('ERROR: Unknown provider "bogusprov"'), `status=${r.status}`);
  }
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
