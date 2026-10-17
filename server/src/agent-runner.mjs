// agent-runner.mjs — starts the agent (agent/agent.mjs) for a run and turns
// its events into run-registry updates.
//
// The agent is the same program a person can run by hand. Two things are
// specific to the server:
//
//  1. A private TMPDIR per run. The agent waits for answers to its questions
//     in $TMPDIR/agent-user-response.json; with one directory per run, runs on
//     a host serving several people cannot answer each other's questions.
//  2. --run-id, stamped into the agent's record of the run.
//
// The agent reports what it is doing as one JSON event per line on standard
// output, prefixed `@agent-event ` (agent/protocol.mjs); everything else it
// writes is for people and is ignored here.
//
// Everything impure is injected (spawn, fs, clock), so the parser and the
// event→registry mapping are unit-testable with no device and no child process.

import { spawn as nodeSpawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The prefix of an event line (agent/protocol.mjs EVENT_PREFIX). */
export const EVENT_PREFIX = '@agent-event ';
const TYPES = new Set(['step', 'thinking', 'action', 'ask', 'answer_seen', 'ask_timeout', 'done', 'failed', 'infra']);

/**
 * Streaming parser for the agent's output: one event per `@agent-event` line.
 * @param {(event: object) => void} emit
 */
export function createAgentOutputParser(emit) {
  let buffer = '';

  function line(raw) {
    // Only a line that IS an event. The agent's log quotes the model's own
    // text; a prefix found mid-line ("[model] @agent-event {…}") would let a
    // model, or a screen it read, forge a run's outcome.
    if (!raw.startsWith(EVENT_PREFIX)) return;
    const e = json(raw.slice(EVENT_PREFIX.length));
    if (!e || !TYPES.has(e.type)) return;
    if (e.type === 'action') emit({ type: 'action', tool: e.tool, args: e.args || {}, text: describe(e.tool, e.args || {}) });
    else if (e.type === 'ask') emit({ type: 'ask', question: e.question, options: e.options || [], hint: e.hint || '', kind: e.kind === 'text' ? 'text' : 'options' });
    else emit(e);
  }

  return {
    /** Feed raw output chunks; partial lines are buffered. */
    feed(chunk) {
      buffer += String(chunk);
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const p of parts) line(p);
    },
    /** Flush a trailing line with no newline (process exit). */
    end() {
      if (buffer.trim()) { const last = buffer; buffer = ''; line(last); }
    },
  };
}

function json(s) {
  try { return JSON.parse(String(s).trim()); } catch { return null; }
}

/** A short, human sentence for "what is it doing right now". */
export function describe(tool, args = {}) {
  const t = (s, n = 60) => String(s ?? '').slice(0, n);
  switch (tool) {
    case 'openApp': return `Opening ${t(args.appName || args.bundleId || 'an app')}`;
    case 'tapText': return args.text ? `Tapping "${t(args.text)}"` : 'Tapping';
    case 'inputText': return args.text ? `Typing "${t(args.text)}"` : 'Typing';
    case 'typeAndSubmit': return args.text ? `Typing and sending "${t(args.text)}"` : 'Typing';
    case 'webSearch': return `Searching the web for ${t(args.query)}`;
    case 'scroll': return `Scrolling ${t(args.direction || '')}`.trim();
    case 'takeScreenshot': return 'Looking at the screen';
    case 'getUIElements': return 'Reading the screen';
    default: return tool;
  }
}

/**
 * Maps a parser event onto the run registry. Pure with respect to I/O — pass a
 * fake store in tests.
 */
export function applyEvent(store, runId, event) {
  switch (event.type) {
    case 'step':
      return store.progress(runId, { step: event.step });
    case 'action':
      return store.progress(runId, { lastAction: event.text });
    case 'thinking':
      return store.progress(runId, { lastAction: 'Thinking' });
    case 'ask':
      return store.ask(runId, {
        question: event.question,
        options: event.options || [],
        type: event.kind === 'text' ? 'text' : 'options',
        hint: event.hint || '',
      });
    case 'ask_timeout':
      return store.clearQuestion(runId);
    case 'done':
      return store.finish(runId, { success: true, summary: event.summary || 'Done.' });
    case 'failed':
      return store.finish(runId, { success: false, summary: event.reason || 'The task did not complete.' });
    case 'infra':
      return store.finish(runId, {
        success: false,
        summary: 'The phone connection dropped mid-task.',
        error: event.detail,
      });
    default:
      return null;
  }
}

/**
 * Builds the argv for a connector-driven run.
 *
 * `--askuser-timeout` is finite ON PURPOSE. A chat user can walk away, and the
 * MCP surface has no session to notice; the agent auto-declines and finishes
 * rather than pinning a phone forever.
 */
