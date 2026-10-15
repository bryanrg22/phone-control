# Set up the server

> **Before you start.** These steps come from a working setup, but nobody has yet followed them start to finish on a fresh machine. If a step does not match what you see, please [open an issue](https://github.com/bryanrg22/phone-control/issues).

The server is a small Linux machine of your own that stays on. It receives Claude's tool calls and drives your phone. It serves you and your phone; nobody else can use it unless you register them.

## What it runs on

| | Tested with |
| --- | --- |
| Machine | Any small VPS. 1 vCPU and 1 GB RAM is enough, with little to spare |
| OS | Ubuntu 24.04 LTS, x86_64 |
| Node.js | 22 (NodeSource package) |
| Python | 3.13 (deadsnakes PPA). **3.13 is the minimum**: the tunnel uses TLS-PSK, which Python gained in 3.13. On 3.12 the handshake fails with an error that looks like a trust problem |
| pymobiledevice3 | 9.7.2, pinned. 10.x changed the interface `device/tunnel.py` uses |
| go-ios | upstream commit `d596a56` (v1.0.213) plus `device/patches/go-ios-cableout.patch` |
| Tailscale | 1.102 |

Everything below runs as root. The service runs as root too, because it creates a kernel tunnel interface and pymobiledevice3 looks for the phone's pairing record in the home directory of the user it runs as.

## 1. System packages

```bash
apt-get update
apt-get install -y git curl python3-venv net-tools usbmuxd
systemctl enable --now usbmuxd
```

`net-tools` provides `ifconfig`, which `device/tunnel.py` uses to check that the tunnel interface is up. `usbmuxd` must be running even though no phone is ever plugged in: go-ios asks it for a device list before it does anything else.

On a brand-new machine, Ubuntu's automatic updates hold the package lock for the first few minutes. Wait for them to finish.

## 2. Node.js 22 and Python 3.13

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

add-apt-repository -y ppa:deadsnakes/ppa
apt-get install -y python3.13 python3.13-venv python3.13-dev
```

## 3. Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

Sign in to the same tailnet your phone is on.

**Publish the server to Claude.** Claude connects from Anthropic's servers and only to port 443, so the server needs a public HTTPS address on that port. Tailscale Funnel provides one and forwards it to a local port:

```bash
tailscale funnel --bg 8788
tailscale funnel status      # shows https://<machine>.<tailnet>.ts.net
```

The first time, Tailscale may ask you to enable HTTPS certificates and Funnel for your tailnet. Keep the address it prints; it is your `CONNECTOR_PUBLIC_URL`.

**Optional: always use a relay.** You can make Tailscale send all traffic through its relays instead of finding a direct path:

```bash
mkdir -p /etc/systemd/system/tailscaled.service.d
printf '[Service]\nEnvironment=TS_DEBUG_ALWAYS_USE_DERP=1\n' \
  > /etc/systemd/system/tailscaled.service.d/force-derp.conf
systemctl daemon-reload && systemctl restart tailscaled
```

This is a choice, not a requirement. It makes the path identical before and after the phone moves between Wi-Fi and cellular, at the cost of added latency on every request. A direct path also works. Automation on cellular does not depend on it.

## 4. This repository

```bash
git clone https://github.com/bryanrg22/phone-control.git /opt/phone-control
cd /opt/phone-control
npm ci --omit=dev

python3.13 -m venv .venv
.venv/bin/pip install -r deploy/requirements.txt
```

## 5. go-ios

`scripts/build-go-ios.sh` clones go-ios at the pinned commit, applies the patch and builds `device/bin/go-ios`. It needs Go, which the server does not otherwise need, so the simplest route is to build on your Mac and copy the result:

```bash
# on the Mac, in a checkout of this repository
GOOS=linux GOARCH=amd64 scripts/build-go-ios.sh "$PWD/device/bin/go-ios-linux-amd64"
scp device/bin/go-ios-linux-amd64 root@<server>:/opt/phone-control/device/bin/go-ios
```

The script builds for both macOS and Linux.

## 6. The pairing record

The phone and the server have to trust each other before any tunnel can be built. [install-phone.md](install-phone.md) covers creating the pairing record. It ends up here:

```
/root/.pymobiledevice3/remote_<UDID>.plist      (mode 600, directory mode 700)
```

Treat this file like a password: anyone holding it can open developer services on your phone.

**The server's hostname is part of the trust.** pymobiledevice3 9.7.2 identifies itself to the phone with an ID derived from the machine's hostname, so the server's hostname must be the hostname of the machine that created the pairing record, and must not change afterwards:

```bash
hostnamectl set-hostname <hostname of the machine that paired>
```

The Tailscale machine name is separate and can be anything.

## 7. Settings

```bash
mkdir -p /etc/phone-control /var/lib/phone-control
cp deploy/example.env      /etc/phone-control/phone-control.env
cp deploy/example.keys.env /etc/phone-control/keys.env
chmod 600 /etc/phone-control/keys.env
```

Edit `/etc/phone-control/phone-control.env`:

- `CONNECTOR_PUBLIC_URL`: the Funnel address from step 3.
- `RUNNER_BUNDLE`: printed by `runner/build.sh` when you build the runner.

Put the API key for the model that will drive the phone in `/etc/phone-control/keys.env`. Only the provider you use needs one.

## 8. The service

```bash
cp deploy/phone-control.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now phone-control
curl -s http://127.0.0.1:8788/healthz
```

`healthz` answers `{"ok":true,"service":"phone-control",…}`. From your own machine, `npm run check:deployed -- https://<your address>` compares the code the server is running with your checkout.

Do not start the server with `systemd-run` instead of the unit file. The unit's `KillMode=process` keeps the tunnel alive across restarts, and a transient unit with a surviving child process cannot be started again under the same name.

## 9. Register the phone

```bash
cd /opt/phone-control
node server/bin/phonectl.mjs device add \
  --email you@example.com \
  --address <the phone's Tailscale IPv4 address> \
  --udid <the phone's UDID>
```

The email is just a label for you; it is not sent anywhere. Find the phone's address with `tailscale status`.

Check that the server can see it. Never use `ping` for this, because iOS does not answer it over a VPN:

```bash
set -a; . /etc/phone-control/phone-control.env; set +a
node device/supervisor.mjs --status --address <address> --udid <UDID>
```

`phoneNet` should be `wifi` with the phone awake on Wi-Fi. Next: [connect Claude](connect-claude.md).

## Keeping it running

- **Back up** `/root/.pymobiledevice3/` and `/etc/phone-control/`. Losing the pairing record means pairing again with the phone in hand.
- **Unattended upgrades** can restart services overnight. The unit file survives that; a warm tunnel may not, and the next task then needs Wi-Fi.
- [operations.md](operations.md) covers logs, updating, and what each reported state means.
