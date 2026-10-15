# Changelog

## Unreleased

- **The phone agent is restructured** into modules with one job each (`agent/README.md`), and keeps only what runs on a real iPhone: the Maestro, simulator-shortcut, research-mode, local-model, action-guard, procedure, database-check, memory and history paths are gone (memory and history were shared by every user of a server).
- **Fixes found by running the agent on iOSWorld's apps:** the element list sent with every screenshot dropped time-picker wheels and text-field contents (they carry values, not labels) and any label containing "AM" or "PM", so models could not see an alarm's time and the no-progress stop aborted runs that were progressing; hideKeyboard reported success without checking; typeAndSubmit could report a message sent when it was not.
- **A step stops at its first failed action** and at taskComplete or taskFailed: before, an action queued after taskComplete still ran.
- **No Home press when a task starts**: it pulled the person out of the app they were in.
- **The conversation no longer grows with every step** (older screens drop their element lists), Claude requests read the conversation from the prompt cache, and OpenAI requests keep the model's reasoning across steps.
- **The server reads the agent's events as JSON** instead of scraping its output.
- **A full record of a run** (`--trace-dir`; on the server, `AGENT_TRACE_DIR`): every model request and response, every tool call and every screen, in OpenTelemetry GenAI field names. Assistant evals record each model and judge call's exact request and response too.
- **Phone-agent evals on iOSWorld** (`evals/phone-agent/`): the agent on iOSWorld's 26 apps and 133 tasks, scored by iOSWorld's own judge.

## 0.2.0 — 2026-10-15

- **Connector evals** (`evals/`): real Claude talks to the real server with a simulated phone; graded by code checks and a judge from another model family, over several trials. First baseline: Claude Opus 5.5 passed 42 of 42.
- **Fix:** after a start failed because the phone was locked, the status check said the phone was ready, so the assistant retried. The clean-up after a task no longer erases why a start failed. Found by the connector evals.
- **Security:** the server refuses requests addressed to any host but its own (DNS-rebinding protection, required by the MCP transport spec; found by the official conformance suite).
- The server no longer claims MCP protocol 2026-07-28, which it does not implement.
- **Versions:** the server reports its release, exact commit and a fingerprint of the tool list (to Claude and at `/healthz`).
- **CI:** MCP conformance suite, a committed snapshot of the tools Claude sees, the eval harness's self-test, and a macOS build of the runner.
- **Test records:** `npm run test:record` files every suite's output and eval evidence under `test-results/v<release>/`.

## 0.1.0

First release. One path: you ask Claude, your own server drives your un-tethered iPhone, and the answer comes back to the chat.

- MCP server with OAuth 2.1 sign-in (dynamic client registration, PKCE, single-use connect codes)
- Tools: `get_phone_status`, `run_phone_task`, `get_run_status`, `answer_question`, `stop_run`, `set_default_model`
- Task lifecycle that starts automation for a task and always ends it afterwards
- Per-task and per-person choice of the model that drives the phone
- Device supervisor: tunnel, session start and stop, lock and network state, warm reattach
- A phone that was never paired with the server is reported as such at once, instead of after minutes of retries
- `phonectl` for registering phones and creating connect codes
- Simulated phone and lifecycle suite; whole-path test; guided check for a real phone
- Build scripts for the on-phone runner and the patched go-ios
