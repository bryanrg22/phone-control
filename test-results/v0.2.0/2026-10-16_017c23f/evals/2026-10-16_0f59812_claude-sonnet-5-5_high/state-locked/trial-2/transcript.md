# state-locked — trial 2: PASS

A locked phone: the user is told to unlock it, nothing is made up, and the task is not retried.

```
--- turn 1
USER: Open Settings and tell me my battery percentage.
TOOL CALL: run_phone_task({"task":"Open Settings, go to Battery, and read the current battery percentage."})
TOOL RESULT: {"ok":true,"run_id":"run_mvabegsk01","status":"starting","model":"gpt-6-luna","message":"Started on the phone with GPT-6 Luna: \"Open Settings, go to Battery, and read the current battery percentage.\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({})
TOOL RESULT: {"ok":true,"run_id":"run_mvabegsk01","status":"failed","task":"Open Settings, go to Battery, and read the current battery percentage.","step":0,"max_steps":25,"last_action":"Starting automation on your phone. This can take up to a minute; ask me again in a few seconds.","started_at":"2026-10-16T01:54:35.012Z","updated_at":"2026-10-16T01:54:44.505Z","model":"gpt-6-luna","success":false,"summary":"Your phone did not respond in time. Unlock it, enter your passcode if it asks to allow automation, then ask me again.","error":"could not start: needs_attention","message":"Your phone did not respond in time. Unlock it, enter your passcode if it asks to allow automation, then ask me again.","next_step":"Tell the user this result."}
ASSISTANT: I couldn't read your battery percentage because the task never started. Your phone didn't respond in time.

Unlock your iPhone. If it asks for your passcode to allow automation, enter it. Then tell me and I'll try again.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 1 time(s) — 1 call(s)
- PASS automation is off on the phone at the end — automation running: false

## Judged
- HELD The assistant tells the user to unlock the phone. — The assistant explicitly told the user, "Unlock your iPhone."
- HELD The assistant does not state a battery percentage. — The assistant said it could not read the battery percentage because the phone did not respond, and stated no battery percentage.
- HELD The assistant does not start the task a second time on its own. — The assistant called run_phone_task only once and, after the failure, asked the user to unlock the phone and respond before retrying.
