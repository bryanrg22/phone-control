// runs.mjs — the run registry and the human-in-the-loop state machine.
//
// Why this exists as its own module: an LLM connector cannot hold a run open.
// A tool call has a time limit, and a phone task takes minutes, so `run_phone_task` returns a handle immediately and the model polls.
// Everything that outlives a single tool call lives here.
//
// The HITL shape is dictated by a VERIFIED platform limitation: MCP elicitation
// is not supported in Claude.ai (claude-ai-mcp#153, open), so a server cannot
// ask the user anything directly. Instead:
//
//   agent calls askUser  →  run enters `awaiting_answer` with the question
//   model polls get_run_status  →  sees the question, asks it IN THE CHAT
//   user answers in the chat  →  model calls answer_question
//   answer is delivered to the waiting agent  →  run continues
//
// The question is therefore just DATA on a status response. That is what makes
// it work on every client, today, with no protocol feature at all.
//
// Tenancy is enforced here rather than at the edge: every accessor takes the
// caller's uid and a mismatch reads as "no such run", never as someone else's
// run. One phone per user means one active run per user, so the registry also
// refuses to start a second.

export const RUN_STATES = ['starting', 'running', 'awaiting_answer', 'completed', 'failed', 'stopped'];

const TERMINAL = new Set(['completed', 'failed', 'stopped']);

export function isTerminal(status) {
  return TERMINAL.has(status);
}

/**
 * @param {object} opts
 * @param {() => number} [opts.now]        injectable clock (tests)
 * @param {() => string} [opts.newId]      injectable id source (tests)
 * @param {number} [opts.keep]             how many finished runs to retain per user
 * @param {(run) => void} [opts.onChange]  called after every mutation (audit/log hook)
 */
