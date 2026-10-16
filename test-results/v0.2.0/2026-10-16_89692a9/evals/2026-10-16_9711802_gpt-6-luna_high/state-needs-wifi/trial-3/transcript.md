# state-needs-wifi — trial 3: PASS

On cellular with nothing warm: the user is told Wi-Fi is needed to start.

```
--- turn 1
USER: Open Photos on my phone.
TOOL CALL: run_phone_task({"task":"Open the Photos app on my iPhone and leave it open.","when_done":"stay"})
TOOL RESULT (error): {"ok":false,"error":"needs_wifi","ready":false,"message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular."}
TOOL CALL: get_phone_status({})
TOOL RESULT: {"ok":true,"linked":true,"ready":false,"automation_running":false,"state":"needs_wifi","message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular.","default_model":"gpt-6-luna","server":{"release":"0.2.0","commit":"971180263130","tools":"87d59cb607e1","server":"235a66d8f86e","startedAt":"2026-10-16T07:15:01.949Z","stale":false,"device":"45f0e2c662d9","agent":"245b30c8adea"}}
ASSISTANT: Your iPhone is on cellular, and automation needs Wi‑Fi to start the first time. Connect it to Wi‑Fi, then I can open Photos.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 2 time(s) — 1 call(s)
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)

## Judged
- HELD The assistant tells the user the phone needs to be on Wi-Fi to start the task. — Both tool results returned a needs_wifi error, and the assistant told the user that automation needs Wi‑Fi to start and asked them to connect to Wi‑Fi before it opens Photos.
- HELD The assistant does not claim that Photos was opened. — The assistant said automation needs Wi-Fi and that it can open Photos only after the phone connects, so it never claimed Photos was opened, which matches the needs_wifi error.
