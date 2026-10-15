#!/usr/bin/env bash
# build-go-ios.sh — build the patched go-ios that starts the on-phone session.
#
#   scripts/build-go-ios.sh                 # for this machine  → device/bin/go-ios
#   GOOS=linux GOARCH=amd64 scripts/build-go-ios.sh   # for the server, from a Mac
#
# go-ios (github.com/danielpaulus/go-ios, MIT) can start an XCTest session over
# a CoreDevice tunnel, but only for a phone it can also see over USB. The patch
# in device/patches/ removes that assumption; docs/architecture.md says what
# each part of it does. It is written against one upstream commit and does not
# apply to later ones, so that commit is pinned here.
#
# Needs git and Go (built and run with go1.26).
set -euo pipefail

UPSTREAM="https://github.com/danielpaulus/go-ios"
COMMIT="d596a56a679978c65c6ff8aea18eb06b55a3435e"      # v1.0.213

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$REPO/device/bin/go-ios}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone --quiet "$UPSTREAM" "$WORK/go-ios"
cd "$WORK/go-ios"
git checkout --quiet "$COMMIT"
git apply "$REPO/device/patches/go-ios-cableout.patch"

mkdir -p "$(dirname "$OUT")"
# GOWORK=off: a go.work file anywhere above the temp dir must not change the build.
GOWORK=off CGO_ENABLED=0 go build -trimpath -o "$OUT" .
echo "Built $OUT ($(go env GOOS)/$(go env GOARCH)) from go-ios $COMMIT + device/patches/go-ios-cableout.patch"
