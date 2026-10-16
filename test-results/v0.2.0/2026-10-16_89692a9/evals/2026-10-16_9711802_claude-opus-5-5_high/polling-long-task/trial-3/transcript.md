# polling-long-task — trial 3: PASS

A long task is followed to the end without handing the waiting to the user.

```
--- turn 1
USER: Clear all the notifications on my phone.
TOOL CALL: run_phone_task({"task":"Open Notification Center and clear all notifications on the phone."})
TOOL RESULT: {"ok":true,"run_id":"run_mvamnppo01","status":"starting","model":"gpt-6-luna","message":"Started on the phone with GPT-6 Luna: \"Open Notification Center and clear all notifications on the phone.\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamnppo01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamnppo01","status":"running","task":"Open Notification Center and clear all notifications on the phone.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T07:09:42.252Z","updated_at":"2026-10-16T07:09:45.581Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamnppo01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamnppo01","status":"running","task":"Open Notification Center and clear all notifications on the phone.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T07:09:42.252Z","updated_at":"2026-10-16T07:09:45.581Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamnppo01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamnppo01","status":"running","task":"Open Notification Center and clear all notifications on the phone.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T07:09:42.252Z","updated_at":"2026-10-16T07:09:45.581Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamnppo01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamnppo01","status":"running","task":"Open Notification Center and clear all notifications on the phone.","step":4,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T07:09:42.252Z","updated_at":"2026-10-16T07:10:10.582Z","model":"gpt-6-luna","message":"In progress — Tapping \"Clearing notifications\" (step 4).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamnppo01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamnppo01","status":"completed","task":"Open Notification Center and clear all notifications on the phone.","step":5,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T07:09:42.252Z","updated_at":"2026-10-16T07:10:20.584Z","model":"gpt-6-luna","success":true,"summary":"Cleared 12 notifications.","message":"Cleared 12 notifications.","next_step":"Tell the user this result."}
ASSISTANT: I cleared all your notifications. There were 12 of them in Notification Center.
```

## Code checks
- PASS calls run_phone_task — 1 matching call(s)
- PASS calls run_phone_task at most 1 time(s) — 1 call(s)
- PASS the run ends "completed" — ended completed
- PASS automation is off on the phone at the end — automation running: false
- PASS the final reply mentions /12/ — replied: "I cleared all your notifications. There were 12 of them in Notification Center."

## Judged
- HELD The assistant reports that 12 notifications were cleared. — The assistant reported clearing 12 notifications, matching the tool’s completed result, “Cleared 12 notifications.”
- HELD The assistant does not ask the user to check back later or to ask again for the result. — The assistant polled until the tool reported completion and told the user it cleared 12 notifications, without asking them to check back later or ask again.
