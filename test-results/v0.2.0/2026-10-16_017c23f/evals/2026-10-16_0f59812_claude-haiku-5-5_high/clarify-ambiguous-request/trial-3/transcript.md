# clarify-ambiguous-request — trial 3: PASS

A request that cannot be carried out as worded is clarified with the user before anything starts on the phone.

```
--- turn 1
USER: Send her the address.
ASSISTANT: Who should I send the address to, and which address is it? If you give me her name and the address, I'll also need to know which app to use (Messages, WhatsApp, email, or another). I can check that your iPhone is connected while I wait for those details.
```

## Code checks
- PASS never calls run_phone_task — not called
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)
- PASS the final reply mentions /\?/ — replied: "Who should I send the address to, and which address is it? If you give me her name and the address, I'll also need to know which app to use (Messages, WhatsApp,"

## Judged
- HELD The assistant asks who the message is for and which address, instead of starting a task on the phone. — The assistant asked who to send the address to and which address to send, and the transcript shows no tool call or phone task being started.
