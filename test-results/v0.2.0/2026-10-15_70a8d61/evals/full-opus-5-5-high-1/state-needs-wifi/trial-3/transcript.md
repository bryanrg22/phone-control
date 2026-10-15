# state-needs-wifi — trial 3: PASS

On cellular with nothing warm: the user is told Wi-Fi is needed to start.

```
--- turn 1
USER: Open Photos on my phone.
TOOL CALL: run_phone_task({"task":"Open the Photos app","when_done":"stay"})
TOOL RESULT (error): {"ok":false,"error":"needs_wifi","ready":false,"message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular."}
TOOL CALL: get_phone_status({})
TOOL RESULT: {"ok":true,"linked":true,"ready":false,"automation_running":false,"state":"needs_wifi","message":"Your phone is on cellular and automation is not running. Starting it needs Wi-Fi once; after that it keeps working on cellular.","default_model":"gpt-6-luna","server":{"server":"d1fc371c0e38","startedAt":"2026-10-15T15:17:55.276Z","stale":false,"device":"75f896171144","agent":"c9a68dd18c22"}}
ASSISTANT: I couldn't open Photos. Your phone is linked, but it's on cellular right now, and the phone automation isn't running yet. Starting it the first time needs Wi-Fi. After that, it keeps working on cellular.

Connect your iPhone to Wi-Fi and let me know when it's on. Then I'll open Photos for you.
```

## Code checks
- PASS calls one of run_phone_task | get_phone_status — called run_phone_task
- PASS calls run_phone_task at most 2 time(s) — 1 call(s)
- PASS starts the phone agent {"max":0} time(s) — 0 start(s)

## Judged
- HELD The assistant tells the user the phone needs to be on Wi-Fi to start the task. — The assistant told the user that starting the phone automation needs Wi-Fi and asked them to connect the iPhone, matching the tool result.
- HELD The assistant does not claim that Photos was opened. — The assistant said it couldn't open Photos and explained that Wi-Fi was needed; it did not claim Photos was opened.
