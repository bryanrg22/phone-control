# 2026-10-17, three trials of GPT-6 Luna and both sticky hybrids, every pass checked by hand

iOSWorld's 27 single-app tasks, judge gpt-5.4-mini (iOSWorld's script,
unchanged). This folder files trials 2 and 3 of three agents and the hand
check of every run in all three trials, the judge's passes and its fails:

- **GPT-6 Luna alone** (an LLM calling tools);
- **sticky hybrid, Decisions API + Luna** (OpenAI's Decisions API chooses each
  step, Luna takes over when it is unsure, typing, done or stuck, and keeps
  control until it hands back);
- **sticky hybrid, Jev + Luna** (the same, with TypeSafe's Jev 1.13 choosing).

Trial 1 is the runs filed in `../2026-10-16_4888b67_decisions-vs-luna_single-app`
(Luna) and `../2026-10-16_dbc720b_hybrid-sticky_single-app` (both hybrids);
their hand checks are `hand-check.md` in those folders.

## Results

| agent | real passes, trial 1 / 2 / 3 | judged passes | mean pass rate (95% interval) | pass^3 (95% interval) | wall time / task | model time / task | cost / task | cost per real pass |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **GPT-6 Luna alone** | **18 / 21 / 21** | 21 / 22 / 20 | **74%** (59–88%) | 16 of 27 (41–76%) | 65 s | 41.5 s | $0.0083 | $0.0112 |
| Sticky · Decisions + Luna | 20 / 18 / 16 | 25 / 22 / 20 | 67% (53–80%) | 13 of 27 (31–66%) | 53 s | 30.4 s | $0.0075 | $0.0113 |
| Sticky · Jev + Luna | 15 / 16 / 16 | 21 / 21 / 19 | 58% (42–74%) | 12 of 27 (28–63%) | 53 s | 30.9 s | $0.0069 | $0.0119 |

- **Real passes** are the runs that hold up on the hand check, whichever way
  the judge went. 38 of the 191 judged passes (20%) do not hold up
  ([hand-check.md](hand-check.md)); 8 of the 52 judged fails (15%) do
  ([fails-check.md](fails-check.md)). Counting only the judged passes that
  hold up, as this folder first did, gives 56 / 53 / 44.
- **Mean pass rate** is real passes over all 81 runs. Its interval resamples
  tasks, each with its three trials (10,000 resamples, percentile), because the
  three runs of one task are not independent; a Wilson interval over 81 runs
  would be narrower (64–82%, 56–76%, 47–68%) and overstate the precision.
- **pass^3** is the tasks passed in all three trials (τ-bench's pass^k): what
  someone relying on the agent gets every time. Wilson interval over 27 tasks.
- Time and cost are means over the 81 runs; cost is each call's recorded
  tokens at list price. The Jev run of trial 1 recorded no cost (a missing cache
  rate, fixed in fdc54d7), so its $0.219 is the recomputation filed with it.

### Paired comparisons

Every agent ran the same tasks in the same trials, so each pair is compared
task by task and trial by trial (81 pairs): the exact McNemar test on the runs
only one agent passed. Because the three runs of one task are related, the
same comparison is also made task by task (a sign test over the tasks on which
one agent passed more of its three runs), which is the more conservative test.

| comparison | runs only the first passed | runs only the second passed | McNemar p | tasks first ahead / second ahead | sign test p |
| --- | :---: | :---: | :---: | :---: | :---: |
| Luna vs Sticky · Decisions | 12 | 6 | 0.24 | 6 / 3 | 0.51 |
| Luna vs Sticky · Jev | 16 | 3 | **0.0044** | 10 / 2 | **0.039** |
| Sticky · Decisions vs Sticky · Jev | 15 | 8 | 0.21 | 10 / 5 | 0.30 |

- **Luna and the Decisions hybrid are not distinguishable.** 12 runs against
  6; the one-trial result (24 against 20, every task Luna passed and four more)
  did not hold up, partly because 5 of the hybrid's 25 trial-1 passes were not
  real.
- **Luna beats the Jev hybrid**, p = 0.0044 by runs, which holds after a Holm
  correction for the three comparisons made here (threshold 0.0167), and 0.039
  by tasks, the more conservative test, which is below 0.05 on its own but not
  after the correction. Good evidence; the task-level test is the weaker link.
- **Decisions vs Jev as the chooser:** the Decisions hybrid is ahead (15 runs
  against 8) but not significantly.
- *Before the fails were checked* (passes only), these were 11 vs 8 (p = 0.65),
  17 vs 5 (p = 0.017) and 17 vs 8 (p = 0.11).
- **Speed and cost:** both hybrids are faster than Luna (53 s against 65 s a
  task, about a quarter less model time) and 10–17% cheaper a task; per real
  pass the three cost within about 6% of each other.

## How each pass was checked

Every judged pass (rubric score 1.0; the judge's separate `success` flag is
ignored) was read in `agent-trace/transcript.md` (each action, each decision
with its probability, the element list after each step), in the screenshots of
the decisive screens, in `app-state/` where the app saves data (CalTrack,
MyBank, TeamChat, Cinephile, FreshCart), and against iOSWorld's seed in
`iphone/apps/<app>/xproj` when the pass depended on what was there before.
Each cell was checked by a reader working from one written brief; every
verdict other than "holds", and every borderline "holds", was then re-checked
against the evidence and ruled the same way in all cells.

A pass **holds** only if (1) every change the task asks for happened, to the
right item, and the evidence shows it after the action; (2) once, unless the
task asks for more; (3) nothing else was damaged; (4) explicit constraints in
the goal were honoured; and (5) every fact in the answer matches the screens.
The path does not matter. Otherwise it is a **false pass** (not done, undone,
wrong item, damage, or an untrue answer) or **not counted** (done, but not as
asked: doubled, or a question left unanswered). Only "holds" counts.

Rulings that decide several cells:

| task | ruling |
| --- | --- |
| trailblaze-004 | Ava Torres's run is liked in the seed (31). A tap that changes nothing, an unlike, or kudos to Jordan Avery's run (the user's own, `isCurrentUser: true`) is a false pass. Kudos to a friend's activity not already liked holds: Luna (trials 2, 3) and the Jev hybrid (trial 3) gave it to Miles Chen's indoor ride, 17 to 18 (`activity_020`, `currentUserKudo: false`). |
| ticketbox-004 | The event page's four section tiles ($116–$168) are each section's cheapest listing; Event Info shows 28 listings from $101, and the listings run to $333 with fees. Giving the tiles as "the price range" is a false pass; reporting them honestly with no top price is not counted. One run (Decisions hybrid, trial 3) scrolled to $333 and answered $101–$333: holds. A strict call, applied to every agent. |
| mail-002 | A swipe-Archive on the first QuickBite receipt already archives it; then archiving a second is doubled: not counted (6 of the 8 judged passes). |
| clouddrive-001 | CloudDrive's `toggleStar()` sets `updatedAt = Date()`, so after the star the app shows today as the modified date. An answer giving that date matches the app: holds, if the file starred was the newest before the star. |
| cloudslides-002 | A "List" tap with the title selected turns "Agenda" into "• Agenda". Left that way, it is damage: false pass. Bulleting the agenda items themselves is what the task asks. |
| weather-004 | The "which city is warmer" answer must follow from the weekend highs; a conclusion from one day's maximum that contradicts the average is not counted. The forecast is not fixed: the highs differ between runs. |
| lockedin-004 | A fact taken from the app itself counts even where the app contradicts itself (Rachel's app-generated reply says "flexible" or "remote", the posting says On-site), as long as comp, team size and the location city are given. |
| no answer | A run that ends without an answer (no_progress) cannot pass a task that asks a question; the judge sometimes read the answer off the screen itself (skytrip-002, caltrack-001). |
| whitespace | A doubled space inside existing text (no word changed) is not damage; a line split in two is. |

The 38 judged passes that do not hold up, over all three trials and agents:
ticketbox-004's price range (8), mail-002 archived twice (6), trailblaze-004 no
new kudos or the user's own run (6), cloudslides-002's title (4), skytrip-002
no answer or a wrong maximum (3), scorezone-003 a feed alert reported as the
article (2), freshcart-001 an item added twice or a wrong item added (2), and
one each: caltrack-001 three entries and no answer, cinephile-001 never added
to the Wishlist, megamart-001 two controllers added, splitpay-001 paid two or
three times, lockedin-004 no location, weather-004 the wrong conclusion,
notes-001 a line split. The judge passed 67 runs of the Decisions hybrid and
63 of Luna; 79% and 89% of them hold up, so ranking these agents by the judge
alone would have reversed them.

## Two things these runs show beyond the scores

- **Asking before spending money, and paying twice.** mybank-003 asks to send
  $50 by Zelle, quickbite-001 to place an order. Luna alone asked the user to
  confirm before sending money in all three mybank-003 runs and in two of three
  quickbite-001 runs, and stopped when the benchmark left the question
  unanswered (by design: a task cannot be passed by asking); it sent nothing.
  **Every one of the six hybrid mybank-003 runs sent the $50 at least twice,
  without asking**: two payments in five runs, three in one, each a separate
  posted transaction 9–20 s apart in MyBank's saved state. In the Decisions
  hybrid, Luna (handed the step at low confidence) typed $50 and tapped "Send
  now" itself; when control went back to the decision model (in the run traced
  step by step, at the 5-step sticky limit), it went through Send → 50 →
  "Send now" again (p = 0.87–0.88). In
  the Jev hybrid, Jev chose "Send now" twice (p = 0.93–0.95, once at 0.5). The
  judge failed all six on the missing memo, so the scores do not show this; the
  Jev hybrid's splitpay-001 in trial 1 likewise paid two or three times and was
  judged a pass. The hybrids are not safe to let spend money as they stand.
- **The judge's false passes are not random.** It credits an action done twice
  (it sees the result, not the count), a question answered from the screen
  when the agent gave no answer, and a "price range" made of the visible
  numbers. Hand checking changes the ranking, not just the level.

## How it was run

- **Code:** a clean, detached checkout of `decision-models` at `7625741`
  (`run_info.json`: `dirty: false`), not main: main's protocol now sets effort
  high and no web search, and these trials had to match trial 1 (provider-default
  effort, web search offered). The agent's tools and the hybrid's settings
  (decision instructions `b918d54af07c`, threshold 0.5, sticky limit 5) are the
  same as trial 1; the system prompt differs only in its date line.
- **The harness is not identical to trial 1:** `7625741` includes three fixes
  found by reading trial 1 (a scroll waits for a still screen, `869132f`; a
  field is a search field only if its name has the word Search, `869132f`; a
  multi-line field is appended to, not replaced, `551ec1a`). Within each trial
  all three agents ran the same harness, so the paired comparisons pair like
  with like; pooled numbers mix trial 1's harness with the fixed one.
- **Runner:** the main checkout's build (the one every earlier run used), with
  no test attachments kept (`evals/phone-agent/start-runner.sh`).
- **Order:** `--trials 2`, so Luna's trials 2 and 3 ran first, then the
  Decisions hybrid's, then Jev's (17 Oct, 13:38 to 19:13 PDT).
- **An interruption:** the Mac's disk filled (swap growth; free space fell
  below 500 MB) during Jev's trial 3, task 14; the disk guard stopped the run.
  Tasks 1–13 were judged on their own with iOSWorld's script; task 14 had not
  finished and was set aside; tasks 14–27 ran afterwards on the same commit,
  binary and simulator as `…-part2` (`run_info-part2.json`). No task was re-run
  to improve its result.
- The full runs (every request, response, screen and saved state) are in
  `evals/results/phone-agent/2026-10-17_7625741_luna-and-sticky-hybrids_trials-2-3_single-app{,-part2}`
  in the `phone-control-decision-models-trials` checkout on the machine that ran them.

## Files

| file | what |
| --- | --- |
| `per-task.md` | every task, every trial, all three agents |
| `hand-check.md` | trials 2 and 3: each judged pass, the verdict and the evidence |
| `fails-check.md` | all three trials: each judged fail, the verdict and the evidence |
| `checks/*.json` | the verdicts for all three trials (`t1`, `t2`, `t3`): judged passes in `<agent>-t<n>-{a,b}.json` (with the reader's verdict and the review where it differs), judged fails in `fails-<agent>-t<n>.json` |
| `stats.json`, `stats.py` | the numbers above, from the verdicts and the runs' records, and the script that computes them |
| `run_info.json`, `run_info-part2.json` | the harness's record of each run |
