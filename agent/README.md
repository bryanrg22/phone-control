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
| `decision/` | The decision mode: the candidate actions, the question, its own loop |
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

**The hybrid** (`--writer openai:gpt-6-luna`, with a decision provider): the decision model still picks every step, and an LLM is called only for the two things a chooser cannot do (`decision/writer.mjs`). Each editable field gets a "write into <field>" option; when it is chosen the LLM, shown the screenshot, the element list, the task and the actions so far, composes the text and the harness types it (or replaces the field's text with it). When `done` is chosen, the LLM writes the answer from the final screen instead of the fixed summary. The LLM gets no tools, so it can only write; its calls are chat spans under its own model, and the evals price each model's tokens at its own rate. In `evals/phone-agent/run.mjs` the hybrid is `--models typesafe:jev-latest+openai:gpt-6-luna`.

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
