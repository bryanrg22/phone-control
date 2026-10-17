# Decision models for the phone agent: Jev and OpenAI's Decisions API (handoff, 2026-10-16)

Research done in the evals session of 2026-10-16, before any code. Work on this
in a separate session, on the branch `decision-models` (from `main` at the commit
that added this file). Nothing below is a result yet; every number marked
*vendor* is the vendor's own claim.

## What these are

Both return a **typed decision with calibrated probabilities instead of text**:
a choice among options you list, a yes/no probability, or a score on a rubric.
Neither writes tool arguments. They are a fast, cheap "which one" layer, not a
generative agent.

| | OpenAI Decisions API | TypeSafe Jev |
| --- | --- | --- |
| Endpoint | `POST https://api.openai.com/v1/decisions` (public beta; GA "in the coming weeks") | `POST https://api.typesafe.ai/v1/systemone` (also via OpenRouter `/api/alpha/decisions`, DigitalOcean) |
| Auth | the project's `OPENAI_API_KEY` (works: a real call returned 200 on 2026-10-16) | `Authorization: Bearer $TYPESAFE_API_KEY`; SDKs read that env var |
| Model | `gpt-6-luna` only | `jev-latest` = `jev-1.13.0`; `jev-preview` = `jev-1.14.0` (from 2026-10-14) |
| Request | `{ model, input: string \| [{role:'user', content:[{type:'input_text'},{type:'input_image', image_url:'data:…;base64,…'}]}], questions: [{ type: 'predicate'\|'choice'\|'score', name, instructions, choices: [{value, description}] \| levels: [{label, description}] }] }` | `{ model, state: string \| object, questions: { <id>: { type: 'choice'\|'noul'\|'score'\|'box', instructions, criteria: {<option>: description} \| [levels] } }, assets?: {…} }` |
| Response | `answers: [{ type, name, choice, probabilities: [{value, probability}], confidence }]`; predicate → `probability`; score → `score` (probability-weighted level index) | `answers: { <id>: { type, choice, probabilities: {option: p}, confidence } }`; noul → `noul` (0–1); score → `score`, `legend`; plus `usage.input_tokens` |
| Images | inline base64 data URLs only (no http URLs, no file ids); docs give no size limits | yes on 1.13 and 1.14 with header `TypeSafe-Danger-Zone-Images: true`; images go in a top-level `assets` map (`data_base64` without the `data:` prefix, `format` png/jpg) and are referenced by key from `state`; 280–1568 px per side; "not yet ready for production" |
| Visual grounding | none | **Box** (Jev 1.14 only): returns `{top,bottom,left,right}` as fractions of the image for "the Save button" — a tap target without an element tree |
| Limits | not published (no max choices/questions stated) | 255 options per choice; 64k tokens per request, 32k per question; 262k with `TypeSafe-Danger-Zone-Long-Context: true` ("slower and less accurate") |
| Price | $0.10 / M input tokens, output free, no cache charges | $0.042 / M input tokens, output free |
| Latency | measured here: **0.51 s cold, then 0.12–0.13 s** for a 7-option screen choice (OpenAI's slide: 150 ms vs 1.6 s for Luna) | not measured yet (key was empty at the time); OpenRouter telemetry p50 0.21 s, p95 0.34 s, p99 0.75 s (2026-10-01) |

Primary sources: OpenAI's guide (developers.openai.com/api/docs/guides/decisions),
TypeSafe's docs (docs.typesafe.ai: `introduction/quickstart`, `primitives/choice`,
`images`, `models`, `primitives/box`, `sdk/javascript`), OpenRouter's Jev guide.

## What the measured call looked like (Decisions API, 2026-10-16)

Input: the task ("set a 6:45 AM alarm labelled Gym") and a Clock-app screen as
a numbered element list; question: a `choice` over the tappable elements plus
`done` and `blocked`. Answer: element 2 ("tap Add") at probability 0.98, the
rest ≤ 0.01. Three calls: 0.51 s, 0.125 s, 0.119 s.

## How people wired them for automation (what is actually known)

- TypeSafe's own line: Jev is for routing, triage, gating and judging; their
  cookbook "function_calling" picks WHICH tool to call, and "Gate Agent Tool
  Calls" checks a risky call against the user's request. Their CEO said screen
  and computer-use decisions are "in progress" (JevBench thread, Show HN).
- The browser-automation claims ("Jev-Ultrafast", WebVoyager 80.4 / 98.5) are
  vendor- or blog-reported, inconsistent across sources, and unreproduced. The
  described loop: a harness enumerates candidate actions (operation + target),
  the model picks one; typing is handled outside the model.
