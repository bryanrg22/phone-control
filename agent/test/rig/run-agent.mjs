// run-agent.mjs — run the REAL agent process between a fake phone and a fake model.
//
// Spawned with the arguments the server uses (server/src/agent-runner.mjs
// buildAgentArgs), and its output read by the server's own parser, so a test
// checks the contract the server actually depends on, not an internal detail.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentArgs, createAgentOutputParser } from '../../../server/src/agent-runner.mjs';

const AGENT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'agent.mjs');

/**
 * @param {object} o
 * @param {object} o.runner      from startFakeRunner
 * @param {object} o.model       from startFakeModel
 * @param {string} [o.task]
 * @param {number} [o.maxSteps]
 * @param {number} [o.askUserTimeoutSec]
 * @param {(ask, answer) => void} [o.onAsk]   answer a question: answer('Sam Lee')
 * @param {string[]} [o.extraArgs]
 * @param {number} [o.timeoutMs]
 */
export async function runAgent({ runner, model, task = 'Do the thing', maxSteps = 10, askUserTimeoutSec = 300, onAsk = null, extraArgs = [], timeoutMs = 60000 }) {
  const tmp = mkdtempSync(join(tmpdir(), 'agent-rig-'));
  const state = mkdtempSync(join(tmpdir(), 'agent-rig-state-'));
  const args = buildAgentArgs({
    agentPath: AGENT, task, maxSteps, provider: 'anthropic', model: 'claude-test-model',
    driverHost: '127.0.0.1', driverPort: runner.port, runId: 'run_rig', askUserTimeoutSec, extraArgs,
  });
  const events = [];
  const parser = createAgentOutputParser((e) => {
    events.push(e);
    if (e.type === 'ask' && onAsk) {
      onAsk(e, (choice) => writeFileSync(join(tmp, 'agent-user-response.json'), JSON.stringify({ choice })));
    }
  });
  let stdout = '';
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      env: {
        // A bare PATH: no pymobiledevice3, no maestro, so nothing can reach a real device.
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: state, TMPDIR: tmp, PHONE_CONTROL_STATE_DIR: state,
        ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: model.url,
      },
    });
    const feed = (c) => { stdout += c; parser.feed(c); };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    const t = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (c) => { clearTimeout(t); resolve(c); });
  });
  parser.end();
  const leftovers = existsSync(state) ? readdirSync(state) : [];
  rmSync(tmp, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
  return { code, events, stdout, stateFiles: leftovers };
}
