#!/usr/bin/env bash
# prepare-simulator.sh — a simulator in iOSWorld's start state, with our runner installed.
#
#   evals/phone-agent/prepare-simulator.sh <iOSWorld checkout> ["simulator name"] [runner port]
#
# Defaults: "iOSWorld iPhone 17 Pro", port 22187 (22087 is left to any other
# simulator's runner: simulators share the Mac's network).
#
# 1. Creates the simulator if it does not exist (iPhone 17 Pro, newest iOS 26 runtime).
# 2. Runs iOSWorld's own bootstrap on it: ERASES that simulator, then builds and
#    installs the 26 apps, imports the contacts, grants permissions.
# 3. Removes the home-screen widgets, as iOSWorld's bootstrap intends, with the
#    simulator shut down: on iOS 26.4 SpringBoard writes its layout back over an
#    edit made while it runs, so the bootstrap's own removal does not stick.
# 4. Builds our runner from runner/ and installs it on the simulator.
#
# Then start the runner with start-runner.sh and run evals/phone-agent/run.mjs.
set -euo pipefail

IOSWORLD="${1:?usage: prepare-simulator.sh <iOSWorld checkout> [\"simulator name\"] [runner port]}"
NAME="${2:-iOSWorld iPhone 17 Pro}"
PORT="${3:-22187}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

udid_of() {
  xcrun simctl list devices -j | python3 -c '
import json, sys
name = sys.argv[1]
for runtime, devices in json.load(sys.stdin)["devices"].items():
    for d in devices:
        if d["name"] == name and d.get("isAvailable", True):
            print(d["udid"]); sys.exit(0)' "$1"
}

UDID="$(udid_of "$NAME")"
if [ -z "$UDID" ]; then
  RUNTIME="$(xcrun simctl list runtimes -j | python3 -c '
import json, sys
rs = [r for r in json.load(sys.stdin)["runtimes"] if r["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-26") and r.get("isAvailable")]
print(sorted(rs, key=lambda r: r["version"])[-1]["identifier"] if rs else "")')"
  [ -n "$RUNTIME" ] || { echo "no iOS 26 simulator runtime installed (Xcode > Settings > Components)"; exit 1; }
  UDID="$(xcrun simctl create "$NAME" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro "$RUNTIME")"
  echo "created \"$NAME\" ($UDID) on $RUNTIME"
fi
echo "simulator: \"$NAME\" ($UDID)"

# 2. iOSWorld's bootstrap. It matches the device by exact name, so it can only touch this one.
"$IOSWORLD/iphone/bootstrap/bootstrap_ios_apps.sh" --device "$NAME"

# 3. Widgets, with the simulator shut down.
xcrun simctl shutdown "$UDID" 2>/dev/null || true
python3 - "$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Library/SpringBoard/IconState.plist" <<'PY'
# The same rule as iOSWorld's remove_home_screen_widgets (iphone/bootstrap/bootstrap_ios_apps.sh).
import os, plistlib, sys
path = sys.argv[1]
if os.path.exists(path):
    with open(path, "rb") as f:
        data = plistlib.load(f)
    data["iconLists"] = [[x for x in page if not (isinstance(x, dict) and (x.get("elementType") == "widget" or "elements" in x))]
                         for page in data.get("iconLists", [])]
    if "today" in data:
        data["today"] = []
    with open(path, "wb") as f:
        plistlib.dump(data, f)
    print("home-screen widgets removed")
PY
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null

# 4. Our runner, built from this checkout.
"$REPO/runner/build.sh" --simulator
P="$REPO/runner/build/simulator/Build/Products"
xcrun simctl install "$UDID" "$P/Debug-iphonesimulator/maestro-driver-iosUITests-Runner.app"
xcrun simctl install "$UDID" "$P/Debug-iphonesimulator/maestro-driver-ios.app"
xcrun simctl spawn "$UDID" launchctl setenv PORT "$PORT"

echo
echo "Ready. Start the runner (leave it running):"
echo "  evals/phone-agent/start-runner.sh $UDID"
echo "Then run, for example:"
echo "  node evals/phone-agent/run.mjs --udid $UDID --driver-port $PORT --models openai:gpt-6-luna --tasks clock-001"
