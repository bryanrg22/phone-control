# clarify-ambiguous-request — trial 2: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: Happy to send it, but I don't have any earlier context in this chat, so I need a few details first:

1. **Who is "her"?** Give me the contact's name as it's saved on your phone.
2. **What address?** Type it out, or tell me where it is (for example, "my home address from my contact card" or "the restaurant I saved in Maps").
3. **How should I send it?** Messages, WhatsApp, email or something else? If you don't say, I'll use iMessage.

Once I have those, I'll send it from your iPhone.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "Happy to send it, but I don't have any earlier context in this chat, so I need a few details first:\n\n1. **Who is \"her\"?** Give me the contact's name as it's sav"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who “her” refers to and which address to send, and made no tool calls or started any task on the phone.
