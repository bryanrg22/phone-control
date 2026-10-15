// agent-runner.mjs — starts a REAL agent.mjs run and translates its stdout into
// run-registry events.
//
// Deliberately NOT a second agent loop: it runs the same agent/agent.mjs a
// person can run by hand, with two server-specific wrinkles:
//
//  1. PER-RUN TMPDIR. agent.mjs's askUser protocol polls
//     `join(tmpdir(), 'agent-user-response.json')` (agent/agent.mjs:139) — a
//     SINGLE path. One phone per user makes that fine for one run, but a
//     multi-tenant host runs several at once and they would answer each other's
//     questions. Node resolves `os.tmpdir()` from $TMPDIR at call time, so
//     giving each child its own TMPDIR isolates the mailbox with no change to
//     agent.mjs at all.
//
//  2. --log-run-id. agent.mjs already stamps `runId` into every logs/tasks.jsonl
//     record, so a connector run is attributable afterwards without racing on
//     "the last line of the file".
//
// Everything impure is injected (spawn, fs, clock), so the parser and the
// event→registry mapping are unit-testable with no device, no child process and
// no filesystem.

import { spawn as nodeSpawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Markers agent.mjs prints. Kept in one place so a change to the agent's
 *  output has exactly one place to be reflected. */
export const MARKERS = {
  ask: '__ASK_USER__:',
  askText: '__ASK_USER_TEXT__:',
  done: 'TASK COMPLETED',
  failed: 'TASK FAILED',
  maxSteps: 'MAX STEPS REACHED',
};

/**
 * Streaming parser for agent.mjs stdout.
 *
 * Stateful for exactly one reason: the completion summary is printed on the
 * line AFTER "✅ TASK COMPLETED", so a pure per-line function would drop the
 * one sentence the user actually wants back in their chat.
 *
 * @param {(event: object) => void} emit
 */
export function createAgentOutputParser(emit) {
  let buffer = '';
  let expect = null;              // 'done-summary' | 'failed-reason' | null

  function line(raw) {
    const text = raw.trim();
    if (!text) return;

    if (expect === 'done-summary') {
      expect = null;
      emit({ type: 'done', summary: strip(text) });
      return;
    }
    if (expect === 'failed-reason') {
      expect = null;
      // The failure banner carries its own reason often enough that a bare
      // separator line means "no extra detail", not "the detail is ═══════".
      emit({ type: 'failed', reason: /^[=─\s]+$/.test(text) ? null : strip(text) });
      return;
    }

    if (text.includes(MARKERS.ask)) {
      const payload = json(text.split(MARKERS.ask)[1]);
      if (payload) emit({ type: 'ask', question: payload.question, options: payload.options || [], kind: 'options' });
      return;
    }
    if (text.includes(MARKERS.askText)) {
      const payload = json(text.split(MARKERS.askText)[1]);
      if (payload) emit({ type: 'ask', question: payload.question, options: [], hint: payload.hint || '', kind: 'text' });
      return;
    }
    if (/^\[askUser(Text)?\] No response after/.test(text)) {
      emit({ type: 'ask_timeout' });
      return;
    }
    if (/^\[askUser(Text)?\] (User responded|User typed):/.test(text)) {
      emit({ type: 'answer_seen' });
      return;
    }
    if (text.includes(MARKERS.done)) {
      // "✅ TASK COMPLETED (DB-verified) — <context>" already carries its text.
      const inline = text.split(MARKERS.done)[1]?.replace(/^[\s—-]*/, '').trim();
      if (inline) emit({ type: 'done', summary: strip(inline) });
      else expect = 'done-summary';
      return;
    }
    if (text.includes(MARKERS.failed)) {
      const inline = text.split(MARKERS.failed)[1]?.replace(/^[\s:—-]*/, '').replace(/^\([\d.]+s\)\s*/, '').trim();
      if (inline) emit({ type: 'failed', reason: strip(inline) });
      else expect = 'failed-reason';
      return;
    }
    if (text.includes(MARKERS.maxSteps)) {
      emit({ type: 'failed', reason: 'Reached the step limit without finishing.' });
      return;
    }
    if (text.includes('❌ INFRA:')) {
      emit({ type: 'infra', detail: strip(text.split('❌ INFRA:')[1] || '').slice(0, 200) });
      return;
    }

    const step = text.match(/--- Step (\d+)\/(\d+).*?\(([\d.]+)s total\)/);
    if (step) {
      emit({ type: 'step', step: Number(step[1]), total: Number(step[2]), elapsed: step[3] });
      return;
    }
    // "[Tool] tapText({...})" — the intent, announced before it runs.
    const call = text.match(/^\[Tool\]\s+(\w+)\((\{.*\})\)\s*$/);
    if (call) {
      emit({ type: 'action', tool: call[1], args: json(call[2]) || {}, text: describe(call[1], json(call[2]) || {}) });
      return;
    }
    if (text.startsWith('[AI] Sending to')) emit({ type: 'thinking' });
  }

  return {
    /** Feed raw stdout/stderr chunks; partial lines are buffered. */
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

/** Strips the agent's decoration so a chat message doesn't inherit box drawing. */
function strip(s) {
  return String(s).replace(/^[✅❌\s]+/, '').replace(/^(DONE|FAILED):\s*/i, '').trim();
}

/** A short, human sentence for "what is it doing right now". */
export function describe(tool, args = {}) {
  const t = (s, n = 60) => String(s ?? '').slice(0, n);
  switch (tool) {
    case 'openApp': return `Opening ${t(args.appName || args.bundleId || 'an app')}`;
    case 'tapText': return args.text ? `Tapping "${t(args.text)}"` : 'Tapping';
    case 'inputText': return args.text ? `Typing "${t(args.text)}"` : 'Typing';
    case 'typeAndSubmit': return args.text ? `Typing and sending "${t(args.text)}"` : 'Typing';
    case 'searchMaps': return `Searching Maps for ${t(args.query)}`;
    case 'googleSearch':
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
  driverHost, driverPort = 22087, runId, askUserTimeoutSec = 300,
  agentMode = 'single-image', extraArgs = [],
}) {
  if (!task || !String(task).trim()) throw new Error('task is required');
  if (!driverHost) throw new Error('driverHost is required — the phone has no address');
  return [
    agentPath, String(task),
    '--max-steps', String(maxSteps),
    '--provider', provider,
    // No --model → the provider's pinned default (agent/models.mjs).
    ...(model ? ['--model', String(model)] : []),
    '--backend', 'phone-direct',
    '--driver-host', String(driverHost),
    '--driver-port', String(driverPort),
    '--agent-mode', agentMode,
    '--runtime-guard', 'off',
    '--askuser-timeout', String(askUserTimeoutSec),
    '--log-run-id', String(runId),
    ...extraArgs,
  ];
}

/**
 * Spawns the agent for an existing run record and wires stdout → registry.
 * Returns { proc, tmpDir }.
 */
export function startAgentProcess({
  run, store, repoRoot, driverHost, driverPort = 22087, provider = 'anthropic', model = null,
  askUserTimeoutSec = 300, spawnFn = nodeSpawn, env = process.env, onLine = null,
}) {
  const tmpDir = join(tmpdir(), `connector-run-${run.id}`);
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

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
  proc.stdout?.on('data', feed);
  proc.stderr?.on('data', feed);

  proc.on('error', (e) => {
    store.finish(run.id, { success: false, summary: 'The agent could not be started.', error: e.message });
    cleanup();
  });
  proc.on('close', (code) => {
    parser.end();
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