- No published recipe for iOS or any accessibility-tree agent exists. Critics
  (Show HN) note the harness does the real work: the model only chooses.

## The design to try here

Our agent already produces the two things a decision model needs: a **text
element list** of the screen (`agent/elements.mjs`, ≤150 lines with labels,
values, positions) and a fixed tool set. A `decision` agent mode would, each
step:

1. Build the candidate actions from the element list: `tap <element>` for every
   tappable element, `scroll`, `back/home`, `done`, `blocked` — and, when a text
   field is focused or named in the task, `type <phrase>` for phrases lifted
   from the task text (quoted strings, times, names).
2. Ask ONE `choice` question: task + screen list → which candidate. Jev takes
   the list as `state`; the Decisions API as `input` (optionally with the
   screenshot as an image, which Jev 1.14 can also take).
3. Execute it through the existing tools, observe, repeat; stop on `done`
   (then call `taskComplete` with a fixed summary) or `blocked`.
4. Keep every call in the run record (`agent/record.mjs`) with the same OTel
   fields, so `evals/phone-agent` scores it with iOSWorld's judge unchanged and
   `report.mjs` compares steps, time and cost against the LLM runs.

Expected weaknesses to measure, not assume: free text (labels, messages) that
is not in the task; multi-step plans that need memory; low confidence on long
lists (TypeSafe's "jaggedness" page says accuracy falls as irrelevant state
grows, so trim the list to on-screen interactive elements).

## Testing plan (the same discipline as the rest of `evals/`)

- Unit: candidate enumeration from fixture hierarchies (`agent/test/fixtures/`),
  the request builders for both APIs (field names exactly as above), parsing
  of answers and confidences, the stop rule. Provider stubs, no network.
- Tool checks: `e2e/tools-on-simulator.mjs` already covers the tools; nothing
  new needed unless Box-based tapping is added (then: a Box tap lands on the
  element it names, checked against the element tree).
