#!/bin/bash
# Render an SVG to an .icns (packaging/make-icon.swift, then iconutil), skipping the work when
# the .icns is newer than the SVG and the renderer. Used by package.sh and bundle.sh.
#   bash scripts/make-icns.sh <art.svg> <out.icns> [--document]
set -euo pipefail
cd "$(dirname "$0")/.."
SVG="$1"; ICNS="$2"; shift 2
if [ -f "$ICNS" ] && [ "$ICNS" -nt packaging/make-icon.swift ] && [ "$ICNS" -nt "$SVG" ]; then exit 0; fi
SET="${ICNS%.icns}.iconset"
rm -rf "$SET"
mkdir -p "$(dirname "$ICNS")"
swift packaging/make-icon.swift "$SET" "$SVG" "$@" >/dev/null
iconutil -c icns "$SET" -o "$ICNS"
