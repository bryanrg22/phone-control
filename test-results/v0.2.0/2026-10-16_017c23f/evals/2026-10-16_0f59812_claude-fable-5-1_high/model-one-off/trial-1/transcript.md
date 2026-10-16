# model-one-off — trial 1: PASS

A model named for one task is used for that task only.

```
--- turn 1
USER: Use Sonnet for this one: open Maps and search for coffee.
TOOL CALL: run_phone_task({"task":"open Maps and search for coffee","model":"claude-sonnet-5-5","when_done":"stay"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab8ppy01","status":"starting","model":"claude-sonnet-5-5","message":"Started on the phone with Claude Sonnet 5.5: \"open Maps and search for coffee\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab8ppy01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab8ppy01","status":"running","task":"open Maps and search for coffee","step":2,"max_steps":25,"last_action":"Tapping \"Opening Maps\"","started_at":"2026-10-16T01:50:06.646Z","updated_at":"2026-10-16T01:50:09.956Z","model":"claude-sonnet-5-5","message":"In progress — Tapping \"Opening Maps\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvab8ppy01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvab8ppy01","status":"completed","task":"open Maps and search for coffee","step":3,"max_steps":25,"last_action":"Tapping \"Opening Maps\"","started_at":"2026-10-16T01:50:06.646Z","updated_at":"2026-10-16T01:50:10.758Z","model":"claude-sonnet-5-5","success":true,"summary":"Found coffee nearby: Blue Bottle (0.3 mi), Verve (0.6 mi).","message":"Found coffee nearby: Blue Bottle (0.3 mi), Verve (0.6 mi).","next_step":"Tell the user this result."}
ASSISTANT: Done — Claude Sonnet 5.5 opened Maps and searched for coffee. Nearby results include **Blue Bottle (0.3 mi)** and **Verve (0.6 mi)**. I left Maps open on your phone so you can browse the results.
```

## Code checks
- PASS never calls set_default_model — not called
- PASS the task runs on "claude-sonnet-5-5" — ran on claude-sonnet-5-5
- PASS the run ends "completed" — ended completed
- PASS the default model becomes gpt-6-luna — default is gpt-6-luna

## Judged
- HELD The assistant reports the coffee places the task found. — The assistant reported Blue Bottle (0.3 mi) and Verve (0.6 mi), matching the coffee places in the completed task result.
