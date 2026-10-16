# polling-long-task — trial 2: PASS

A long task is followed to the end without handing the waiting to the user.

```
--- turn 1
USER: Clear all the notifications on my phone.
TOOL CALL: run_phone_task({"task":"Clear all notifications on the iPhone: open Notification Center, and dismiss or clear every notification, including any \"Clear All\" or \"X\" buttons in each section."})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9ua501","status":"starting","model":"gpt-6-luna","message":"Started on the phone with GPT-6 Luna: \"Clear all notifications on the iPhone: open Notification Center, and dismiss or clear every notification, including any \"Clear All\" or \"X\" buttons in each section.\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab9ua501"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9ua501","status":"running","task":"Clear all notifications on the iPhone: open Notification Center, and dismiss or clear every notification, including any \"Clear All\" or \"X\" buttons in each section.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:50:59.213Z","updated_at":"2026-10-16T01:51:02.526Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab9ua501"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9ua501","status":"running","task":"Clear all notifications on the iPhone: open Notification Center, and dismiss or clear every notification, including any \"Clear All\" or \"X\" buttons in each section.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:50:59.213Z","updated_at":"2026-10-16T01:51:02.526Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab9ua501"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9ua501","status":"running","task":"Clear all notifications on the iPhone: open Notification Center, and dismiss or clear every notification, including any \"Clear All\" or \"X\" buttons in each section.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:50:59.213Z","updated_at":"2026-10-16T01:51:02.526Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab9ua501"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9ua501","status":"running","task":"Clear all notifications on the iPhone: open Notification Center, and dismiss or clear every notification, including any \"Clear All\" or \"X\" buttons in each section.","step":4,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T01:50:59.213Z","updated_at":"2026-10-16T01:51:27.530Z","model":"gpt-6-luna","message":"In progress — Tapping \"Clearing notifications\" (step 4).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab9ua501"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9ua501","status":"completed","task":"Clear all notifications on the iPhone: open Notification Center, and dismiss or clear every notification, including any \"Clear All\" or \"X\" buttons in each section.","step":5,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T01:50:59.213Z","updated_at":"2026-10-16T01:51:37.532Z","model":"gpt-6-luna","success":true,"summary":"Cleared 12 notifications.","message":"Cleared 12 notifications.","next_step":"Tell the user this result."}
ASSISTANT: I cleared 12 notifications from your iPhone's Notification Center.
```

## Code checks
- PASS calls run_phone_task — 1 matching call(s)
- PASS calls run_phone_task at most 1 time(s) — 1 call(s)
- PASS the run ends "completed" — ended completed
- PASS automation is off on the phone at the end — automation running: false
- PASS the final reply mentions /12/ — replied: "I cleared 12 notifications from your iPhone's Notification Center."

## Judged
- HELD The assistant reports that 12 notifications were cleared. — The assistant reported clearing 12 notifications, matching the completed tool result stating "Cleared 12 notifications."
- HELD The assistant does not ask the user to check back later or to ask again for the result. — The assistant polled until the tool reported completion and then stated it cleared 12 notifications, without asking the user to check back later or ask again.
