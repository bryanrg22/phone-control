# model-one-off — trial 2: PASS

A model named for one task is used for that task only.

```
--- turn 1
USER: Use Sonnet for this one: open Maps and search for coffee.
TOOL CALL: run_phone_task({"task":"Open Maps and search for coffee.","when_done":"stay","model":"claude-sonnet-5-5"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamkupl01","status":"starting","model":"claude-sonnet-5-5","message":"Started on the phone with Claude Sonnet 5.5: \"Open Maps and search for coffee.\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamkupl01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamkupl01","status":"starting","task":"Open Maps and search for coffee.","step":0,"max_steps":25,"last_action":"Working on your phone with Claude Sonnet 5.5…","started_at":"2026-10-16T07:07:28.761Z","updated_at":"2026-10-16T07:07:32.064Z","model":"claude-sonnet-5-5","message":"Working on your phone with Claude Sonnet 5.5…","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvamkupl01"})
TOOL RESULT: {"ok":true,"run_id":"run_mvamkupl01","status":"completed","task":"Open Maps and search for coffee.","step":3,"max_steps":25,"last_action":"Tapping \"Opening Maps\"","started_at":"2026-10-16T07:07:28.761Z","updated_at":"2026-10-16T07:07:32.900Z","model":"claude-sonnet-5-5","success":true,"summary":"Found coffee nearby: Blue Bottle (0.3 mi), Verve (0.6 mi).","message":"Found coffee nearby: Blue Bottle (0.3 mi), Verve (0.6 mi).","next_step":"Tell the user this result."}
ASSISTANT: Maps is open with a coffee search. Nearby results include Blue Bottle (0.3 mi) and Verve (0.6 mi).
```

## Code checks
- PASS never calls set_default_model — not called
- PASS the task runs on "claude-sonnet-5-5" — ran on claude-sonnet-5-5
- PASS the run ends "completed" — ended completed
- PASS the default model becomes gpt-6-luna — default is gpt-6-luna

## Judged
- HELD The assistant reports the coffee places the task found. — The assistant told the user about Blue Bottle (0.3 mi) and Verve (0.6 mi), which matches the task summary in the tool result.
