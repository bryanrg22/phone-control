# clarify-ambiguous-request — trial 2: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: Who should I send the address to, and which address? Please give me the recipient's name (or the number or contact) and the address itself. Tell me which app to use too, like Messages, WhatsApp, or email, if you have a preference.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "Who should I send the address to, and which address? Please give me the recipient's name (or the number or contact) and the address itself. Tell me which app to"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who to send the address to and which address, and made no phone tool calls.
