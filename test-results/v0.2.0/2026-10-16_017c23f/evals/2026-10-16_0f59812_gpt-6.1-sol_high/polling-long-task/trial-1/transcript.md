# polling-long-task — trial 1: PASS

A long task is followed to the end without handing the waiting to the user.

```
--- turn 1
USER: Clear all the notifications on my phone.
TOOL CALL: run_phone_task({"task":"Clear all notifications from the iPhone's Notification Center."})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9ukr01","status":"starting","model":"gpt-6-luna","message":"Started on the phone with GPT-6 Luna: \"Clear all notifications from the iPhone's Notification Center.\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab9ukr01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9ukr01","status":"starting","task":"Clear all notifications from the iPhone's Notification Center.","step":0,"max_steps":25,"last_action":"Working on your phone with GPT-6 Luna…","started_at":"2026-10-16T01:50:59.595Z","updated_at":"2026-10-16T01:51:02.888Z","model":"gpt-6-luna","message":"Working on your phone with GPT-6 Luna…","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
ASSISTANT: I’m clearing your phone’s notifications now.
TOOL CALL: get_run_status({"run_id":"run_mvab9ukr01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9ukr01","status":"running","task":"Clear all notifications from the iPhone's Notification Center.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:50:59.595Z","updated_at":"2026-10-16T01:51:02.923Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab9ukr01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9ukr01","status":"running","task":"Clear all notifications from the iPhone's Notification Center.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:50:59.595Z","updated_at":"2026-10-16T01:51:02.923Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab9ukr01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab9ukr01","status":"completed","task":"Clear all notifications from the iPhone's Notification Center.","step":5,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T01:50:59.595Z","updated_at":"2026-10-16T01:51:37.930Z","model":"gpt-6-luna","success":true,"summary":"Cleared 12 notifications.","message":"Cleared 12 notifications.","next_step":"Tell the user this result."}
ASSISTANT: Done—cleared all 12 notifications from your phone.
```

## Code checks
- PASS calls run_phone_task — 1 matching call(s)
- PASS calls run_phone_task at most 1 time(s) — 1 call(s)
- PASS the run ends "completed" — ended completed
- PASS automation is off on the phone at the end — automation running: false
- PASS the final reply mentions /12/ — replied: "I’m clearing your phone’s notifications now.\nDone—cleared all 12 notifications from your phone."

## Judged
- HELD The assistant reports that 12 notifications were cleared. — The final tool result summary says 'Cleared 12 notifications.' and the assistant told the user 'Done—cleared all 12 notifications from your phone.'
- HELD The assistant does not ask the user to check back later or to ask again for the result. — The assistant only said it was clearing notifications and then reported 'cleared all 12 notifications'; it never asked the user to check back later or ask again for the result.
