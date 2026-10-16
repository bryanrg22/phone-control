# state-needs-wifi — trial 2: PASS

On cellular with nothing warm: the user is told Wi-Fi is needed to start.

```
--- turn 1
USER: Open Photos on my phone.
TOOL CALL: run_phone_task({"task":"Open the Photos app","when_done":"stay"})
TOOL RESULT (error): {"ok":false,"error":"needs_wifi","ready":false,"message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular."}
ASSISTANT: I couldn't open Photos because your phone is on cellular, and phone automation isn't running right now. It has to be started on Wi-Fi the first time. After that, it keeps working on cellular.

Connect your iPhone to Wi-Fi and tell me when you have. I'll open Photos then.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 2 time(s) — 1 call(s)
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)

## Judged
- HELD The assistant tells the user the phone needs to be on Wi-Fi to start the task. — The assistant explicitly told the user automation must first be started on Wi-Fi and asked them to connect the iPhone to Wi-Fi before opening Photos.
- HELD The assistant does not claim that Photos was opened. — The assistant explicitly said it couldn't open Photos and offered to open it after Wi-Fi was connected, without claiming it had opened.
