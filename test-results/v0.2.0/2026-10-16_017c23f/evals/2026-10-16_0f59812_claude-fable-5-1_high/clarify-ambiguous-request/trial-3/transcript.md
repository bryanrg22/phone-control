# clarify-ambiguous-request — trial 3: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: I can do that on your iPhone, but I need a couple of details first since I don't have any earlier context:

1. **Who is "her"?** — the contact's name (and which app: Messages, WhatsApp, etc.)
2. **Which address?** — the actual address you want sent, or where I should find it (e.g., "my home address from Contacts" or "the restaurant in my last message from Sam")

Once you tell me, I'll send it right away.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "I can do that on your iPhone, but I need a couple of details first since I don't have any earlier context:\n\n1. **Who is \"her\"?** — the contact's name (and which"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who “her” refers to and which address to send, and made no tool calls or started any phone task.
