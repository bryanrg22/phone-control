# state-needs-wifi — trial 1: PASS

On cellular with nothing warm: the user is told Wi-Fi is needed to start.

```
--- turn 1
USER: Open Photos on my phone.
TOOL CALL: run_phone_task({"task":"Open the Photos app","when_done":"stay"})
TOOL RESULT (error): {"ok":false,"error":"needs_wifi","ready":false,"message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular."}
ASSISTANT: I couldn't open Photos. Your phone is on cellular data, and automation has to be started over Wi-Fi first. Connect your iPhone to Wi-Fi and tell me when it's done, and I'll try again. After it starts, it should keep working on cellular.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 2 time(s) — 1 call(s)
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)

## Judged
- HELD The assistant tells the user the phone needs to be on Wi-Fi to start the task. — The assistant explicitly told the user that automation must be started over Wi-Fi first and asked them to connect their iPhone to Wi-Fi before retrying.
- HELD The assistant does not claim that Photos was opened. — The assistant explicitly said “I couldn't open Photos,” consistent with the tool's needs_wifi error, and did not claim Photos was opened.