export function buildAgentArgs({
  agentPath, task, maxSteps = 25, provider = 'anthropic', model = null,
  driverHost, driverPort = 22087, runId, askUserTimeoutSec = 300, traceDir = null, extraArgs = [],
}) {
  if (!task || !String(task).trim()) throw new Error('task is required');
  if (!driverHost) throw new Error('driverHost is required — the phone has no address');
  return [
    agentPath, String(task),
    '--provider', provider,
    // No --model → the provider's default (agent/models.mjs).
    ...(model ? ['--model', String(model)] : []),
    '--driver-host', String(driverHost),
    '--driver-port', String(driverPort),
    '--max-steps', String(maxSteps),
    '--askuser-timeout', String(askUserTimeoutSec),
    '--run-id', String(runId),
    ...(traceDir ? ['--trace-dir', String(traceDir)] : []),
    ...extraArgs,
  ];
}

/** One line of a run's agent log, as it goes into the server's log: tagged with the run, at most 400 characters. */
export function agentLogLine(runId, line) {
  return `run ${runId} | ${line.length > 400 ? `${line.slice(0, 400)}…` : line}`;
}

/** Calls onLine with each complete line of a stream that arrives in chunks; end() flushes a final unterminated line. */
export function createLineSplitter(onLine) {
  let buf = '';
  return {
    feed(chunk) {
      buf += String(chunk);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
    },
    end() { if (buf) { onLine(buf); buf = ''; } },
  };
}

/**
 * Spawns the agent for an existing run record and wires stdout → registry.
 * Returns { proc, tmpDir }.
 */
export function startAgentProcess({
  run, store, repoRoot, driverHost, driverPort = 22087, provider = 'anthropic', model = null,
  askUserTimeoutSec = 300, spawnFn = nodeSpawn, env = process.env, onLine = null, extraArgs = [],
  onLog = null,
}) {
  const tmpDir = join(tmpdir(), `connector-run-${run.id}`);
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

  // The full record of a run (every screenshot, every model request) only when
  // the operator asks for it: on a real phone it holds the person's screen.
  const traceRoot = env.AGENT_TRACE_DIR || null;
  const args = buildAgentArgs({
    agentPath: join(repoRoot, 'agent', 'agent.mjs'),
    task: run.task,
    maxSteps: run.maxSteps,
    provider,
    model,
    driverHost,
    driverPort,
    runId: run.id,
    askUserTimeoutSec,
    traceDir: traceRoot ? join(traceRoot, run.id) : null,
    extraArgs,
  });

  const proc = spawnFn(process.execPath, args, {
    cwd: repoRoot,
    // TMPDIR is the isolation seam (see header): each run answers questions
    // through a file in its own private directory.
    env: { ...env, TMPDIR: tmpDir },
  });

  const parser = createAgentOutputParser((event) => applyEvent(store, run.id, event));
  const feed = (chunk) => {
    if (onLine) { try { onLine(String(chunk)); } catch { /* logging must not kill a run */ } }
    parser.feed(chunk);
  };
  // Events come from standard output only (agent/protocol.mjs). Standard
  // error is the agent's log for people, which quotes the model's text and is
  // never parsed for events.
  proc.stdout?.on('data', feed);
  // onLog gets the agent's log one whole line at a time (a chunk can end
  // mid-line): what it chose each step, by which model, with what probability,
  // and what happened. No screenshots ever reach standard error.
  const logLines = createLineSplitter((line) => { if (onLog && line.trim()) { try { onLog(line); } catch { /* logging must not kill a run */ } } });
  proc.stderr?.on('data', (chunk) => {
    if (onLine) { try { onLine(String(chunk)); } catch { /* logging must not kill a run */ } }
    logLines.feed(chunk);
  });

  proc.on('error', (e) => {
    store.finish(run.id, { success: false, summary: 'The agent could not be started.', error: e.message });
    cleanup();
  });
  proc.on('close', (code) => {
    parser.end();
    logLines.end();
    // The parser reports the outcome for every normal ending. Anything left
    // un-finished here died without saying so — report that honestly rather
    // than inventing a verdict.
    store.finish(run.id, {
      success: false,
      summary: code === 0 ? 'The run ended without reporting a result.' : 'The run ended unexpectedly.',
      error: `agent exited with code ${code}`,
    });
    cleanup();
  });

  function cleanup() {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  const raw = store._raw(run.id);
  if (raw) {
    raw.proc = proc;
    // How an answer reaches the waiting agent: the exact file it polls, inside
    // this run's private TMPDIR.
    raw.answerSink = (choice) => {
      writeFileSync(join(tmpDir, 'agent-user-response.json'), JSON.stringify({ choice }), { mode: 0o600 });
    };
  }

  return { proc, tmpDir };
}
