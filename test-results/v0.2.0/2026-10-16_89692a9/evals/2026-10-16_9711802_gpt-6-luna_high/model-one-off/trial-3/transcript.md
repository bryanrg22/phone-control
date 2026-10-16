# model-one-off — trial 3: PASS

A model named for one task is used for that task only.

```
--- turn 1
USER: Use Sonnet for this one: open Maps and search for coffee.
TOOL CALL: run_phone_task({"task":"Open Maps and search for coffee.","when_done":"stay","model":"claude-sonnet-5-5"})
TOOL RESULT: {"ok":true,"run_id":"run_mvaml26101","status":"starting","model":"claude-sonnet-5-5","message":"Started on the phone with Claude Sonnet 5.5: \"Open Maps and search for coffee.\". Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvaml26101"})
TOOL RESULT: {"ok":true,"run_id":"run_mvaml26101","status":"running","task":"Open Maps and search for coffee.","step":2,"max_steps":25,"last_action":"Tapping \"Opening Maps\"","started_at":"2026-10-16T07:07:38.425Z","updated_at":"2026-10-16T07:07:41.735Z","model":"claude-sonnet-5-5","message":"In progress — Tapping \"Opening Maps\" (step 2).","next_step":"Call get_run_status again right away — it waits for progress by itself, so do not pause or sleep in between."}
TOOL CALL: get_run_status({"run_id":"run_mvaml26101"})
TOOL RESULT: {"ok":true,"run_id":"run_mvaml26101","status":"completed","task":"Open Maps and search for coffee.","step":3,"max_steps":25,"last_action":"Tapping \"Opening Maps\"","started_at":"2026-10-16T07:07:38.425Z","updated_at":"2026-10-16T07:07:42.535Z","model":"claude-sonnet-5-5","success":true,"summary":"Found coffee nearby: Blue Bottle (0.3 mi), Verve (0.6 mi).","message":"Found coffee nearby: Blue Bottle (0.3 mi), Verve (0.6 mi).","next_step":"Tell the user this result."}
ASSISTANT: Maps is open with coffee results nearby: Blue Bottle (0.3 mi) and Verve (0.6 mi).
```

## Code checks
- PASS never calls set_default_model — not called
- PASS the task runs on "claude-sonnet-5-5" — ran on claude-sonnet-5-5
- PASS the run ends "completed" — ended completed
- PASS the default model becomes gpt-6-luna — default is gpt-6-luna

## Judged
- HELD The assistant reports the coffee places the task found. — The final tool result listed Blue Bottle (0.3 mi) and Verve (0.6 mi), and the assistant told the user exactly those coffee places with the same distances.
