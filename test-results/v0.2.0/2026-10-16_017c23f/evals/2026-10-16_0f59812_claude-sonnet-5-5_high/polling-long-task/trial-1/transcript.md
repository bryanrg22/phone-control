# polling-long-task — trial 1: PASS

A long task is followed to the end without handing the waiting to the user.

```
--- turn 1
USER: Clear all the notifications on my phone.
TOOL CALL: run_phone_task({"task":"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up on the lock screen), then tap the X / clear button and confirm \"Clear All Notifications\"."})
TOOL RESULT: {"ok":true,"run_id":"run_mvab8lsh01","status":"starting","model":"gpt-6-luna","message":"Started on the phone with GPT-6 Luna: \"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up on the lock screen), then tap the X / clear button and confirm \"Clear All Notifications\".\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({})
TOOL RESULT: {"ok":true,"run_id":"run_mvab8lsh01","status":"running","task":"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up on the lock screen), then tap the X / clear button and confirm \"Clear All Notifications\".","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:50:01.553Z","updated_at":"2026-10-16T01:50:04.895Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({})
TOOL RESULT: {"ok":true,"run_id":"run_mvab8lsh01","status":"running","task":"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up on the lock screen), then tap the X / clear button and confirm \"Clear All Notifications\".","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:50:01.553Z","updated_at":"2026-10-16T01:50:04.895Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({})
TOOL RESULT: {"ok":true,"run_id":"run_mvab8lsh01","status":"running","task":"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up on the lock screen), then tap the X / clear button and confirm \"Clear All Notifications\".","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:50:01.553Z","updated_at":"2026-10-16T01:50:04.895Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({})
TOOL RESULT: {"ok":true,"run_id":"run_mvab8lsh01","status":"running","task":"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up on the lock screen), then tap the X / clear button and confirm \"Clear All Notifications\".","step":4,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T01:50:01.553Z","updated_at":"2026-10-16T01:50:29.896Z","model":"gpt-6-luna","message":"In progress — Tapping \"Clearing notifications\" (step 4).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({})
TOOL RESULT: {"ok":true,"run_id":"run_mvab8lsh01","status":"completed","task":"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up on the lock screen), then tap the X / clear button and confirm \"Clear All Notifications\".","step":5,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T01:50:01.553Z","updated_at":"2026-10-16T01:50:39.899Z","model":"gpt-6-luna","success":true,"summary":"Cleared 12 notifications.","message":"Cleared 12 notifications.","next_step":"Tell the user this result."}
ASSISTANT: I cleared all 12 notifications on your phone.
```

## Code checks
- PASS calls run_phone_task — 1 matching call(s)
- PASS calls run_phone_task at most 1 time(s) — 1 call(s)
- PASS the run ends "completed" — ended completed
- PASS automation is off on the phone at the end — automation running: false
- PASS the final reply mentions /12/ — replied: "I cleared all 12 notifications on your phone."

## Judged
- HELD The assistant reports that 12 notifications were cleared. — The assistant reported, "I cleared all 12 notifications on your phone," matching the tool result "Cleared 12 notifications."
- HELD The assistant does not ask the user to check back later or to ask again for the result. — The assistant polled until the tool reported completion and then said it cleared all 12 notifications, without asking the user to check back later or ask again.
