// eval-rows.mjs — the rows a test record shows for an eval run. Pure.
//
// Two kinds of run leave different files:
//   connector (evals/connector/run.mjs): run_info.assistant + judge; summary.json
//     is one summary (pass_at_1, pass_at_1_ci95, pass_hat_k, trials, test_errors);
//     a later re-grade (regrade-<stamp>/summary.json) may sit beside it.
//   phone-agent (evals/phone-agent/run.mjs): run_info.models (one or more) +
//     judge; summary.json is one row per model (report.mjs: pass_rate,
//     pass_ci95, pass_hat_k, judged, test_errors).
// A record lists one row per model either way.

const pct = (x) => (x === null || x === undefined ? 'n/a' : `${Math.round(x * 100)}%`);
const interval = (p, ci) => `${pct(p)} (${pct(ci?.low)}–${pct(ci?.high)})`;

/**
 * @param {object} o
 * @param {string} o.runName
 * @param {object} o.info             run_info.json
 * @param {object|object[]} o.summary summary.json
 * @param {object|null} [o.regraded]  the latest re-grade's summary.json, connector runs only
 * @param {string|null} [o.regradedFolder]
 * @param {string} o.recordCommit     the commit the record is for
 * @param {(from: string, to: string) => string|null} [o.changedSince]  what changed in server/device/agent/evals between two commits
 */
export function evalRows({ runName, info, summary, regraded = null, regradedFolder = null, recordCommit, changedSince = () => null }) {
  const ranOn = info.git?.commit ?? info.phone_control?.commit ?? null;
  const dirty = info.git?.dirty ?? info.phone_control?.dirty ?? false;
  const common = {
    run: runName,
    judge: info.judge?.model ? `${info.judge.provider ?? ''} ${info.judge.model}`.trim() : (info.judge?.provider ?? 'none'),
    commit: ranOn ? `${ranOn.slice(0, 7)}${dirty ? '+dirty' : ''}` : 'unknown',
    differs_from_record: ranOn !== recordCommit,
    changed_since_eval: ranOn && ranOn !== recordCommit ? changedSince(ranOn, recordCommit) : null,
  };
  if (info.assistant) {
    const a = info.assistant;
    return [{
      ...common,
      assistant: a.model ? `${a.model}${a.effort ? ` (${a.effort})` : ''}` : a.kind,
      pass_at_1: interval(summary.pass_at_1, summary.pass_at_1_ci95),
      pass_hat_k: pct(summary.pass_hat_k),
      regraded: regraded ? { folder: regradedFolder, pass_at_1: interval(regraded.pass_at_1, regraded.pass_at_1_ci95), pass_hat_k: pct(regraded.pass_hat_k), cases: regraded.regraded_cases ?? 'all' } : null,
      trials: `${summary.trials} graded, ${summary.test_errors} test errors`,
    }];
  }
  if (Array.isArray(info.models)) {
    const rows = Array.isArray(summary) ? summary : [];
    return info.models.map((m) => {
      const r = rows.find((x) => x.provider === m.provider && x.model === m.model) || {};
      return {
        ...common,
        assistant: `phone agent on iOSWorld: ${m.provider}:${m.model}`,
        pass_at_1: interval(r.pass_rate, r.pass_ci95),
        pass_hat_k: pct(r.pass_hat_k),
        regraded: null,
        trials: `${r.judged ?? 0} judged of ${r.runs ?? 0} (${info.tasks?.length ?? '?'} tasks × ${info.trials ?? 1}), ${r.test_errors ?? 0} test errors`,
      };
    });
  }
  throw new Error(`${runName}: run_info.json has neither "assistant" (connector run) nor "models" (phone-agent run)`);
}
