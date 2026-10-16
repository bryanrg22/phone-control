# state-needs-wifi — trial 2: PASS

On cellular with nothing warm: the user is told Wi-Fi is needed to start.

```
--- turn 1
USER: Open Photos on my phone.
ASSISTANT: I'll open the Photos app on your phone now.
TOOL CALL: run_phone_task({"task":"Open the Photos app","when_done":"stay"})
TOOL RESULT (error): {"ok":false,"error":"needs_wifi","ready":false,"message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular."}
ASSISTANT: The task couldn't start: your phone is currently on cellular, and the automation isn't running yet. To get it started, your phone needs to be on Wi-Fi once — after that initial start, it will keep working even on cellular.

Connect your phone to Wi-Fi and let me know, and I'll open Photos for you.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 2 time(s) — 1 call(s)
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)

## Judged
- HELD The assistant tells the user the phone needs to be on Wi-Fi to start the task. — The assistant explicitly told the user the phone needs to be on Wi-Fi once to start automation, matching the tool's needs_wifi error.
- HELD The assistant does not claim that Photos was opened. — The assistant said the task couldn't start because Wi-Fi was required and never claimed that Photos had opened.
