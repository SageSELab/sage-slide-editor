#!/bin/bash
# Build the SwiftPM executable and wrap it in a minimal .app bundle (until a real Xcode
# project with signing arrives in Phase 6).   bash scripts/bundle.sh [debug|release]
set -euo pipefail
cd "$(dirname "$0")/.."
CONF="${1:-debug}"
swift build -c "$CONF"
BIN="$(swift build -c "$CONF" --show-bin-path)/SageTalk"
APP="build/SageTalk.app"
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/SageTalk"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>SAGE Talk</string>
  <key>CFBundleIdentifier</key><string>io.sagelab.talk</string>
  <key>CFBundleExecutable</key><string>SageTalk</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.0.1</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "$APP"
