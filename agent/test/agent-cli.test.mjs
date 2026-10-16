// agent-cli.test.mjs — the agent's arguments (cli-args.mjs), and that the
// arguments the server passes are ones the agent accepts.

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgentArgs, VALUE_FLAGS, helpText } from '../cli-args.mjs';
import { buildAgentArgs } from '../../server/src/agent-runner.mjs';

const AGENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'agent.mjs');
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); fail++; }
}
const ok = (argv) => parseAgentArgs(argv).config;
const err = (argv) => parseAgentArgs(argv).error;

console.log('parsing:');
{
  const c = ok(['set', 'an', 'alarm', '--driver-host', '100.64.0.11']);
  check('the task is every word that is not a flag', c?.task === 'set an alarm');
  check('defaults: anthropic, 25 steps, port 22087, 300 s to answer, stop after 8 unchanged screens', c.provider === 'anthropic' && c.maxSteps === 25 && c.driverPort === 22087 && c.askUserTimeoutSec === 300 && c.noProgressAbort === 8);
  check('no temperature is sent unless asked for', c.temperature === null);
  check('no record unless asked for', c.traceDir === null);
}
{
  const c = ok(['t', '--driver-host', 'h', '--provider', 'openai']);
  check('a provider without --model gets its default', c.model === 'gpt-6-luna');
}
{
  const c = ok(['t', '--simulator', 'ABC-123']);
  check('--simulator drives a local simulator: the runner is on 127.0.0.1', c.simulator === 'ABC-123' && c.driverHost === '127.0.0.1');
}
check('--max-steps is capped at 300', ok(['t', '--driver-host', 'h', '--max-steps', '999999']).maxSteps === 300);
check('web search is on unless --no-web-search', ok(['t', '--simulator', 'u']).webSearch === true && ok(['t', '--simulator', 'u', '--no-web-search']).webSearch === false);
check('--effort takes the four levels and nothing else', ok(['t', '--simulator', 'u', '--effort', 'high']).effort === 'high' && ok(['t', '--simulator', 'u']).effort === null && /--effort must be one of/.test(err(['t', '--simulator', 'u', '--effort', 'ultra'])?.message || ''));
check('a phone needs --driver-host', /driver-host/.test(err(['t'])?.message || ''));
check('an unknown flag is an error, not ignored', /unknown flag/.test(err(['t', '--driver-host', 'h', '--backend', 'x'])?.message || ''));
check('a flag with no value is an error', /needs a value/.test(err(['t', '--driver-host'])?.message || ''));
check('no task is an error', /no task/.test(err(['--driver-host', 'h'])?.message || ''));
check('an unknown provider is an error', /provider/.test(err(['t', '--driver-host', 'h', '--provider', 'local'])?.message || ''));
check('a bad --max-steps is an error', !!err(['t', '--driver-host', 'h', '--max-steps', 'ten']));
check('a temperature the model rejects is an error', /temperature/.test(err(['t', '--driver-host', 'h', '--provider', 'openai', '--model', 'gpt-6-luna', '--temperature', '0'])?.message || ''));
check('every error exits 2', [err(['t']), err(['t', '--bogus', 'x'])].every((e) => e.exitCode === 2));
check('--help lists every flag', [...VALUE_FLAGS].every((f) => helpText().includes(f)));

console.log('what the server passes:');
{
  const args = buildAgentArgs({ agentPath: 'agent.mjs', task: 'Text Sam', provider: 'openai', model: 'gpt-6-luna', driverHost: '100.64.0.11', runId: 'run_1', traceDir: '/tmp/x' }).slice(1);
  const c = ok(args);
  check('the agent accepts every argument the server sends', !!c, JSON.stringify(err(args)));
  check('and reads them as meant', c?.task === 'Text Sam' && c.provider === 'openai' && c.model === 'gpt-6-luna' && c.driverHost === '100.64.0.11' && c.runId === 'run_1' && c.traceDir === '/tmp/x');
}

console.log('the process:');
{
  const run = (argv) => spawnSync(process.execPath, [AGENT, ...argv], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  check('--help exits 0', run(['--help']).status === 0);
  check('a bad argument exits 2', run(['t', '--bogus', 'x']).status === 2);
  check('a missing API key exits 1 before touching the phone', run(['t', '--driver-host', '127.0.0.1', '--driver-port', '9']).status === 1);
}

console.log(fail ? `\n❌ ${fail} FAILED, ${pass} passed` : `\n✅ ALL PASS: ${pass} passed, 0 failed`);
if (fail) process.exit(1);
