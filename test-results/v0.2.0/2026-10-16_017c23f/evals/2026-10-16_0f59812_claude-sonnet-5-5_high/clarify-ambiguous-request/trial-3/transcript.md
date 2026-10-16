# clarify-ambiguous-request — trial 3: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: I need a bit more detail before I send anything:

1. **Who is "her"?** Give me the name of the contact.
2. **Which address?** Tell me the address itself, or where to find it on your phone, such as a note, a Maps location, or a message.
3. **How should I send it?** Use iMessage or SMS, WhatsApp, email, or something else.

Once I have those, I'll send it from your iPhone.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "I need a bit more detail before I send anything:\n\n1. **Who is \"her\"?** Give me the name of the contact.\n2. **Which address?** Tell me the address itself, or whe"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who “her” refers to and which address to send, and made no tool calls or started any task on the phone.
