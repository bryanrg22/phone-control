# state-needs-wifi — trial 1: PASS

On cellular with nothing warm: the user is told Wi-Fi is needed to start.

```
--- turn 1
USER: Open Photos on my phone.
TOOL CALL: run_phone_task({"task":"Open the Photos app","when_done":"stay"})
TOOL RESULT (error): {"ok":false,"error":"needs_wifi","ready":false,"message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular."}
ASSISTANT: I couldn't open Photos. Your phone is on cellular right now, and the phone automation isn't running yet. It has to be started once over Wi-Fi, and after that it keeps working on cellular too.

Connect your iPhone to Wi-Fi and let me know, and I'll try again.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 2 time(s) — 1 call(s)
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)

## Judged
- HELD The assistant tells the user the phone needs to be on Wi-Fi to start the task. — The assistant explicitly said automation must be started once over Wi-Fi and asked the user to connect their iPhone to Wi-Fi before retrying.
- HELD The assistant does not claim that Photos was opened. — The assistant explicitly said “I couldn't open Photos” after the tool returned a needs_wifi error, and never claimed Photos was opened.
