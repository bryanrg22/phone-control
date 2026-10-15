# Changelog

## 0.1.0 — unreleased

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
