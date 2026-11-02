#!/bin/bash
# Build the SwiftPM executable and wrap it in a minimal .app bundle (until a real Xcode
# project with signing arrives in Phase 6).   bash scripts/bundle.sh [debug|release]
#
# The development app runs the sidecar from this checkout (`node --import tsx src/main.ts` in
# packages/sidecar). The repo path and the node path are baked into Contents/Resources
# (sage-repo-path, sage-node-path) because an app opened from Finder has no useful cwd or PATH.
# SAGE_REPO and SAGE_NODE in the environment override them (SidecarLocator).
set -euo pipefail
cd "$(dirname "$0")/.."
CONF="${1:-debug}"
swift build -c "$CONF"
BIN="$(swift build -c "$CONF" --show-bin-path)/SageTalk"
APP="build/SageTalk.app"
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/SageTalk"
# Icons and document types as in the release app (.talk / .talktheme packages), cached in build/cache.
for art in AppIcon TalkDocument ThemeDocument; do
  bash scripts/make-icns.sh "packaging/$art.svg" "build/cache/$art.icns" $([ "$art" = AppIcon ] || echo --document)
  cp "build/cache/$art.icns" "$APP/Contents/Resources/"
done
DOCUMENT_TYPES="$(cat packaging/document-types.plist.xml)"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>SAGE Talk</string>
  <key>CFBundleIdentifier</key><string>io.sagelab.talk</string>
  <key>CFBundleExecutable</key><string>SageTalk</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.0.1</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>NSHighResolutionCapable</key><true/>
$DOCUMENT_TYPES
</dict></plist>
PLIST
plutil -lint "$APP/Contents/Info.plist" >/dev/null
REPO="$(cd ../.. && pwd)"
printf '%s\n' "$REPO" > "$APP/Contents/Resources/sage-repo-path"
NODE="${SAGE_NODE:-$(command -v node || true)}"
if [ -n "$NODE" ]; then printf '%s\n' "$NODE" > "$APP/Contents/Resources/sage-node-path"; fi
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
# Keep build copies out of Launchpad and Spotlight's app list: only /Applications should show.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$LSREGISTER" -u "$PWD/$APP" >/dev/null 2>&1 || true
echo "$APP"
