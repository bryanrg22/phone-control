// protocol.mjs — how the agent talks to whoever started it (the server, or an eval harness).
//
// Events: one line on standard output each, `@agent-event ` and a JSON object:
//
//   {"type":"step","step":3,"total":25,"elapsed":"12.4"}
//   {"type":"thinking"}                                   a model request is in flight
//   {"type":"action","tool":"tap","args":{"x":50,"y":12}} announced before it runs
//   {"type":"ask","question":"Which Sam?","options":["Sam Lee","Sam Patel"],"kind":"options"}
//   {"type":"ask","question":"What is the code?","hint":"6 digits","kind":"text"}
//   {"type":"answer_seen"}   {"type":"ask_timeout"}
//   {"type":"done","summary":"…"}   {"type":"failed","reason":"…"}   {"type":"infra","detail":"…"}
//
// The parser is server/src/agent-runner.mjs (createAgentOutputParser). Every
// other line the agent writes goes to standard error, for people.
//
// Answers: the agent waits for $TMPDIR/agent-user-response.json, {"choice": "…"},
// which the server writes into the run's private TMPDIR.

import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const EVENT_PREFIX = '@agent-event ';

export function createProtocol({ askUserTimeoutSec = 300, out = process.stdout, err = process.stderr } = {}) {
  const emit = (type, data = {}) => out.write(`${EVENT_PREFIX}${JSON.stringify({ type, ...data })}\n`);
  const log = (...parts) => err.write(`${parts.join(' ')}\n`);
  const answerFile = () => join(tmpdir(), 'agent-user-response.json');

  /** Ask the person; resolves to their answer, or null when nobody answered in time. */
  async function ask({ question, options = [], hint = '', kind = 'options' }) {
    try { unlinkSync(answerFile()); } catch { /* none waiting */ }
    emit('ask', kind === 'text' ? { question, hint, kind } : { question, options, kind });
    log(`[ask] ${question}${options.length ? ` — ${options.join(' / ')}` : ''}`);
    const deadline = askUserTimeoutSec > 0 ? Date.now() + askUserTimeoutSec * 1000 : Infinity;
    while (Date.now() < deadline) {
      try {
        const { choice } = JSON.parse(readFileSync(answerFile(), 'utf8'));
        try { unlinkSync(answerFile()); } catch { /* already gone */ }
        emit('answer_seen');
        log(`[ask] answered: ${choice}`);
        return String(choice);
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    emit('ask_timeout');
    log(`[ask] no answer after ${askUserTimeoutSec}s`);
    return null;
  }

  return { emit, log, ask };
}
