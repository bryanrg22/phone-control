# clarify-ambiguous-request — trial 2: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: Who should I send it to, and what address should I send?
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "Who should I send it to, and what address should I send?"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant replied only with a question asking who the recipient is and what address to send, and made no tool calls.
