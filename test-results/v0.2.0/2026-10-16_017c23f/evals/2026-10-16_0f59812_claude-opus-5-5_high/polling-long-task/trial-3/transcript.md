# polling-long-task — trial 3: PASS

A long task is followed to the end without handing the waiting to the user.

```
--- turn 1
USER: Clear all the notifications on my phone.
TOOL CALL: run_phone_task({"task":"Open Notification Center and clear all notifications."})
TOOL RESULT: {"ok":true,"run_id":"run_mvabbwto01","status":"starting","model":"gpt-6-luna","message":"Started on the phone with GPT-6 Luna: \"Open Notification Center and clear all notifications.\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvabbwto01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvabbwto01","status":"starting","task":"Open Notification Center and clear all notifications.","step":0,"max_steps":25,"last_action":"Working on your phone with GPT-6 Luna…","started_at":"2026-10-16T01:52:35.820Z","updated_at":"2026-10-16T01:52:39.113Z","model":"gpt-6-luna","message":"Working on your phone with GPT-6 Luna…","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvabbwto01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvabbwto01","status":"running","task":"Open Notification Center and clear all notifications.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:52:35.820Z","updated_at":"2026-10-16T01:52:39.146Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvabbwto01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvabbwto01","status":"running","task":"Open Notification Center and clear all notifications.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:52:35.820Z","updated_at":"2026-10-16T01:52:39.146Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvabbwto01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvabbwto01","status":"completed","task":"Open Notification Center and clear all notifications.","step":5,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T01:52:35.820Z","updated_at":"2026-10-16T01:53:14.150Z","model":"gpt-6-luna","success":true,"summary":"Cleared 12 notifications.","message":"Cleared 12 notifications.","next_step":"Tell the user this result."}
ASSISTANT: I cleared 12 notifications from your phone's Notification Center.
```

## Code checks
- PASS calls run_phone_task — 1 matching call(s)
- PASS calls run_phone_task at most 1 time(s) — 1 call(s)
- PASS the run ends "completed" — ended completed
- PASS automation is off on the phone at the end — automation running: false
- PASS the final reply mentions /12/ — replied: "I cleared 12 notifications from your phone's Notification Center."

## Judged
- HELD The assistant reports that 12 notifications were cleared. — The assistant reported clearing 12 notifications, matching the completed tool result stating “Cleared 12 notifications.”
- HELD The assistant does not ask the user to check back later or to ask again for the result. — The assistant polled until the tool reported completion, then stated that it cleared 12 notifications without asking the user to check back later or ask again.
