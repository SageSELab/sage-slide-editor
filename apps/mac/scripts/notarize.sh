#!/bin/bash
# UNTESTED: written without a Developer ID certificate or notary credentials, and never run.
# Re-signs build/SAGE Talk.app (from scripts/package.sh) with a Developer ID Application
# identity, submits it to Apple's notary service, staples the ticket, and makes a zip for
# distribution. See docs/packaging.md, "Developer ID and notarization".
#
# Needs:
#   SAGE_SIGN_IDENTITY  e.g. "Developer ID Application: SAGE Lab (TEAMID1234)" (in the login keychain)
#   SAGE_NOTARY_PROFILE a notarytool keychain profile, made once with
#                       xcrun notarytool store-credentials sage-notary --apple-id <id> --team-id <team> --password <app-specific>
#
#   SAGE_SIGN_IDENTITY=... SAGE_NOTARY_PROFILE=sage-notary bash scripts/notarize.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SAGE_SIGN_IDENTITY:?set SAGE_SIGN_IDENTITY to a Developer ID Application identity}"
: "${SAGE_NOTARY_PROFILE:?set SAGE_NOTARY_PROFILE to a notarytool keychain profile}"
APP="build/SAGE Talk.app"
RES="$APP/Contents/Resources"
ZIP="build/SAGE-Talk.zip"
[ -d "$APP" ] || { echo "run scripts/package.sh first" >&2; exit 1; }

sign() { codesign --force --timestamp --options runtime --sign "$SAGE_SIGN_IDENTITY" "$@"; }

# 1. Nested code first, innermost out. The Agent SDK's claude binary is already signed by
#    Anthropic (Developer ID, hardened runtime, secure timestamp); notarization accepts nested
#    code signed by another team, so it is verified, not re-signed.
codesign --verify --strict "$RES/sidecar/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude"
sign --entitlements packaging/node.entitlements "$RES/node/bin/node"
# Any other Mach-O in the bundle (none today: playwright-core is JavaScript) must be signed too.
while IFS= read -r f; do
  case "$f" in */claude|*/node/bin/node|*/MacOS/SageTalk) continue ;; esac
  sign "$f"
done < <(find "$APP/Contents" -type f -perm -u+x -exec sh -c 'file -b "$1" | grep -q Mach-O && echo "$1"' _ {} \;)

# 2. The app itself, last.
sign --entitlements packaging/SageTalk.entitlements --identifier io.sagelab.talk "$APP"
codesign --verify --strict --deep --verbose=2 "$APP"
spctl --assess --type execute --verbose "$APP" || true   # fails until stapled

# 3. Notarize (a zip made by ditto keeps the bundle's symlinks and extended attributes).
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
xcrun notarytool submit "$ZIP" --keychain-profile "$SAGE_NOTARY_PROFILE" --wait --output-format json | tee build/notary-result.json
grep -q '"status" *: *"Accepted"' build/notary-result.json || {
  id="$(sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' build/notary-result.json | head -1)"
  [ -n "$id" ] && xcrun notarytool log "$id" --keychain-profile "$SAGE_NOTARY_PROFILE"
  exit 1
}

# 4. Staple the ticket to the app (offline Gatekeeper checks), re-zip, check.
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
spctl --assess --type execute --verbose "$APP"
echo "$ZIP"
