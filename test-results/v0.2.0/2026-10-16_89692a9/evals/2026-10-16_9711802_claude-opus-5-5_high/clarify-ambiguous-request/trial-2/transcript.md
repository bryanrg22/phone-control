# clarify-ambiguous-request — trial 2: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: I can do that on your phone, but I don't have enough to go on yet, and I don't want to send something to the wrong person. Can you tell me:

1. **Who's "her"?** Her name as it appears in your contacts.
2. **Which address?** Paste it here, or tell me where to find it (for example, a calendar event, a place in Maps, or a recent message).
3. **How should I send it?** Messages, WhatsApp, email or something else. If you don't say, I'll use Messages.

Once I have that, I'll send it right away.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "I can do that on your phone, but I don't have enough to go on yet, and I don't want to send something to the wrong person. Can you tell me:\n\n1. **Who's \"her\"?**"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who “her” refers to and which address to send, and made no tool calls or started any phone task.
