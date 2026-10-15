#!/usr/bin/env bash
# build.sh — build the on-phone runner and package it as an .ipa.
#
#   DEVELOPMENT_TEAM=ABCDE12345 BUNDLE_ID_PREFIX=com.example.you runner/build.sh
#   runner/build.sh --simulator        # compile check only: no signing, no .ipa
#
# Needs a Mac with Xcode, signed in to the Apple developer account that owns
# DEVELOPMENT_TEAM. The phone it will run on must be registered to that team
# (plugging it in and selecting it in Xcode once does that).
#
# BUNDLE_ID_PREFIX must be a prefix your team can use; bundle identifiers are
# unique across all of Apple's developers. What you choose decides the value the
# server needs as RUNNER_BUNDLE, which this script prints at the end.
#
# ALLOW_PROVISIONING_UPDATES=0 stops Xcode from creating or refreshing signing
# profiles; the build then succeeds only if a usable profile is already here.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/build"
PROJECT="$HERE/maestro-driver-ios.xcodeproj"

if [ "${1:-}" = "--simulator" ]; then
  xcodebuild build-for-testing -quiet \
    -project "$PROJECT" -scheme maestro-driver-ios \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$OUT/simulator" \
    CODE_SIGNING_ALLOWED=NO
  echo "Compiled for the simulator (unsigned). Nothing to install."
  exit 0
fi

: "${DEVELOPMENT_TEAM:?set DEVELOPMENT_TEAM to your 10-character Apple team ID}"
: "${BUNDLE_ID_PREFIX:?set BUNDLE_ID_PREFIX, for example com.example.you}"

PROVISIONING=(-allowProvisioningUpdates)
[ "${ALLOW_PROVISIONING_UPDATES:-1}" = "0" ] && PROVISIONING=()

xcodebuild build-for-testing -quiet \
  -project "$PROJECT" -scheme maestro-driver-ios \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$OUT/device" \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" BUNDLE_ID_PREFIX="$BUNDLE_ID_PREFIX" \
  ${PROVISIONING[@]+"${PROVISIONING[@]}"}

APP="$OUT/device/Build/Products/Debug-iphoneos/maestro-driver-iosUITests-Runner.app"
[ -d "$APP" ] || { echo "build finished but $APP is missing" >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir "$STAGE/Payload"
cp -R "$APP" "$STAGE/Payload/"
rm -f "$OUT/runner.ipa"
(cd "$STAGE" && zip -qr "$OUT/runner.ipa" Payload)

echo "Built $OUT/runner.ipa"
echo "On the server, set:  RUNNER_BUNDLE=${BUNDLE_ID_PREFIX}.maestro-driver-iosUITests.xctrunner"
