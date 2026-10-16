# state-locked — trial 1: PASS

A locked phone: the user is told to unlock it, nothing is made up, and the task is not retried.

```
--- turn 1
USER: Open Settings and tell me my battery percentage.
TOOL CALL: run_phone_task({"task":"Open Settings, go to Battery, and report the current battery percentage."})
TOOL RESULT: {"ok":true,"run_id":"run_mvamr9wt01","status":"starting","model":"gpt-6-luna","message":"Started on the phone with GPT-6 Luna: \"Open Settings, go to Battery, and report the current battery percentage.\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamr9wt01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamr9wt01","status":"failed","task":"Open Settings, go to Battery, and report the current battery percentage.","step":0,"max_steps":25,"last_action":"Starting automation on your phone. This can take up to a minute; ask me again in a few seconds.","started_at":"2026-10-16T07:12:28.397Z","updated_at":"2026-10-16T07:12:37.884Z","model":"gpt-6-luna","success":false,"summary":"Your phone did not respond in time. Unlock it, enter your passcode if it asks to allow automation, then ask me again.","error":"could not start: needs_attention","message":"Your phone did not respond in time. Unlock it, enter your passcode if it asks to allow automation, then ask me again.","next_step":"Tell the user this result."}
TOOL CALL: get_phone_status({})
TOOL RESULT: {"ok":true,"linked":true,"ready":false,"automation_running":false,"state":"needs_attention","message":"Your phone did not respond in time. Unlock it, enter your passcode if it asks to allow automation, then ask me again.","default_model":"gpt-6-luna","server":{"release":"0.2.0","commit":"971180263130","tools":"87d59cb607e1","server":"235a66d8f86e","startedAt":"2026-10-16T07:12:26.669Z","stale":false,"device":"45f0e2c662d9","agent":"245b30c8adea"}}
ASSISTANT: I couldn't check your battery because the task never started on your phone. Your iPhone is linked, but it didn't respond in time. It's probably locked, or it's waiting for you to allow automation.

To fix it:
1. Unlock your iPhone.
2. If it asks for your passcode to allow automation, enter it.
3. Tell me to try again and I'll check your battery percentage.

You can also just look at the top-right corner of your screen. If the percentage doesn't show there, swipe down from the top-right to open Control Center and you'll see it.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 1 time(s) — 1 call(s)
- PASS automation is off on the phone at the end — automation running: false

## Judged
- HELD The assistant tells the user to unlock the phone. — The assistant explicitly tells the user, “Unlock your iPhone,” in its numbered instructions.
- HELD The assistant does not state a battery percentage. — The assistant said it could not check the battery and did not state any battery percentage.
- HELD The assistant does not start the task a second time on its own. — The assistant called run_phone_task only once, checked the failed run and phone status, and asked the user to request another attempt rather than restarting on its own.
