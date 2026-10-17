# Architecture

## The problem

Apple's UI automation (XCUITest) is built for a phone plugged into a Mac running Xcode. Three things make "ask an assistant, and it happens on my phone" hard:

1. **The assistant is somewhere else.** Claude calls tools from Anthropic's servers, not from your phone. Something reachable from the public internet has to receive the call.
2. **The phone is not plugged into anything.** The automation session has to be started over a network, by a machine that is not a Mac.
3. **A session is visible and intrusive.** While one is active, iOS shows an "Automation Running" banner and dims the screen. It should exist only while a task is actually running.

## The path of one task

```
┌────────────┐  HTTPS :443   ┌──────────────────────────────────────────────┐
│ Claude     │──────────────▶│ your server                                  │
│ (Anthropic │   MCP + OAuth │                                              │
│  servers)  │◀──────────────│  server/     tools, sign-in, task lifecycle  │
└────────────┘               │     │                                        │
      ▲                      │     ├─▶ device/supervisor.mjs   one command  │
      │ chat                 │     │      ├─ tunnel.py          per action   │
┌────────────┐               │     │      └─ go-ios (patched)                │
│ Claude app │               │     └─▶ agent/agent.mjs        one process   │
│ on iPhone  │               │                                 per task     │
└────────────┘               └───────────────────┬──────────────────────────┘
                                                 │ VPN (Tailscale)
                                          ┌──────▼───────┐
                                          │ your iPhone  │
                                          │  runner :22087 ◀── taps, typing,
                                          └──────────────┘     screenshots
```

1. You ask Claude to do something on your phone. Claude calls the `run_phone_task` tool on your server and gets a run id back immediately.
2. The server starts automation on the phone (next section), checks the phone is unlocked, and clears another app's banner from the top of the screen if one is in the way.
3. The server starts the agent, a separate process that loops: take a screenshot, ask a model what to do, do it through the runner.
4. Claude calls `get_run_status` repeatedly. Each call waits on the server for up to ten seconds for something to change, so progress arrives promptly without polling noise.
5. When the agent finishes, the server brings the Claude app back to the front, ends the automation session, and the answer appears in your chat.

Step 5's clean-up runs however the task ended: finished, failed, stopped from the chat, stopped on the phone, connection lost, or the chat going quiet for half a minute.

## How a session reaches an unplugged phone

Four layers, each resting on the one below.

| Layer | What it is | Who provides it |
| --- | --- | --- |
| 4. Runner | An app on the phone answering HTTP on port 22087: tap here, type this, send a screenshot | `runner/` |
| 3. Session | An XCTest session that launched the runner and keeps it alive | `go-ios runtest`, patched |
| 2. Tunnel | A CoreDevice tunnel: the encrypted channel iOS developer services are offered on | `device/tunnel.py` (pymobiledevice3) |
| 1. Reachability | The server can open a connection to the phone at all | Tailscale |

**Reachability.** The phone and the server are on the same tailnet, so the server can address the phone wherever it is. The server's HTTPS address for Claude comes from Tailscale Funnel, which also means nothing has to listen on a public port directly.

**Tunnel.** `pymobiledevice3 remote start-tunnel` finds phones by mDNS, which does not cross a VPN. `tunnel.py` calls the same library with an explicit address instead. iOS only accepts a new tunnel on port 49152 **while the phone is on Wi-Fi**; on cellular the port refuses connections. Once built, a tunnel survives the phone moving to cellular, because it is addressed to the phone's VPN address, which does not change.

**Session.** go-ios can start an XCTest session over a tunnel, but stock go-ios first looks for the phone on USB and gives up if it is not there. `device/patches/go-ios-cableout.patch` removes that assumption in five places:

| File | Change |
| --- | --- |
| `main.go` | With `--address` and `--rsd-port` given, a phone missing from the USB list is not an error |
| `ios/utils.go` | Build the device entry from the tunnel when USB does not list the phone |
| `ios/rsd.go` | Resolve services that the tunnel only offers under a `.shim.remote` name (otherwise they resolve to port 0) |
| `ios/installationproxy/installationproxy.go` | Reach the installation service through the tunnel |
| `ios/testmanagerd/xcuitestrunner.go` | When the iOS version cannot be read over USB, a tunnel implies iOS 17+ |

The `go-ios runtest` process is the session's **anchor**: the runner lives exactly as long as that process does. Ending it ends the runner and clears the banner, and leaves the tunnel up.

**Runner.** Launched by the session, it serves a small HTTP API on the phone. The agent and the supervisor both talk to it directly over the VPN.

### Warm and cold

Ending a task ends the session (layer 3) and keeps the tunnel (layer 2). That is the difference between:

- a **warm start**: tunnel still up, start a session over it. A couple of seconds, and it works on cellular.
- a **cold start**: build a tunnel first. Longer, and it needs Wi-Fi.

A warm tunnel does not last forever. In testing it went stale anywhere from ten minutes to two hours after the phone went to sleep. The supervisor detects a stale tunnel, removes it, and builds a new one, which is why the first task after a while needs Wi-Fi.

### Developer disk image

iOS offers the testing service only after a developer disk image is mounted, and a restart unmounts it. The supervisor checks for the service after building a tunnel and mounts the image through pymobiledevice3 when it is missing. The phone has to be unlocked for that, and the server needs internet access to fetch the image.

## Why the pieces are separate processes

- **`device/supervisor.mjs` is run once per action** (`--status`, `--once`, `--suspend`, …) and exits. The server holds no connection to the phone between actions, so restarting the server loses nothing, and you can run the same commands by hand to see exactly what the server sees.
- **The tunnel helper and the anchor outlive whoever started them.** The systemd unit uses `KillMode=process` so a server restart does not take the warm tunnel with it.
- **The agent is a child process per task.** A crash or a hang in a task cannot take the server down, and stopping a task is a signal.

## Sign-in

Claude registers itself with the server (OAuth dynamic client registration), then sends you to a consent page. The page asks for a **connect code**: eight characters, single use, valid for ten minutes, created on the server with `phonectl link-code`. Entering it ties that assistant's token to your phone. Tokens are stored hashed; `phonectl revoke` invalidates them.

Only you can create a connect code, on your own server. Nothing about your phone is reachable through the public address without one.

## What the server can tell about a phone

The supervisor measures; `server/src/preflight.mjs` turns the measurement into a state and a sentence for the chat.

| Signal | How it is read |
| --- | --- |
| On Wi-Fi, on cellular, or unreachable | A connection to port 49152: accepted, refused, or no answer. Refused and no answer are different facts |
| Tunnel live, stale or absent | The tunnel's interface and whether it still routes |
| Automation running | The runner answers on port 22087 |
| Locked | The runner's view of the screen includes the lock screen's own elements |
| A start is waiting on the owner | The session was authorised and then nothing happened for ten seconds (locked phone, or the passcode prompt) |
| Stopped on the phone | The anchor's log ends with a lost connection to the testing service |
| Never paired | No pairing record for the phone on the server. Known without contacting the phone |

[operations.md](operations.md) lists the resulting states.
