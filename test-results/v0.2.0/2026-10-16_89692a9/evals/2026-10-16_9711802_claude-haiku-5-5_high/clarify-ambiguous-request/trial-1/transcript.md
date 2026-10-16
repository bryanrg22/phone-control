# clarify-ambiguous-request — trial 1: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: Who should I send it to, and which address? Once you tell me the recipient's name and the address (or where it should come from), I'll send it from your iPhone. Let me know if you'd rather use a particular app, like Messages.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "Who should I send it to, and which address? Once you tell me the recipient's name and the address (or where it should come from), I'll send it from your iPhone."

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who to send it to and which address, and made no tool calls to start a task on the phone.
