#!/bin/bash
# Packaging smoke test (docs/packaging.md): the packaged app with this repository out of the way.
#
#   bash scripts/package.sh && bash scripts/package-smoke.sh [path/to/SAGE Talk.app]
#
# Copies the app and a temp copy of fixtures/issta26 into a fresh temp folder, then runs
# everything from there with a clean environment (no SAGE_REPO, SAGE_NODE or NODE_*; PATH with
# no node on it; cwd the temp folder), so nothing can reach the checkout:
#   1. the copied app's signature verifies, and no file in it mentions the repository's path
#   2. the app in SAGE_SELFTEST mode (never activated, draws only its own views): the sidecar
#      starts from the bundle (expected mode: bundled), the talk builds and opens, every
#      thumbnail renders, presenting, the edit and external-edit round trips, the Claude pane
#      replay, talk.publish / talk.export / site staging through the sidecar, and the
#      onboarding checks (Claude auth asked without a model call)
#   3. talkc, found on the PATH the sidecar gives Claude (Resources/sidecar/bin first):
#      publish writes the public file, byte-identical to the repository's talkc output; and
#      shoot renders a frame with the bundled Playwright in the render browser the app chose
# Exits 1 on any failure. Results in <tmp>/out (kept; the path is printed).
set -euo pipefail
cd "$(dirname "$0")/.."
SRC_APP="$(cd "$(dirname "${1:-build/SAGE Talk.app}")" && pwd)/$(basename "${1:-build/SAGE Talk.app}")"
REPO="$(cd ../.. && pwd)"
[ -x "$SRC_APP/Contents/MacOS/SageTalk" ] || { echo "no app at $SRC_APP; run scripts/package.sh first" >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/sage-smoke.XXXXXX")"
WORK="$(cd "$WORK" && pwd -P)"
# The temp copy stays on disk with the results, but must not linger in Launchpad or Spotlight.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
trap '"$LSREGISTER" -u "$WORK/SAGE Talk.app" >/dev/null 2>&1 || true' EXIT
APP="$WORK/SAGE Talk.app"
SIDE="$APP/Contents/Resources/sidecar"
OUT="$WORK/out"
mkdir -p "$OUT"
ditto "$SRC_APP" "$APP"
rsync -a --exclude build --exclude .sage "$REPO/fixtures/issta26/" "$WORK/issta26/"
cp "$REPO/tests/claude/caption-frame.ndjson" "$WORK/caption-frame.ndjson"
# The reference for the publish comparison, made with the repository's talkc before the run.
rsync -a --exclude build --exclude .sage "$REPO/fixtures/issta26/" "$WORK/reference/"
node "$REPO/packages/core/src/cli.ts" publish "$WORK/reference" issta26 >/dev/null

FAILS=0
pass() { echo "PASS $*" | tee -a "$OUT/smoke.txt"; }
fail() { echo "FAIL $*" | tee -a "$OUT/smoke.txt"; FAILS=$((FAILS + 1)); }
check() { local what="$1"; shift; if "$@"; then pass "$what"; else fail "$what"; fi; }

# The environment a Finder launch gives an app, and nothing else.
CLEAN=(env -i HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" SHELL="${SHELL:-/bin/zsh}" TMPDIR="${TMPDIR:-/tmp}"
       PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG="${LANG:-en_US.UTF-8}")
cd "$WORK"

# ---- 1. the bundle itself -----------------------------------------------------------------
check "the copied app's signature verifies (ad hoc, hardened runtime)" codesign --verify --strict --deep "$APP"
check "no baked repository path (sage-repo-path, sage-node-path)" test ! -e "$APP/Contents/Resources/sage-repo-path" -a ! -e "$APP/Contents/Resources/sage-node-path"
if grep -rlF "$REPO" "$APP/Contents" >"$OUT/repo-mentions.txt" 2>/dev/null; then
  fail "no file in the app mentions $REPO (see repo-mentions.txt)"
else
  pass "no file in the app mentions the repository's path"
fi
check "no node on the clean PATH" "${CLEAN[@]}" /bin/sh -c '! command -v node >/dev/null'

# ---- 2. the app, self-test mode -----------------------------------------------------------
"${CLEAN[@]}" SAGE_OPEN="$WORK/issta26" SAGE_SELFTEST="$OUT/selftest" SAGE_SELFTEST_EXPECT_MODE=bundled \
  SAGE_SELFTEST_CLAUDE_TRACE="$WORK/caption-frame.ndjson" \
  "$APP/Contents/MacOS/SageTalk" >"$OUT/app.log" 2>&1 &
PID=$!
( sleep 600; kill "$PID" ) >/dev/null 2>&1 &
WATCHDOG=$!
disown "$WATCHDOG"
APP_EXIT=0
wait "$PID" || APP_EXIT=$?
pkill -P "$WATCHDOG" 2>/dev/null || true; kill "$WATCHDOG" 2>/dev/null || true
check "the app ran its self-test and quit (exit $APP_EXIT)" test "$APP_EXIT" -eq 0 -a -f "$OUT/selftest/result.txt"
RESULT="$OUT/selftest/result.txt"
touch "$RESULT"
check "no self-test check failed ($(grep -c '^PASS' "$RESULT") passed)" sh -c "! grep -q '^FAIL' '$RESULT' && grep -q '^PASS' '$RESULT'"
check "the talk sidecar started from the bundle" grep -q 'info: ready (protocol 1, node v[0-9.]*, bundled' "$OUT/app.log"
check "no sidecar ran from a checkout" sh -c "! grep -q 'info: ready (protocol 1, node v[0-9.]*, development' '$OUT/app.log'"
check "the onboarding sidecar runs in bundled mode" grep -q '^PASS onboarding: the sidecar runs in bundled mode' "$RESULT"
check "the talk built and opened" grep -q '^PASS talk opened and the engine booted' "$RESULT"
check "every thumbnail rendered" grep -q '^PASS all thumbnails generated' "$RESULT"
check "talk.publish and talk.export through the bundled sidecar" sh -c "grep -q '^PASS publish: wrote' '$RESULT' && grep -q '^PASS export: PDF' '$RESULT'"
check "Claude auth reported without a model call" grep -q '^PASS onboarding: Claude auth state reported' "$RESULT"
check "talkc reported inside the copied app" grep -qF "talkc $SIDE/bin/talkc" "$OUT/selftest/onboarding.txt"

# ---- 3. talkc through the sidecar's PATH --------------------------------------------------
# What Claude's Bash sees: the sidecar puts bin/ first on PATH (runtime.ts applyRuntime).
TALKC_ENV=("${CLEAN[@]}" PATH="$SIDE/bin:/usr/bin:/bin:/usr/sbin:/sbin")
FOUND="$("${TALKC_ENV[@]}" /bin/sh -c 'command -v talkc' || true)"
check "talkc on that PATH is the app's shim ($FOUND)" test "$FOUND" = "$SIDE/bin/talkc"
if "${TALKC_ENV[@]}" talkc publish "$WORK/issta26" issta26 >"$OUT/publish.log" 2>&1; then
  pass "talkc publish (bundled) exited 0: $(tail -1 "$OUT/publish.log")"
else
  fail "talkc publish (bundled): $(tail -3 "$OUT/publish.log")"
fi
check "the public file is byte-identical to the repository's talkc output" \
  cmp -s "$WORK/issta26/build/public/issta26.html" "$WORK/reference/build/public/issta26.html"
BROWSER="$(sed -nE 's/^browser (chrome|installed|missing)( .*)?$/\1/p' "$OUT/selftest/onboarding.txt")"
if [ "$BROWSER" = missing ]; then
  echo "SKIP talkc shoot: no render browser on this Mac (the app offers the download)" | tee -a "$OUT/smoke.txt"
elif "${TALKC_ENV[@]}" talkc shoot "$WORK/issta26" --times 5 --out "$OUT/shots" >"$OUT/shoot.log" 2>&1 && ls "$OUT/shots"/*.png >/dev/null 2>&1; then
  pass "talkc shoot rendered a frame with the bundled Playwright in $BROWSER"
else
  fail "talkc shoot: $(tail -3 "$OUT/shoot.log")"
fi

echo
echo "results: $OUT ($FAILS failed)"
[ "$FAILS" -eq 0 ]
