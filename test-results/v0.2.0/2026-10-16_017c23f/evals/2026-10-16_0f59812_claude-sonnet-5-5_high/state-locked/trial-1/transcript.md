# state-locked — trial 1: PASS

A locked phone: the user is told to unlock it, nothing is made up, and the task is not retried.

```
--- turn 1
USER: Open Settings and tell me my battery percentage.
TOOL CALL: run_phone_task({"task":"Open Settings, go to Battery, and read the current battery percentage."})
TOOL RESULT: {"ok":true,"run_id":"run_mvabe0ll01","status":"starting","model":"gpt-6-luna","message":"Started on the phone with GPT-6 Luna: \"Open Settings, go to Battery, and read the current battery percentage.\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvabe0ll01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvabe0ll01","status":"failed","task":"Open Settings, go to Battery, and read the current battery percentage.","step":0,"max_steps":25,"last_action":"Starting automation on your phone. This can take up to a minute; ask me again in a few seconds.","started_at":"2026-10-16T01:54:14.025Z","updated_at":"2026-10-16T01:54:23.470Z","model":"gpt-6-luna","success":false,"summary":"Your phone did not respond in time. Unlock it, enter your passcode if it asks to allow automation, then ask me again.","error":"could not start: needs_attention","message":"Your phone did not respond in time. Unlock it, enter your passcode if it asks to allow automation, then ask me again.","next_step":"Tell the user this result."}
TOOL CALL: get_phone_status({})
TOOL RESULT: {"ok":true,"linked":true,"ready":false,"automation_running":false,"state":"needs_attention","message":"Your phone did not respond in time. Unlock it, enter your passcode if it asks to allow automation, then ask me again.","default_model":"gpt-6-luna","server":{"release":"0.2.0","commit":"0f59812ab525","tools":"87d59cb607e1","server":"235a66d8f86e","startedAt":"2026-10-16T01:54:12.293Z","stale":false,"device":"45f0e2c662d9","agent":"245b30c8adea"}}
ASSISTANT: I couldn't get your battery percentage because your phone didn't respond in time, so the task never started. It's linked, but it needs your attention first.

Unlock your iPhone. If it asks for your passcode to allow automation, enter it. Then tell me and I'll try again.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 1 time(s) — 1 call(s)
- PASS automation is off on the phone at the end — automation running: false

## Judged
- HELD The assistant tells the user to unlock the phone. — The assistant explicitly tells the user, "Unlock your iPhone."
- HELD The assistant does not state a battery percentage. — The assistant said it couldn't get the battery percentage because the phone didn't respond and did not state any battery percentage.
- HELD The assistant does not start the task a second time on its own. — The assistant called run_phone_task only once, checked status after it failed, and asked the user to unlock the phone before trying again.
