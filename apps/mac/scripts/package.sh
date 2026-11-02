#!/bin/bash
# Build the release app, self-contained: build/SAGE Talk.app runs without this repository
# (docs/packaging.md). Ad-hoc signed with the hardened runtime; scripts/notarize.sh describes
# the Developer ID + notarization steps.
#
#   bash scripts/package.sh            prints the app path last, after a size summary
#
# Downloads, into build/cache (gitignored), only the pinned official Node.js release tarball
# from nodejs.org, checked against both the SHA-256 pinned below and the release's
# SHASUMS256.txt. Everything else comes from this checkout's pnpm install.
set -euo pipefail
cd "$(dirname "$0")/.."
MAC="$PWD"
REPO="$(cd ../.. && pwd)"

NODE_VERSION=24.22.2
NODE_SHA256=aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a   # node-v24.22.2-darwin-arm64.tar.gz
NODE_DIST="node-v${NODE_VERSION}-darwin-arm64"
BUNDLE_ID=io.sagelab.talk
CACHE="$MAC/build/cache"
APP="$MAC/build/SAGE Talk.app"
RES="$APP/Contents/Resources"
SIDE="$RES/sidecar"

step() { printf '\n== %s\n' "$*" >&2; }
die() { echo "package.sh: $*" >&2; exit 1; }
[ "$(uname -m)" = arm64 ] || die "this script packages darwin-arm64 only"

# ---- versions -----------------------------------------------------------------------------
DESCRIBE="$(git -C "$REPO" describe --tags --always --dirty)"
BUILD_NUMBER="$(git -C "$REPO" rev-list --count HEAD)"
if [[ "$DESCRIBE" =~ ^v?([0-9]+\.[0-9]+(\.[0-9]+)?) ]]; then SHORT_VERSION="${BASH_REMATCH[1]}"; else SHORT_VERSION="0.6.0"; fi

# ---- Node runtime -------------------------------------------------------------------------
step "Node $NODE_VERSION"
mkdir -p "$CACHE/node"
TARBALL="$CACHE/node/$NODE_DIST.tar.gz"
SUMS="$CACHE/node/SHASUMS256-v$NODE_VERSION.txt"
[ -f "$SUMS" ] || curl -fsSL -o "$SUMS" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
if [ ! -f "$TARBALL" ]; then
  curl -fsSL -o "$TARBALL.part" "https://nodejs.org/dist/v$NODE_VERSION/$NODE_DIST.tar.gz"
  mv "$TARBALL.part" "$TARBALL"
fi
GOT="$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)"
LISTED="$(grep " $NODE_DIST.tar.gz\$" "$SUMS" | cut -d' ' -f1)"
[ "$GOT" = "$NODE_SHA256" ] || { rm -f "$TARBALL"; die "Node tarball checksum $GOT != pinned $NODE_SHA256 (deleted; run again)"; }
[ "$GOT" = "$LISTED" ] || die "Node tarball checksum $GOT is not the one in SHASUMS256.txt ($LISTED)"
echo "sha256 ok: $GOT" >&2
NODE_X="$CACHE/node/$NODE_DIST"
[ -x "$NODE_X/bin/node" ] || tar -xzf "$TARBALL" -C "$CACHE/node" "$NODE_DIST/bin/node" "$NODE_DIST/LICENSE"

# ---- Swift app ----------------------------------------------------------------------------
step "SwiftPM release build"
SWIFT_FLAGS=(-c release)
swift build "${SWIFT_FLAGS[@]}" > "$CACHE/swift-build.log" 2>&1 || { cat "$CACHE/swift-build.log" >&2; die "the release build failed"; }
tail -1 "$CACHE/swift-build.log" >&2
grep -q 'warning:' "$CACHE/swift-build.log" && die "the release build has warnings (see $CACHE/swift-build.log)"
BIN="$(swift build "${SWIFT_FLAGS[@]}" --show-bin-path)/SageTalk"
[ -x "$BIN" ] || die "no release binary at $BIN"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$RES/node/bin" "$SIDE/bin" "$SIDE/node_modules"
cp "$BIN" "$APP/Contents/MacOS/SageTalk"
# Debug symbols carry this checkout's paths (object files, sources); a release app needs neither.
strip -S -x "$APP/Contents/MacOS/SageTalk"
cp "$NODE_X/bin/node" "$RES/node/bin/node"
cp "$NODE_X/LICENSE" "$RES/node/LICENSE"

