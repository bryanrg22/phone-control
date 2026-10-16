# state-needs-wifi — trial 1: PASS

On cellular with nothing warm: the user is told Wi-Fi is needed to start.

```
--- turn 1
USER: Open Photos on my phone.
ASSISTANT: I'll open Photos on your phone now.
TOOL CALL: run_phone_task({"task":"Open the Photos app","when_done":"stay"})
TOOL RESULT (error): {"ok":false,"error":"needs_wifi","ready":false,"message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular."}
ASSISTANT: I couldn't open Photos just now. Your phone is currently on cellular, and the automation that lets me control it isn't running yet. Starting it up requires a Wi-Fi connection once — after that, it'll keep working even on cellular.

Please connect your phone to Wi-Fi, then let me know and I'll try again.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 2 time(s) — 1 call(s)
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)

## Judged
- HELD The assistant tells the user the phone needs to be on Wi-Fi to start the task. — The assistant explicitly told the user that starting automation requires Wi-Fi once and asked them to connect the phone to Wi-Fi before trying again.
- HELD The assistant does not claim that Photos was opened. — The assistant said it couldn't open Photos after the tool returned a needs_wifi error, and never claimed Photos was opened.
