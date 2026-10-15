// tool-api.mjs — the tools an LLM calls, independent of how they are framed.
//
// One core, three framings: MCP (Claude custom connector / ChatGPT plugin),
// REST (OpenAPI — Siri Shortcuts, Action Button, a desktop GPT Action), and
// direct import (tests). Nothing here knows about HTTP.
//
// The shape is forced by two platform facts:
//
//   • a tool call cannot block for the length of a phone task
//         → run_phone_task returns a handle immediately; the model polls.
//   • MCP elicitation is unsupported in Claude.ai (claude-ai-mcp#153 open)
//         → the server cannot ask the user anything. A question comes back as
//           DATA on get_run_status, the model asks it in the chat, and the
//           answer returns through answer_question.
//
// The tool DESCRIPTIONS are load-bearing: they are the only place the model
// learns that protocol. They are written for a model that will read them once,
// mid-conversation, and must not need a manual.
//
// Annotations (title + readOnlyHint/destructiveHint) are required by BOTH
// directories, so they are part of the definition, not decoration.

import { resolveModel, modelChoices, MODELS } from './models.mjs';

export const MAX_TASK_CHARS = 500;
export const DEFAULT_MAX_STEPS = 25;
export const HARD_MAX_STEPS = 40;

// get_run_status WAITS on the server for progress, so the model should call it
// again straight away rather than sleeping in between — sleeping is what made
// the assistant's own activity indicator read "Bash", and a gap in these calls
// is how the server notices a chat has stopped following its task.
const POLL_HINT = 'Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between.';
export const STATUS_WAIT_MS = 10000;