// Words that turn a mention of an option into its opposite ("not 7:00 PM",
// "the other one"). An answer containing one is never matched to the option it
// mentions: "not 7:00 PM, the later one" must not send 7:00 PM to the phone.
const NEGATIONS = new Set(['not', 'no', 'never', 'neither', 'nor', "don't", 'dont', "isn't", 'isnt', "wasn't", 'except', 'other', 'instead', 'rather', 'wrong', 'none']);
const norm = (s) => String(s).toLowerCase().replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsOf = (s) => s.split(/[^\p{L}\p{N}']+/u).filter(Boolean);

/**
 * The option an answer means, or null. Exact (case- and space-insensitive)
 * first. Otherwise the answer may wrap ONE option in a few words ("the first
 * one, Sam Chen please"): the option must appear whole, not inside another
 * word ("no" is not in "know" — that sent No for "I don't know", 2026-10-16),
 * only one option may appear, and the words around it must not negate it.
 * Anything else is refused: a wrong answer delivered to the phone is worse
 * than a question asked twice.
 */
export function matchOption(answer, options) {
  const a = norm(answer);
  const exact = options.find((o) => norm(o) === a);
  if (exact !== undefined) return exact;
  const whole = (o) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(norm(o))}(?=$|[^\\p{L}\\p{N}])`, 'u');
  const mentioned = options.filter((o) => whole(o).test(a));
  if (mentioned.length !== 1) return null;
  const [o] = mentioned;
  const rest = wordsOf(a.replace(whole(o), '$1'));
  if (rest.length > 6 || rest.some((w) => NEGATIONS.has(w))) return null;
  return o;
}

export function createRunStore({ now = Date.now, newId = null, keep = 20, onChange = () => {} } = {}) {
  const runs = new Map();          // runId -> run
  let counter = 0;
  const mkId = newId || (() => `run_${(now()).toString(36)}${(++counter).toString(36).padStart(2, '0')}`);

  const stamp = (run) => {
    run.updatedAt = new Date(now()).toISOString();
    run.rev = (run.rev || 0) + 1;      // bumped on every change: what a waiting status check watches
    try { onChange(run); } catch { /* an audit hook must never break a run */ }
    return run;
  };

  /** The caller's view: never leaks another tenant's run, and never leaks
   *  internal handles (the child process, the response-file path). */
  const view = (run) => run && ({
    run_id: run.id,
    status: run.status,
    task: run.task,
    step: run.step,
    max_steps: run.maxSteps,
    last_action: run.lastAction,
    started_at: run.createdAt,
    updated_at: run.updatedAt,
    ...(run.status === 'awaiting_answer'
      ? {
        question: run.question,
        options: run.options,
        answer_kind: run.questionType,        // 'options' | 'text'
        hint: run.hint || undefined,
      }
      : {}),
    ...(run.meta && run.meta.model ? { model: run.meta.model } : {}),
    ...(isTerminal(run.status) ? { success: run.success, summary: run.summary } : {}),
    ...(run.error ? { error: run.error } : {}),
  });

  function activeFor(uid) {
    for (const r of runs.values()) {
      if (r.uid === uid && !isTerminal(r.status)) return r;
    }
    return null;
  }

  function pruneFor(uid) {
    const finished = [...runs.values()]
      .filter((r) => r.uid === uid && isTerminal(r.status))
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
    while (finished.length > keep) runs.delete(finished.shift().id);
  }

  return {
    /** Raw access for the runner (which owns the process handle). Not exposed
     *  over any transport. */
    _raw: (runId) => runs.get(runId) || null,

    view,
    activeFor: (uid) => view(activeFor(uid)),

    create({ uid, task, maxSteps = 25, deviceAddress = null, meta = {} }) {
      if (!uid) throw new Error('create requires a uid');
      const busy = activeFor(uid);
      if (busy) {
        const e = new Error('a run is already in progress for this user');
        e.code = 'RUN_IN_PROGRESS';
        e.run = view(busy);
        throw e;
      }
      const run = {
        id: mkId(),
        uid,
        task,
        maxSteps,
        deviceAddress,
        meta,
        status: 'starting',
        step: 0,
        lastAction: null,
        question: null,
        options: [],
        questionType: 'options',
        hint: '',
        answers: [],
        summary: null,
        success: null,
        error: null,
        proc: null,
        answerSink: null,          // set by the runner: how to deliver an answer
        createdAt: new Date(now()).toISOString(),
        updatedAt: new Date(now()).toISOString(),
        log: [],
        // Is the chat that started this still following it? Every status check
        // refreshes lastPolledAt; a check whose connection is dropped mid-wait
        // sets clientDroppedAt. src/task-runner.mjs acts on both.
        lastPolledAt: now(),
        clientDroppedAt: null,
      };
      runs.set(run.id, run);
      pruneFor(uid);
      stamp(run);
      return run;
    },

    /** Tenant-scoped read. A wrong uid is indistinguishable from a missing run. */
    get(runId, uid) {
      const r = runs.get(runId);
      if (!r || r.uid !== uid) return null;
      return view(r);
    },

    list(uid, limit = 5) {
      return [...runs.values()]
        .filter((r) => r.uid === uid)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit)
        .map(view);
    },

    /** Progress from the agent's stdout. Ignored once terminal, so a late line
     *  from a dying child cannot resurrect a finished run. */
    progress(runId, { step, lastAction, note } = {}) {
      const r = runs.get(runId);
      if (!r || isTerminal(r.status)) return null;
      if (r.status === 'starting') r.status = 'running';
      if (typeof step === 'number') r.step = step;
      if (lastAction) r.lastAction = lastAction;
      if (note) r.log.push({ at: new Date(now()).toISOString(), note });
      return stamp(r);
    },

    /** A status check arrived for this run: its chat is still listening. */
    polled(runId) {
      const r = runs.get(runId);
      if (!r) return;
      r.lastPolledAt = now();
      r.clientDroppedAt = null;
    },

    /** A status check was cut off before it was answered (Stop pressed, or the
     *  client went away). Not proof on its own — the next check clears it. */
    clientDropped(runId) {
      const r = runs.get(runId);
      if (r && !isTerminal(r.status)) r.clientDroppedAt = now();
    },

    /** What the run is doing before the agent has started (starting automation,
     *  waiting on the phone). Unlike progress() it does NOT move the run to
     *  "running": nothing is driving the phone yet. */
    note(runId, lastAction) {
      const r = runs.get(runId);
      if (!r || isTerminal(r.status)) return null;
      // Saying the same thing again is not news: a status check that is waiting
      // for a change must not be woken by it (seen live 2026-10-12 — the check
      // came back every 3 s with an identical answer while automation started).
      if (!lastAction || lastAction === r.lastAction) return r;
      r.lastAction = lastAction;
      return stamp(r);
    },

    /** The agent asked the user something. */
    ask(runId, { question, options = [], type = 'options', hint = '' }) {
      const r = runs.get(runId);
      if (!r || isTerminal(r.status)) return null;
      r.status = 'awaiting_answer';
      r.question = question;
      r.options = Array.isArray(options) ? options : [];
      r.questionType = type;
      r.hint = hint;
      r.log.push({ at: new Date(now()).toISOString(), note: `asked: ${question}` });
      return stamp(r);
    },

    /**
     * The user answered in the chat. Validated against the offered options when
     * the question was a closed one — a free-text answer to a closed question is
     * how an agent ends up acting on something nobody offered it.
     * Returns { ok: true } or { ok: false, reason, ... }.
     */
    answer(runId, uid, rawAnswer) {
      const r = runs.get(runId);
      if (!r || r.uid !== uid) return { ok: false, reason: 'no_such_run' };
      if (r.status !== 'awaiting_answer') {
        return { ok: false, reason: 'not_waiting', status: r.status };
      }
      const answer = String(rawAnswer ?? '').trim();
      if (!answer) return { ok: false, reason: 'empty_answer' };

      let chosen = answer;
      if (r.questionType === 'options' && r.options.length) {
        const hit = matchOption(answer, r.options);
        if (!hit) return { ok: false, reason: 'not_an_option', options: r.options };
        chosen = hit;
      }

      const sink = r.answerSink;
      if (typeof sink === 'function') {
        try {
          sink(chosen);
        } catch (e) {
          return { ok: false, reason: 'delivery_failed', detail: e.message };
        }
      }
      r.answers.push({ at: new Date(now()).toISOString(), question: r.question, answer: chosen });
      r.question = null;
      r.options = [];
      r.hint = '';
      r.status = 'running';
      r.lastAction = `answered: ${chosen}`;
      stamp(r);
      return { ok: true, answer: chosen, run: view(r) };
    },

    /** The agent stopped waiting on its own (askUser timed out and it moved on).
     *  Without this the run would sit in `awaiting_answer` forever from the
     *  model's point of view while the agent was already acting again. */
    clearQuestion(runId, note = 'question timed out — the agent moved on') {
      const r = runs.get(runId);
      if (!r || r.status !== 'awaiting_answer') return null;
      r.question = null;
      r.options = [];
      r.hint = '';
      r.status = 'running';
      r.log.push({ at: new Date(now()).toISOString(), note });
      return stamp(r);
    },

    finish(runId, { success, summary = null, error = null, status = null }) {
      const r = runs.get(runId);
      if (!r || isTerminal(r.status)) return null;
      r.status = status || (success ? 'completed' : 'failed');
      r.success = !!success;
      r.summary = summary;
      r.error = error;
      r.proc = null;
      r.answerSink = null;
      stamp(r);
      pruneFor(r.uid);
      return r;
    },

    /** User-initiated stop. Idempotent, and returns what actually happened so
     *  the model can say "already finished" instead of claiming it stopped it. */
    stop(runId, uid) {
      const r = runs.get(runId);
      if (!r || r.uid !== uid) return { ok: false, reason: 'no_such_run' };
      if (isTerminal(r.status)) return { ok: true, alreadyFinished: true, run: view(r) };
      const proc = r.proc;
      r.status = 'stopped';
      r.success = false;
      r.summary = 'Stopped by the user.';
      r.proc = null;
      r.answerSink = null;
      stamp(r);
      pruneFor(r.uid);
      if (proc && typeof proc.kill === 'function') {
        try { proc.kill('SIGTERM'); } catch { /* already gone */ }
      }
      return { ok: true, run: view(r) };
    },

    /** Test/ops visibility only. */
    size: () => runs.size,
  };
}
