#!/bin/bash
# LEGACY (v1): scaffold a hand-written single-file deck (index.html + talk.js) from assets/legacy/.
# New talks use ../new-talk.sh (a sage-talk/1 talk folder).
#   bash legacy/new-talk.sh <target-dir> ["Short title"]
set -e
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
LEG="$HERE/assets/legacy"
DEST="${1:?target directory}"
TITLE="${2:-Talk}"
mkdir -p "$DEST/assets" "$DEST/public"
for f in talk.js talk.css edit.js serve.py build-public.py "Edit talk.command"; do
  cp "$LEG/$f" "$DEST/$f"
done
chmod +x "$DEST/serve.py" "$DEST/Edit talk.command" "$DEST/build-public.py"
cp "$HERE/assets/starter-v2/assets/manrope-latin.woff2" "$DEST/assets/"
if [ ! -f "$DEST/index.html" ]; then
  sed "s/__TITLE__/$(printf '%s' "$TITLE" | sed 's/[&/\]/\\&/g')/g" "$LEG/starter/index.html" > "$DEST/index.html"
fi
if [ ! -f "$DEST/README.md" ]; then
cat > "$DEST/README.md" <<EOF
# $TITLE — talk

A continuous film with checkpoints (talk.js). Open index.html in Chrome. F for fullscreen.

Keys: Space/→ next hold · ← previous · Enter play through · N presenter window · T reset clock · H hide bar · E edit text · ⌘S save (serve the deck with "Edit talk.command" so saves write index.html).
URL: ?cp=7 · ?t=61.5 · &capture (no controls) · &cplist (hold list).

Files: index.html (film) · talk.js, talk.css (engine, theme) · edit.js, serve.py (editing) · build-public.py (public build → public/) · assets/ · PLAN.md (storyboard).

Status: 0 main holds, 0 backups.
EOF
fi
if [ ! -f "$DEST/PLAN.md" ]; then printf '# %s · storyboard\n\n(see the skill'"'"'s references/storyboard.md for the template)\n' "$TITLE" > "$DEST/PLAN.md"; fi
echo "scaffolded $DEST"
ls "$DEST"
