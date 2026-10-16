# clarify-ambiguous-request — trial 2: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: I need a bit more information before I can send that:

1. **Who** is "her"? Please give me the contact's name.
2. **Which address** should I send? Give me the exact address, or tell me where to find it, such as a recent message, a Maps location, or a contact card.
3. **How** should I send it: iMessage/SMS, WhatsApp, or something else?

Once I have those, I'll do it on your iPhone.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "I need a bit more information before I can send that:\n\n1. **Who** is \"her\"? Please give me the contact's name.\n2. **Which address** should I send? Give me the e"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who “her” was and which address to send, and made no tool calls or started any task on the phone.
