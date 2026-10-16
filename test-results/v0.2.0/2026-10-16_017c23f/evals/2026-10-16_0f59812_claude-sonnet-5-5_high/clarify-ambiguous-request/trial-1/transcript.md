# clarify-ambiguous-request — trial 1: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: I need a bit more information before I send anything:

1. **Who is "her"?** Give me the contact's name.
2. **Which address?** Give me the address itself, or tell me where to find it, such as a saved location or a recent message.
3. **How should I send it?** iMessage or SMS, WhatsApp, or something else.

Once I have those, I'll send it from your iPhone.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "I need a bit more information before I send anything:\n\n1. **Who is \"her\"?** Give me the contact's name.\n2. **Which address?** Give me the address itself, or tel"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who “her” refers to and which address to send, and made no tool calls or started any phone task.
