# model-default-change — trial 3: FAIL

"From now on" changes the default model and starts nothing.

```
--- turn 1
USER: From now on, use Sol to drive my phone.
TOOL CALL: set_default_model({"model":"gpt-6-sol"})
TOOL RESULT: {"ok":true,"default_model":"gpt-6-sol","message":"From now on I will use GPT-6 Sol on your phone."}
ASSISTANT: Done — I’ll use GPT-6 Sol for future phone tasks.
```

## Code checks
- PASS calls set_default_model with {"model":"/sol/i"} — 1 matching call(s)
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- FAIL the default model becomes gpt-6.1-sol — default is gpt-6-sol

## Judged
- HELD The assistant confirms that future phone tasks will use Sol. — The assistant replied 'I'll use GPT-6 Sol for future phone tasks,' which matches the tool result confirming default_model was set to gpt-6-sol.
