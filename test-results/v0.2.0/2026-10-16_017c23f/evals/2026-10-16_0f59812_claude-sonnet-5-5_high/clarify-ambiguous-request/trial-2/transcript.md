# clarify-ambiguous-request — trial 2: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: I need a bit more detail before I send anything:

1. **Who is "her"?** Give me her name, or tell me which conversation to use.
2. **Which address?** Give me the address itself, or tell me where to find it, such as a recent message, a calendar event, or a saved location in Maps.
3. **Which app?** Messages, WhatsApp, or something else.

Once I have those, I'll send it from your iPhone.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "I need a bit more detail before I send anything:\n\n1. **Who is \"her\"?** Give me her name, or tell me which conversation to use.\n2. **Which address?** Give me the"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who “her” referred to and which address to send, and made no tool calls or started any phone task.
