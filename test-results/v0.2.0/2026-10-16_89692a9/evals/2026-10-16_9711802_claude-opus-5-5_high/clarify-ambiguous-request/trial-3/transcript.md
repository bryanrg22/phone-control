# clarify-ambiguous-request — trial 3: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: Happy to send it. I don't have any earlier context, though, so I need a few details first:

1. **Who should I send it to?** Give me her name as it appears in your contacts.
2. **Which address?** Paste or type it here, or tell me where to find it on your phone, like "the restaurant in my last Maps search" or "my home address from my contact card."
3. **Which app?** I'll use Messages unless you'd rather use something else, like WhatsApp.

Once you tell me, I'll send it from your phone.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "Happy to send it. I don't have any earlier context, though, so I need a few details first:\n\n1. **Who should I send it to?** Give me her name as it appears in yo"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who to send the message to and which address to send, and made no tool calls or started any phone task.
