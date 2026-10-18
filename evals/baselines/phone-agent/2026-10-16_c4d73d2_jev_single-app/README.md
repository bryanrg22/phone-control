# 2026-10-16, the 27 single-app tasks: TypeSafe's Jev in the decision mode

> **Checked by hand on 2026-10-17** ([hand-check.md](hand-check.md)): neither of Jev's 2 judged passes holds up; it writes no answer, so the questions the tasks ask went unanswered. The counts below are the judge's.

The phone agent on iOSWorld's 27 single-app tasks, commit `c4d73d2`, judge
gpt-5.4-mini (iOSWorld's script, unchanged), one trial. One agent: **Jev
(`jev-latest` = `jev-1.13.0`) through TypeSafe's System One endpoint** in the
decision mode (`agent/decision/`: one `choice` question per step over the
actions the harness enumerates, the state as an object, no screenshot, no text
written). The harness is the one the 2026-10-16 baseline ran on (`4888b67`)
plus two commits that change no behaviour: the provider reads Jev's request id
from the response header (`c4d73d2`); the price helper no longer makes NaN for
a model with no cache rate (`fdc54d7`, after the run; the costs here are
recomputed from the recorded tokens with it, the run's own files said `null`).

| agent | pass rate (95%) | rubric score | avg steps | model time / task | cost / task | endings |
| --- | --- | --- | --- | --- | --- | --- |
| typesafe:jev-latest (this run) | **7%** (2–23%) of 27 | 0.53 | 15.4 | 2.2 s | $0.002 | completed 11, failed 3, no_progress 13 |
| openai-decisions:gpt-6-luna (4888b67) | 11% (4–28%) of 27 | 0.61 | 15.4 | 17.7 s | $0.005 | completed 16, failed 1, no_progress 10 |
| openai:gpt-6-luna as an LLM (4888b67) | 78% (59–89%) of 27 | 0.89 | 14.1 | 41.9 s | $0.008 | completed 22, failed 2, no_progress 3 |

`summary.md`, `summary.json`, `run_info.json` are the harness's own; `per-task.md`
lists every task's verdict and failed criteria, then the three agents side by
side. The full run (every request and response, every screen, the apps' saved
data) is in `evals/results/phone-agent/2026-10-16_c4d73d2_jev_single-app` on
the machine that ran it; the clock-001 smoke run before it is
`…_c4d73d2_jev_clock-001` (same result: no_progress at 16 steps, 3 of 6).

The two passes are stayfinder-001 (4 steps, `done` at p 0.99) and ticketbox-004
(11 steps, p 0.63); both also passed under both Luna agents. Jev and Luna through
the Decisions API agree on 26 of 27 verdicts; criteria satisfied, 99 vs 113 of 193.
A note on the rule: the judge's holistic `success` flag was true for mybank-003
(Zelle sent, no memo), but a task passes only when every criterion holds, as
iOSWorld counts it (its own summary says 2 passes).

What the 25 failures are, each read in `agent.log` (the chosen option and the
probabilities at every step), the judge's reasons, and where it mattered the
element list the model was given and the final screen:

- **2 did every action and only lacked the answer** (tasterank-001: saved to
  Want to Try, `done` at p 1.00; trailblaze-004: kudos given, `done` at 0.82).
  `done` carries a fixed summary. With an answer step they pass: 4 of 27.
- **7 needed written text**: lockedin-003/004, quickchat-003, teamchat-003,
  notes-001, clouddocs-004, cloudslides-002, the same seven as Luna's decision
  run. Jev did damage on the way: it typed the search phrase "launch plan" into
  the document body ten times (clouddocs), replaced slide 2's agenda with the
  word "safety" and said `done` at 0.73 (cloudslides), sent "Brooklyn Half"
  twice as the reply (quickchat) and "Follow" as the reply to Rachel (lockedin-004).
- **3 needed a control the element list did not have** (a limit of the
  text-only mode; the LLM passed all three from the screenshot, Luna's decision
  run failed all three):
  - splitpay-001: the amount, the note and "Pay" were right; the Confirm
    Payment sheet then exposed nothing (the list shrank to the app and the
    covered "Pay" at 61.8%), and Jev tapped that covered button six times at
    p 0.95 → 0.49 while the sheet's "Pay $32.50" sat at 90%, unlisted.
  - dinespot-001: "Confirm Reservation" is listed at (50%, 90.4%), size
    370×64, the full-width container; the red button is drawn at its left
    (about 30%), so the tap at the centre, chosen at p 1.00, missed; `done`
    at 0.56 on the unchanged Review Booking screen.
  - mail-002: in Select mode, tapping the QuickBite row's circle toggled it six
    times; among the 126 options at each step there was never an Archive,
    Move or Trash (the selection toolbar is not in the tree).
- **13 are the model's judgment**:
  - `done` too early, 5: caltrack-001 (step 3, p 0.75, after tapping a food
    row, no search or add), cityride-001 (p 0.68 on the ride sheet with
    "Request CityRideX" offered), scorezone-003 (p 0.47 on the Scores tab, no
    article read), clouddrive-001 (p 0.60 after a "Favorite" tap whose effect
    neither the judge nor the saved state shows; no answer), mybank-003 (p 0.80
    before the memo).
  - repeating a tap that changed nothing, which the instruction forbids and
    the history marks, 4: clock-001 (the hour wheel ten times at p 0.3–0.7,
    "Set picker wheel … by tapping it and typing 6:45 AM" offered every step at
    ≤ 0.04), megamart-001 (the product's title text six times with "Add to
    cart" in the list), cinephile-001 (a result label five times with the
    result card offered), freshcart-001 (the search field eight times after
    landing on the wrong store).
  - multi-step controls and long lists with no goal value, 4: skytrip-002
    (the date picker, no search run), weather-004 (Add city / Done three times,
    Dallas never opened), cloudsheets-003 (edited a shift cell "Morning" to
    "Pending", then hide-keyboard five times, each reported as failed),
    quickbite-001 (typed the delivery address into the restaurant search ten
    times, `blocked` at p 0.14).

Cost and speed: 1.58M input tokens at $0.042/M = **$0.07 for the 27**
($0.002 a task; the 177k output tokens Jev reports are not priced). Every call
answered first time (417 calls, all 200, no retries) in about 0.14 s: 2.2 s of model time a
task against 17.7 s for the Decisions API and 41.9 s for the LLM. Wall time a
task was 82–160 s, almost all of it iOSWorld's reset.

Calibration (27 points, too few): the 11 runs that ended with `done` passed 1
of 2 at p ≥ 0.95, 0 of 2 at 0.8–0.95, 1 of 6 at 0.5–0.8, 0 of 1 below 0.5; the
16 that never said `done` passed 0. Jev's `confidence` was the chosen
option's probability within 0.06 on 415 of 417 steps (mean gap 0.02); the two
outliers were the final `blocked` of the two 50-step runs (0.73 vs 0.46,
0.86 vs 0.72). The mean probability on
the chosen action was 0.52 (Luna's decision run: 0.54).

## Note added 2026-10-17: trailblaze-004

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

- Jev's verdict here (fail, 3 of 5) stands, but "kudos given" above is wrong:
  its one Like tap came right after the scroll and changed nothing (31, orange,
  before and after). With an answer step it would not have passed: 3 of 27,
  not 4.
- The two Luna passes in the comparison table (4888b67) are not real either: the
  Decisions API's tap changed nothing, and Luna LLM removed the seeded like
  (31 to 30). See that baseline's note.
