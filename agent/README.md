# The phone agent

The program that operates the iPhone. The server starts one per task (`node agent/agent.mjs "<task>" …`, see `server/src/agent-runner.mjs`); it looks at the screen, asks a model what to do, does it through the XCTest runner on the phone, and repeats until the model says the task is done, gives up, or the step budget runs out.

## How one task runs

```
observe ──► decide ──► act ──► observe ──► …            until taskComplete / taskFailed / budget
  │           │          │
  │           │          └─ tools.mjs: each tool call → runner calls (tap, type, launch…)
  │           └─ providers/: one request to the model with the conversation and the tools
  └─ observe.mjs: a screenshot (768 px wide) and the on-screen element list (elements.mjs)
```

One **step** is one model request. The model may call several tools in one step; they run in order, and the run stops at the first that fails, at `taskComplete` or at `taskFailed` (the rest are reported as not run). After a step that changed the screen the agent observes again, so the next request carries a fresh screenshot.

## Files

| File | Responsibility |
| --- | --- |
| `agent.mjs` | Entry point: reads the arguments, wires the parts together, maps the outcome to an exit code |
| `cli-args.mjs` | The arguments (pure, unit-tested) |
| `loop.mjs` | The loop: step budget, the final step, the stops, the outcome |
| `observe.mjs` | Screenshot (rotated upright, resized) and element list for one step |
| `elements.mjs` | View hierarchy → the element list the model reads; the screen signature |
| `tools.mjs` | The tools the model can call, and what each does on the device |
| `device.mjs` | HTTP client for the XCTest runner; which apps are installed |
| `context.mjs` | The conversation: what is kept, what older screenshots become, the action history |
| `prompt.mjs` | The system prompt |
| `stuck.mjs` | Repeated actions (nudges) and no progress (stop) |
| `providers/` | One file per model provider: request shape, response shape, retries. `openai-decisions.mjs` and `typesafe.mjs` are decision models (below) |
| `decision/` | The decision mode: the candidate actions, the question, its own loop; `escalate.mjs` is the hybrid's handoff policy |
| `execute.mjs` | One step's tool calls, run in order (shared by the LLM loop and the hybrid's LLM steps) |
| `protocol.mjs` | What the server reads: one JSON event per line, and the answer file for questions |
| `record.mjs` | The full record of a run (see below) |
| `models.mjs` | Default model per provider |

## The decision mode (a trial)

`--provider openai-decisions` (OpenAI's Decisions API, `gpt-6-luna`) or `--provider typesafe` (TypeSafe's Jev, `jev-latest`) replaces the LLM with a **decision model**: one that answers a choice question with a probability per option and writes no text. The loop is `decision/loop.mjs`:

```
observe ──► enumerate candidates ──► one choice question ──► run the chosen tool ──► observe ──► …
             decision/candidates.mjs    decision/question.mjs      tools.mjs (unchanged)
```

The harness lists every action it could take (tap each on-screen element, type each phrase lifted from the task, Return, scroll, Home, open an app the task names, `done`, `blocked`) and the model picks one; the state it sees is the task, the actions so far, and the element list, as text (the Decisions API) or as an object (Jev). No screenshot is sent. `done` ends the run as `taskComplete` with a fixed summary, so a task that asks for information cannot be answered: a weakness to measure, not a bug. The record has the same spans as the LLM mode, with the answer's probabilities under `eval.decision`, so the evals judge and report both modes alike. Keys: `OPENAI_API_KEY`, `TYPESAFE_API_KEY`. Background and plan: `docs/research/decision-models-jev-handoff-2026-10-16.md`.

### The hybrid mode

`--provider hybrid --model openai-decisions:gpt-6-luna+openai:gpt-6-luna` keeps the decision model in charge and hands a step to the LLM only when `decision/escalate.mjs` says so: the decision model chose `done` or `blocked` (the LLM verifies on the screen and writes the real summary or answer), it chose "write into field F" (text the task does not supply), it chose a control that pays, orders, deletes or sends (below), its best option fell below `--escalation-threshold` (0.5, fixed before a run), the screen has not changed for three of its steps, or it is the final step. The LLM gets the screenshot, the element list, its own running conversation and a handoff note with the decision model's steps; its tool calls run through `execute.mjs` exactly as in the LLM loop. With `--escalation-mode sticky` the LLM keeps control after it takes a step, with no decision call, until it calls `handBack` (a tool offered only in this mode), concludes, or has taken five steps in a row. Each model call is recorded and priced by its own model, and the eval report shows the LLM's share of steps. Prior art: Browser Use's jev-ultrafast (a small LLM writes TYPE_TEXT only) and JEV-as-a-Judge (arXiv 2609.26550: accept when confident, escalate when unsure).

### Irreversible actions

