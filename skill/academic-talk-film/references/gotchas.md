# Gotchas for sage-talk/1 talks, and the fixes

The compiler and validator now catch what used to be the commonest failures: a script syntax
error blanking the stage (`script-syntax`, the build refuses), an entrance starting before its
hold (`ghost-entrance`, and `ghost-visible` under `--render`), a chapter label flipping on the
hold (markers are derived), times to shift after inserting a beat (times are beat-relative),
dark windows and durations to recompute (derived from the spine), duplicate ids, missing assets,
a selector that matches nothing. Run `talkc validate talk/ --render` (or `talk_layout` in the
app) after every round and fix every error before looking at frames. What remains:

## Format rules the tools cannot fix for you

**Never re-indent or reformat scene HTML.** Scenes are emitted verbatim. A code pane is
`white-space: pre`, so the indentation inside it is content; a reformat moved the ISSTA panes
by up to 9,671 px. Edit scenes with exact, minimal replacements, and keep long lines long.

**Text the film rewrites at runtime is edited in motion code, not in the scene.** `B.count`,
`B.type` and `B.set(…, { text })` own their element's text while the film plays; the markup is
only the value before the first step. Change the number in the `B.count(…, to)` call, the
string in the `B.set` step, or the helper's data array (`lib/term.js` lines, `lib/bars.js`
rows). The SAGE app refuses an in-place text edit on such an element (`runtime-text`).

**The initial state lives in markup.** A `B.set` track starts from the value captured at
registration. If an element must start hidden, styled or with other text, write that in the
scene; a step at t = 0 of a later beat is not the same thing (it shows the markup until then).

**Leave the previous pane at t = 0 of the beat that replaces it,** not at the end of the beat
that shows it: motion after the hold of beat k belongs to beat k+1 (boundary rule). A `B.out`
in beat k that runs past its hold is a ghost in reverse: the pane is half gone at the hold.

**The first animation on a property decides what shows before it.** Bring an element in with
a from-0 keyframe (`B.in`, `B.show`, `[{opacity:0},{opacity:1}]`) the first time any beat
touches it. Never register a `B.out` for an element no beat brings in. A flash on a visible
element starts from an explicit value (`[{opacity:1},{opacity:.15,offset:.02},{opacity:1}]`).
The validator warns (`first-owner-opacity`); moving or deleting a beat can create the problem
in another beat, so validate after every structural edit.

**A hold before the motion ends is allowed, and only a warning.** Use it on purpose (a heat
map still filling while Kevin talks) and say so in a comment; otherwise move the hold.

**Element ids are unique across all scenes and layers** (`duplicate-element-id`). Prefix them
by chapter (`c4-h`, `c4-s`).

**Assets go in `assets/`.** The build copies only that folder (`asset-not-in-build` warns
about anything else); the public build inlines what scenes and the theme reference.

**A lib file that generates DOM throws if its container is missing,** which stops every later
script (`record-script-failed`, a blank or half-built film). Copy a starter helper only with
the markup it expects, and list lib files in dependency order (`codepane.js` before `term.js`).

**`B.at` and `B.T` are escape hatches** (absolute times). They bypass hold seeding and the
ghost checks; keep them inside helpers that genuinely need the absolute clock.

**Backups must recreate the state they need.** Kevin jumps to a backup directly: show the
device at the right position, reveal the code lines it depends on, fade `#black` out if the
backup is light (set `"dark": false` on that beat). Elements an earlier beat faded out can be
brought back with `B.in`.

**Removing a hold whose content a later hold builds on.** If the next beat only adds to the
same pane, merge the two beats (move the motion into one registration, keep one spine entry,
merge the notes) rather than deleting the motion with the beat.

## Rendering

**Stray text outside its pane.** A `.scene` is full-stage; an absolutely positioned child with
the wrong `left/top` lands on another pane. Shoot the frame; `&hide=sel` isolates who painted.

**Descenders clipped while a headline blurs in.** Blur filters clip at the box. talk.css pads
display type; never put `overflow:hidden` on text containers.

**Do not test playback, test instants.** Under headless virtual time rAF does not advance; use
`?t=` frames (`talkc shoot`, `talk_frame`). Do not sample exactly on a `B.set` step time when
comparing frames: the step applies from its time inclusive.

**3D in thumbnails.** The app's navigator thumbnails flatten 3D transforms; `talk_frame` and
`talkc shoot` render with Chromium and show 3D correctly. Judge 3D beats from those.

## Environment

**Python on this machine is 3.6.** No `fromisoformat`, no walrus, no `capture_output`. Prefer
Node (24) for data mining scripts. ImageMagick's `convert` is a broken x86 binary; use `sips`.

**Git commit messages with apostrophes.** Write the message to a file and `git commit -F file`.

**Fonts.** Manrope is a latin-subset woff2 in `assets/` (talk.css loads it from there); system
fonts for text and mono. No CDN links: the deck must work offline on the podium laptop.

**Images.** Headshots as 240 px square JPEGs (`sips --resampleWidth`, then `-c H W
--cropOffset y x`), rendered round via CSS. QR codes as SVG from the `qrcode` npm package (see
publishing.md). Logos grayscaled at 0.8 opacity on the light stage, `brightness(0) invert(1)`
on the dark close.

**Double-blind.** A follow-up under review is "a follow-up study" or "ongoing work" on screen,
in notes, in talk.json, in README and in commit messages; the venue is never typed anywhere.
