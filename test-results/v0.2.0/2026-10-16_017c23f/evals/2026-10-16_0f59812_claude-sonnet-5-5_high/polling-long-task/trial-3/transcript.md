# polling-long-task — trial 3: PASS

A long task is followed to the end without handing the waiting to the user.

```
--- turn 1
USER: Clear all the notifications on my phone.
TOOL CALL: run_phone_task({"task":"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up from the lock screen) and tap the X / Clear All button to clear all notifications."})
TOOL RESULT: {"ok":true,"run_id":"run_mvabamtk01","status":"starting","model":"gpt-6-luna","message":"Started on the phone with GPT-6 Luna: \"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up from the lock screen) and tap the X / Clear All button to clear all notifications.\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({})
TOOL RESULT: {"ok":true,"run_id":"run_mvabamtk01","status":"running","task":"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up from the lock screen) and tap the X / Clear All button to clear all notifications.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:51:36.200Z","updated_at":"2026-10-16T01:51:39.511Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({})
TOOL RESULT: {"ok":true,"run_id":"run_mvabamtk01","status":"running","task":"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up from the lock screen) and tap the X / Clear All button to clear all notifications.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:51:36.200Z","updated_at":"2026-10-16T01:51:39.511Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({})
TOOL RESULT: {"ok":true,"run_id":"run_mvabamtk01","status":"running","task":"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up from the lock screen) and tap the X / Clear All button to clear all notifications.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Notification Center\"","started_at":"2026-10-16T01:51:36.200Z","updated_at":"2026-10-16T01:51:39.511Z","model":"gpt-6-luna","message":"In progress — Tapping \"Opening Notification Center\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({})
TOOL RESULT: {"ok":true,"run_id":"run_mvabamtk01","status":"running","task":"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up from the lock screen) and tap the X / Clear All button to clear all notifications.","step":4,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T01:51:36.200Z","updated_at":"2026-10-16T01:52:04.516Z","model":"gpt-6-luna","message":"In progress — Tapping \"Clearing notifications\" (step 4).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({})
TOOL RESULT: {"ok":true,"run_id":"run_mvabamtk01","status":"completed","task":"Clear all notifications on the phone: open Notification Center (swipe down from the top-left/center of the screen or swipe up from the lock screen) and tap the X / Clear All button to clear all notifications.","step":5,"max_steps":25,"last_action":"Tapping \"Clearing notifications\"","started_at":"2026-10-16T01:51:36.200Z","updated_at":"2026-10-16T01:52:14.518Z","model":"gpt-6-luna","success":true,"summary":"Cleared 12 notifications.","message":"Cleared 12 notifications.","next_step":"Tell the user this result."}
ASSISTANT: I cleared all 12 notifications on your phone.
```

## Code checks
- PASS calls run_phone_task — 1 matching call(s)
- PASS calls run_phone_task at most 1 time(s) — 1 call(s)
- PASS the run ends "completed" — ended completed
- PASS automation is off on the phone at the end — automation running: false
- PASS the final reply mentions /12/ — replied: "I cleared all 12 notifications on your phone."

## Judged
- HELD The assistant reports that 12 notifications were cleared. — The assistant reported “I cleared all 12 notifications on your phone,” matching the tool result “Cleared 12 notifications.”
- HELD The assistant does not ask the user to check back later or to ask again for the result. — The assistant polled until the tool reported completion and told the user it cleared all 12 notifications, without asking them to check back later or ask again.
