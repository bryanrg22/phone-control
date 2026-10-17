// keep-warm.mjs — keep each phone ready for its next task, without touching its screen.
//
// The first task after a phone has been idle for hours took 37 s to start on
// 2026-10-17 (run_mvcvrrv701, bringup.log): 5 s to find and clear a tunnel that
// had died while the phone slept, 3 s to build a new one, 3 s to ask for the
// phone's services, 16 s to mount the developer disk image iOS had dropped, and
// 8.5 s to start the runner. A task minutes after another started in 12-14 s.
// Only the runner start has to happen when the task arrives; the tunnel and the
// disk image can be put right beforehand.
//
// So every interval this runs the supervisor's --tunnel-only for each enrolled
// phone: a dead tunnel is rebuilt (the phone must be on Wi-Fi), a dropped disk
// image is mounted (the phone must be unlocked), and the runner is NOT started,
// so the "Automation Running" banner never appears. A phone with a task, a
// bring-up or a keep-warm already under way is skipped, and a task's bring-up
// stops a keep-warm that is running (preflight.mjs). A failure is not an error
// here: a phone on cellular, locked or switched off is simply tried again later.

/** What a --tunnel-only run did, from the supervisor's own narration. */
export function summarize({ code, lines }) {
  const text = lines.join('\n');
  const did = [];
  if (/building tunnel/.test(text)) did.push(code === 0 || /tunnel routing/.test(text) ? 'rebuilt the tunnel' : 'could not rebuild the tunnel');
  if (/auto-mount/.test(text)) did.push(code === 0 ? 'mounted the disk image' : 'could not mount the disk image');
  if (code === 0 && !did.length) return { changed: false, outcome: 'already warm' };
  if (code !== 0) {
    const why = /COLD-START ON CELLULAR|refusing \(cellular\)/.test(text) ? 'phone on cellular, so no tunnel can be built'
      : /UNREACHABLE|not answering \(unreachable\)/.test(text) ? 'phone not reachable'
        : /auto-mount failed|testmanagerd absent/.test(text) ? 'phone locked, so the disk image cannot be mounted'
          : /NOT PAIRED|TUNNEL REFUSED/.test(text) ? 'phone not accepting this host'
            : `failed (exit ${code})`;
    return { changed: true, outcome: [...did, why].join('; ') };
  }
  return { changed: true, outcome: did.join(' and ') };
}

/**
 * @param {object} o
 * @param {() => Array<{uid: string, address: string, udid: string}>} o.enrolled   the phones to keep warm
 * @param {(uid: string) => boolean} o.busy        true while that user's task is in progress
 * @param {(device: object, opts?: object) => Promise<object>} o.keepWarm   supervisor.keepWarm
 * @param {number} [o.intervalMs]                  between rounds (default 10 min; under the 15 min the disk image is trusted for)
 * @param {number} [o.firstDelayMs]                before the first round
 */
export function createKeepWarm({ enrolled, busy, keepWarm, log = () => {}, intervalMs = 10 * 60 * 1000, firstDelayMs = 30 * 1000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const last = new Map();       // address → last outcome, so a phone that stays on cellular is logged once
  let timer = null;
  let stopped = false;

  async function round() {
    let phones = [];
    try { phones = enrolled(); } catch (e) { log(`keep-warm: could not read the device registry: ${e.message}`); }
    for (const d of phones) {
      if (stopped) return;
      if (busy(d.uid)) continue;
      let r;
      try { r = await keepWarm({ address: d.address, udid: d.udid }); } catch (e) { r = { ran: true, code: null, ms: 0, lines: [String(e.message)] }; }
      if (!r.ran) continue;
      const { changed, outcome } = summarize(r);
      // Work done is always worth a line; a state (already warm, on cellular,
      // locked) only when it differs from the last round's.
      if ((changed && r.code === 0) || last.get(d.address) !== outcome) log(`keep-warm for ${d.address}: ${outcome} (${(r.ms / 1000).toFixed(1)} s)`);
      last.set(d.address, outcome);
    }
  }

  function schedule(ms) {
    if (stopped) return;
    timer = setTimer(async () => {
      try { await round(); } catch (e) { log(`keep-warm: ${e.message}`); }
      schedule(intervalMs);
    }, ms);
    if (timer?.unref) timer.unref();
  }

  return {
    start() { if (intervalMs > 0) schedule(firstDelayMs); },
    stop() { stopped = true; if (timer) clearTimer(timer); },
    round,
  };
}
