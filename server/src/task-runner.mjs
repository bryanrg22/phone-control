// task-runner.mjs — one phone task, from "start" to a clean phone.
//
//   1. start automation on the phone        (the banner appears HERE, not before)
//   2. refuse if the phone is locked
//   3. run the agent with the chosen model
//   4. watch it: is the runner still there? is the phone still unlocked?
//   5. ALWAYS put automation down again      (the banner leaves with the task)
//
// The rule this file exists to keep: the "Automation Running" banner dims the
// screen, so it may be up only while an agent is actually driving the phone. Every exit below — finished, failed, stopped by
// the user, stopped on the phone, connection lost, this code throwing — ends in
// the same `finally`, which suspends.
//
// What a run can die of, and how each was observed on the real phone:
//   never starts      phone unreachable / on cellular with nothing warm / waiting
//                     on a passcode nobody enters
//   locked            runner stays up while locked, so the agent would tap at a
//                     lock screen — caught by reading the screen itself
//   stopped on phone  both volume buttons: the host's anchor exits at once
//   connection lost   power-off, flat battery: nothing answers
// Each becomes a sentence in the run's summary, not a generic failure.
//
// Everything is injected, so the whole state machine is tested without a phone.

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

export const TASK_LIMITS = {
  startTimeoutMs: 5 * 60 * 1000,     // a cold start after a restart + a passcode can take minutes
  startPollMs: 3000,
  watchEveryMs: 10000,
  misses: 2,                         // consecutive bad readings before acting: one blip is not a verdict
  // "Is the chat still following this task?" The assistant checks status
  // back-to-back (each check waits ~10 s on the server), so silence is rare.
  // 16–19 s gaps were the norm even when it slept between checks (measured
  // 2026-10-12), so a minute of nothing means it has stopped.
  abandonMs: 60 * 1000,
  // A status check that was CUT OFF mid-wait (the Stop button) and not followed
  // by another one is a much stronger sign, so it gets a much shorter leash.
  dropGraceMs: 15 * 1000,
  clientCheckMs: 3000,
};

