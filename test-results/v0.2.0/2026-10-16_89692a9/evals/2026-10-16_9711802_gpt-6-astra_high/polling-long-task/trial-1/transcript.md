# polling-long-task — trial 1: PASS

A long task is followed to the end without handing the waiting to the user.

```
--- turn 1
USER: Clear all the notifications on my phone.
TOOL CALL: run_phone_task({"task":"Clear all notifications from Notification Center on my iPhone."})
TOOL RESULT: {"ok":true,"run_id":"run_mvamnraa01","status":"starting","model":"gpt-6-luna","message":"Started on the phone with GPT-6 Luna: \"Clear all notifications from Notification Center on my iPhone.\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamnraa01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamnraa01","status":"running","task":"Clear all notifications from Notification Center on my iPhone.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T07:09:44.290Z","updated_at":"2026-10-16T07:09:47.627Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
ASSISTANT: I’m opening Notification Center to clear the notifications.
TOOL CALL: get_run_status({"run_id":"run_mvamnraa01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamnraa01","status":"running","task":"Clear all notifications from Notification Center on my iPhone.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T07:09:44.290Z","updated_at":"2026-10-16T07:09:47.627Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamnraa01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamnraa01","status":"running","task":"Clear all notifications from Notification Center on my iPhone.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T07:09:44.290Z","updated_at":"2026-10-16T07:09:47.627Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamnraa01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamnraa01","status":"completed","task":"Clear all notifications from Notification Center on my iPhone.","step":5,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T07:09:44.290Z","updated_at":"2026-10-16T07:10:22.629Z","model":"gpt-6-luna","success":true,"summary":"Cleared 12 notifications.","message":"Cleared 12 notifications.","next_step":"Tell the user this result."}
ASSISTANT: Cleared all 12 notifications from your phone.
```

## Code checks
- PASS calls run_phone_task — 1 matching call(s)
- PASS calls run_phone_task at most 1 time(s) — 1 call(s)
- PASS the run ends "completed" — ended completed
- PASS automation is off on the phone at the end — automation running: false
- PASS the final reply mentions /12/ — replied: "I’m opening Notification Center to clear the notifications.\nCleared all 12 notifications from your phone."

## Judged
- HELD The assistant reports that 12 notifications were cleared. — The final tool result said "Cleared 12 notifications," and the assistant then told the user "Cleared all 12 notifications from your phone."
- HELD The assistant does not ask the user to check back later or to ask again for the result. — The assistant kept polling get_run_status until the run completed and then reported 'Cleared all 12 notifications'; at no point did it ask the user to check back later or to ask again.
