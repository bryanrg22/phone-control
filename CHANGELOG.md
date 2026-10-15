# Changelog

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
