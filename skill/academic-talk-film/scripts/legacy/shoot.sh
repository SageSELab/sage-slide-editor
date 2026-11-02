#!/bin/bash
# Screenshot a talk at one or more times with headless Chrome.
#   bash shoot.sh <talk-dir-or-html> <t> [<t> ...]        → PNGs in $OUT (default: /tmp/talk-shots)
# render(t) is deterministic, so the frame at t is exactly what the audience sees there.
set -e
TARGET="${1:?talk dir or html file}"; shift
if [ -d "$TARGET" ]; then HTML="$(cd "$TARGET" && pwd)/index.html"; else HTML="$(cd "$(dirname "$TARGET")" && pwd)/$(basename "$TARGET")"; fi
OUT="${OUT:-/tmp/talk-shots}"; mkdir -p "$OUT"
CH="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
for t in "$@"; do
  "$CH" --headless=new --disable-gpu --hide-scrollbars --window-size=1920,1080 --virtual-time-budget=3000 \
    --screenshot="$OUT/t$t.png" "file://$HTML?t=$t&capture" >/dev/null 2>&1
  echo "$OUT/t$t.png"
done
