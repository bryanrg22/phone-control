# 2026-10-16, the 27 single-app tasks: four agents, the hybrid among them

iOSWorld's 27 single-app tasks, judge gpt-5.4-mini (iOSWorld's script,
unchanged), one trial each. Four agents on the same decision harness (no change
to `agent/decision/`, `elements.mjs`, `tools.mjs` or `observe.mjs` between
4888b67, c4d73d2 and 487f174):

- **Decisions API**: GPT-6 Luna through OpenAI's `/v1/decisions`, decision mode (4888b67).
- **Jev**: TypeSafe's jev-1.13.0, decision mode (c4d73d2).
- **Luna LLM**: GPT-6 Luna as the product's LLM agent (4888b67).
- **Hybrid**: the Decisions API drives and GPT-6 Luna takes a step when the
  choice is done/blocked, "write into a field", below p 0.5, or stuck for three
  steps, plus the final step (487f174, `agent/decision/escalate.mjs`).

| agent | passed (95% interval) | model time / task | wall time / task | cost / task |
| --- | --- | --- | --- | --- |
| Decisions API | 3 of 27 (4–28%) | 17.7 s | 45 s | $0.0049 |
| Jev | 2 of 27 (2–23%) | 2.2 s | 25 s | $0.0025 |
| Luna LLM | **21 of 27** (59–89%) | 41.9 s | 67 s | $0.0081 |
| Hybrid | **21 of 27** (59–89%) | 31.1 s | 54 s | $0.0099 |

`per-task.md` has every task for all four. The hybrid ran in two parts on the
same commit, because the disk filled after 13 tasks (part 1: 13 tasks, 9
passed; part 2: the other 14, 12 passed; no test errors in either). Both parts'
summaries and run_info are here; the full runs (every request, response and
screen) are under `evals/results/phone-agent/2026-10-16_487f174_hybrid_single-app{,-part2}`
in the `phone-control-hybrid` worktree. A first attempt that a second runner
on the same simulator killed is kept apart as `…_ABORTED-runner-collision` and
not counted.

## What it shows

**The hybrid matches the LLM's pass rate and is faster, not cheaper.** Same
21 of 27, with 26% less model time and 20% less wall time. It cost 22% more:

| hybrid's calls | calls | input tokens | cached | cost (27 tasks) |
| --- | --- | --- | --- | --- |
| Decisions API | 408 | 1.11M | 0% | $0.111 |
| Luna | 233 | 3.02M | 61% | $0.156 |
| (Luna alone, for comparison) | 381 | 4.72M | 65% | $0.218 |

The LLM half made 39% fewer calls and read 36% fewer tokens than Luna alone,
but the decision calls cost almost as much again: $0.0041 a task, half of
Luna's whole cost, and 232 of the 408 were handed to Luna anyway (172 low
confidence, 43 conclusions, 17 write-text), so their tokens bought nothing.

The same token counts priced with a costlier LLM in the hybrid (an estimate:
a stronger model would take different steps):

| LLM | alone, per task | in the hybrid, per task | saving |
| --- | --- | --- | --- |
| GPT-6 Luna (measured) | $0.0081 | $0.0099 | −22% |
| GPT-6.1 Sol | $0.150 | $0.113 | 25% |
| Claude Opus 5.5 | $0.301 | $0.221 | 27% |
| GPT-6 Astra | $0.809 | $0.580 | 28% |

**The two pass sets differ.** The hybrid passed cloudsheets-003, freshcart-001
and quickbite-001, which Luna failed; Luna passed cinephile-001, lockedin-004
and mail-002, which the hybrid failed. With one trial each, that is as likely
run-to-run variance as a property of either agent.

**The hybrid's six failures**, each read in `agent.log`:

- **Ping-pong** (cinephile-001, weather-004): Luna starts a plan, then the
  decision model, confidently wrong, takes the next step and undoes it.
  Weather: Luna swiped to the next city, then the decision model tapped "Add
  city" twice at p 0.57 and 0.59. Cinephile: eight steps alternating between
  two screens until the no-progress stop. This is the limit JEV-as-a-Judge
  (arXiv 2609.26550) names: confidence catches an unsure model, not a
  confidently wrong one.
- **The LLM concluded early** (mail-002, caltrack-001): "done" went to Luna as
  designed, and Luna called it complete, one criterion short each time.
- **One step short** (lockedin-004, 11 of 12; mybank-003, 6 of 7: a memo the
  rubric adds, missed by every agent).

## What would be worth trying next

1. **Sticky escalation**: once Luna takes a step, it keeps control until it
   hands back or concludes, instead of one step at a time. Aimed at the
   ping-pong, and saves the decision calls that get handed over anyway.
   (Corrected 2026-10-16: an earlier version of this README counted 6 tasks
   of the aborted attempt in the cost table.)
2. **Skip the doomed decision call**: after two low-confidence handoffs in a
   row on the same screen, call Luna directly.
3. **Jev as the chooser**: its input costs $0.042/M, against $0.10/M for the
   Decisions API; on this run that is about $0.055 instead of $0.131. Jev chose
   worse than the Decisions API alone (2 of 27 vs 3), so this needs its own run.
4. **More than one trial** before reading anything into per-task differences.

## Note added 2026-10-17: trailblaze-004 is not a real pass for any agent here

In iOSWorld's seed (`TrailBlaze/Persistence/SeedData.swift`, and the app
state after a reset on the simulator) Ava Torres's run "Twin Peaks Sunrise
Repeats" is already liked (`currentUserKudo: true`, 31), and Jordan Avery is the
user (`athlete_001`, `isCurrentUser: true`). Giving a friend kudos means a
friend's run not yet liked: Miles Chen's "Zwift Race - Crit City" (17) is next
in the feed. The rubric ("tap the kudos button on the friend's activity",
report the name and type) cannot tell giving from removing, and the judge does
not know who the user is. Separately, the first tap after a scroll landed while
the list was still moving and did nothing (fixed in 869132f: a scroll now waits
for a still screen; see `docs/research/decision-models-jev-handoff-2026-10-16.md`).
Each run below was read from its screens (the Like count and colour before and
after every tap). The judge's numbers above are unchanged.

- **Decisions API** (4888b67): the tap after the scroll changed nothing; `done`.
- **Luna LLM** (4888b67): removed the seeded like (31 to 30).
- **Hybrid** (487f174): the Like tap right after the scroll changed nothing (31,
  orange, before and after); Luna then concluded "Gave kudos to Ava Torres's
  workout".
- **Jev** (c4d73d2) was judged a fail; its tap changed nothing too.

Counted strictly: the Decisions API 2 of 27, Luna LLM 20, Hybrid 20.

## Note added 2026-10-18: every run checked by hand

Every run of the hybrid was checked against the screens, the saved app data
and the seed, by the bar the three-trial agents were checked by, passes and
fails alike ([hand-check.md](hand-check.md); verdicts in `checks/`). **14 of the
hybrid's 27 runs hold up (52%, 34–69%), not 21**: 8 of its judged passes do not
(two answers with a wrong time or price, trailblaze-004, the "• Agenda" title,
salmon added twice, no answer or not the one asked in three), and one judged
fail does (caltrack-001). Luna alone's trial 1, checked the same way, has 18,
so "the hybrid matches the LLM's pass rate" above is the judge's count and does
not hold up (18 against 14; McNemar p = 0.29 over one trial). The hybrid also
sent mybank-003's $50 three times without asking.