export const TOOL_DEFINITIONS = [
  {
    name: 'get_phone_status',
    title: 'Check whether the user\'s iPhone is connected',
    description:
      'Reports whether this user has a linked iPhone and whether it is reachable right now. '
      + 'Call this first if a phone task fails to start, or when the user asks "is my phone connected?". '
      + 'Tell the user what its message says, in your own words — it names the actual reason and what they need to do. '
      + 'It only LOOKS: it never starts automation on the phone. state "standby" means a task can start right away and nothing is running on the phone, which is the normal resting state. '
      + 'If state is waking or waiting_on_phone, call it again after a few seconds until it changes.',
    annotations: { title: 'Check phone status', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_phone_task',
    title: 'Do something on the user\'s iPhone',
    description:
      'Performs a task on the user\'s own iPhone by actually driving the screen — opening apps, tapping, typing, scrolling. '
      + 'Use it when the user asks for something to be DONE on their phone ("open LinkedIn and finish that game", "reply to Sam in Messages").\n'
      + 'This starts the task and returns immediately with a run_id; it does NOT wait for the task to finish. '
      + `After calling it you MUST follow up with get_run_status until the run reaches a final state. ${POLL_HINT}\n`
      + 'If the run comes back with a question, ask the user that question in the chat, in your own words, and send their reply with answer_question.\n'
      + 'Only one task can run at a time. Describe the whole goal in one clear sentence rather than issuing steps one at a time.',
    annotations: { title: 'Run a task on the iPhone', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to do, in plain language, as the user would say it. For example: "open LinkedIn and finish today\'s puzzle".' },
        max_steps: { type: 'integer', minimum: 1, maximum: HARD_MAX_STEPS, description: `Optional cap on agent steps (default ${DEFAULT_MAX_STEPS}).` },
        when_done: {
          type: 'string', enum: ['return', 'stay'],
          description: 'Optional. Where to leave the phone when the task ends. "return" (default) brings the Claude app back to the front so the user sees your reply. '
            + 'Use "stay" only when the point of the task is to leave the user somewhere — "open Maps and start directions", "open the camera".',
        },
        model: {
          type: 'string',
          description: 'Optional. Which AI model drives the phone for THIS task only. Pass it only when the user names one ("use Luna", "do it with Sonnet"); otherwise omit it and the user\'s default is used. '
            + `Choices: ${Object.entries(MODELS).map(([id, m]) => `${m.label} = ${id}`).join('; ')}.`,
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_run_status',
    title: 'Check how the phone task is going',
    description:
      'Returns the progress of a run: what it is doing, whether it finished, and — importantly — whether it is waiting on the user. '
      + 'It waits up to about 10 seconds for something to change before answering, so keep calling it back-to-back with no pause in between; if you stop calling it, the task on the phone is stopped.\n'
      + 'status values: starting / running / awaiting_answer / completed / failed / stopped.\n'
      + 'If status is awaiting_answer, the response carries a question (and options, if the answer is a fixed choice). '
      + 'Put that question to the user in the chat and then call answer_question. Do not answer it yourself and do not guess.\n'
      + `If status is starting or running, report the progress briefly and keep going. ${POLL_HINT}\n`
      + 'When status is completed or failed, tell the user the summary — that is the answer they asked for.',
    annotations: { title: 'Check task progress', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: { run_id: { type: 'string', description: 'Omit to check the most recent run.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'answer_question',
    title: 'Send the user\'s answer back to the running task',
    description:
      'Delivers the user\'s reply to a question the phone task asked, and the task resumes. '
      + 'Only call this with something the USER actually said in this conversation. '
      + 'If the question offered a fixed set of options, pass one of them.',
    annotations: { title: 'Answer the task\'s question', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        answer: { type: 'string', description: 'The user\'s answer, as they gave it.' },
        run_id: { type: 'string', description: 'Omit to answer the most recent run.' },
      },
      required: ['answer'],
      additionalProperties: false,
    },
  },
  {
    name: 'stop_run',
    title: 'Stop the running phone task',
    description:
      'Stops the task on the phone. Call this the moment the user says stop, cancel, or anything equivalent — before answering anything else.',
    annotations: { title: 'Stop the task', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: { run_id: { type: 'string', description: 'Omit to stop the most recent run.' } },
      additionalProperties: false,
    },
  },
];

// Present only when the connector keeps per-user preferences.
export const PREFERENCE_TOOL_DEFINITIONS = [
  {
    name: 'set_default_model',
    title: 'Change which AI model drives the phone by default',
    description:
      'Changes the model that drives the user\'s phone for all FUTURE tasks. Call it when the user says "from now on use …" or "switch to …". '
      + 'For a one-off ("use Sol for this one") pass model to run_phone_task instead and leave the default alone. '
      + `Choices: ${Object.entries(MODELS).map(([id, m]) => `${m.label} = ${id}`).join('; ')}.`,
    annotations: { title: 'Change the default model', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: { model: { type: 'string', description: 'The model to use from now on.' } },
      required: ['model'],
      additionalProperties: false,
    },
  },
];

/** The instruction block a client can surface as server instructions. */
export const SERVER_INSTRUCTIONS =
  'These tools control the user\'s own iPhone. Starting a task is asynchronous: run_phone_task returns a run_id, '
  + 'then you poll get_run_status until it is completed or failed, relaying progress briefly. '
  + 'If a run is awaiting_answer, ask the user its question in the chat and pass their reply to answer_question — '
  + 'never invent the answer. Stop immediately with stop_run if the user asks you to stop. '
  + 'The user can also stop any run on the phone itself by holding both volume buttons.';

function clampSteps(n) {
  const v = Number.isFinite(n) ? Math.floor(n) : DEFAULT_MAX_STEPS;
  return Math.max(1, Math.min(HARD_MAX_STEPS, v));
}

/**
 * @param {object} deps
 * @param {object} deps.store    run registry (src/runs.mjs)
 * @param {object} deps.devices  device resolver (src/device-resolver.mjs)
 * @param {(ctx) => Promise<void>|void} deps.startRun  launches the agent for a created run
 * @param {(msg: string) => void} [deps.log]
 */
export function createToolApi({
  store, devices, startRun, log = () => {},
  versionInfo = null,
  // Per-user default model (src/prefs.mjs) and "is this provider's key
  // set up?". Without `prefs` there is no model choice and the agent's own
  // default is used, exactly as before.
  prefs = null,
  hasProviderKey = null,
  statusWaitMs = STATUS_WAIT_MS,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  if (!store || !devices || typeof startRun !== 'function') {
    throw new Error('createToolApi requires { store, devices, startRun }');
  }

  /** Resolve an explicit run_id, else the caller's most recent run. */
  function pick(uid, runId) {
    if (runId) return store.get(runId, uid);
    const active = store.activeFor(uid);
    if (active) return active;
    return store.list(uid, 1)[0] || null;
  }

  const handlers = {
    async get_phone_status(_args, { uid }) {
      // Read-only, as its annotation promises: this never starts automation.
      const s = await devices.status(uid);
      return {
        ok: true,
        linked: s.state !== 'not_enrolled',
        // `ready` = a task can be started now. `automation_running` = the
        // runner is up on the phone at this moment (the banner is showing).
        ready: s.ready || s.startable === true,
        automation_running: s.ready === true,
        state: s.state,
        message: s.message,
        ...(prefs ? { default_model: prefs.modelFor(uid) } : {}),
        // Which code answered. Lets "is this the latest version?" be read off
        // the tool result instead of taken on trust (src/version.mjs).
        ...(versionInfo ? { server: versionInfo() } : {}),
      };
    },

    async run_phone_task(args, { uid, email }) {
      const task = String(args?.task ?? '').trim();
      if (!task) return { ok: false, error: 'missing_task', message: 'Tell me what to do on the phone.' };
      if (task.length > MAX_TASK_CHARS) {
        return {
          ok: false, error: 'task_too_long',
          message: `That task is ${task.length} characters; keep it under ${MAX_TASK_CHARS}. Say the goal in one sentence.`,
        };
      }

      // Decide the model BEFORE touching the phone: a typo or a missing key
      // must not flash the automation banner and then fail.
      let model = null;
      if (prefs) {
        model = resolveModel(args?.model ? args.model : prefs.modelFor(uid));
        if (!model) {
          return { ok: false, error: 'unknown_model', message: `I do not know a model called "${String(args?.model).slice(0, 60)}". The choices are: ${modelChoices()}.` };
        }
        if (hasProviderKey && !hasProviderKey(model.provider)) {
          return { ok: false, error: 'model_unavailable', message: `${model.label} cannot be used yet: there is no ${model.provider} API key set up on the server. Pick another model, or ask the owner to add the key.` };
        }
      }

      // Looking only — the task runner is what starts automation, so the banner
      // appears when the task begins and not a moment earlier.
      const device = await devices.status(uid);
      if (!device.ready && !device.startable) {
        return { ok: false, error: device.state, ready: false, message: device.message };
      }

      let run;
      try {
        run = store.create({
          uid, task,
          maxSteps: clampSteps(args?.max_steps),
          deviceAddress: device.address,
          meta: { email: email || '', ...(model ? { model: model.id } : {}), whenDone: args?.when_done === 'stay' ? 'stay' : 'return' },
        });
      } catch (e) {
        if (e.code === 'RUN_IN_PROGRESS') {
          return {
            ok: false, error: 'busy', run: e.run,
            message: 'A task is already running on this phone. Check it with get_run_status, or stop it first with stop_run.',
          };
        }
        throw e;
      }

      try {
        await startRun({ run, device, uid, model });
      } catch (e) {
        store.finish(run.id, { success: false, summary: 'The task could not be started.', error: e.message });
        log(`run ${run.id} failed to start: ${e.message}`);
        return { ok: false, error: 'start_failed', run_id: run.id, message: 'I could not start the task on the phone.' };
      }

      log(`run ${run.id} started for ${email || uid}: ${task.slice(0, 80)}`);
      return {
        ok: true,
        run_id: run.id,
        status: 'starting',
        ...(model ? { model: model.id } : {}),
        message: `Started on the phone${model ? ` with ${model.label}` : ''}: "${task}". ${POLL_HINT}`,
      };
    },

    async get_run_status(args, { uid, signal }) {
      let r = pick(uid, args?.run_id);
      if (!r) return { ok: false, error: 'no_such_run', message: 'There is no run to report on.' };

      // WAIT for something to change (a new step, a question, the end) instead
      // of answering the same thing over and over. The chat is "listening" for
      // as long as these calls keep arriving; one cut off mid-wait is noted.
      const raw = () => store._raw(r.run_id);
      const cancelled = () => { store.clientDropped?.(r.run_id); return { ok: false, error: 'cancelled', message: 'The status check was cancelled.' }; };
      store.polled?.(r.run_id);
      const seen = raw()?.rev;
      const waitable = (s) => s === 'starting' || s === 'running';
      const deadline = now() + statusWaitMs;
      while (statusWaitMs > 0 && waitable(raw()?.status) && raw()?.rev === seen && now() < deadline) {
        if (signal?.aborted) return cancelled();
        await sleep(250);
      }
      if (signal?.aborted) return cancelled();
      store.polled?.(r.run_id);
      r = store.get(r.run_id, uid) || r;
      const out = { ok: true, ...r };
      if (r.status === 'awaiting_answer') {
        out.message = `The task needs an answer from the user: ${r.question}`;
        out.next_step = 'Ask the user this question in the chat, then call answer_question with their reply.';
      } else if (r.status === 'starting') {
        // Nothing is driving the phone yet: say what it is waiting for.
        out.message = r.last_action || 'Starting.';
        out.next_step = POLL_HINT;
      } else if (r.status === 'running') {
        out.message = r.last_action ? `In progress — ${r.last_action} (step ${r.step}).` : 'In progress.';
        out.next_step = POLL_HINT;
      } else {
        out.message = r.summary || (r.success ? 'The task finished.' : 'The task did not finish.');
        out.next_step = 'Tell the user this result.';
      }
      return out;
    },

    async answer_question(args, { uid }) {
      const answer = String(args?.answer ?? '').trim();
      if (!answer) return { ok: false, error: 'missing_answer', message: 'I need the user\'s answer to pass on.' };
      const r = pick(uid, args?.run_id);
      if (!r) return { ok: false, error: 'no_such_run', message: 'There is no run waiting for an answer.' };

      const res = store.answer(r.run_id, uid, answer);
      if (!res.ok) {
        if (res.reason === 'not_an_option') {
          return {
            ok: false, error: 'not_an_option', options: res.options,
            message: `That is not one of the choices. The options are: ${res.options.join(', ')}. Ask the user to pick one.`,
          };
        }
        if (res.reason === 'not_waiting') {
          return { ok: false, error: 'not_waiting', status: res.status, message: 'That task is not waiting for an answer right now.' };
        }
        return { ok: false, error: res.reason, message: 'I could not deliver that answer.' };
      }
      return { ok: true, run_id: r.run_id, answer: res.answer, status: res.run.status, message: `Sent "${res.answer}" to the phone. ${POLL_HINT}` };
    },

    ...(prefs ? {
      async set_default_model(args, { uid }) {
        const m = resolveModel(args?.model);
        if (!m) return { ok: false, error: 'unknown_model', message: `I do not know a model called "${String(args?.model ?? '').slice(0, 60)}". The choices are: ${modelChoices()}.` };
        if (hasProviderKey && !hasProviderKey(m.provider)) {
          return { ok: false, error: 'model_unavailable', message: `${m.label} cannot be used yet: there is no ${m.provider} API key set up on the server.` };
        }
        prefs.setModel(uid, m.id);
        return { ok: true, default_model: m.id, message: `From now on I will use ${m.label} on your phone.` };
      },
    } : {}),

    async stop_run(args, { uid }) {
      const r = pick(uid, args?.run_id);
      if (!r) return { ok: false, error: 'no_such_run', message: 'There is nothing running to stop.' };
      const res = store.stop(r.run_id, uid);
      if (!res.ok) return { ok: false, error: res.reason, message: 'I could not stop that run.' };
      return {
        ok: true, run_id: r.run_id, status: res.run.status,
        message: res.alreadyFinished ? 'That task had already finished.' : 'Stopped the task on the phone.',
      };
    },
  };

  return {
    definitions: [
      ...TOOL_DEFINITIONS,
      ...(prefs ? PREFERENCE_TOOL_DEFINITIONS : []),
    ],
    instructions: SERVER_INSTRUCTIONS,
    has: (name) => Object.prototype.hasOwnProperty.call(handlers, name),
    /**
     * @param {string} name
     * @param {object} args
     * @param {{uid: string, email?: string}} caller  ALWAYS server-derived from
     *        the credential — never from the model's arguments. A tool must not
     *        be able to name a user.
     */
    async call(name, args, caller) {
      if (!caller?.uid) throw new Error('call requires an authenticated caller');
      if (!this.has(name)) {
        return { ok: false, error: 'unknown_tool', message: `No such tool: ${name}` };
      }
      return handlers[name](args || {}, caller);
    },
  };
}
