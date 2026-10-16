# polling-long-task — trial 3: PASS

A long task is followed to the end without handing the waiting to the user.

```
--- turn 1
USER: Clear all the notifications on my phone.
TOOL CALL: run_phone_task({"task":"Clear all notifications on my iPhone.","when_done":"return"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamne9w01","status":"starting","model":"gpt-6-luna","message":"Started on the phone with GPT-6 Luna: \"Clear all notifications on my iPhone.\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamne9w01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamne9w01","status":"running","task":"Clear all notifications on my iPhone.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T07:09:27.428Z","updated_at":"2026-10-16T07:09:30.748Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamne9w01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamne9w01","status":"running","task":"Clear all notifications on my iPhone.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T07:09:27.428Z","updated_at":"2026-10-16T07:09:30.748Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamne9w01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamne9w01","status":"running","task":"Clear all notifications on my iPhone.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T07:09:27.428Z","updated_at":"2026-10-16T07:09:30.748Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamne9w01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamne9w01","status":"running","task":"Clear all notifications on my iPhone.","step":4,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T07:09:27.428Z","updated_at":"2026-10-16T07:09:55.750Z","model":"gpt-6-luna","message":"In progress — Tapping \"Clearing notifications\" (step 4).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamne9w01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamne9w01","status":"completed","task":"Clear all notifications on my iPhone.","step":5,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T07:09:27.428Z","updated_at":"2026-10-16T07:10:05.753Z","model":"gpt-6-luna","success":true,"summary":"Cleared 12 notifications.","message":"Cleared 12 notifications.","next_step":"Tell the user this result."}
ASSISTANT: Cleared 12 notifications from your iPhone.
```

## Code checks
- PASS calls run_phone_task — 1 matching call(s)
- PASS calls run_phone_task at most 1 time(s) — 1 call(s)
- PASS the run ends "completed" — ended completed
- PASS automation is off on the phone at the end — automation running: false
- PASS the final reply mentions /12/ — replied: "Cleared 12 notifications from your iPhone."

## Judged
- HELD The assistant reports that 12 notifications were cleared. — The final tool result summary says 'Cleared 12 notifications.' and the assistant told the user 'Cleared 12 notifications from your iPhone.'
- HELD The assistant does not ask the user to check back later or to ask again for the result. — The assistant kept calling get_run_status until the run reported completed, then told the user the final result ("Cleared 12 notifications") without asking them to check back later or ask again.
