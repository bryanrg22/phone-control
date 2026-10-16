# clarify-ambiguous-request — trial 2: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: Who should I send it to, and which address? Please give me the person's name (or number) and the address, and tell me if you want it sent by Messages, email, or another app.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "Who should I send it to, and which address? Please give me the person's name (or number) and the address, and tell me if you want it sent by Messages, email, or"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who to send it to and which address to send, and made no tool calls or started any phone task.
