# clarify-ambiguous-request — trial 2: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: I'd be glad to send that from your phone, but I'm missing a couple of details since there's no earlier context here:

1. **Who is "her"?** — the contact's name (and which app: Messages, WhatsApp, etc., if it matters)
2. **Which address?** — the actual address you want sent, or where I can find it (e.g., "the restaurant from my last message to Sam")

Let me know and I'll send it right away.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "I'd be glad to send that from your phone, but I'm missing a couple of details since there's no earlier context here:\n\n1. **Who is \"her\"?** — the contact's name "

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who “her” refers to and which address to send, and made no tool calls or started any phone task.
