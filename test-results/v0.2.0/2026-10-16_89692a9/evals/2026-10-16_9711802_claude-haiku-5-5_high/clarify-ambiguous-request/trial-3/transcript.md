# clarify-ambiguous-request — trial 3: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: Who should I send it to, and which address? Please give me the person's name (or number) and the address, or tell me which one to use if it's in a note or message. Also let me know which app to use, such as Messages, and whether you want any wording added.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "Who should I send it to, and which address? Please give me the person's name (or number) and the address, or tell me which one to use if it's in a note or messa"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who to send the message to and which address to use, and made no phone tool calls.
