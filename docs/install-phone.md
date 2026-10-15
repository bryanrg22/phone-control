# Set up the phone

> **Before you start.** These steps come from a working setup, but nobody has yet followed them start to finish on a fresh machine. If a step does not match what you see, please [open an issue](https://github.com/bryanrg22/phone-control/issues).

Three things have to be true of the phone before the server can drive it:

1. it is on the same Tailscale network as the server;
2. the **runner** app is installed on it, signed by your Apple developer team;
3. it has been **paired** with the server.

All three are one-time. A Mac with Xcode and a cable are needed for setup, not afterwards.

## Requirements

- An iPhone you own. Everything here was done on an iPhone 15 Pro running iOS 27. The underlying mechanism exists from iOS 17; nothing older than iOS 27 has been tried.
- An Apple developer account. A free account works but its signing expires after 7 days, so the runner has to be rebuilt and reinstalled weekly. A paid account lasts a year.
- A Mac with Xcode, signed in to that account.

## 1. Phone settings

- **Tailscale**: install the Tailscale app and sign in to the same tailnet as the server. iOS allows one VPN at a time, so no other VPN can be on while the server drives the phone.
- **Developer Mode**: Settings → Privacy & Security → Developer Mode → on, then restart when asked. iOS only shows this switch after a development-signed app has been installed, so it may not appear until after step 3.

## 2. Build the runner

On the Mac, in a checkout of this repository:

```bash
DEVELOPMENT_TEAM=ABCDE12345 BUNDLE_ID_PREFIX=com.example.you runner/build.sh
```

- `DEVELOPMENT_TEAM` is your 10-character Apple team ID.
- `BUNDLE_ID_PREFIX` is any reverse-domain prefix your team can use. Bundle identifiers are unique across all Apple developers, so pick your own.
- The phone must be registered to your team. Plugging it in and selecting it as a run destination in Xcode once does that.

The script produces `runner/build/runner.ipa` and prints the `RUNNER_BUNDLE` value the server needs in `/etc/phone-control/phone-control.env`.

*Re-run while writing this guide: the script built and packaged a signed runner from this repository. That package was not installed on a phone.*

## 3. Install the runner

**From the Mac, with a cable.** Any way of installing a development-signed app works. With Xcode's command-line tool:

```bash
xcrun devicectl device install app --device <UDID> \
  runner/build/device/Build/Products/Debug-iphoneos/maestro-driver-iosUITests-Runner.app
```

This is Apple's standard tool for installing a development build.

**From the server, without a cable.** Useful for reinstalling later, for example when the signing expires. It needs the phone already paired (step 4) and on Wi-Fi:

```bash
# on the Mac
scp runner/build/runner.ipa root@<server>:/root/

# on the server
cd /opt/phone-control
set -a; . /etc/phone-control/phone-control.env; set +a
node device/supervisor.mjs --tunnel-only --address <address> --udid <UDID>
node device/supervisor.mjs --status      --address <address> --udid <UDID>   # note "rsd": "<addr>:<port>"
.venv/bin/python -m pymobiledevice3 apps install /root/runner.ipa --rsd <addr> <port>
```

Then, on the phone, the first time only: Settings → General → VPN & Device Management → your developer app → Trust.

## 4. Pair the phone with the server

Pairing creates a record that lets the server open developer services on the phone. A Linux server cannot do the first pairing itself: iOS announces itself for pairing only on the local network, and that does not cross a VPN. So the record is created on a machine next to the phone and copied to the server.

**With the Mac and a cable:**

```bash
# on the Mac — a throwaway environment, because this command needs a newer
# pymobiledevice3 than the server's pinned version
python3 -m venv /tmp/pmd3 && /tmp/pmd3/bin/pip install pymobiledevice3==9.34.0
/tmp/pmd3/bin/pymobiledevice3 lockdown remotepairing --pair

# copy the record to the server
ssh root@<server> 'mkdir -p /root/.pymobiledevice3 && chmod 700 /root/.pymobiledevice3'
scp ~/.pymobiledevice3/remote_<UDID>.plist root@<server>:/root/.pymobiledevice3/
ssh root@<server> 'chmod 600 /root/.pymobiledevice3/remote_<UDID>.plist'
```

The phone must already trust the Mac over USB (unlock it and tap Trust when asked). No code is shown; the pairing rides on that existing trust.

Then set the server's hostname to the Mac's hostname, as described in [install-server.md](install-server.md#6-the-pairing-record). The server identifies itself to the phone with an ID derived from its hostname, and it has to match the machine that created the record.

The pairing record is a credential. Do not commit it, paste it or leave copies around.

## 5. First start

Start automation once by hand, with the phone unlocked and on Wi-Fi:

```bash
cd /opt/phone-control
set -a; . /etc/phone-control/phone-control.env; set +a
node device/supervisor.mjs --once --address <address> --udid <UDID>
```

- The phone asks for its **passcode** to "Enable UI Automation". This happens on the first start after each restart of the phone.
- The **"Automation Running"** banner appears and the command prints `RUNNER_URL=http://<address>:22087`.

End it again:

```bash
node device/supervisor.mjs --suspend --address <address> --udid <UDID>
```

The banner goes away. The phone is ready: [connect Claude](connect-claude.md).

For a guided run through every situation the server is meant to handle (leaving Wi-Fi, locking, restarting, stopping from the phone), see `e2e/live-check.mjs`.
