# polling-long-task — trial 2: PASS

A long task is followed to the end without handing the waiting to the user.

```
--- turn 1
USER: Clear all the notifications on my phone.
TOOL CALL: run_phone_task({"task":"Open Notification Center and clear all notifications."})
TOOL RESULT: {"ok":true,"run_id":"run_mv9oh9um01","status":"starting","model":"gpt-6-luna","message":"Started on the phone with GPT-6 Luna: \"Open Notification Center and clear all notifications.\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mv9oh9um01"})
TOOL RESULT: {"ok":true,"run_id":"run_mv9oh9um01","status":"running","task":"Open Notification Center and clear all notifications.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-15T15:12:54.814Z","updated_at":"2026-10-15T15:12:58.238Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mv9oh9um01"})
TOOL RESULT: {"ok":true,"run_id":"run_mv9oh9um01","status":"running","task":"Open Notification Center and clear all notifications.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-15T15:12:54.814Z","updated_at":"2026-10-15T15:12:58.238Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mv9oh9um01"})
TOOL RESULT: {"ok":true,"run_id":"run_mv9oh9um01","status":"running","task":"Open Notification Center and clear all notifications.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-15T15:12:54.814Z","updated_at":"2026-10-15T15:12:58.238Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mv9oh9um01"})
TOOL RESULT: {"ok":true,"run_id":"run_mv9oh9um01","status":"running","task":"Open Notification Center and clear all notifications.","step":4,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-15T15:12:54.814Z","updated_at":"2026-10-15T15:13:23.598Z","model":"gpt-6-luna","message":"In progress — Tapping \"Clearing notifications\" (step 4).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mv9oh9um01"})
TOOL RESULT: {"ok":true,"run_id":"run_mv9oh9um01","status":"completed","task":"Open Notification Center and clear all notifications.","step":5,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-15T15:12:54.814Z","updated_at":"2026-10-15T15:13:33.245Z","model":"gpt-6-luna","success":true,"summary":"Cleared 12 notifications.","message":"Cleared 12 notifications.","next_step":"Tell the user this result."}
ASSISTANT: I cleared 12 notifications from your phone's Notification Center.
```

## Code checks
- PASS calls run_phone_task — 1 matching call(s)
- PASS calls run_phone_task at most 1 time(s) — 1 call(s)
- PASS the run ends "completed" — ended completed
- PASS automation is off on the phone at the end — automation running: false
- PASS the final reply mentions /12/ — replied: "I cleared 12 notifications from your phone's Notification Center."

## Judged
- HELD The assistant reports that 12 notifications were cleared. — The completed tool result says “Cleared 12 notifications,” and the assistant reported that it cleared 12.
- HELD The assistant does not ask the user to check back later or to ask again for the result. — The assistant reported that it cleared 12 notifications and did not ask the user to check back later or ask again.
