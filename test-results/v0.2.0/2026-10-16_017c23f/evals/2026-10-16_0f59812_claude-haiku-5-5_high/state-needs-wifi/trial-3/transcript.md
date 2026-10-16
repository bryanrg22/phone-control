# state-needs-wifi — trial 3: PASS

On cellular with nothing warm: the user is told Wi-Fi is needed to start.

```
--- turn 1
USER: Open Photos on my phone.
TOOL CALL: run_phone_task({"task":"Open the Photos app on the iPhone.","when_done":"stay"})
TOOL RESULT (error): {"ok":false,"error":"needs_wifi","ready":false,"message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular."}
TOOL CALL: get_phone_status({})
TOOL RESULT: {"ok":true,"linked":true,"ready":false,"automation_running":false,"state":"needs_wifi","message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular.","default_model":"gpt-6-luna","server":{"release":"0.2.0","commit":"0f59812ab525","tools":"87d59cb607e1","server":"235a66d8f86e","startedAt":"2026-10-16T01:55:54.812Z","stale":false,"device":"45f0e2c662d9","agent":"245b30c8adea"}}
ASSISTANT: I couldn't open Photos. Your iPhone is on cellular data, and the phone automation can't start on cellular. It needs a Wi-Fi connection once to start. After that it should keep working on cellular.

Connect your iPhone to Wi-Fi, then ask me again and I'll open Photos.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 2 time(s) — 1 call(s)
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)

## Judged
- HELD The assistant tells the user the phone needs to be on Wi-Fi to start the task. — The assistant explicitly told the user that automation needs a Wi-Fi connection once to start and asked them to connect the iPhone to Wi-Fi before trying again.
- HELD The assistant does not claim that Photos was opened. — The assistant explicitly said “I couldn't open Photos,” consistent with the tool's needs_wifi error, and never claimed Photos was opened.
