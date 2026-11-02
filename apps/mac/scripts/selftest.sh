#!/bin/bash
# Launch the app in the background on a talk folder, let it photograph its own window, quit.
#   bash scripts/selftest.sh <talk-folder> [out-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
TALK="$(cd "$1" && pwd)"; OUT="${2:-build/selftest}"
rm -rf "$OUT"; mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
APP=$(bash scripts/bundle.sh debug | tail -1)
SAGE_OPEN="$TALK" SAGE_SELFTEST="$OUT" "$APP/Contents/MacOS/SageTalk"
ls "$OUT"
