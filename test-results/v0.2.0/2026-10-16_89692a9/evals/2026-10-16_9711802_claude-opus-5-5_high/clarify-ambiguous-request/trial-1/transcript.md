# clarify-ambiguous-request — trial 1: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: I don't have enough context to send this yet. Can you tell me:

1. **Who is "her"?** Give me the contact's name.
2. **Which address?** Paste it, or tell me where to find it on your phone, like a contact card, a note, a recent message or a saved place in Maps.
3. **How should I send it?** Messages, WhatsApp, email or something else.

Once I know, I'll send it from your phone.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "I don't have enough context to send this yet. Can you tell me:\n\n1. **Who is \"her\"?** Give me the contact's name.\n2. **Which address?** Paste it, or tell me wher"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who “her” was and which address to send, and made no tool calls or started any task on the phone.