export function createTaskRunner({
  store, devices, supervisor, startAgent,
  log = () => {}, sleep = sleepMs, now = Date.now, limits = {},
  returnApp = null,                  // bundle id to bring forward when a task ends, e.g. the Claude app
}) {
  if (!store || !devices || !supervisor || typeof startAgent !== 'function') {
    throw new Error('createTaskRunner requires { store, devices, supervisor, startAgent }');
  }
  const L = { ...TASK_LIMITS, ...limits };
  const terminal = (run) => ['completed', 'failed', 'stopped'].includes(store._raw(run.id)?.status);
  const fail = (run, summary, error) => store.finish(run.id, { success: false, summary, error: error || null });

  /**
   * Has the chat that asked for this gone away? Null while it is still there.
   * A task waiting on the USER'S answer is exempt: silence is what waiting
   * looks like, and that state has its own time limit.
   */
  function abandoned(run) {
    const r = store._raw(run.id);
    if (!r || r.status === 'awaiting_answer') return null;
    const t = now();
    if (r.clientDroppedAt && t - r.clientDroppedAt >= L.dropGraceMs) return 'The task was stopped because the chat was stopped.';
    if (t - r.lastPolledAt >= L.abandonMs) return 'The task was stopped because the chat stopped following it.';
    return null;
  }

  /** Runs for the whole task: ends it the moment nobody is listening. */
  async function watchClient(run, getProc) {
    while (!terminal(run)) {
      await sleep(L.clientCheckMs);
      if (terminal(run)) return;
      const why = abandoned(run);
      if (why) {
        log(`run ${run.id}: ${why}`);
        store.finish(run.id, { success: false, summary: why, error: 'abandoned by client', status: 'stopped' });
        const proc = getProc();
        if (proc) { try { proc.kill('SIGTERM'); } catch { /* already gone */ } }
        return;
      }
    }
  }

  /** Phase 1: get the runner up, narrating what the phone needs meanwhile. */
  async function bringUp(run, uid) {
    const deadline = now() + L.startTimeoutMs;
    for (;;) {
      if (terminal(run)) return null;                       // the user said stop while we were starting
      const s = await devices.status(uid, { start: true });
      if (s.ready) return s;
      if (s.state !== 'waking' && s.state !== 'waiting_on_phone') {
        fail(run, s.message, `could not start: ${s.state}`);
        return null;
      }
      store.note(run.id, s.message);
      if (now() >= deadline) {
        fail(run, 'Automation did not start on your phone in time. Check that it is unlocked and try again.', 'start timed out');
        return null;
      }
      await sleep(L.startPollMs);
    }
  }

  /** Phase 4: is the phone still in a state the agent can work with? */
  async function watch(run, device, proc) {
    let down = 0; let locked = 0;
    while (!terminal(run)) {
      await sleep(L.watchEveryMs);
      if (terminal(run)) return;
      const st = await supervisor.inspect(device);
      if (st && !st.runnerHealthy) {
        down += 1;
        if (down >= L.misses) {
          const why = st.lastSession && st.lastSession.endedOnDevice
            ? 'Automation was stopped on the phone itself, so the task ended.'
            : st.phoneNet === 'unreachable'
              ? 'The connection to your phone was lost during the task. It may have lost signal, been switched off, or run out of battery.'
              : 'Automation stopped unexpectedly on the phone, so the task ended.';
          log(`run ${run.id}: runner gone mid-task (${st.phoneNet}, endedOnDevice=${!!st.lastSession?.endedOnDevice})`);
          fail(run, why, 'runner lost mid-run');
          try { proc.kill('SIGTERM'); } catch { /* already gone */ }
          return;
        }
        continue;
      }
      if (st) down = 0;
      const screen = await supervisor.screenState(device);
      if (screen && screen.locked === true) {
        locked += 1;
        if (locked >= L.misses) {
          log(`run ${run.id}: phone locked mid-task`);
          fail(run, 'Your phone was locked during the task, so I stopped. Unlock it and ask me again.', 'locked mid-run');
          try { proc.kill('SIGTERM'); } catch { /* already gone */ }
          return;
        }
      } else if (screen && screen.locked === false) {
        locked = 0;
      }
    }
  }

  async function runTask({ run, uid, model }) {
    let device = null;
    let proc = null;
    let runnerWasUp = false;
    // From the first moment: if the chat goes quiet, the task ends — whether it
    // is still starting automation or already driving the phone.
    const client = watchClient(run, () => proc);
    try {
      store.note(run.id, 'Starting automation on your phone…');
      device = await bringUp(run, uid);
      if (!device) return;
      runnerWasUp = true;

      const screen = await supervisor.screenState(device);
      if (screen && screen.locked === true) {
        fail(run, 'Your phone is locked. Unlock it and ask me again.', 'locked at start');
        return;
      }
      if (terminal(run)) return;

      // Clear the top of the screen BEFORE the agent looks at it: the Claude
      // app's own "Claude's reply" banner sits there, over the back buttons,
      // until someone swipes it away. A fixed gesture, not the agent's call.
      const prep = await supervisor.prepareScreen?.(device);
      if (prep?.bannerFound) log(`run ${run.id}: banner "${prep.text}" over the screen — ${prep.cleared ? 'swiped away' : 'could NOT be cleared'} (${prep.swipes} swipe(s))`);
      if (terminal(run)) return;

      store.note(run.id, `Working on your phone with ${model.label}…`);
      ({ proc } = startAgent({ run, device, model }));
      const ended = new Promise((resolve) => { proc.once('close', resolve); proc.once('error', resolve); });
      await Promise.race([ended, watch(run, device, proc), client]);
      await Promise.race([ended, sleep(5000)]);             // let a killed agent actually exit
    } catch (e) {
      log(`run ${run.id}: task runner error: ${e?.message || e}`);
      fail(run, 'Something went wrong on the server while running the task.', String(e?.message || e).slice(0, 200));
    } finally {
      // Leave the user where their answer is — unless the task was meant to
      // leave them somewhere, or the runner is not there to do it.
      const meta = store._raw(run.id)?.meta || {};
      if (returnApp && runnerWasUp && meta.whenDone !== 'stay') {
        try {
          const back = await supervisor.launchApp?.(device, returnApp);
          if (back) log(`run ${run.id}: returned to ${returnApp} (${back.launched ? `front: ${back.foreground}` : 'could not'})`);
        } catch { /* returning is a courtesy; it must never block the cleanup below */ }
      }
      // The one promise this file makes: the phone is left clean.
      const where = device || (await devices.resolve?.(uid)) || null;
      if (where?.address) {
        // A bring-up still in flight would finish AFTER this cleanup and put the
        // banner back with no task to own it. Stop it first.
        try { if (await supervisor.cancelArm?.(where)) log(`run ${run.id}: cancelled a bring-up that was still in flight`); } catch { /* nothing in flight */ }
        try { await supervisor.suspend(where); log(`run ${run.id}: automation put down`); } catch (e) { log(`run ${run.id}: SUSPEND FAILED — banner may be showing: ${e?.message || e}`); }
      }
      if (!terminal(run)) fail(run, 'The task ended without a result.', 'no terminal state');
    }
  }

  return {
    /** Starts the lifecycle and returns at once; the run record carries progress. */
    start(ctx) {
      const done = runTask(ctx);
      done.catch((e) => log(`run ${ctx.run.id}: unhandled: ${e?.message || e}`));
      return done;
    },
  };
}
