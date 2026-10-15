#!/usr/bin/env bash
# start-runner.sh — run our XCTest runner on a prepared simulator, until stopped.
#
#   evals/phone-agent/start-runner.sh <simulator UDID>
#
# The port is the one prepare-simulator.sh set inside the simulator (22187 by
# default). Check it with: curl http://127.0.0.1:22187/deviceInfo
set -euo pipefail
UDID="${1:?usage: start-runner.sh <simulator UDID>}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
P="$REPO/runner/build/simulator/Build/Products"
set -- "$P"/*.xctestrun
XCTESTRUN="$1"
[ -f "$XCTESTRUN" ] || { echo "no runner build: run evals/phone-agent/prepare-simulator.sh first"; exit 1; }
exec xcodebuild test-without-building -xctestrun "$XCTESTRUN" -destination "platform=iOS Simulator,id=$UDID"
