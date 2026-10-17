# 2026-10-16/17, the writer-only hybrid: a decision model picks, an LLM only writes

iOSWorld's 27 single-app tasks, judge gpt-5.4-mini (iOSWorld's script,
unchanged), one trial each, commit `75c3f2c` (`--writer`, `agent/decision/writer.mjs`).
The commit is reverted on `decision-models` in a5127cb: these files are its
record. Check out 75c3f2c to reproduce it.

The decision model picks every step. GPT-6 Luna is called with no tools, and
only for two things a chooser cannot do. When a "write into <field>" option is
chosen, Luna composes the text from the screenshot, task and history, and the
harness types it or replaces the field's text with it. When `done` is chosen,
Luna writes the answer from the final screen. Two choosers: TypeSafe's Jev
(jev-1.13.0) and OpenAI's Decisions API (gpt-6-luna).

| agent | judged passes | passes that hold up | model time / task | wall time / task | cost / task |
| --- | --- | --- | --- | --- | --- |
| Jev alone (c4d73d2) | 2 | – | 2.2 s | 25 s | $0.0025 |
| Decisions API alone (4888b67) | 3 | – | 17.7 s | 45 s | $0.0049 |
| **Jev + Luna writer** | 8 (30%) | **5** | 7.3 s | 40 s | $0.0029 |
| **Decisions + Luna writer** | 10 (37%) | **7** | 9.6 s | 47 s | $0.0052 |
| GPT-6 Luna alone (4888b67) | 21 | – | 41.9 s | 67 s | $0.0081 |
| sticky hybrid, Jev (dbc720b) | 21 | – | 36.1 s | 59 s | $0.0081 |
| sticky hybrid, Decisions API (dbc720b) | 25 | – | 35.7 s | 58 s | $0.0081 |

"Passes that hold up" is my check of every judged pass in `agent.log`, the
screens, and the saved state where the app keeps one (`per-task.md` has each).
The other rows are the judge's counts as filed; their passes were not
re-checked this way.

| cell | chooser calls | chooser cost | writer calls | writer input | writer cost | total, 27 tasks |
| --- | --- | --- | --- | --- | --- | --- |
| Jev + writer | 373 | $0.061 | 36 | 117k | $0.017 | $0.078 |
| Decisions + writer | 462 | $0.123 | 37 | 127k | $0.018 | $0.141 |

Split from the traces in `cost-by-model.json`, each call priced at its own
model's list price.

## What it shows

- **Writing is worth about 3 to 5 tasks, not 18.** The writer took Jev from 2
  to 5 tasks that hold up, and the Decisions API from 3 to 7. The gains are the
  tasks that needed only text or an answer: lockedin-003 and quickchat-003
  (a message composed and sent), scorezone-003, stayfinder-001, tasterank-001,
  megamart-001 and teamchat-003 (the answer read from the screen). The sticky
  hybrid, where Luna also takes the steps the chooser is unsure of, passed 21
  and 25 at about 1.6 to 2.8 times the cost per task.
- **The writer's answer creates false passes.** When `done` was chosen on a
  screen that looked finished, Luna described what should have happened, and
  the judge believed it. caltrack-001 (Jev): one food row tapped, nothing
  logged, answer "Logged 1 serving of oatmeal". clouddrive-001 (Jev): a star
  tap that changed nothing, answer "I starred Q3 Planning Brief". On screens
  that plainly showed unfinished work it was honest instead (cityride-001:
  "the ride request has not yet been submitted"; mail-002, notes-001).
- **Rewriting a multi-line field damages it.** The rewrite option replaces the
  field's text with select-all then type, and select-all there is a triple tap,
  which in a text view selects one paragraph. Luna's full rewrite was pasted
  over that paragraph: notes-001 and clouddocs-004 duplicated their content in
  both cells; in notes-001 (Decisions) the Today list was overwritten.
- **The chooser's loops are untouched.** 11 of Jev's 19 failures and 9 of the
  Decisions cell's 17 are the chooser repeating a no-op tap or alternating
  between two screens until the no-progress stop (cinephile, clock, dinespot,
  freshcart, mail, megamart, quickbite, skytrip, splitpay, weather,
  cloudsheets). A writer cannot help there; this is what the sticky hybrid fixes.
- **Jev opened Safari** for ticketbox-004 instead of TicketBox, found iOSWorld's
  own trajectories page for that task on iosworld.io, and tapped a reCAPTCHA.
  It failed, but a browser can reach the benchmark's answers.

## Found on the way, affecting every run on this harness

- **trailblaze-004 is a pass the judge cannot check.** In the seed, Ava
  Torres's run is already liked (31, orange). The first Like tap after the
  scroll lands while the list is still moving and does nothing; a second tap
  removes the like (31 to 30). Traced in the filed runs (corrected
  2026-10-17): the Decisions API alone (4888b67) tapped once and changed
  nothing, and was judged a pass; Jev alone (c4d73d2) did the same and was
  judged a fail (no answer); Luna alone (4888b67) went 31 to 30, judged a pass;
  the step hybrid (487f174) tapped once and changed nothing, judged a pass. The
  sticky hybrids (dbc720b) liked Jordan Avery's run, which is the user's own
  (`isCurrentUser: true` in the seed), judged passes. Each of those baselines
  now carries a note. Not counted here.
- **The search-field test matches "Research".** `candidates.mjs` treats a field
  as a search field when its description contains "search", so the agenda field
  ("Threat models / Research gaps / …") got "Search for safety" options and lost
  its write option. That option overwrote "Research gaps" in cloudslides-002
  (Decisions), which the judge passed. Fixed in 869132f: the field's name
  (label or placeholder) must have the word Search.
- **The first tap after a scroll is swallowed** (trailblaze in every run, the
  list shifting about 4% between the screens): the 350 ms settle is shorter
  than the scroll's deceleration (about 2 s after the swipe call returns,
  measured 2026-10-17). Fixed in 869132f: scroll and swipe wait for the
  runner's /isScreenStatic, as Maestro does.

## How it was run

Both cells ran from a clean detached checkout at 75c3f2c, against the same
simulator and the same runner binary (the main checkout's build, without the
diagnostic code in decision-models' working tree). The machine shut down during
the Decisions cell's task 19 (scorezone-003). That task's partial folder was set
aside. The 18 finished tasks were judged on their own with iOSWorld's script,
and the last 9 ran as `…_single-app-part2` after a restart, with the runner
keeping no test attachments (3fe4a7b's setting). `summary.md` and `summary.json`
merge the two parts through the run's own `report.mjs`; `run_info-part1.json`
and `-part2.json` are the harness's records of each. The full runs (every
request, response, screen and saved state) are under
`evals/results/phone-agent/2026-10-16_75c3f2c_writer-hybrids_single-app{,-part2}`
in the `phone-control-decision-models-run` checkout on the machine that ran them.
