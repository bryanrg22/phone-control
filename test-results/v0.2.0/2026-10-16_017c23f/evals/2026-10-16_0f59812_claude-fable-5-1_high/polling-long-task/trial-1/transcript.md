# polling-long-task — trial 1: PASS

A long task is followed to the end without handing the waiting to the user.

```
--- turn 1
USER: Clear all the notifications on my phone.
ASSISTANT: I'll start that on your phone now.
TOOL CALL: run_phone_task({"task":"Open Notification Center and clear all notifications"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9jae01","status":"starting","model":"gpt-6-luna","message":"Started on the phone with GPT-6 Luna: \"Open Notification Center and clear all notifications\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab9jae01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9jae01","status":"running","task":"Open Notification Center and clear all notifications","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:50:44.966Z","updated_at":"2026-10-16T01:50:48.314Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab9jae01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9jae01","status":"running","task":"Open Notification Center and clear all notifications","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:50:44.966Z","updated_at":"2026-10-16T01:50:48.314Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab9jae01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9jae01","status":"running","task":"Open Notification Center and clear all notifications","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:50:44.966Z","updated_at":"2026-10-16T01:50:48.314Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab9jae01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9jae01","status":"running","task":"Open Notification Center and clear all notifications","step":4,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T01:50:44.966Z","updated_at":"2026-10-16T01:51:13.316Z","model":"gpt-6-luna","message":"In progress — Tapping \"Clearing notifications\" (step 4).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab9jae01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9jae01","status":"completed","task":"Open Notification Center and clear all notifications","step":5,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T01:50:44.966Z","updated_at":"2026-10-16T01:51:23.317Z","model":"gpt-6-luna","success":true,"summary":"Cleared 12 notifications.","message":"Cleared 12 notifications.","next_step":"Tell the user this result."}
ASSISTANT: Done — all 12 notifications on your phone have been cleared.
```

## Code checks
- PASS calls run_phone_task — 1 matching call(s)
- PASS calls run_phone_task at most 1 time(s) — 1 call(s)
- PASS the run ends "completed" — ended completed
- PASS automation is off on the phone at the end — automation running: false
- PASS the final reply mentions /12/ — replied: "I'll start that on your phone now.\nDone — all 12 notifications on your phone have been cleared."

## Judged
- HELD The assistant reports that 12 notifications were cleared. — The assistant reported that all 12 notifications were cleared, matching the tool’s completed result, “Cleared 12 notifications.”
- HELD The assistant does not ask the user to check back later or to ask again for the result. — The assistant polled the tool until completion and reported that 12 notifications were cleared without asking the user to check back later or ask again.