# ---- sidecar ------------------------------------------------------------------------------
step "Sidecar bundle (esbuild)"
(cd "$REPO/packages/sidecar" && "$NODE_X/bin/node" scripts/bundle.ts "$SIDE") >&2

# What cannot be bundled, copied out of the pnpm store with links resolved.
resolve() { # <from-dir> <module/path>  -> absolute file
  (cd "$1" && "$NODE_X/bin/node" -e 'console.log(require.resolve(process.argv[1]))' "$2")
}
SDK_DIR="$(dirname "$(resolve "$REPO/packages/sidecar" @anthropic-ai/claude-agent-sdk)")"
SDK_BIN_DIR="$(dirname "$(resolve "$SDK_DIR" @anthropic-ai/claude-agent-sdk-darwin-arm64/package.json)")"
PW_DIR="$(dirname "$(resolve "$REPO/packages/render" playwright/package.json)")"
PWC_DIR="$(dirname "$(resolve "$PW_DIR" playwright-core/package.json)")"
mkdir -p "$SIDE/node_modules/@anthropic-ai/claude-agent-sdk" "$SIDE/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64"
# sdk.mjs is self-contained (it imports only Node built-ins); the rest of the package is
# types, a browser build and a bridge the sidecar does not use.
for f in sdk.mjs package.json LICENSE.md README.md; do cp "$SDK_DIR/$f" "$SIDE/node_modules/@anthropic-ai/claude-agent-sdk/"; done
cp -R "$SDK_BIN_DIR/." "$SIDE/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/"
cp -R "$PWC_DIR" "$SIDE/node_modules/playwright-core"
rm -rf "$SIDE/node_modules/playwright-core/types"

# Engine files where core expects them (SAGE_ENGINE_DIR, set by the sidecar's runtime.ts),
# the canvas overlay for the app, the plugin with its skill symlink resolved.
cp -R "$REPO/packages/engine/src" "$SIDE/engine"
cp "$REPO/packages/engine/src/canvas.js" "$RES/canvas.js"
cp -RL "$REPO/packages/sidecar/plugin" "$SIDE/plugin"
rm -rf "$SIDE/plugin/skills/academic-talk-film/evals"
find "$SIDE/plugin" -type l | grep -q . && die "symlinks left in the plugin"

cat > "$SIDE/bin/talkc" <<'SH'
#!/bin/sh
# talkc from SAGE Talk.app: the app's own Node running the bundled @sage/core CLI. The sidecar
# puts this folder first on Claude's PATH.
here="$(cd "$(dirname "$0")/.." && pwd -P)"
exec "$here/../node/bin/node" "$here/dist/talkc.mjs" "$@"
SH
chmod +x "$SIDE/bin/talkc"

SDK_VERSION="$("$NODE_X/bin/node" -p 'require(process.argv[1]).version' "$SDK_DIR/package.json")"
PW_VERSION="$("$NODE_X/bin/node" -p 'require(process.argv[1]).version' "$PWC_DIR/package.json")"
CHROMIUM_REV="$("$NODE_X/bin/node" -p 'require(process.argv[1]).browsers.find((b) => b.name === "chromium-headless-shell").revision' "$PWC_DIR/browsers.json")"
"$NODE_X/bin/node" -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({
  format: "sage-sidecar/1", version: process.argv[2], node: process.argv[3], agentSdk: process.argv[4],
  playwright: process.argv[5], chromiumRevision: process.argv[6] }, null, 2) + "\n")' \
  "$SIDE/manifest.json" "$DESCRIBE" "v$NODE_VERSION" "$SDK_VERSION" "$PW_VERSION" "$CHROMIUM_REV"

