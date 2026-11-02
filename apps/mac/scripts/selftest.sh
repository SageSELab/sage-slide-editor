#!/bin/bash
# Launch the app in the background on a talk folder (it never takes focus), let it exercise the
# talk and draw its own windows and web views to PNGs, quit. Exits 1 if any check failed.
# A beat-format talk opens through the sidecar and also gets the external-edit round trip on a
# temp copy. Checks are in <out-dir>/result.txt; see Sources/SageTalk/SelfTest.swift.
#   bash scripts/selftest.sh <talk-folder> [out-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
TALK="$(cd "$1" && pwd)"; OUT="${2:-build/selftest}"
rm -rf "$OUT"; mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
APP=$(bash scripts/bundle.sh debug | tail -1)
SAGE_OPEN="$TALK" SAGE_SELFTEST="$OUT" "$APP/Contents/MacOS/SageTalk"
# Keep build copies out of Launchpad and Spotlight's app list: only /Applications should show.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$LSREGISTER" -u "$PWD/$APP" >/dev/null 2>&1 || true
ls "$OUT"
cat "$OUT/result.txt"
! grep -q '^FAIL' "$OUT/result.txt"
