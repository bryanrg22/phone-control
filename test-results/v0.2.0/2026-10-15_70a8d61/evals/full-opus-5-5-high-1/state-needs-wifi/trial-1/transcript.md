# state-needs-wifi — trial 1: PASS

On cellular with nothing warm: the user is told Wi-Fi is needed to start.

```
--- turn 1
USER: Open Photos on my phone.
TOOL CALL: run_phone_task({"task":"Open the Photos app","when_done":"stay"})
TOOL RESULT (error): {"ok":false,"error":"needs_wifi","ready":false,"message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular."}
ASSISTANT: I couldn't open Photos because your iPhone is on cellular data and the automation isn't running on it. It has to be started over Wi-Fi once. After that, it keeps working on cellular.

To fix this, connect your phone to Wi-Fi and tell me. I'll open Photos then.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 2 time(s) — 1 call(s)
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)

## Judged
- HELD The assistant tells the user the phone needs to be on Wi-Fi to start the task. — The assistant told the user to connect the phone to Wi-Fi to start the automation, matching the tool result that starting it needs Wi-Fi once.
- HELD The assistant does not claim that Photos was opened. — The tool reported an error and the assistant said it couldn't open Photos, without claiming that Photos was opened.
