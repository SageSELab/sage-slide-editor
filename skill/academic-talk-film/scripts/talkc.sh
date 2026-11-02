#!/bin/bash
# Run talkc, the SAGE talk editor's compiler (build, validate, layout, shoot, publish), from
# wherever it is: a `talkc` on PATH, $SAGE_REPO, the repository this skill lives in, or Kevin's
# checkout. Needs Node 24 and `corepack pnpm install` done in that repository.
#   bash talkc.sh validate talk/ --render
set -e
if command -v talkc >/dev/null 2>&1; then exec talkc "$@"; fi
SKILL="$(cd "$(dirname "$0")/.." && pwd -P)"
for R in "${SAGE_REPO:-}" "$SKILL/../.." "$HOME/Dropbox/Documents/My_Faculty_Work/SAGE/git-src-code/sage-slide-editor"; do
  if [ -n "$R" ] && [ -f "$R/packages/core/src/cli.ts" ]; then exec node "$R/packages/core/src/cli.ts" "$@"; fi
done
echo "talkc: not found. Set SAGE_REPO to a sage-slide-editor checkout (after corepack pnpm install)." >&2
exit 2
