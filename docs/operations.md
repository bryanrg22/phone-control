# Operations

## What the server says about the phone

`get_phone_status` (and the start of every task) reports one of these. Each was produced on a real phone before it got its own message.

| State | What it means | What to do |
| --- | --- | --- |
| `standby` | Reachable, nothing running on it. The normal resting state | Nothing. A task can start |
| `ready` | Automation is running (a task is in progress) | — |
| `waking` | A start is in progress | Wait a few seconds |
| `waiting_on_phone` | The start is stuck on something only you can do | Unlock the phone; enter the passcode if it asks to allow automation |
| `needs_wifi` | On cellular with no warm connection | Join Wi-Fi once. After a task has started, cellular works again |
| `unreachable` | Nothing answers: switched off, out of battery, or restarted and not yet unlocked | Unlock it once and check Tailscale is on |
| `needs_attention` | The last start failed for a reason you can fix | Follow the message: usually unlock and try again |
| `needs_setup` | The phone is registered but was never paired with the server | Finish [install-phone.md](install-phone.md), step 4 |
| `not_enrolled` | No phone is registered for this person | `phonectl device add` |

### A phone that is not set up

Tasks always run on the **registered** phone, not on whichever device the chat is open on. Asking from an iPad, a computer, or a second phone signed in to the same Claude account drives the registered phone, wherever it is.

What happens when setup is incomplete, and how sure that is:

| Missing | What the chat is told | Basis |
| --- | --- | --- |
| Not registered | The connector cannot be added at all: a connect code exists only for a registered phone | Tested |
| Never paired with the server | `needs_setup`, immediately; a task is refused without touching the phone | Tested against the simulated phone |
| Paired once, but the phone no longer accepts the server | The task fails within seconds: the phone would not accept the server's connection | Tested against the simulated phone |
| Tailscale not installed, or off | `unreachable`: nothing answers at the phone's address | Measured for a phone that was switched off or not yet unlocked after a restart. A phone without the VPN should look the same to the server, but that exact case was not measured |
| Runner not installed, or its signing expired | The start fails after the session attempts run out (a few minutes) with a general "automation would not start" message. It does not say the runner is missing | From reading the code. **Not measured on a real phone** |
| Developer Mode off | Unknown. If the phone refuses the tunnel port as it does on cellular, the chat would be told the phone needs Wi-Fi, which would be wrong | **Not measured** |

The last two need a real phone to pin down, so they do not yet have their own messages.

## Behaviour worth knowing

- **Starting needs Wi-Fi; continuing does not.** iOS accepts a new tunnel only on Wi-Fi. An existing tunnel keeps working on cellular.
- **A warm tunnel does not survive the phone sleeping for long.** In testing it lasted between ten minutes and two hours. The next task rebuilds it, which takes a few seconds on Wi-Fi and is refused on cellular.
- **A locked phone cannot start a task**, and locking the phone during a task ends the task. The session itself survives locking, so the server reads the screen to notice.
- **After a restart** the phone is unreachable until it is unlocked once, and the first start asks for the passcode.
- **Switching the phone off** during a task is noticed because the runner stops answering; the server then cleans up its own side.
- **One task at a time per phone.**
- **If the chat stops asking** about a running task for a minute, the server ends the task. This is what makes the Stop button in the Claude app work.

## Day to day

```bash
systemctl status phone-control
journalctl -u phone-control -f                      # what the server is doing
ls /var/lib/phone-control/logs/                     # server.log, tunnel and session logs, task records
curl -s http://127.0.0.1:8788/healthz
```

See what the server sees, by hand (read-only):

```bash
cd /opt/phone-control
set -a; . /etc/phone-control/phone-control.env; set +a
node device/supervisor.mjs --status       --address <address> --udid <UDID>
node device/supervisor.mjs --screen-state --address <address> --udid <UDID>   # only while automation is running
```

Start and stop automation by hand:

```bash
node device/supervisor.mjs --once    --address <address> --udid <UDID>
node device/supervisor.mjs --suspend --address <address> --udid <UDID>
```

Checking reachability: use `nc -vz <address> 49152` (open on Wi-Fi, refused on cellular) and `tailscale status`. Do not use `ping`; iOS does not answer it over a VPN, so it reports total loss on a healthy connection.

## Updating

```bash
cd /opt/phone-control
git pull
npm ci --omit=dev
systemctl restart phone-control
```

From your own machine, `npm run check:deployed -- https://<your address>` compares fingerprints of your checkout with what the server reports it is running, and says when the server's files changed without a restart.

A restart does not end a warm tunnel. Do not restart while a task is running.

## Where things are

| Path | Contents |
| --- | --- |
| `/etc/phone-control/phone-control.env` | Settings. Not secret |
| `/etc/phone-control/keys.env` | Model API keys. Mode 600 |
| `/etc/phone-control/devices.json` | Registered phones |
| `/etc/phone-control/connector.json` | Assistant credentials, hashed |
| `/etc/phone-control/prefs.json` | Your default model |
| `/root/.pymobiledevice3/remote_<UDID>.plist` | The pairing record. A credential |
| `/var/lib/phone-control/` | Logs, task records, what the agent was asked to remember |

Back up `/etc/phone-control/` and `/root/.pymobiledevice3/`.

Tasks in progress are held in memory, so do not restart the server during a task. The unit is set up to leave child processes alone on restart (that is what keeps the tunnel warm), which means a task's agent and its automation session would be left running with nothing tracking them. This case has not been tested. If it happens: `pkill -f agent/agent.mjs`, then `--suspend`.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Claude: "Couldn't reach this address" | The address is not HTTPS on port 443, or Funnel is off (`tailscale funnel status`) |
| `--once` fails with a handshake error that mentions trust or ciphers | Python older than 3.13, or the server's hostname does not match the pairing record |
| `--once` prints `NOT PAIRED` or `TUNNEL REFUSED` | No pairing record for this phone in `/root/.pymobiledevice3/`, or the phone no longer accepts it. Pair again |
| `--once` fails with `can't assign requested address` and a port of `0` | The developer disk image is not mounted. Unlock the phone and try again; the server needs internet access to fetch the image |
| `--once` reports the session was authorised and then nothing | The phone is locked or showing the passcode prompt |
| go-ios exits immediately with "device not found" | `usbmuxd` is not running (`systemctl start usbmuxd`) |
| The banner stays after a task | Run `--suspend`. Then check the log for `SUSPEND FAILED` |
| Everything stopped working about a week after setup | Free Apple developer account: the runner's signing expired. Rebuild and reinstall |

## Checking a real phone

`e2e/live-check.mjs` walks through the situations above with you holding the phone, and records what the server saw at each step:

```bash
node e2e/live-check.mjs --list
node e2e/live-check.mjs --email you@example.com
```
