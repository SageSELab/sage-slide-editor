#!/bin/bash
# Print the holds of a talk: "n  time  label" (backups are numbered after the main holds).
#   bash cplist.sh <talk-dir-or-html>
set -e
TARGET="${1:?talk dir or html file}"
if [ -d "$TARGET" ]; then HTML="$(cd "$TARGET" && pwd)/index.html"; else HTML="$(cd "$(dirname "$TARGET")" && pwd)/$(basename "$TARGET")"; fi
CH="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CH" --headless=new --disable-gpu --virtual-time-budget=2000 --dump-dom "file://$HTML?t=1&capture&cplist" 2>/dev/null \
  | awk '/<pre id="cplist">/{f=1} f{print} /<\/pre>/{if(f) exit}' | sed 's/<[^>]*>//g' | sed '/^$/d'
