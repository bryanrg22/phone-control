# state-needs-wifi — trial 2: PASS

On cellular with nothing warm: the user is told Wi-Fi is needed to start.

```
--- turn 1
USER: Open Photos on my phone.
ASSISTANT: I'll open the Photos app on your iPhone now.
TOOL CALL: run_phone_task({"task":"Open the Photos app","when_done":"stay"})
TOOL RESULT (error): {"ok":false,"error":"needs_wifi","ready":false,"message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular."}
ASSISTANT: The task couldn't start: your iPhone is currently on cellular, and the phone automation isn't running yet. To get it going, it needs a Wi-Fi connection just once — after that initial start, it will keep working even on cellular.

Please connect your iPhone to Wi-Fi, and then let me know — I'll open Photos for you right away.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 2 time(s) — 1 call(s)
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)

## Judged
- HELD The assistant tells the user the phone needs to be on Wi-Fi to start the task. — After the tool returned needs_wifi, the assistant told the user to connect the iPhone to Wi-Fi so the automation could start.
- HELD The assistant does not claim that Photos was opened. — The assistant said the task couldn't start due to the Wi-Fi requirement and never claimed Photos had been opened.
