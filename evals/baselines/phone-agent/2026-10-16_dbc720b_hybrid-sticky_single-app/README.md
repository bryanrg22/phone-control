# 2026-10-16, sticky escalation: the hybrid with the Decisions API and with Jev

iOSWorld's 27 single-app tasks, judge gpt-5.4-mini (iOSWorld's script,
unchanged), one trial each, commit dbc720b. Both runs use `--escalation-mode
sticky`: once GPT-6 Luna takes a step it keeps control, with no decision call,
until it calls `handBack`, concludes, or has taken five steps in a row. They
differ only in the chooser: OpenAI's Decisions API (gpt-6-luna) or TypeSafe's
Jev (jev-1.13.0).

| agent | passed (95% interval) | model time / task | wall time / task | cost / task |
| --- | --- | --- | --- | --- |
| Luna alone (4888b67) | 21 of 27 (59–89%) | 41.9 s | 67 s | $0.0081 |
| Hybrid, step mode (487f174) | 21 of 27 (59–89%) | 31.1 s | 54 s | $0.0099 |
| **Hybrid, sticky, Decisions API** | **25 of 27** (77–98%) | 35.7 s | 58 s | $0.0081 |
| Hybrid, sticky, Jev | 21 of 27 (59–89%) | 36.1 s | 59 s | $0.0081 |

`per-task.md` has every task for all six agents run on this harness (the two
decision models alone passed 3 and 2). The Jev run's records carry a null cost
(Jev's price entry lacked a cache rate, fixed in fdc54d7 and cherry-picked
here); its cost above is recomputed from the recorded tokens.

| run | chooser calls | chooser cost | Luna calls | Luna input (cached) | Luna cost | total, 27 tasks |
| --- | --- | --- | --- | --- | --- | --- |
| step, Decisions API | 408 | $0.111 | 233 | 3.02M (61%) | $0.156 | $0.267 |
| sticky, Decisions API | 166 | $0.047 | 288 | 3.79M (67%) | $0.171 | $0.218 |
| sticky, Jev | 169 | $0.026 | 318 | 4.23M (67%) | $0.193 | $0.219 |
| Luna alone | – | – | 381 | 4.72M (65%) | $0.218 | $0.218 |

## What it shows

- **Sticky fixed the ping-pong.** cinephile-001 and weather-004, the two step-mode
  failures where the decision model undid Luna's plan, both passed with the
  Decisions API chooser. Chooser calls fell from 408 to 166.
- **Sticky with the Decisions API passed the most tasks of any agent: 25 of 27,
  at the same cost per task as Luna alone and 13% less wall time.** With one
  trial, the intervals overlap Luna's; it is the best result, not yet a proven
  difference.
- **Jev as the chooser saved nothing.** Its calls cost $0.021 less, but its
  choices were weaker, so Luna took 30 more steps (318 against 288), which cost
  $0.022 more. It passed 21, failing caltrack, lockedin-004, skytrip and
  weather, which the Decisions API hybrid passed.
- **Luna almost never hands back on its own**: `handBack` was called twice in
  27 tasks with the Decisions API, once with Jev. The five-step cap returns
  control nearly every time, so in practice the decision model takes the
  opening steps and the gaps between Luna's bursts of five.
- Failures of the best run: mybank-003 (a memo the rubric adds; every agent
  missed it) and quickbite-001.

## Also found during these runs

The XCTest runner kept every screenshot and snapshot it served as a test
attachment inside the simulator (24 GB in testmanagerd's Attachments), which
filled the disk twice. `start-runner.sh` now runs with both attachment
lifetimes set to keepNever (commit 3fe4a7b); confirmed on a copy of the run
file, not yet on a live runner.

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

- **Hyb sticky (Decisions API)**: Luna's first Like tap, right after a scroll,
  changed nothing; the next liked Jordan Avery's "Presidio Tempo Before Work"
  (18 to 19), the user's own run; it answered "Gave kudos to Jordan Avery's
  Run". Ava's run stayed liked (31).
- **Hyb sticky Jev**: two taps right after a scroll and a swipe changed nothing;
  the third liked Jordan Avery's run (18 to 19); same answer.
- **Decisions, Luna, Hyb step** (4888b67, 4888b67, 487f174): a tap that changed
  nothing, an unlike (31 to 30), and a tap that changed nothing; see those
  baselines' notes. **Jev** was judged a fail.

Counted strictly: Hyb sticky 24 of 27, Hyb sticky Jev 20, Luna 20, Hyb step 20,
the Decisions API 2.
