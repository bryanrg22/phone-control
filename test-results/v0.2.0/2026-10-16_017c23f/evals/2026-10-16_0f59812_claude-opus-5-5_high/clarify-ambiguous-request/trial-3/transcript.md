# clarify-ambiguous-request — trial 3: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: I can send it from your phone, but I need two things first:

1. **Who's "her"?** Give me the contact's name, and the app if it's not Messages (for example WhatsApp).
2. **Which address?** Type it out, or tell me where to find it, like "the one Mom texted me yesterday" or "my home address from my contact card."

Once I have those, I'll send it.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "I can send it from your phone, but I need two things first:\n\n1. **Who's \"her\"?** Give me the contact's name, and the app if it's not Messages (for example Whats"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who “her” refers to and which address to send, and made no tool calls or started any phone task.
