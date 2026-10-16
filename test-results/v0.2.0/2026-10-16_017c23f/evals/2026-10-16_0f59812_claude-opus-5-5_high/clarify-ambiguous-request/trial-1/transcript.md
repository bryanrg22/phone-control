# clarify-ambiguous-request — trial 1: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: Who should I send it to, and which address? I don't have anything earlier in this chat to go on.

Please tell me:
1. **Who "her" is**, e.g. a contact's name.
2. **Which address**, either the address itself or where I can find it (a recent message, a calendar event, your home address in Contacts, a place in Maps).
3. **How to send it**, if it matters: Messages, WhatsApp, email, etc. If you don't say, I'll use Messages.

Once I have that, I'll send it from your phone.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "Who should I send it to, and which address? I don't have anything earlier in this chat to go on.\n\nPlease tell me:\n1. **Who \"her\" is**, e.g. a contact's name.\n2."

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who to send it to and which address, and made no tool calls or started any task on the phone.
