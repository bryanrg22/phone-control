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
XCTESTRUN=""
for f in "$P"/*.xctestrun; do case "$(basename "$f")" in phone-control-*) ;; *) XCTESTRUN="$f" ;; esac; done
[ -f "$XCTESTRUN" ] || { echo "no runner build: run evals/phone-agent/prepare-simulator.sh first"; exit 1; }

# The runner is one XCTest that runs until it is stopped, so it never "succeeds",
# and the build's default attachment lifetime (deleteOnSuccess) kept every
# screenshot and snapshot it served as a test attachment inside the simulator
# (testmanagerd's Attachments: 24 GB after a day of evals, filling the disk,
# 2026-10-16). A copy of the run file, beside the original so __TESTROOT__
# still resolves, keeps none.
RUN="$P/phone-control-runner.xctestrun"
cp "$XCTESTRUN" "$RUN"
TARGET="$(plutil -p "$RUN" | awk -F'"' '/^  "[^_][^"]*" => \{/ {print $2; exit}')"
plutil -replace "$TARGET.SystemAttachmentLifetime" -string keepNever "$RUN"
plutil -replace "$TARGET.UserAttachmentLifetime" -string keepNever "$RUN"
exec xcodebuild test-without-building -xctestrun "$RUN" -destination "platform=iOS Simulator,id=$UDID"
