# Gotchas met while building the ISSTA 2026 deck, and the fixes (LEGACY single-file decks)

> v1 list, for decks written as one `index.html`. Script paths below are now under
> `scripts/legacy/` and the engine files under `assets/legacy/`. For sage-talk/1 talks see
> `../gotchas.md`.

**An element is visible before its entrance (or a screen is dimmed early).** WAAPI: the first animation that touches a property on an element fills both ways, so a one-keyframe `T.out` registered as the first opacity animation makes the element visible from t=0. Fixes: bring the element in with a from-0 keyframe first (`T.in`, or `T.show` which uses `[{opacity:0},{opacity:1}]`), or start a flash with an explicit from-1 keyframe (`[{opacity:1},{opacity:.15,offset:.02},{opacity:1}]`). Never register a `T.out` for an element that is never brought in.

**A hold shows a ghost of the next tile.** The next element's `T.in` started before the hold time. Put the hold after the current motion ends and start the next element's motion at least 0.1 s after the hold. For builds: step spacing = longest micro-animation + 0.6 s.

**Chapter label flips on the hold instead of after it.** Chapter markers at exactly the hold time win the `<=` comparison. Put each marker 0.1 s after the chapter's first hold.

**Descenders clipped while a headline blurs in.** Blur filters clip at the box. talk.css adds padding-bottom and a negative margin on display type; keep that and never put `overflow:hidden` on text containers.

**Typed text leaves a white box before it starts.** `T.type` must empty the element at p≤0 (it does in the bundled engine). If you write a custom tween, handle p=0.

**Stray text appears outside its pane.** A `.scene` is full-stage; an absolutely positioned child with the wrong `left/top` lands on another pane. Shoot the frame and use `&at=x,y` to find who painted there.

**Edit mode shows outlines but nothing can be focused.** Later scenes stack above the current one and swallow clicks. talk.css already sets `pointer-events:none` on everything in the stage while editing and `auto` on `.ed` targets; keep those rules if you edit the CSS.

**⌘S asks to save a new file.** Chrome refuses the File System Access API from `file://`. Serve the deck with `serve.py` (double-click `Edit talk.command`); the save then goes straight to `index.html`.

**Shifting times after inserting or removing a beat.** Use `scripts/shift-times.py index.html "<start marker>" "<end marker>" <delta> [--min N] [--prefix c4]` to add delta to every `c4 + N` literal in the block, then update the chapter `at` values, `DURATION`, the dark-window logic (driven by chapter `dark` flags in the starter, hard-coded times in older decks), and the public build's duration. Re-list holds with `cplist.sh` and compare against the previous list.

**Removing a hold whose content a later hold builds on.** Check whether the next hold adds to the same pane (`T.in` of more elements without `T.out` of the current ones). If so, remove only the `cp(...)` line and merge its notes; if the content is self-contained, cut the segment and shift.

**Moving a segment to the backups.** The backup must recreate the state it needs: show the device at the right position, reveal the code lines it depends on (`tline` each), fade `#black` out if the backup is light. Elements already faded out by the main flow can be brought back with `T.in`.

**A new element on an existing pane overlaps a stroke or line drawn in world coordinates.** The chapter-1 timeline sits at y=680 across the title; keep title-pane additions above 660 or below 700.

**Headless screenshots come out blank.** Usually a script syntax error. Check with `node -e "const s=require('fs').readFileSync('index.html','utf8');const m=s.match(/<script>([\s\S]*)<\/script>/);new Function(m[1])"`. Also always run Chrome from inside the talk folder with an absolute `file://` URL, and use `--virtual-time-budget=3000`.

**Headless playback tests are unreliable.** Under virtual time, rAF does not advance, so `T.play()` stays at t=0. Test states with `?t=` (deterministic render), not by playing.

**Python on this machine is 3.6.** No `fromisoformat`, no walrus, no `capture_output`, no `directory=` on `SimpleHTTPRequestHandler`. ImageMagick's `convert` is a broken x86 binary; use `sips` for crops and resizes, and Chrome headless for anything else.

**Git commit messages with apostrophes.** Write the message to a file with `printf` and use `git commit -F file`; heredocs in the tool shell break on quotes.

**Fonts.** Manrope is bundled as a latin-subset woff2 and inlined into the public build; system fonts for text and mono. No CDN links, the deck must work offline on the podium laptop.

**Images.** Headshots as 240 px square JPEGs cropped with `sips -c H W --cropOffset y x` after `--resampleWidth`; rendered round via CSS. QR codes as SVG from the `qrcode` npm package (see publishing.md). Logos grayscaled at 0.8 opacity on the light stage, `brightness(0) invert(1)` on the dark close.

**Double-blind.** A follow-up under review is "a follow-up study" / "ongoing work" on screen and in notes; the venue is never typed anywhere in the deck, including README and commit messages.