- Evals: `evals/phone-agent/run.mjs` with the new provider, first on
  `clock-001`, then the 27 single-app tasks, then all 133, beside the LLM
  baselines of the same commit. Report pass rate (Wilson), steps, model seconds
  per step, cost per task, and confidence calibration (does the answer's
  probability predict the judge's verdict? plot reliability by bucket).
- Record the preview status of both APIs in `run_info.json` (model version,
  headers used); both say their formats may change.

## Open before any run

- `TYPESAFE_API_KEY` in `~/dev/GitHub/ios-agent_automation/.env` was present
  but **empty** for most of 2026-10-16 (the silent prompt lost the paste); it
  was re-added by hand in the evening and the live call below went through.
- Which Jev version: 1.13 (stable) for text-only choices, 1.14 (preview) if
  Box or images are used; say which in every result.
- Whether to feed the screenshot at all: start text-only (the element list),
  since that is what both models are built for and what makes them fast.

## Results so far (branch `decision-models`, 2026-10-16)

Implemented: `agent/decision/` (candidates, question, loop), providers
`openai-decisions` and `typesafe`, the record's `eval.decision`, the report's
calibration table. 78 unit checks in `agent/test/decision.test.mjs`.

**Decisions API, verified live** (three calls on the Add Alarm fixture, 16
options): 315 ms cold then 101–157 ms; `usage` = input tokens only, cached 0;
the answer carries a probability for every option. Rate-limit headers: 10,000
requests/min, 10M tokens/min.

**Jev, verified live** (2026-10-16, after the key was re-added; three calls on
the Add Alarm fixture, 24 options, request 4.3 kB): 200 in 225 ms cold, then
207 and 196 ms; `model` = `jev-1.13.0`; `usage` = `{ input_tokens: 2440,
output_tokens: 238 }` (only input is priced: 2440 × $0.042/M ≈ $0.0001 a
step); the answer carries a probability for every option, summing to ~1, plus
`confidence` (0.61, 0.58, 0.51 across the three calls: the same input gives a
slightly different distribution each time). The response has no top-level
`id`; the request id is the `x-typesafe-request-id` header, which the provider
now records as `responseId`. Every field `parseJevAnswer` reads was present;
no other change was needed. On this screen (keyboard up, label typed) Jev
chose "Tap picker wheel = 38 minutes" at p=0.63/0.60/0.53, with "Press Return"
second at 0.21, "Save" at 0.05.

**clock-001, Decisions API (`gpt-6-luna`), three runs while the candidate set was
being corrected** (each run on a committed tree; folders under `evals/results/phone-agent/`):

| run | commit | result | steps | model time | agent time | cost |
| --- | --- | --- | --- | --- | --- | --- |
| `smoke-decisions-clock-001` | ad69a0f | 5 of 6 criteria: label became "Gym6:45 AM" | 19 | 5.6 s | 29 s | $0.003 |
| `…-named-fields` | dd2d29b | 2 of 6: typed with no field focused, no_progress stop | 10 | 1.5 s | 17 s | $0.001 |
| `…-compound-typing` | 033f3f2 | **passed, 6 of 6** | 8 | 1.6 s | 15 s | $0.001 |

What changed between runs, and why: a typing option first said only "into the
focused text field" (run 1 typed the time phrase into the label); then named
its field (run 2 chose it three times without tapping the field: a memoryless
chooser cannot plan tap-then-type); now it is one option that taps the named
field, then types, as the LLM's replaceText and typeAndSubmit bundle steps.
Run 1 also showed iOS picker wheels take typed digits once tapped (the model
set 6:45 by tapping the hour wheel and typing "6:45 AM"), so wheels are typing
targets for phrases that start with a digit.

The seven LLM baselines on the same task (`smoke-7-models-clock-001-after-fixes`,
2026-10-15, a different commit): all passed; 9–14 steps; 29–74 s of model time;
$0.008 (Luna) to $0.99 (Fable). The decision run's probability on "done" was
0.97 (passed), 0.5 (failed) and none (no_progress): one point each, nothing to
read yet.

Known gaps to measure on the 27 single-app tasks, not fix first: no option
replaces a field's text (typing appends); `done` carries no answer, so tasks
that ask for information cannot pass; low-confidence steps (p 0.2–0.5) on the
Add Alarm sheet in every run.

## The 27 single-app tasks, Decisions API (`gpt-6-luna`), commit de1cb39

Run `evals/results/phone-agent/2026-10-16_de1cb39_decisions-luna_single-app`
(judge gpt-5.4-mini, unchanged). **4 of 27 passed (15%, 95% interval 6–32%)**,
rubric score 0.58; 21.7 steps on average, **3.3 s of model time per task**,
33.5 s per task in all, **$0.007 per task** ($0.18 for the run). 651 tool calls,
none failed. 15 runs ended with `done`, 12 with the no-progress stop.

Passed: caltrack-001, clock-001, stayfinder-001, ticketbox-004.

Every failure read (`agent.log`, the judge's reasons, the screens in the trace):

| cause | tasks | what the log shows |
| --- | --- | --- |
| **Harness: taps under the open keyboard** | cinephile-001, megamart-001 | The element list does not know what the keyboard covers; the model tapped a result row at 66% that sat behind the predictions bar at 64%, which typed "The" / "j" into the search field. The LLM prompt warns about this; the decision mode offered the tap. |
| **Harness: typing appends, never replaces** | skytrip-002, cityride-001 | "ATL" became "ATLSFOSFO"; the destination field held "Work" and the only option was to append. |
| **Harness: a custom number pad** | splitpay-001 | The amount is entered on the app's own keypad (buttons "1".."9", "."); the model tapped 1, 2, 5, then Backspace nine times. No option enters a number on a keypad. |
| **No free text** (expected) | lockedin-003, lockedin-004, quickchat-003, teamchat-003, notes-001, clouddocs-004, cloudslides-002 | A reply, a bullet, a note: a decision model writes nothing, and the task gives no phrase to type. |
| **No answer** (expected) | tasterank-001 (5/7, both misses are "report …"), clouddrive-001, dinespot-001, mail-002 ("confirm it was archived"), mybank-003 (a memo the rubric adds) | `done` carries a fixed summary. |
| **Lost, low confidence** | trailblaze-004 (`done` at p 0.15 after 4 steps), scorezone-003, weather-004, freshcart-001, quickbite-001, cloudsheets-003 | Steps at p 0.1–0.3 on long lists; freshcart's "avocados" is lowercase and never became a phrase. |

Calibration, from 27 points: runs that ended with `done` at p ≥ 0.95 passed 2 of
5; at p < 0.5, 1 of 5; the 12 no-progress runs 0. Too few to plot, but the
direction is right.

**Fixed after this run (commit after de1cb39):** taps under an open keyboard
are not offered and "hide the keyboard" is; a single-line field with text is
replaced (the `replaceText` tool, found by the field's label or placeholder), a
text view is appended to. Not fixed: keypad entry, free text, answers.

**LLM comparison on the same 27 tasks: not run yet** (the only LLM evidence on
this harness is clock-001 ×7 and the two-task pilot on main). iOSWorld's paper
reports vision+XML LLM agents far above 15% on single-app tasks; the number to
beat is the same-commit run of one LLM.

## Re-run of the four harness-affected tasks, commit 541a83a

`2026-10-16_541a83a_decisions-luna_four-fixed`: 0 of 4 passed, but the two fixes
did what they were for (no stray letters typed; "ATL" was replaced by "SFO"),
and the screens showed the next layer:

- **Result rows under the keyboard.** With the keyboard up only a row's title
  text was reachable; tapping it did nothing (cinephile, megamart). The LLM's
  `typeAndSubmit` presses Return after typing, which closes the keyboard and
  runs the search. Fixed: a search field also gets "Search for X: type it and
  press Return" (tap, type, Return in one option).
- **The model never saw a tool's answer.** `hideKeyboard` reported "Keyboard is
  still up" and was chosen five times in a row. Fixed: when a step changed
  nothing or a tool reported a problem, its first line is shown in the history.
- **Two fields with one label.** SkyTrip's from/to fields are both "Airport";
  replace-by-label hit the first one twice ("SFOJFK"). Fixed: replacing is by
  position, through `replaceTextAt`, a tool the LLM is not offered (its tool
  list and hash are unchanged).
- cityride-001 ended with `done` at p 0.21 after 3 steps; trailblaze-004 did the
  same at p 0.15 in the 27. A rule "a conclusion needs p ≥ 0.5, otherwise the
  best other option runs" is how TypeSafe says to use calibrated answers; not
  applied yet, since it is a policy, to be measured as a variant.

## The four tasks again, on e478080 (code; run from 0d9b5e1)

`…_four-fixed-2` is a test error (every run ended at its first call with
OpenAI's 429 `insufficient_quota`; credits were added). `…_four-fixed-3`:
**1 of 4 passed**, and each fix did its job on the device:

| task | result | what the log shows |
| --- | --- | --- |
| megamart-001 | **passed** (6/6, 10 steps) | "Search for PS5 Controller … and press Return" chosen, the result row reachable, Add to cart tapped |
| cinephile-001 | 5/6, missed "Add to Wishlist" | the search-and-submit option was chosen (p 0.84); the movie page was reached at step 14 and `done` chosen at p 0.48 without the wishlist |
| skytrip-002 | 3/8 | both airports replaced correctly ("ATL"→"SFO", "LAX"→"JFK", the second field by position); then a date picker: "Previous Month" ×4, the year wheel, no date set |
| cityride-001 | 5/7 | "Where to?" tapped, then `done` at **p 0.15** after 3 steps (the same as the 27-run) |

So the harness defects found so far are closed; what is left on these tasks is
the model's judgment: conclusions at p 0.15–0.48, and multi-step controls
(a date picker) with no notion of the goal date. The two candidate policies to
measure next, as variants, not defaults: a conclusion threshold (`done`
needs p ≥ 0.5), and a date-picker option that enters a date in one step.

Next, in order: add `TYPESAFE_API_KEY`; the 27 single-app tasks again on this
harness with both decision models beside one LLM (GPT-6 Luna, $0.008 a task on
clock-001) on the same commit; then the policies above as variants.

## Result: the 27 single-app tasks, both modes, one commit (4888b67)

Baseline: `evals/baselines/phone-agent/2026-10-16_4888b67_decisions-vs-luna_single-app/`.

| agent | pass rate | rubric | steps | model time / task | cost / task |
| --- | --- | --- | --- | --- | --- |
| Decisions API, gpt-6-luna (decision mode, harness fixed) | **3 of 27 (11%)** | 0.61 | 15.4 | 17.7 s | $0.005 |
| gpt-6-luna as an LLM (the product's loop) | **21 of 27 (78%)** | 0.89 | 14.1 | 41.9 s | $0.008 |

The harness fixes moved which tasks pass, not how many (4, then 3 of 27). Read
per failure: 3 runs did every action and only lacked an answer; 7 needed
written text; 14 were the model's judgment (conclusions at p 0.15–0.5, controls
that need a goal value, long lists with every option near p 0.2). The decision
mode's own promise held: input tokens only, no text, 0.1–0.3 s a call when
the API is quick (it was 3–9 s on 49 of 417 calls this afternoon). It did not
make the agent cheaper in practice: Luna as an LLM, with caching, costs about
the same per task and passes seven times as many.

What would be worth measuring next, if anything: (1) an answer step, one LLM
call over the final screen when the decision model says `done` (+3 here);
(2) a conclusion threshold (`done` needs p ≥ 0.5) and goal-valued options for
pickers and keypads; (3) Jev, once `TYPESAFE_API_KEY` exists, on the same 27
with the same harness (the provider is built and unit-tested; nothing else
changes). The free-text class (7 of 27 here) stays out of reach by design.

## Result: Jev on the same 27 (c4d73d2, 2026-10-16 evening)

Baseline: `evals/baselines/phone-agent/2026-10-16_c4d73d2_jev_single-app/`
(the three agents side by side in its `per-task.md`).

| agent | pass rate | rubric | steps | model time / task | cost / task |
| --- | --- | --- | --- | --- | --- |
| Jev 1.13 (decision mode, same harness + the header fix) | **2 of 27 (7%)** | 0.53 | 15.4 | 2.2 s | $0.002 |
| Decisions API, gpt-6-luna (decision mode, 4888b67) | 3 of 27 (11%) | 0.61 | 15.4 | 17.7 s | $0.005 |
| gpt-6-luna as an LLM (4888b67) | 21 of 27 (78%) | 0.89 | 14.1 | 41.9 s | $0.008 |

Jev is what it says it is: 0.14 s a call, every call 200, $0.07 for the run,
and the same picture as the Decisions API (26 of 27 verdicts agree, 99 vs 113
criteria of 193). Read per failure: 2 lacked only the answer, 7 needed written
text (and Jev wrote the wrong thing into four of them: the search phrase into
the document, "safety" over the agenda, "Brooklyn Half" and "Follow" as
replies), 3 needed a control the element list does not carry (SplitPay's
confirm sheet is empty in the tree; DineSpot's confirm button is at the left of
a full-width frame so the centre tap misses; Mail's selection toolbar never
appears), 13 were judgment: `done` at p 0.47–0.80 with the next step offered
(5), the same no-op tap six to ten times despite "(the screen did not change)"
in the history (4), pickers, lists and a wrong field (4).

Two things only Jev showed: it ignores the history more than Luna does (clock-001:
the hour wheel ten times with the type-the-time option at ≤ 0.04; Luna's
decision run reached 5 of 6 on the same screen), and its `confidence` is the
chosen option's probability to within 0.06 on 415 of 417 steps, so it adds
nothing to the calibration table.

The ranking the handoff asked for is settled for the text-only decision mode:
LLM 21 ≫ Decisions API 3 ≈ Jev 2, at $0.008 vs $0.005 vs $0.002 a task. The
cheap modes are seven to ten times faster per task and pass a tenth as often.
What is still worth measuring, unchanged from above: an answer step (+2 here),
a conclusion threshold, goal-valued options for pickers. New from this run:
the three element-list gaps (a tap at a wide frame's leading edge; sheets and
toolbars missing from the tree) are harness work that would help both decision
models and cost nothing to the LLM mode; and Jev 1.14 with the screenshot
(`TypeSafe-Danger-Zone-Images`) is the only way to test whether the picture
closes the gap the tree leaves, at a price the docs call not production-ready.


## The hybrid: a decision model driving, an LLM taking the steps it cannot (2026-10-16/17)

Prior art, researched before building: Browser Use's jev-ultrafast (Jev picks an
operation and an element; a small separate LLM writes only TYPE_TEXT; a demo,
no benchmark) and JEV-as-a-Judge (arXiv 2609.26550: accept when confident,
escalate when unsure; confidence catches an unsure model, not a confidently
wrong one). Nothing published on mobile or on an accessibility tree.

**The hybrid kept** (`--provider hybrid`, `agent/decision/escalate.mjs`): the
decision model chooses; GPT-6 Luna, with the screenshot and the full tool set,
takes a step when the choice is done/blocked (it verifies and writes the
answer), "write into field F", below p 0.5 (fixed before any run), stuck for
three steps, or the final step. With `--escalation-mode sticky` Luna keeps
control after it takes over, with no decision calls, until it calls `handBack`,
concludes, or has taken five steps in a row.

The 27 single-app tasks, one trial each (baselines under
`evals/baselines/phone-agent/2026-10-16_487f174_hybrid_single-app/` and
`…/2026-10-16_dbc720b_hybrid-sticky_single-app/`):

| agent | passed | model time / task | wall time / task | cost / task |
| --- | --- | --- | --- | --- |
| Decisions API alone | 3 | 17.7 s | 45 s | $0.0049 |
| Jev alone | 2 | 2.2 s | 25 s | $0.0025 |
| GPT-6 Luna alone | 21 | 41.9 s | 67 s | $0.0081 |
| hybrid, step mode, Decisions API | 21 | 31.1 s | 54 s | $0.0099 |
| **hybrid, sticky, Decisions API** | **25** | 35.7 s | 58 s | $0.0081 |
| hybrid, sticky, Jev | 21 | 36.1 s | 59 s | $0.0081 |

Step mode was faster than Luna alone but cost more: 232 of its 408 decision
calls were handed to Luna anyway, and the decision model, confidently wrong,
undid Luna's plan (weather-004, cinephile-001). Sticky mode cut decision calls
to 166 and passed both. Jev as the chooser saved $0.021 on its calls and cost
$0.022 more in Luna steps. Luna called `handBack` three times in 54 tasks; the
cap returns control. The low-confidence threshold is about right: when the
decision model was unsure, Luna did something else 67–83% of the time.

Measured, not yet tried: a decision request is 31% element list and 55%
choices, and every tap choice already names its element, so dropping the list
would cut each decision call by about a third; and every task's first decision
was "open the app" at p≈1, which the harness could do without asking.

**The writer-only hybrid, set aside** (commit 75c3f2c, reverted on this branch
in a5127cb except its harmless `listElements` value field): the decision model
picks every step, and an LLM with no tools is called only to compose text for a
"write into field F" option or the answer when `done` is chosen. It costs less
per LLM call (no tools, a short prompt) but cannot help with the judgment
failures, which were 13–14 of the 24 decision-only failures and where the kept
hybrid gains most. Its 27-task run with both choosers is filed under
`evals/baselines/phone-agent/2026-10-16_75c3f2c_writer-hybrids_single-app/`
(check out 75c3f2c to reproduce it):

| agent | judged passes | passes that hold up | model time / task | cost / task |
| --- | --- | --- | --- | --- |
| Jev + Luna writer | 8 | 5 | 7.3 s | $0.0029 |
| Decisions API + Luna writer | 10 | 7 | 9.6 s | $0.0052 |

Every judged pass was checked in the log, the screens and, where the app keeps
one, its saved state. Five did not hold up. Two were invented by the writer's
answer at `done`: caltrack-001 logged nothing, and clouddrive-001's star tap
changed nothing, yet the answers said "Logged" and "I starred". cloudslides-002
overwrote an agenda item instead of adding one. caltrack-001 (Decisions) logged
two entries. Writing added 3 to 4 real passes, the tasks that needed only text
or an answer; the chooser's loops (11 of Jev's 19 failures) are untouched,
which the sticky hybrid fixes at 1.6 to 2.8 times the cost per task.

Found on that run, affecting every run on this harness: trailblaze-004's post is
liked in the seed, so a no-op tap or an unlike is judged a pass (Jev alone and
Luna alone included); `candidates.mjs` treats any field whose text contains
"search" as a search field ("Research gaps" matched); the first tap after a
scroll is swallowed; and the writer's rewrite of a multi-line text view replaces
one paragraph, because select-all there is a triple tap.

**Disk:** the XCTest runner kept every screenshot and snapshot as a test
attachment inside the simulator (testmanagerd's Attachments, 24 GB), because
its single test never "succeeds" and the lifetime was deleteOnSuccess.
`evals/phone-agent/start-runner.sh` now sets keepNever (3fe4a7b); a runner
started before that keeps filling the disk at about 60 MB a minute while it
serves an eval.

## Three harness defects, fixed or measured (2026-10-17, commit 869132f)

**1. "Search" in a field's text.** `candidates.mjs` offered "Search for X"
(type, then Return) on any field whose description matched `/search/i`, so
CloudSlides' agenda field ("Threat models / Research gaps / ...") got them. Now
a search field is one iOS calls so, or a field whose *name* (label or
placeholder, never its text) has the word Search: CloudSlides' "Search in
Slides" is a plain text field, so the kind alone would miss it. Unit test with
the agenda field, a field named "Research notes" and the real search field; it
fails on the old test (three search options) and passes on the new (one).

**2. The first tap after a scroll.** Measured on the iOSWorld simulator
(TrailBlaze's feed, the agent's scroll: a 0.3 s swipe from 70% to 30%): the
runner's swipe call returns at ~670 ms, and the list keeps decelerating until
~2.7 s after the swipe began. At the loop's 350 ms settle a Like is at 72-73%; it
comes to rest at 60%. The runner's `/isScreenStatic` (two screenshots compared)
turned true at 2.69-2.71 s in three trials, the same moment the element tree
stopped changing. With the old timing, a tap at the observed Like 1 s later (a
decision call's time) changed nothing, 3 of 3; with the fix it toggled the like,
3 of 3 (read from the app's saved state).

The fix is Maestro's: after every swipe its iOS driver polls `isScreenStatic`
until true, up to 3000 ms (`IOSDriver.waitForAppToSettle`; its source names this
very bug, MA-4124). `scroll` and `swipe` in `tools.mjs` now do the same before
returning, so the decision loop, the LLM loop and the hybrids all get it. The
first still answer ends the wait: requiring two in a row waited out the scroll
bar's fade (~0.8 s, it moves nothing) into the cap. A scroll now takes 2.9-3.6 s
instead of 0.7 s; a bounce at the top of Settings 1.3 s. The LLM's tool
definitions and system prompt hash the same as before (checked against HEAD
for plain, webSearch and handBack tool sets), and the result text is unchanged.

**3. trailblaze-004 cannot be passed by tapping the first Like.** In the seed
(`SeedData.swift`, and the app state after a reset) Ava Torres's "Twin Peaks
Sunrise Repeats", the first post in the feed, is already liked (31), and Jordan
Avery, the second, is the user (`isCurrentUser: true`). Giving a friend kudos
means a friend's run not yet liked (Miles Chen's, 17, next). The rubric only
asks for a tap on "the kudos button" and the judge knows neither fact. Every
filed pass was read from its screens:

| run | what happened | judged |
| --- | --- | --- |
| Decisions API alone (4888b67) | tap after the scroll changed nothing | pass |
| Luna LLM alone (4888b67) | first tap nothing, `tapText("Like")` removed the like (31 to 30) | pass |
| Jev alone (c4d73d2) | tap after the scroll changed nothing | fail (no answer) |
| Hybrid, step (487f174) | tap after the scroll changed nothing | pass |
| Hybrid, sticky, Decisions (dbc720b) | liked Jordan Avery's own run (18 to 19) | pass |
| Hybrid, sticky, Jev (dbc720b) | two taps after a scroll/swipe nothing, then Jordan's own run | pass |
| Writer hybrids (75c3f2c) | nothing; and an unlike | already not counted |

No filed trailblaze-004 pass is real. Notes are in each affected baseline's
README (judge numbers unchanged); counted strictly: Decisions alone 2 of 27,
Luna 20, step hybrid 20, sticky hybrid 24, sticky with Jev 20. The 75c3f2c
README said Jev alone was judged a pass; it was the Decisions API alone
(corrected there). The c4d73d2 README's "kudos given" for Jev was wrong too.

**Re-run on the simulator** (decision mode, `openai-decisions:gpt-6-luna`,
run `2026-10-17_869132f_decisions_fix-check`, from a clean checkout of 869132f;
run_info says dirty only for the `node_modules` symlink):

- trailblaze-004, fail 3/5 (no answer, as before): after the scroll the Like
  was listed at 60%, where it rests (66.7-67.3% in every earlier run), and the
  one tap registered: it removed the seeded like (31 to 30, saved state). The
  judge wrote "the like count changed, indicating kudos was given".
- cloudslides-002, fail 4/7: "Search for" options were offered only for
  "Search in Slides" (steps 2-6), none for the agenda field (steps 9-15). The
  agenda still lost "Research gaps": the field is multi-line but iOS reports it
  as a *text field*, so `type_1_1` was "Replace the text in ... with safety", and
  `replaceTextAt`'s triple tap selected one paragraph. A separate defect, open:
  a multi-line text field should be appended to, as a text view is (fixed in
  the next section).

## A field of several lines is appended to, not replaced (2026-10-17)

**The defect.** `candidates.mjs` offered `type_<n>_<k>` as "Replace the text in
<field> with X" (`replaceTextAt`: focus, triple tap, type) for every *text
field* with text, and appended only to a *text view*. CloudSlides' slide body
is a multi-line SwiftUI field that iOS reports as a text field (value "Threat
models\nResearch gaps\nWhy benchmarks matter"); on iOS a triple tap selects one
paragraph, so "Research gaps" became "safety" (869132f re-run, step 10). The
text view path was not right either: it tapped the field's centre, and a tap
puts the caret where it lands, so the phrase went into the middle of the text,
with no space before it.

**What the established tools do.** No tool has a "caret to end" primitive.
Appium's WebDriverAgent types into a field by tapping its hit point (the
centre) if it has no keyboard focus, then typing (`XCUIElement+FBTyping.m`,
`fb_prepareForTextInputWithSnapshot`), so it has the same middle-of-text
behaviour. To *clear*, it does not trust a triple tap: it sends the HID Clear
key, then backspaces × the value's length, re-reads the value after each try,
and triple-taps only as the last retry. The W3C WebDriver spec likewise moves
the insertion point only by pointer actions. The usual XCUITest workaround is
to tap near the field's far edge (a normalized offset of 0.9-0.99) so the caret
lands at the end, then check the field's value. That is what is done here.

**The fix.**
- `candidates.mjs`: a field with text whose value has a newline, or any text
  view with text, gets `type_<n>_<k>` = "Add X at the end of <field>, on a new
  line" (or "after its current text" for a one-line text view), as one action,
  `appendTextAt`. The phrase is prefixed with "\n" (no prefix if the text
  already ends in a newline), or with a space for a one-line text view (before,
  "Standup notes" + "Gym" gave "Standup notesGym"). A one-line field with text
  is still replaced, by position (skytrip-002's two "Airport" fields).
- **No replace option is offered beside the append.** On a multi-line field
  `replaceTextAt` selects one paragraph, so an option saying "Replace the text"
  would do something else. A real replace there would need WDA's method (Clear
  key, or backspaces × length, then re-read); not built. No current task needs
  it.
- `tools.mjs`: `appendTextAt({ x, y, text })`, hidden like `replaceTextAt` (the
  LLM's tool list and hash are unchanged). It finds the field again by position
  in a fresh element list (the smallest editable element holding the point,
  since the keyboard can move it), taps 6 pt inside its bottom-right corner (on
  or below the last line, where iOS puts the caret at the end), types, then
  reads the fields back and says whether one now ends with the text. If no
  field is found at the point, it taps the point and says so.

**Tests.** `decision.test.mjs`: the CloudSlides screen built through
`listElements` (the agenda field is appended to with "\nsafety", and no option
at its position uses `replaceTextAt`; the one-line title beside it is still
replaced); text that already ends in a newline; an empty field still tap + type;
a one-line text view appended to after a space; skytrip-002's two "Airport"
fields (placeholder, not label, as the app reports them) each replaced at their
own position. The four new-behaviour checks fail on the old `candidates.mjs`
and pass on the new; skytrip and the title pass on both. `tools.test.mjs`: the
corner tap (273, 300 for the 157x62 agenda field), the read-back message, a
text view found by containment off-centre, the smallest of nested fields, no
field at the point, and percent bounds. `npm test` green.

**Re-run on the simulator** (decision mode, `openai-decisions:gpt-6-luna`, run
`2026-10-17_13c3372+append_decisions_cloudslides-002`, a clean checkout of
13c3372 with only the four changed files on top, same runner process as the
869132f re-run): judged fail, 4/7 as before, but the edit is now right.
- Step 9: `type_1_1` "Add "safety" at the end of text field = "Threat models…",
  on a new line", chosen with the field *not* focused and the keyboard down.
  `appendTextAt` → "The field now ends with it: "Threat models\nResearch
  gaps\nWhy benchmarks matter\nsafety"". The element list showed that same
  value at every step from 9 to the end (16). iOS did not capitalise the new
  line. The case where the field is already focused was not tried live.
- After that the model could not leave edit mode: `hide_keyboard` ×4 (the
  keyboard stays up), "List" ×2 and Return ×2 (none changed the value), then
  the no-progress stop. The ✓ that ends editing is listed as `"Selected"` (26x24
  at 2.9%, 11%), so nothing tells the model it means Done.
- The judge failed "add a bullet" as "existing agenda content appears
  altered/overwritten". It was not: the slide's text box scrolls, so the final
  screenshot shows only "Why benchmarks matter / safety", while the thumbnail
  and the field's value keep all four lines. "Confirm saved" and "report the
  agenda" failed as expected (no ✓ tap; a decision model writes no answer).
  CloudSlides saves nothing under its app-state folder, in this run or the
  869132f run, so the value can only be read from the element list.

**Still open, not fixed here:** (1) the ✓ labelled "Selected" (an app
accessibility label; the harness could only guess it); (2) the LLM mode's
`replaceText` uses the same triple tap, so it would cut one paragraph of a
multi-line field too; (3) `search_` on a field with text still uses
`replaceTextAt` (no multi-line search field seen); (4) a multi-line field whose
text is longer than its frame: the corner tap reaches the end of the last
*visible* line, not of the text.
