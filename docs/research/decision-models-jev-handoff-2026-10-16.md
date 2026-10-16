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
