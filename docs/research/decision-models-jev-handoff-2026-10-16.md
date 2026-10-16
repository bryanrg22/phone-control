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
  but **empty** on 2026-10-16 (the silent prompt lost the paste); re-add it
  from the clipboard (`printf 'TYPESAFE_API_KEY=%s\n' "$(pbpaste)"`).
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

**Jev: not yet called.** `TYPESAFE_API_KEY` is still empty; the request shape is
from the docs and checked only against a fake server.

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