# ---- Info.plist, icon ---------------------------------------------------------------------
step "Info.plist and icon"
if [ ! -f "$CACHE/AppIcon.icns" ] || [ packaging/make-icon.swift -nt "$CACHE/AppIcon.icns" ] || [ packaging/AppIcon.svg -nt "$CACHE/AppIcon.icns" ]; then
  rm -rf "$CACHE/AppIcon.iconset"
  swift packaging/make-icon.swift "$CACHE/AppIcon.iconset" >/dev/null
  iconutil -c icns "$CACHE/AppIcon.iconset" -o "$CACHE/AppIcon.icns"
fi
cp "$CACHE/AppIcon.icns" "$RES/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleName</key><string>SAGE Talk</string>
  <key>CFBundleDisplayName</key><string>SAGE Talk</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleExecutable</key><string>SageTalk</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>$SHORT_VERSION</string>
  <key>CFBundleVersion</key><string>$BUILD_NUMBER</string>
  <key>SAGEGitDescribe</key><string>$DESCRIBE</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>LSArchitecturePriority</key><array><string>arm64</string></array>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticTermination</key><false/>
  <key>NSHumanReadableCopyright</key><string>SAGE Lab</string>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <!-- A talk is a folder holding talk.json (sage-talk/1) or a legacy index.html deck:
           folders dropped on the app or opened with it. -->
      <key>CFBundleTypeName</key><string>Talk Folder</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key><array><string>public.folder</string></array>
    </dict>
    <dict>
      <!-- A talk's spine: opening talk.json opens its folder. -->
      <key>CFBundleTypeName</key><string>Talk Spine (talk.json)</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key><array><string>public.json</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST
plutil -lint "$APP/Contents/Info.plist" >/dev/null
printf 'APPL????' > "$APP/Contents/PkgInfo"

# ---- signing (ad hoc, hardened runtime) ---------------------------------------------------
step "Ad-hoc signing"
CLAUDE_BIN="$SIDE/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude"
# The claude binary keeps Anthropic's Developer ID signature (hardened runtime, timestamped):
# re-signing it would drop that. Check it is intact.
codesign --verify --strict "$CLAUDE_BIN" || die "the claude binary's signature does not verify"
codesign --force --sign - --options runtime --entitlements packaging/node.entitlements "$RES/node/bin/node"
# JIT probe: V8 must be able to compile under the hardened runtime with these entitlements.
"$RES/node/bin/node" -e 'let s = 0; for (let i = 0; i < 2e7; i++) s += i % 7; if (s !== 59999997) process.exit(1)' \
  || die "the signed node cannot run JIT code (node.entitlements)"
codesign --force --sign - --options runtime --entitlements packaging/SageTalk.entitlements \
  --identifier "$BUNDLE_ID" "$APP"
codesign --verify --strict --deep "$APP" || die "the app's signature does not verify"

# ---- size summary -------------------------------------------------------------------------
step "Size"
kb() { du -sk "$1" | cut -f1; }
row() { printf '%9.1f MB  %s\n' "$(echo "$(kb "$1") / 1024" | bc -l)" "$2"; }
{
  row "$APP" "SAGE Talk.app (total)"
  row "$CLAUDE_BIN" "  claude (Agent SDK native CLI, Anthropic-signed)"
  row "$RES/node" "  node $NODE_VERSION runtime"
  row "$SIDE/node_modules/playwright-core" "  playwright-core"
  row "$SIDE/node_modules/@anthropic-ai/claude-agent-sdk" "  Agent SDK (sdk.mjs)"
  row "$SIDE/dist" "  sidecar bundle (main.mjs + talkc.mjs)"
  row "$SIDE/plugin" "  plugin (academic-talk-film skill)"
  row "$SIDE/engine" "  engine"
  row "$APP/Contents/MacOS" "  Swift app executable"
} | tee "$MAC/build/package-size.txt" >&2
echo "$APP"
