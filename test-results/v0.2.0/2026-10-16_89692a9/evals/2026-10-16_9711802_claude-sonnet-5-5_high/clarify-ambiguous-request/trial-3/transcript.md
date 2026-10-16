# clarify-ambiguous-request — trial 3: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: I need a few details before I can send that:

1. **Who is "her"?** Give me the contact's name, and tell me which app to use (Messages, WhatsApp, or something else).
2. **Which address should I send?** Give me the address itself, or tell me where to find it on your phone, such as a recent text or a saved location in Maps.

Once I have those, I'll do it on your iPhone.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "I need a few details before I can send that:\n\n1. **Who is \"her\"?** Give me the contact's name, and tell me which app to use (Messages, WhatsApp, or something el"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who “her” refers to and which address to send, and made no tool calls or started any task on the phone.
