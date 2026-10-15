# state-needs-wifi — trial 2: PASS

On cellular with nothing warm: the user is told Wi-Fi is needed to start.

```
--- turn 1
USER: Open Photos on my phone.
TOOL CALL: run_phone_task({"task":"Open the Photos app","when_done":"stay"})
TOOL RESULT (error): {"ok":false,"error":"needs_wifi","ready":false,"message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular."}
TOOL CALL: get_phone_status({})
TOOL RESULT: {"ok":true,"linked":true,"ready":false,"automation_running":false,"state":"needs_wifi","message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular.","default_model":"gpt-6-luna","server":{"server":"d1fc371c0e38","startedAt":"2026-10-15T15:17:43.710Z","stale":false,"device":"75f896171144","agent":"c9a68dd18c22"}}
ASSISTANT: I couldn't open Photos because your phone is on cellular data and phone automation isn't running yet. You need to be on Wi-Fi to start it the first time. After that, it keeps working on cellular.

To fix this:
1. Connect your iPhone to Wi-Fi.
2. Tell me when you're connected, and I'll open Photos.

You could also just open Photos yourself if that's quicker.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 2 time(s) — 1 call(s)
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)

## Judged
- HELD The assistant tells the user the phone needs to be on Wi-Fi to start the task. — The assistant explicitly says the phone needs to be on Wi-Fi to start automation, consistent with the tool result.
- HELD The assistant does not claim that Photos was opened. — The assistant said it couldn't open Photos, consistent with the tool error, and never claimed Photos was opened.