A decision model cannot ask the user anything, so the harness recognises the controls that commit something (`decision/irreversible.mjs`), from the element's own label: **confirm** (money moves or data is deleted: Pay, Send now in a task that moves money, Place Order, Buy Now, a priced Request or Book, Delete) and **verify** (the user's command authorises it: Send, Post, Submit, Confirm Reservation, Book with no price). A label must be a commit phrase, not contain a commit word: "Send | Zelle®", "Pay/Request", "Pay bills", "Transfer" and "Reply" open a screen. Removing an item and archiving are left out, since both are undone by doing them again.

- **Hybrid:** a decision-model choice of either class is the LLM's step (escalation reason `irreversible`, at any probability), with the system prompt's askUser rule spelled out in the handoff. An LLM `tap` or `tapText` of the confirm class is held, not run, until the user has said yes to an `askUser` question in this task; the LLM gets a "Not run" result saying to ask first. The hold exists because GPT-6 Luna holding control in the sticky hybrid tapped MyBank's "Send now" without asking in 3 of 3 runs, where it asked in 3 of 3 alone.
- **One yes, one tap of each control:** a yes authorises each confirm control once. Tapping the same one again (a second "Send now") needs a yes given after the first tap; the LLM is told it was already tapped and to check whether it is done. Different controls of one flow ("Place Order", then "Confirm & Place Order") go on under the one yes. A later "No" withdraws a yes. Every sticky-hybrid mybank-003 run had paid twice or more.
- **The safety line:** while a confirm control is on the LLM's screen and not authorised, its turn includes "[Safety] On this screen, "Send now" would send money… The task saying to do it is not the user's confirmation…". Replaying the exact hybrid request in which Luna tapped "Send now" (10 times each): as recorded, 0 asks; with a line that said "unless the user has already confirmed it in this task", still 0 (Luna took the task as the confirmation); with this line, 10 of 10 asked. At the first hand-off, the hand-off note itself suppressed the question (0 of 8 asked; 4 of 8 with the note removed), so the line is added on every LLM turn, not only at hand-offs.
- **Sticky control during a payment:** once the LLM has asked, been held, or made such a tap in its run, control does not return to the decision model at five steps but at ten, or when it concludes or hands back: the decision model had redone the whole Zelle flow after the five-step limit.
- **Decision-only:** before each confirm tap the harness asks the user a fixed Yes/No question naming the button; anything but yes ends the run as failed, with the button untapped. A send goes ahead, as the LLM's rule has it.

The LLM mode is unchanged: its prompt asks it to confirm payments, and nothing enforces that (iOSWorld 2026-10-16/17: Luna asked on mybank-003 and quickbite-001, but not on splitpay-001).

## What the server sees

Each event is one line on standard output, `@agent-event ` followed by JSON: `step`, `thinking`, `action`, `ask`, `answer_seen`, `ask_timeout`, `done`, `failed`, `infra`. Everything else the agent prints is for people. Answers to questions arrive in `$TMPDIR/agent-user-response.json`. Exit codes: 0 done, 1 not done (gave up, budget, no progress), 42 the model API failed for good, 43 the phone stopped answering, 2 bad arguments.

## The record of a run

With `--trace-dir <dir>` the agent writes everything needed to replay or judge the run without re-running it, using the OpenTelemetry GenAI names for fields:

- `manifest.json`: the task, model, settings, the agent's release and commit, hashes of the prompt and the tool definitions, the device, how the run ended, and totals (tokens in, cached, out, reasoning; model and tool calls; tool errors).
- `trace.jsonl`: one line per record, in order. A `chat` span per model request: the model asked for and the model that answered, finish reason, tokens, timing, and references to the exact request and response. An `execute_tool` span per tool call: arguments, result, timing, error, or "not run". An `observation` event per screen shown to the model. Last, the `invoke_agent` span for the whole run.
- `blobs/sha256/<hex>.<ext>`: every image, request body, response body, system prompt and tool list, stored once by content hash. In a stored request each base64 image is replaced by `{"$blob": "<path>"}`, the file holding those exact bytes.
- `transcript.md`: the run for a person to read: each model reply and tool call, each screen as an image, its element list.

Request headers are never recorded (they carry the API key) and key-shaped strings are scrubbed from every file. On a real phone the record contains the screen, so the server writes one only when the operator sets `AGENT_TRACE_DIR`.

## Design choices, and why

- **Coordinates are percentages of the screen (0–100).** Normalized coordinates survive any screen size; the same idea as Gemini's and Qwen's 0–999 grids.
- **One screenshot at a time, plus a written action history.** Older screenshots become text; the last 20 actions are listed with each request. Keeps the context small without losing what was done.
- **Screenshot plus element list.** iOSWorld (arXiv 2606.09764) measured up to +26 points from giving strong models the accessibility tree alongside the image.
- **The runner is the only way the agent touches the phone.** The same calls work on a real iPhone and on a simulator, which is what makes simulator benchmarks measure the real thing.
