#!/bin/bash
# Scaffold a sage-talk/1 talk folder from assets/starter-v2: a minimal working talk (title, one
# chapter, a dark passage with the close, a backup, a public end card) that passes
# `talkc validate --render` and builds. Grow it chapter by chapter.
#   bash new-talk.sh <target-dir> ["Short title"]
# Refuses to overwrite an existing talk.json. Hand-written single-file decks: scripts/legacy/.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd -P)"
DEST="${1:?usage: new-talk.sh <target-dir> [\"Short title\"]}"
TITLE="${2:-Talk}"
if [ -e "$DEST/talk.json" ]; then echo "new-talk: $DEST/talk.json already exists; not overwriting" >&2; exit 1; fi
mkdir -p "$DEST"
cp -R "$HERE/assets/starter-v2/." "$DEST/"

# The title goes into talk.json: JSON-escape it, then escape it for sed's replacement.
JSON_TITLE=$(printf '%s' "$TITLE" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
SED_TITLE=$(printf '%s' "$JSON_TITLE" | sed -e 's/[\\&|]/\\&/g')
sed "s|__TITLE__|$SED_TITLE|" "$DEST/talk.json" > "$DEST/talk.json.tmp" && mv "$DEST/talk.json.tmp" "$DEST/talk.json"

[ -f "$DEST/.gitignore" ] || printf 'build/\n.sage/\n' > "$DEST/.gitignore"
if [ ! -f "$DEST/PLAN.md" ]; then
  printf '# %s · storyboard\n\n(see the skill'"'"'s references/storyboard.md for the template)\n' "$TITLE" > "$DEST/PLAN.md"
fi
if [ ! -f "$DEST/README.md" ]; then
  {
    printf '# %s · talk\n\n' "$TITLE"
    printf 'A sage-talk/1 talk folder: a continuous film with checkpoints. Open it in the SAGE talk editor,\n'
    printf 'or build it with talkc and open build/index.html in Chrome (F for fullscreen).\n\n'
    printf 'Files: talk.json (spine: chapters, beats, holds, notes, materials) · scenes/*.html (one per\n'
    printf 'chapter) · beats/<chapter>.js (motion) · lib/*.js (helpers) · theme.css · assets/ · PLAN.md\n'
    printf '(storyboard). build/ is generated; do not edit it.\n\n'
    printf 'Commands: talkc build . · talkc validate . --render · talkc layout . · talkc shoot . --holds ·\n'
    printf 'talkc publish . <slug>\n\n'
    printf 'Keys: Space/→ next hold · ← previous · Enter play through · N presenter window · T reset clock ·\n'
    printf 'H hide bar. URL: ?cp=7 · ?t=61.5 · &capture (no controls) · &cplist (hold list).\n\n'
    printf 'Status: 5 main holds, 1 backup (the starter).\n'
  } > "$DEST/README.md"
fi
echo "scaffolded $DEST"
ls "$DEST"
