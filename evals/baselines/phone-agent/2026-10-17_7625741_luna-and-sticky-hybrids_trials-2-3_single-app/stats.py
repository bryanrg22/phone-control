"""Three-trial statistics for the hand-checked iOSWorld passes.

usage: python3 -I stats.py config.json > stats.json

config: {"agents": {"<name>": [{"cell": "<trial folder>", "checks": ["<check json>", ...]}, ...]}}
A run is a real pass when its hand check says "holds", whether the judge passed
it (evaluation.score == 1.0) or failed it. Every run must have a check, or this
fails; a trial may list "fail_checks" (verdicts on its judged fails) beside
"checks" (verdicts on its judged passes).
"""
import glob, json, math, random, sys
from itertools import combinations


def wilson(k, n, z=1.96):
    if not n: return (None, None)
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def mcnemar_exact(b, c):
    """Two-sided exact McNemar: binomial test of b vs c discordant pairs at p = 1/2."""
    n = b + c
    if n == 0: return 1.0
    k = min(b, c)
    p = sum(math.comb(n, i) for i in range(0, k + 1)) / 2 ** n
    return min(1.0, 2 * p)


def load_trial(cell, checks, fail_checks):
    verdicts = {}
    for f in checks + fail_checks:
        for e in json.load(open(f)):
            if e['task'] in verdicts: raise SystemExit(f"{e['task']} checked twice for {cell}")
            verdicts[e['task']] = e['verdict']
    out = {}
    cells = cell if isinstance(cell, list) else [cell]
    for t in sorted(f for c in cells for f in glob.glob(c + '/[0-9][0-9]-*/task.json')):
        j = json.load(open(t)); e = j.get('evaluation') or {}
        judged = e.get('score') == 1.0
        if j['task'] in out: raise SystemExit(f"{j['task']} twice in {cell}")
        if judged and j['task'] not in verdicts: raise SystemExit(f"{j['task']} in {cell}: judged pass with no hand check")
        if not judged and j['task'] not in verdicts: raise SystemExit(f"{j['task']} in {cell}: judged fail with no hand check")
        out[j['task']] = {'judged': judged, 'real': verdicts[j['task']] == 'holds', 'verdict': verdicts.get(j['task']),
                          'status': j.get('status')}
    if len(out) != 27: raise SystemExit(f'{cell}: {len(out)} tasks')
    return out


def main():
    cfg = json.load(open(sys.argv[1]))
    agents = {name: [load_trial(t.get('cells') or t['cell'], t['checks'], t.get('fail_checks', [])) for t in trials] for name, trials in cfg['agents'].items()}
    tasks = sorted(next(iter(agents.values()))[0])
    rng = random.Random(20261017)
    res = {'tasks': tasks, 'agents': {}, 'pairs': []}
    for name, trials in agents.items():
        k = len(trials)
        per_task = {t: sum(tr[t]['real'] for tr in trials) for t in tasks}
        real = [sum(tr[t]['real'] for t in tasks) for tr in trials]
        judged = [sum(tr[t]['judged'] for t in tasks) for tr in trials]
        n = 27 * k; total = sum(real)
        # Interval for the mean pass rate: resample tasks (each with all its trials),
        # since trials of one task are not independent of each other.
        boots = sorted(sum(per_task[rng.choice(tasks)] for _ in tasks) / n for _ in range(10000))
        all_k = sum(1 for t in tasks if per_task[t] == k)
        any_k = sum(1 for t in tasks if per_task[t] > 0)
        res['agents'][name] = {
            'trials': k, 'judged_per_trial': judged, 'real_per_trial': real,
            'judged_pass_holds_per_trial': [sum(tr[t]['judged'] and tr[t]['real'] for t in tasks) for tr in trials],
            'judged_fail_holds_per_trial': [sum((not tr[t]['judged']) and tr[t]['real'] for t in tasks) for tr in trials],
            'mean_pass_rate': total / n, 'mean_ci95_task_bootstrap': [boots[249], boots[9749]],
            'mean_ci95_wilson_all_trials': wilson(total, n),
            'pass_hat_k': all_k, 'pass_hat_k_ci95': wilson(all_k, 27), 'pass_at_k': any_k,
            'per_task': per_task,
            'per_trial': [{t: {'judged': tr[t]['judged'], 'real': tr[t]['real'], 'verdict': tr[t]['verdict'], 'status': tr[t]['status']} for t in tasks} for tr in trials],
        }
    for a, b in combinations(agents, 2):
        A, B = agents[a], agents[b]
        k = min(len(A), len(B))
        only_a = [(t, i + 1) for i in range(k) for t in tasks if A[i][t]['real'] and not B[i][t]['real']]
        only_b = [(t, i + 1) for i in range(k) for t in tasks if B[i][t]['real'] and not A[i][t]['real']]
        # Task-level check: per-task pass counts, sign test over tasks whose counts differ.
        ca = {t: sum(A[i][t]['real'] for i in range(k)) for t in tasks}
        cb = {t: sum(B[i][t]['real'] for i in range(k)) for t in tasks}
        ta = [t for t in tasks if ca[t] > cb[t]]; tb = [t for t in tasks if cb[t] > ca[t]]
        res['pairs'].append({'a': a, 'b': b, 'pairs': 27 * k, 'only_a': len(only_a), 'only_b': len(only_b),
                             'only_a_list': only_a, 'only_b_list': only_b, 'mcnemar_p': mcnemar_exact(len(only_a), len(only_b)),
                             'tasks_a_more': ta, 'tasks_b_more': tb, 'sign_test_p': mcnemar_exact(len(ta), len(tb))})
    json.dump(res, sys.stdout, indent=1)


main()
