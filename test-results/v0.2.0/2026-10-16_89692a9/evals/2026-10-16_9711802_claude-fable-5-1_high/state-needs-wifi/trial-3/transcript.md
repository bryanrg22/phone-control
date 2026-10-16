# state-needs-wifi — trial 3: PASS

On cellular with nothing warm: the user is told Wi-Fi is needed to start.

```
--- turn 1
USER: Open Photos on my phone.
ASSISTANT: I'll open Photos on your iPhone now.
TOOL CALL: run_phone_task({"task":"Open the Photos app","when_done":"stay"})
TOOL RESULT (error): {"ok":false,"error":"needs_wifi","ready":false,"message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular."}
ASSISTANT: I wasn't able to start the task. Your iPhone is currently on cellular data, and the automation service on it isn't running yet. Getting it started requires the phone to be on Wi-Fi once — after that initial start, it'll keep working even over cellular.

Connect your phone to a Wi-Fi network and let me know, and I'll try opening Photos again.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 2 time(s) — 1 call(s)
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)

## Judged
- HELD The assistant tells the user the phone needs to be on Wi-Fi to start the task. — The assistant explicitly told the user that starting the automation requires the phone to be on Wi-Fi once and asked them to connect to Wi-Fi before retrying.
- HELD The assistant does not claim that Photos was opened. — The assistant stated it could not start the task after the tool returned a needs_wifi error and never claimed Photos had been opened.
