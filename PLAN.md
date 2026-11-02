# SAGE Talk Editor — Implementation Plan

Working title. A native macOS app (Windows later) for editing, presenting, and publishing
Kevin Moran's "film with checkpoints" talks, with Claude embedded as a chat pane that builds
and revises the film in real time while the human makes quick edits on the canvas.

Revised 2026-11-01 after Phase 0 (see docs/phase0-memo.md). Written 2026-11-01 after reading the `academic-talk-film` skill, its `talk.js` engine,
`edit.js`, `serve.py`, `build-public.py`, the style and gotchas references, and the ISSTA 2026
example deck, and after verifying the Claude Agent SDK's embedding story against the current
docs.

---

## 1. Decisions already made

| Question | Decision | Why |
|---|---|---|
| Source of truth | A new declarative, **beat-based** talk format that compiles onto the unchanged `talk.js` engine | Hand-written imperative scripts cannot be round-tripped by an editor. Beats as units make insert, delete, reorder, and re-time safe, and remove the whole class of time-shifting gotchas. |
| Who authors motion | **Claude writes motion as code inside beats; humans do quick edits** (text, move, resize, images, notes, beat operations, timing nudges) | Keynote-style effect panels exist because Keynote's author is a human with a mouse. Here the author of motion is Claude, which already does this well. Keeps v1 small enough to ship. |
| Animation power | **No loss by construction.** Every beat's motion is JavaScript against the engine. Components and structured builds are conveniences on top, never a cage. | 95 percent of the ISSTA deck is `T.in`/`T.out`/`T.anim`/counters; the remaining 5 percent (custom tweens, helpers, generated DOM) is what gives decks character and must stay possible. |
| Shell | **Native SwiftUI/AppKit Mac app** with a WKWebView canvas; Windows as a later thin host over the same portable core | Native Mac experience is the priority. The format, compiler, engine, and Claude bridge are TypeScript and portable, so Windows is a shell, not a rewrite. |
| Claude | **Embedded chat pane** driven by the Claude Agent SDK in a Node sidecar, with app-specific tools so Claude can see the canvas | Watching the film get built in real time is the point. The file remains the only channel for content; the app adds eyes (frame rendering) and a faster check loop than headless Chrome. |
| Paper materials | A talk is **attached to a paper**: `.tex` sources or PDF, replication package, figures, data | Passed to Claude as additional directories; shown in a Materials sidebar; never copied. |

Non-goals for v1: authoring complex motion with the mouse, collaboration, cloud sync, an
in-app API billing model, Windows shell.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Mac app (Swift, SwiftUI + AppKit)                                       │
│  windows · menus · file dialogs · Keychain · presenter display           │
│  ┌──────────┐ ┌────────────────────────┐ ┌───────────┐ ┌──────────────┐  │
│  │Navigator │ │ Canvas (WKWebView)     │ │ Inspector │ │ Claude pane  │  │
│  │ beats,   │ │ the real film page +   │ │ position  │ │ chat, tool   │  │
│  │ chapters,│ │ injected canvas.js     │ │ text      │ │ rows, perms, │  │
│  │ thumbs   │ │ (select/drag/text)     │ │ beat      │ │ materials    │  │
│  └──────────┘ └────────────────────────┘ └───────────┘ └──────────────┘  │
│        ▲ JSON-RPC over stdio (NDJSON)              ▲ WKScriptMessage      │
└────────┼───────────────────────────────────────────┼─────────────────────┘
         ▼                                           │
┌──────────────────────────────────────────────┐     │
│  Sidecar (Node, bundled)                     │     │
│  @sage/core: schema · layout · compile ·     │     │
│    validate · source-edit · thumbnails       │     │
│  Agent SDK bridge: query() stream, hooks,    │◄────┘ (frame requests
│    permissions, sessions, in-process tools   │        served by Swift)
│  File watcher                                │
└──────────────────────────────────────────────┘
         ▼ reads/writes
┌──────────────────────────────────────────────┐
│  talk/ folder (the document)                 │
│  talk.json · scenes/*.html · beats/*.js ·    │
│  lib/*.js · theme.css · assets/ · build/     │
└──────────────────────────────────────────────┘
```

**Core in TypeScript, shells native.** Everything that understands the format lives in
`@sage/core` and runs in Node (sidecar and a `talkc` CLI) and partly in the browser
(layout runtime). Swift owns only what must be native. This is what makes Windows a shell
later and lets the skill and CI use the exact same compiler as the app.

**The canvas is the engine.** The editor never re-implements rendering. The WKWebView loads
the compiled film, `render(t)` is deterministic, and the editing overlay is a script injected
into that page. Thumbnails, scrubbing, Claude's frame requests, and presenting all go through
the same `render(t)`.

**Autosave, always.** Every human edit is written to disk immediately through core's
source-edit functions (atomic write). Undo/redo re-applies inverse edits. There is no "unsaved"
state, so Claude's writes and the human's writes never conflict on content; the app reloads
whenever the folder changes. Git in the paper repo remains the history.

---

## 3. The talk format (`sage-talk/1`)

A talk is a folder. Files are plain, diff-friendly, and written by Claude as readily as by the
app.

```
talk/
  talk.json          spine: metadata, chapters, beats (ids, labels, notes, hold), materials
  scenes/<ch>.html   one scene fragment per chapter; objects are elements with ids
  beats/<ch>.js      motion: Talk.beat('<ch>.<beat>', (B) => { ... }) registrations
  lib/*.js           per-talk helpers (device, stations, charts) written against B
  theme.css          per-talk CSS on top of talk.css
  assets/            fonts, logos, faces, screenshots, QR codes
  build/index.html   compiled film (generated; what you present and screenshot)
  build/public/      published single-file version (generated)
  .sage/             app state: Claude session id, thumbnail cache, window layout
```

### 3.1 `talk.json`

```json
{
  "format": "sage-talk/1",
  "title": "How far are we? Automated repair of Android UI bugs",
  "venue": "ISSTA 2026 · Madrid",
  "stage": { "width": 1920, "height": 1080 },
  "theme": "theme.css",
  "lib": ["lib/device.js", "lib/stations.js"],
  "materials": {
    "paper": "../paper",
    "pdf": "../paper/main.pdf",
    "package": "../replication"
  },
  "defaults": { "holdPad": 1.0 },
  "chapters": [
    {
      "id": "title", "label": "Title", "scene": "scenes/title.html",
      "beats": [
        { "id": "title", "label": "Title",
          "notes": "Thank you. I am Kevin Moran from UCF. Joint work with ...",
          "hold": 5.0 }
      ]
    },
    {
      "id": "c2", "label": "Inside the phone", "scene": "scenes/c2.html",
      "beats": [
        { "id": "exploded", "label": "Exploded view", "notes": "..." },
        { "id": "layout",   "label": "Layout",        "notes": "..." }
      ]
    },
    { "id": "omt", "label": "One more thing", "dark": true, "private": true, "scene": "scenes/omt.html", "beats": [] },
    { "id": "backup", "label": "Backup", "backup": true, "private": true, "scene": "scenes/backup.html", "beats": [] }
  ],
  "public": { "scene": "scenes/end.html", "beats": [ { "id": "end", "label": "Paper" } ] }
}
```

- **Boundary rule (normative).** Beat k+1 starts at hold k and owns the interval
  [hold k, hold k+1). Motion registered exactly at hold k is beat k+1's t = 0.
- `hold` is the hold time relative to the beat start. Explicit holds are the norm: Phase 0
  found that none of 13 real holds sit at a fixed pad after the motion. If `hold` is absent
  (a new beat), it is seeded as last motion end plus `holdPad` and written back explicitly the
  first time the beat is timed in the app.
- A hold before the beat's own motion ends is a **warning** (real decks do this on purpose).
  The **error** is the actual ghost: an entrance in the next beat that starts before its hold
  and ends after it, or a `data-a` element visible at a hold that no beat has brought in.
- Chapter markers, duration, dark windows, backup numbering, and the public/private split are
  all derived. Nothing in the format holds an absolute time. The first chapter marker is at 0;
  every other marker is at its first beat's start plus 0.1 s.
- Each chapter's motion lives in `beats/<chapter>.js` by convention (`"motion"` overrides it).
- Duration is the last hold plus `defaults.tail` (default 1.0 s); the public section has its
  own `tail`.
- A chapter's `scene` is optional: a chapter may reuse DOM that lives in another chapter's
  scene file (the ISSTA backups live inside the dark passage's scene).
- `dark` may be set per beat to override its chapter (a light backup inside a dark section).
  A beat is dark over (start, hold], so the hold frame belongs to the beat that ends on it.
- The public section has the shape `{id, label, tail, scene, motion, beats}`. Its motion file is
  loaded only in the public build; notes are stripped there.
- **Scenes are emitted verbatim.** The compiler never re-indents or reformats scene HTML:
  `white-space: pre` code panes made re-indenting cost up to 9,671 px in the port.
- Known divergence from the hand-written ISSTA deck: two chapter markers land 0.5 s earlier
  under the start + 0.1 rule. It is visible only in the scrub bar between holds, never at a
  hold, and is accepted rather than adding a per-chapter offset field.
- Text edits made in the app are written into the scene source. Where an override layer is
  still needed (generated DOM), it is keyed by element id, never by DOM path.
- `private` and `backup` replace today's `<!-- private:start -->` markers.

### 3.2 Scenes

A scene file contains one or more whole `<div class="scene">` elements, exactly as today, with two conventions
the compiler checks: every object the inspector should edit has an `id`, and positioned
objects carry `style="position:absolute;left:…;top:…"` (width/height optional). Anything
else is free HTML. Shared layers that persist across chapters (the device rig, `#black`) are
declared in `talk.json` under `"layers"` and live in `scenes/layers.html`.

### 3.3 Beats and motion

```js
// beats/c2.js
Talk.beat('c2.exploded', (B) => {
  B.out('#c1-h, #c1-s', 0, { dur: 0.5, stagger: 0.03 });
  B.in('#c2-eye', 0.4, { dur: 0.8, y: 14 });
  B.in('#c2-h', 0.6);
  B.anim('.rig', 0.8, 1.2, [{ transform: 'translate(1180px,120px) scale(1.15)' }], { ease: 'inOut' });
  B.lib.explode(B, 1.6);           // helper from lib/device.js
});
Talk.beat('c2.layout', (B) => {
  B.lib.layer(B, 'wire', 0.2);
});
```

`B` has the full `Talk` authoring API (`in`, `out`, `anim`, `show`, `hide`, `words`, `count`,
`type`, `draw`, `tween`, `els`) with **times relative to the beat start**, plus `B.at`
(absolute start, for the rare helper that needs it), `B.lib`, and `B.set(sel, t, {text, class,
style})` for the text-swap and class-toggle tweens that today are hand-written. Every call
records its end time, which is how hold seeding and the ghost check work.

`B.set` semantics: one step track per element and key (text, class, or one style property);
a step applies from its time inclusive; the value before the first step is the one captured at
registration; seeking backwards is exact. Motion that spans beats (a visibility window, a
glitch that runs past a hold) is a pair of steps in the beats where it opens and closes, with
the initial state in markup. `B.at` and `B.T` (the raw engine) remain as escape hatches and the
validator reports their use.

**Registration order is semantic.** The first animation registered on an element property
fills backwards, so it decides what shows before it starts. Beats register in talk order, and
moving a beat re-runs the validator's first-owner check. `Talk.lib` helpers load before beats
and may generate DOM; `Talk.ready` hooks run after layout.

Classic scripts with a registry, no ES modules and no bundler, because headless Chrome and
`file://` must keep working.

### 3.4 Structured builds (optional layer)

For objects the human adds on the canvas, a beat may also carry declarative steps in
`talk.json`:

```json
{ "id": "layout", "label": "Layout", "notes": "...",
  "builds": [ { "sel": "#c2-note", "effect": "in", "t": 0.3, "dur": 0.8, "y": 14 } ] }
```

These compile to the same `B.*` calls and run after the beat's JS. Keeps "I added a caption,
fade it in" out of Claude's lap. Not required for anything else.

### 3.5 Components

`lib/` helpers are functions `(B, ...args)`. The skill's starter library ports the ISSTA
helpers: `device` (rig, screen, press, release, menu, browser), `codepane` (tline, grow,
flash), `stations`, `dots`, `bars`, `heatmap`, `term`. Components have no special status in
the format; they are the convention Claude follows and the inspector recognises by
`data-component` for parameter editing in a later phase.

### 3.6 Layout algorithm (shared by compiler, canvas, and Claude tools)

1. Walk chapters in order; for each beat, run its motion function once against the real `T`
   with times offset by the beat start, recording `lastEnd`; `hold = beat.hold ?? lastEnd +
   holdPad`; `start_next = start + hold`. (Single pass: Phase 0 showed a separate recorder
   pass is unnecessary and would run helper side effects twice.)
2. Chapter `at = 0` for the first chapter, `firstBeat.start + 0.1` otherwise. Computed times
   snap to 6 decimals only when within 1e-9 of that value.
3. `duration = lastBeat.start + lastBeat.hold + 1.0`; public duration computed on the filtered
   set.
4. Emit `cp(start + hold, label, notes, backup)` and run each motion function against the real
   `T` with the beat's offset.

The runtime does this at page load from `talk.json` plus the registered beats, so
`build/index.html` is static and `render(t)` stays deterministic.

---

## 4. Compiler and tooling (`@sage/core`, `talkc`)

- `talkc build <talk>` writes `build/index.html` (layers then scenes, theme and spine inlined,
  each lib and beat file as its own script with a `sourceURL` and a syntax check) and copies
  the engine and `assets/` into `build/` so relative font and image paths resolve.
- `talkc validate <talk> [--public] [--render]`: unique ids, referenced selectors exist in the right scene, `data-a`
  on everything a beat brings in, explicit holds not before motion end, notes present (warn),
  dark chapters have a `#black` fade, private/public markers consistent, assets exist.
  `--render` (off by default, needs Chromium) adds the browser checks: `ghost-visible`, a
  `data-a` element visible at a hold that no motion call has touched before it.
- `talkc layout <talk>` prints the hold list (replaces `cplist.sh`).
- `talkc shoot <talk|film.html> [--holds] [--around S] [--times a,b] [--beats ch.beat,...]
  [--no-backups] [--out dir]` renders PNGs with headless Chromium (replaces `shoot.sh`; every
  hold when nothing is selected; default output `build/shots/`, named and with a manifest
  like `tests/golden`). The renderer is its own package, `@sage/render` (one long-lived
  browser, one page per film, `T.seek(t)` per frame, byte-identical to a fresh `?t=` load),
  which is also behind the app's `talk_frame` tool and exports, because WebKit's
  `takeSnapshot` flattens 3D transforms (Phase 0). `@sage/core` imports it lazily, only for
  `shoot` and `validate --render`.
- `talkc publish <talk> [slug] [--out dir]` writes the self-contained public file,
  `build/public/<slug>.html` (replaces `build-public.py`; TypeScript because the machine's
  Python is 3.6). The cut comes from the spine: `private` chapters out with their scenes and
  motion, the `public` block in, notes and `materials` stripped, and lib files whose
  `Talk.lib` helpers only private beats use left out (the recorder notes who reads which
  helper). It warns when a private label or a note appears in a file that ships.
- `talkc import-legacy <index.html>` is **not** planned. The ISSTA deck is ported by hand once
  (Section 9); any future legacy deck can be presented from the app's read-only mode.
- Source editing API (used by the app): `setText(scene, id, html)`, `setStyle(scene, id,
  {left, top, width, height, fontSize})`, `setAttr`, `insertBeat`, `moveBeat`, `deleteBeat`,
  `duplicateBeat`, `setHold`, `setNotes`, `stretchBeat(factor)`. All operate on source text
  with a position-aware HTML parser so Claude's formatting survives.

---

## 5. The Mac app

SwiftUI app lifecycle with AppKit where SwiftUI falls short (split views, toolbar details,
the presenter `NSWindow`, text fields on the canvas). Targets the current macOS and one back.
Document-based: a talk folder is the document (`NSDocument` subclass over a package-like
folder, or a plain folder opened via `NSOpenPanel`; decide in Phase 2 after a spike).

### 5.1 Layout

Keynote's arrangement: navigator left, canvas center, inspector right, Claude pane as a
fourth column or a right-hand tab beside the inspector (user-resizable, collapsible). Bottom:
a timeline strip for the current beat (motion extents as bars, the hold marker draggable) and
the transport (play to hold, previous, next, time).

### 5.2 Navigator

One thumbnail per beat, grouped by chapter with collapsible headers, dark chapters tinted,
backups in a separate section. Drag to reorder within and across chapters. Context menu:
duplicate, delete, insert empty beat, move to backups, mark private. Thumbnails are
`T.seek(hold)` plus `takeSnapshot` on a hidden WKWebView (about 55 ms each; 3D is flattened,
which is acceptable at thumbnail size; offscreen views need occlusion detection disabled), cached in `.sage/thumbs` by a hash of
the inputs that affect that beat.

### 5.3 Canvas

The compiled film in a WKWebView, fit to the pane, with `canvas.js` injected. There is no edit
mode (Keynote-style): whenever the film is paused the canvas is directly editable; while it
plays the overlay steps aside and comes back, at the new time, when playback stops:

- Click to select the topmost object with an id at the point (hit test honours opacity, so
  invisible-at-this-time objects are skipped unless the Layers popover selects them).
- Drag to move, handles to resize, Option-drag to duplicate, arrow keys to nudge (Shift for
  10 px). Positions snap to a 10 px grid and to other objects' edges and centres, with Keynote
  style guides. Writes `left/top/width/height` through core, debounced.
- Click selected text (or double-click, or just type) to edit it in place (`contenteditable`);
  Escape or Enter commits and leaves the text, a click elsewhere commits the
  innerHTML (inline tags preserved, block children refused). A floating format bar (B/I/U
  and colour inline on a selected range, else setStyle on the element; size, alignment, font)
  sits over the selected text object.
- Images: drop a file to replace `src`, or drop onto empty stage to insert a new positioned
  `<img>` into the current chapter's scene with a build-in step.
- Insert menu for human-added objects: text box (eyebrow, headline, sub, caption styles),
  image, code pane, chip, panel, stat number. Each is a snippet from the style vocabulary
  with an id and an optional structured build.
- Scrubbing the timeline strip calls `render(t)`; selection stays.

### 5.4 Inspector

Tabs: **Object** (id, position, size, font size, colour token, text, image source, visible-from
beat), **Beat** (label, notes with word count, hold mode auto/explicit, hold padding, stretch
factor for the motion, backup/private flags, a read-only code view of the beat's motion with a
"Send to Claude" button that drops a prefilled prompt into the chat), **Chapter** (label,
dark, scene file, z-order of layers), **Talk** (title, venue, materials, theme).

### 5.5 Presenting

Present mode opens the film fullscreen on the chosen display and the presenter view
(notes, next label, clock, current frame) on the other. Both are WKWebViews in the same
process; the app relays play/seek state between them (about 10 ms in Phase 0). BroadcastChannel
also works between WKWebViews, but the relay keeps presenter state in the app. Keys are the engine's keys. A Rehearse mode plays
through with the clock running.

### 5.6 Export

- Publish: `talkc publish`, then optional "copy to site" actions that write into the personal
  and lab site repos at the paths in `publishing.md` and open the commit in a sheet for review.
  Pushing stays a manual step in v1.
- PDF of holds and PNG per hold (from the canvas snapshots).
- Video of a play-through (frame capture at 60 fps via `render(t)` stepping, encoded with
  AVFoundation). Phase 5, nice to have.

### 5.7 Native touches

Menu bar with the full command set and shortcuts, Touch Bar not needed, Quick Look-style
space bar preview in the navigator, dark mode following the system, recent talks, Open in
Terminal / Open in Finder, Services-free. Window state and pane sizes persist per talk.

---

## 6. Claude pane

### 6.1 Runtime

A Node sidecar bundled in the app (`Contents/Resources/sidecar`, Node runtime vendored or
Node single-executable application), started per open talk, speaking NDJSON JSON-RPC over
stdio to Swift. It hosts `@sage/core` services and the Agent SDK bridge.

Verified in the docs and confirmed by the Phase 0 spike (SDK 0.3.316, `claude-opus-5-5`):

- The TypeScript SDK bundles the Claude Code binary as a platform optional dependency; the app
  can also point at an installed `claude` via `pathToClaudeCodeExecutable`.
- The sidecar passes `settingSources: []`. Allow rules in settings files bypass `canUseTool`
  (the SDK warns `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`), and the default sources also start
  Kevin's personal MCP servers inside the sidecar. Consequence: user skills do not load, so
  the app always loads its bundled copy of the skill as a local plugin. `strictMcpConfig`
  should keep claude.ai connectors out (to verify in Phase 4).
- `cwd` is the talk folder; `additionalDirectories` carries the paper and package folders.
- `includePartialMessages` streams text and tool-input deltas for the chat UI.
- `canUseTool` plus `allowedTools` drive a native approval sheet; reads inside the talk and
  materials need no prompt; writes inside the talk folder are pre-approved; anything else asks.
- `PostToolUse` hooks report file edits (`Write`, `Edit`, and Bash, since Bash can write too).
  The SDK's `FileChanged` hook only covers registered watch paths, so the sidecar's own folder
  watcher is the source of truth for reloads, including edits from a terminal session.
- `resume`/`forkSession` keep one conversation per talk, stored in `.sage/session.json`. The SDK
  files transcripts under a path derived from `cwd`, so a moved talk is detected and offered a
  fork of its old session.
- App tools are marked always-loaded; by default they are deferred behind tool search, which
  cost an extra turn in Phase 0.
- Cost: a trivial turn is about 0.15 USD on Opus 5.5. The footer shows session cost, an effort
  control is exposed, and `maxBudgetUsd` caps each request (it is checked between turns, so a
  run can overshoot by one turn).
- In-process tools via `createSdkMcpServer` with no extra process.

### 6.2 Tools the app gives Claude

| Tool | What it returns |
|---|---|
| `talk_state` | Current beat, time, selection, open inspector tab, display size |
| `talk_layout` | The hold list with computed times and validator diagnostics |
| `talk_goto` | Moves the canvas to a beat or time (the user watches) |
| `talk_frame` | Renders a frame at a beat or time (and optionally 0.5 s before and after) with the sidecar's headless Chromium, moves the visible canvas to the same time so the user sees it, and returns image paths. Chromium rather than `takeSnapshot` because the latter flattens 3D. |
| `talk_materials` | The attached paper, PDF, package paths and a short inventory |
| `talk_insert_beat`, `talk_set_notes` | Structured edits through core, so the spine stays valid |

Content edits still go through Claude's ordinary Read/Edit/Write on the talk files. The tools
are eyes and navigation, not a second editing path.

### 6.3 Chat UI

Streamed assistant text as Markdown; tool calls as compact rows (Read `scenes/c2.html`,
Edit `beats/c2.js`, Frame at beat 14) that expand on click; permission requests as an inline
card with Allow / Allow for this talk / Deny; cost and context size in the footer; attachment
of files from the Materials sidebar by drag; a prompt bar with slash-free quick actions
(Storyboard from paper, Build chapter, Re-time this beat, Rewrite notes in my voice). The
navigator highlights the beat Claude last changed, and the canvas follows it unless the user
has pinned their own position.

### 6.4 Auth, terms, naming

The sidecar inherits the user's environment and the user's existing Claude Code login, with
an API key in the Keychain as the documented alternative. **Risk to resolve in Phase 0:** the
Agent SDK overview states that third-party developers may not offer claude.ai login or
subscription limits in their products without approval, and the docs do not explicitly state
that a stored login is reused by SDK sessions. For a personal tool on Kevin's own machine this
is probably fine, but before distributing the app to anyone else, ask Anthropic. The product
must not use "Claude Code" in its name; the pane is labelled "Claude" or "Assistant (powered
by Claude)".

---

## 7. Materials

A talk declares `materials` once. The Materials sidebar (a tab of the navigator) lists the
paper folder, PDF, package, and figures with Quick Look previews, and shows which the skill's
storyboard cited. Drag a file into the chat to attach it to a message. Paths are relative to
the talk so the paper repo can move with it. When Claude cites a number, the skill's
convention of leaving the source path in a comment next to the data is kept; a later phase can
surface those comments in the inspector as "Source".

---

## 8. Skill update (`academic-talk-film` v2)

- Write the beat-based format instead of a monolithic `index.html`; keep the storyboard step
  and the voice rules unchanged.
- Replace `new-talk.sh`, `cplist.sh`, `shoot.sh`, `shift-times.py`, `serve.py`,
  `build-public.py` with `talkc` commands.
- Inside the app, prefer `talk_frame`, `talk_goto`, and `talk_layout` over headless Chrome;
  fall back to `talkc shoot` in a terminal.
- Starter library in `lib/` ported from the ISSTA helpers; `references/example-*` point to the
  ported deck.
- Gotchas list pruned of everything the compiler now prevents.
- Evals updated: "insert a hold in an existing deck" becomes a beat insertion and must leave
  every other beat's frames unchanged.

The skill lives in this repo under `skill/` and is synced to `~/.claude/skills` the same way
the current one is.

---

## 9. Porting the ISSTA 2026 deck

The deck is the fixture for everything: it exercises every primitive, 28 helpers, generated
DOM, a dark passage, backups, private regions, and a public end card.

1. Split scenes into `scenes/*.html`; move per-talk CSS into `theme.css`.
2. Convert each `cp(...)` into a beat; move the motion between consecutive holds into that
   beat's function with times rebased to the previous hold.
3. Port helpers to take `B`; station and tool loops become one beat per iteration calling a
   helper.
4. Compile, shoot every hold with both the original and the port, and diff the PNGs. The
   acceptance bar is pixel-identical frames at every hold (timing inside a beat may differ by
   less than 50 ms).

**Done 2026-11-01.** All 61 holds ported. The hold list is identical, and 207 frames (every hold,
hold ± 0.5 s, and mid-motion samples) plus 9 independently chosen times are byte-identical to
the original. Helpers live in `fixtures/issta26/lib/` as the starter library for skill v2.

---

## 10. Repository layout

```
sage-slide-editor/
  PLAN.md
  package.json                 pnpm workspace (Node 24 is installed; no Rust needed)
  packages/core/               @sage/core: schema (zod), layout, compile, validate, source-edit, publish, cli (talkc)
  packages/render/             @sage/render: headless Chromium frames (talkc shoot, validate --render, talk_frame, exports)
  packages/engine/             talk.js, talk.css, talk-layout.js, canvas.js, presenter.js, manrope font
  packages/sidecar/            JSON-RPC server, Agent SDK bridge, tools, hooks, watcher, thumbnails
  apps/mac/                    Xcode project: SwiftUI app, WKWebView canvas host, presenter window, sidecar supervisor
  apps/windows/                later
  skill/academic-talk-film/    v2 of the skill
  fixtures/issta26/            the ported deck and golden frames
  fixtures/minimal/, fixtures/edge/   small talks for engine and editor tests
  tests/                       golden frames, recorded agent sessions, RPC message fixtures
  docs/                        format spec, RPC protocol, tool schemas
```

---

## 11. Phases and acceptance criteria

### Phase 0 — Spikes (done 2026-11-01, see docs/phase0-memo.md)

- **SDK spike.** A Node script runs `query()` with the talk folder as cwd and the paper as an
  additional directory, confirms the skill is listed in the init message, streams partial
  text, fires a `PostToolUse` hook on an Edit, serves one in-process tool, and reports
  `apiKeySource` with no API key set. Outcome decides the auth plan.
- **WKWebView spike.** The ISSTA deck renders at 1920×1080 in a WKWebView with WAAPI, `color-mix`,
  blur filters, and the bundled font; `takeSnapshot` at `?t=` matches headless Chrome frames;
  scrubbing at 60 fps is smooth on this Mac. Also test two web views relaying state for the
  presenter.
- **Format spike.** Hand-port the title and "Inside the phone" chapters to beats, compile with a
  first-cut layout runtime, and match frames.

Exit: a one-page memo with the three outcomes and any plan changes. The WebKit spike also
produces the first golden-frame harness, since it has to compare frames anyway.

### Phase 1 — Core and format (done 2026-11-02, except CI)

Status: `@sage/core` (schema, loader, recorder, layout, validator, compiler, source-edit API,
`talkc build|validate|layout|shoot|publish`) with 138 tests; `@sage/render` (headless
Chromium frames, 6 tests, byte-identical to `tests/golden/shoot.mjs`); ISSTA fully ported and
pixel-identical; sidecar running on the real core (67 tests) with the Swift client (27 tests);
engine font and dash fixes applied (Chrome output unchanged, WebKit vs Chromium median 0.99 %
to 0.15 %, only the five 3D exploded-view holds above 1 %). `talkc publish` of the ISSTA port
matches the original's published file at all 49 holds (byte-identical frames, same hold list),
loads alone from `file://` with no network, and carries no private text; the agent charts
moved from `lib/dots.js` and `lib/bars.js` to `lib/agents.js` so the cut can drop them. The
second ghost clause is `talkc validate --render` (`ghost-visible`); the ISSTA port is clean,
presented and public. Remaining: CI wiring of the golden suite; retiring the skill's scripts
waits for skill v2 (SKILL.md now names the `talkc` equivalents next to them).

Schema, layout runtime, compiler, validator, source-edit API, `talkc`, and the full ISSTA port
passing the frame diff. The skill's scripts replaced by `talkc`.

Exit: `talkc build fixtures/issta26 && talkc shoot` reproduces the golden frames; the deck
presents in Chrome from `build/index.html` exactly as before. Core unit, property, and
source-edit round-trip suites (Section 12.2) are green in CI.

### Phase 2 — Mac app, read-only (done 2026-11-02, except real-display checks)

Status: the app supervises the sidecar (restart once on crash; the sidecar exits when the app
dies), opens sage-talk/1 folders through it and legacy decks directly, reloads the canvas at
the same time after external edits, and shows a chapter-grouped navigator with thumbnails
(about 3 s for 61 holds, no private API; after a rebuild only holds whose frame changed are
re-rendered). Transport bar, Present and Rehearse with a presenter window relayed by the app.
Legacy decks are never written to: their thumbnail cache lives in ~/Library/Caches. 62 Swift
tests and a 19-check self-test. Not yet verified: a real external display, Space/→/Enter
playback while presenting (the self-test runs off screen), Recent talks.

Open a talk folder, navigator with cached thumbnails, canvas with scrub and transport, notes
view, Present mode with presenter display, Rehearse mode, Reveal in Finder, recent talks.
Sidecar supervisor and RPC in place.

Exit: Kevin can give the ISSTA talk from the app with no browser and no `serve.py`.

### Phase 3 — Editing (in progress)

Status (2026-11-02): `talk.edit`/`talk.revert` in the sidecar (every core op plus
`setBeatProps`/`setChapterProps`; atomic staged writes labelled `app`; inverses carry file
digests and a stale one is refused with EditConflict); `canvas.js` (hit test, move, resize,
snapping with guides, nudges, in-place text, keyboard-only) with 15 Playwright WebKit tests;
in the app: modeless canvas editing with a format bar (no ⌘E edit mode since 2026-11-02), Object/Beat/Chapter inspector, navigator beat menu, undo/redo of
the app's own edits, external changes clearing the history and badging beats. The self-test's
edit round trip (move, retype, set hold, undo all three) ends byte-identical. Not yet: image
replace/insert by drop, the Insert menu, drag reorder in the navigator, Option-drag
duplicate, the timeline strip's draggable hold.

Selection, move, resize, snapping, in-place text, image replace and insert, Insert menu,
inspector tabs, beat operations, hold and stretch controls, undo/redo, autosave, external
change reload preserving position and selection.

Exit: the quick-edit set is done without touching code; every edit survives a reload and
appears as a clean diff in git.

### Phase 4 — Claude pane and skill v2

Status (2026-11-02, Claude pane done; skill v2, Materials sidebar and the exit run remain):
the sidecar bridge (`packages/sidecar/src/claude/`) runs one streaming-input `query()` per
talk with the Phase 0 options; a live run confirmed that `strictMcpConfig` plus
`settingSources: []` leaves only the app's `talk` server (no claude.ai connectors), that
`createSdkMcpServer({alwaysLoad: true})` puts the app tools in the first prompt (no
ToolSearch turn), and that the repo's skill loads as `sage-talk:academic-talk-film` from
`packages/sidecar/plugin` (a symlink to `skill/academic-talk-film`; a bundled app must copy it
with symlinks resolved). `maxBudgetUsd` counts spend since its `query()` started and
`total_cost_usd` is the session's running total (it continues after resume), so a process that
spent money is recycled after its request. Claude's writes are labelled `claude` by the watcher
and clear the human's undo stack. The Claude tab streams Markdown, tool rows, inline permission
cards, cost and context, and the canvas follows Claude's edits unless pinned. Tests: protocol
fixtures, policy, sessions and fork, a replayed live recording (`tests/claude/`), Swift chat
model tests, the self-test pane, and an opt-in live smoke (`SAGE_LIVE_CLAUDE=1`).

Update (2026-11-02, Phase 4 gaps closed; only the exit run remains): `talk_insert_beat` and
`talk_set_notes` write through `talk.edit` labelled `claude` (badged, follow the beat); the
effort control (low to max) uses the SDK's `effort` option and switches a live query with
`applyFlagSettings`; the navigator has a Materials tab (Quick Look, drag a file onto the pane
to attach it); inline code no longer turns a whole reply paragraph monospaced. Skill v2
(`skill/academic-talk-film`): talk folders scaffolded from `assets/starter-v2` by
`scripts/new-talk.sh`, the ISSTA helpers as `assets/lib-starter`, the B API, gotchas and
storyboard rewritten, an "Inside the SAGE Talk app" section, v1 kept under `legacy/`, four
evals (checked structurally by `packages/core/test/skill.test.ts`; not run live).

Agent SDK bridge, chat UI, permissions sheet, sessions per talk, app tools including
`talk_frame`, Materials sidebar, live follow of Claude's edits, skill v2 with evals.

Exit: from an empty talk attached to a paper, "storyboard and build chapter 1" produces a
compiled chapter you watch appear beat by beat, and Claude verifies its frames with the app's
tool rather than headless Chrome.

### Phase 5 — Publish and export

Status 2026-11-02: done except video. The sidecar answers `talk.publish`, `talk.export`
(PNGs or a PDF of 1920x1080-point pages via `@sage/render` and pdf-lib, with
`talk.exportProgress`), `site.stage`, `site.commit` and `talk.qr` (docs/rpc.md "Publish and
export"). Staging copies the file into a site repo's `public/talks/` and splice-edits
`talks.yaml` and the paper's `slides` link with the `yaml` Document API's source ranges, so
every other byte stays; generated YAML (the lab site's) is left alone. Nothing is committed
until the user clicks Commit in the sheet, and nothing pushes. The app has File ▸ Publish…,
File ▸ Export ▸ PNGs / PDF with progress, and Settings (⌘,) for the two repo paths (no
default). Tests: fixtures on both sides, sidecar integration on a temp ISSTA copy and temp
site repos, view-model tests, and the self-test (publish, export, stage, commit, sheet PNGs).

`talkc publish` wired to a Publish sheet, site-copy actions, PDF/PNG export, optional video.

Exit: the public ISSTA file produced by the app is byte-equivalent in behaviour to the one
produced by `build-public.py` today (title autoplays, end card, private content absent).

### Phase 6 — Hardening and distribution

Status (2026-11-02, packaging done; Developer ID, notarization, crash reporting and Windows
remain): `apps/mac/scripts/package.sh` builds a self-contained `SAGE Talk.app` (docs/packaging.md):
the release binary, Node 24.22.2 from nodejs.org (pinned SHA-256), the sidecar as two esbuild
ESM files with only the Agent SDK (plus its 296 MB native `claude`) and playwright-core beside
them, the engine, the plugin with the skill copied in, and a `talkc` shim first on Claude's
PATH. 435 MB, of which `claude` is 68 % and Node 27 %. The sidecar finds everything from its
own location (`runtime.ts`); the app runs it through `SidecarConfiguration.bundled`. Chromium
is not bundled: an installed Google Chrome is used, else Playwright's headless shell is
downloaded on first use. Ad-hoc signed with the hardened runtime (Node needs only
`allow-jit`); `scripts/notarize.sh` is written but untested. A first-run sheet checks Node,
the sidecar, the Claude login (the SDK's `accountInfo()`, no message sent) and the browser,
and states the 6.4 login caveat. `scripts/package-smoke.sh` runs a copy of the app away from
the repository with a Finder-like environment: the full self-test in bundled mode, and
`talkc publish` byte-identical to the repository's. Talks are `.talk` document packages
(UTType `io.sagelab.talk`, with `io.sagelab.talktheme` declared for themes): still plain
folders on disk, shown by Finder as one document with its own icon that opens in the app.
New Talk creates `<name>.talk`; plain folders keep opening, and the app offers (never forces)
an in-place rename to `<name>.talk` (docs/packaging.md).

Developer ID signing, notarization, hardened runtime, sidecar bundling, crash reporting,
onboarding (choose auth, pick skill sync), first Windows shell spike (WebView2 host over the
same sidecar).

---

## 12. Testing strategy

The system has one property that makes it unusually testable: `render(t)` is deterministic.
A talk, a time, and a rendering engine fully determine a frame. Most of the plan below turns
that into golden-frame tests, and the rest covers the parts that are not rendering: the
format, the editing operations, the Swift shell, the Claude bridge, and the skill.

### 12.1 Levels and what each one catches

| Level | Scope | Runs | Catches |
|---|---|---|---|
| Unit | `@sage/core` functions, Swift view models, sidecar handlers | every commit, seconds | layout math, schema rules, source-edit range bugs, RPC decoding |
| Property | layout and source-edit invariants over generated talks | every commit | ordering violations, ghost holds, lost formatting |
| Golden frames | compiled fixtures rendered at every hold in WebKit and Chromium | every commit (WebKit), nightly (Chromium) | any visual regression in engine, compiler, theme, or a ported deck |
| Integration | sidecar + core + a real talk folder over RPC; canvas.js inside a real WKWebView | every commit | protocol drift, reload-preserves-position, autosave races |
| UI | XCUITest flows on the Mac app | PRs touching `apps/mac`, nightly | broken menus, panes, drag, presenter window |
| Agent | recorded Agent SDK sessions replayed; one live smoke nightly | every commit (replay), nightly (live) | tool schema drift, hook handling, permission flow, skill triggering |
| Skill evals | the skill's `evals/` run with `skill-creator` | on skill change, weekly | regressions in storyboarding and beat insertion |
| Manual | presenting on two displays, projector, clicker | before each release and before each real talk | what no runner has: hardware |

### 12.2 Core (`@sage/core`)

- **Schema tests** (vitest): valid and invalid `talk.json` documents, one file per rule in the
  validator, each asserting the exact diagnostic code and location. Rules from Section 4 all
  get a positive and a negative case.
- **Layout tests**: hand-computed expectations for small talks (auto hold, explicit hold,
  `holdPad`, chapter marker offset, dark windows, backup numbering, public filtering). The
  ISSTA port's hold list is a golden file and must match the original deck's `cplist` output
  to within 50 ms per hold.
- **Property tests** (fast-check): for random talks of 1 to 60 beats with random motion
  extents, (a) hold times are strictly increasing, (b) no beat's motion starts before the
  previous hold, (c) chapter markers fall 0.1 s after their first hold, (d) inserting a beat
  leaves every other beat's rendered times unchanged relative to its own start, (e) layout is
  idempotent.
- **Source-edit round trips**: for each operation, apply it to fixture HTML with deliberately
  odd formatting (tabs, comments, attributes across lines, nested inline tags) and assert that
  the only bytes that changed are inside the target range. Apply then invert must reproduce
  the original byte for byte. This is the test that protects Claude's formatting from the
  app.
- **Compiler tests**: compile each fixture and check the output against a checked-in
  `build/index.html` (normalised for timestamps). A syntax check of the emitted script
  (`new Function`) runs on every compile, since a parse error renders a blank stage.
- **Coverage**: 90 percent line coverage on core, enforced in CI; the number matters less
  than the rule that every validator diagnostic has a test.

### 12.3 Engine and golden frames

- **Fixtures**: `fixtures/issta26` (the real deck, large), `fixtures/minimal` (one beat per
  primitive: in, out, anim, words, count, type, draw, set, dark passage, backup), and
  `fixtures/edge` (overlapping motion, zero-duration tweens, elements shared across chapters,
  helpers that register deferred motion).
- **Golden frames** (`tests/golden`, built in Phase 0): for every fixture, a PNG at every hold
  plus 0.5 s before and after each hold, rendered by Playwright WebKit and Chromium.
  Thresholds from Phase 0: 0.1 percent of pixels within one engine; 1 percent between
  WKWebView and Playwright WebKit and across engines (after the engine font fix). Frames whose
  hold shows 3D transforms are compared in Chromium only. Never sample exactly on a `B.set`
  step time. A partially ported deck is compared against a truncated control of the original. Golden
  files are regenerated only by an explicit command that also writes a review contact sheet,
  so a change in a golden frame is always a visible decision in a PR.
- **Cross-engine parity**: nightly, the same frames in Chromium, compared with the WebKit
  goldens at a looser threshold. Divergences become either engine fixes or documented
  exceptions, because the public file is viewed in both.
- **Playback is not tested under virtual time** (the gotchas file is right that `rAF` does not
  advance); tests use `?t=` and `render(t)` only. One real-time smoke test plays a 10 s
  fixture in a headed browser nightly and asserts it stops at the hold.
- **Public build**: the published single file is loaded with no network and no other files
  present, and its frames at the first hold and the end card match goldens; private strings
  (venue of unpublished work, recruiting slide text, notes) are asserted absent by grep.

### 12.4 Canvas editor (`canvas.js`)

Playwright WebKit tests against the compiled fixture with `canvas.js` injected: hit testing
picks the expected object at a point and skips invisible ones; drag moves by the expected
delta with snapping on and off; resize handles keep the opposite edge fixed; in-place text
commits inline tags and refuses block children; Escape cancels; every operation emits exactly
the RPC messages the protocol doc specifies (recorded and compared). Keyboard-only
operation (select, nudge, enter text, escape) is part of the suite.

### 12.5 Sidecar and RPC

- **Protocol contract**: the RPC schema is a TypeScript type set from which both the sidecar
  decoder tests and the Swift `Codable` tests are generated; a JSON fixture per message is
  shared by both sides, so a field renamed on one side fails on the other.
- **Integration**: start the sidecar on a temp copy of a fixture; open, edit, reload, watch.
  Tests for the autosave rule (an external write arriving during a debounced edit never loses
  either change; the loser is reported), thumbnail cache invalidation (only the changed beat
  and the beats after a time shift re-render), and crash recovery (kill the sidecar, the app
  restarts it, state is restored).
- **File watcher**: edits via `talkc`, via a direct write, and via the Agent SDK's Edit tool all
  produce the same reload event.

### 12.6 Mac app (Swift)

- **Unit** (XCTest): view models for navigator, inspector, timeline strip, and transport are
  plain Swift with no AppKit dependency and are tested against a fake RPC client. Undo/redo
  stack tests: apply, undo, redo, and interleave with an external change (which clears the
  stack and badges the beat).
- **UI** (XCUITest): open the fixture, navigate by keyboard, drag a beat between chapters,
  move an object with the mouse and read back the inspector value, edit text in place,
  present on a simulated second screen and close with Escape. Accessibility identifiers on
  every control, which also gives VoiceOver labels for free.
- **Snapshot tests** of SwiftUI views in light and dark mode for the non-canvas chrome.
- **Memory and performance**: a test opens the ISSTA deck, scrubs end to end, and asserts
  peak memory under 1 GB and no leaked web views after closing the document; an XCTest
  `measure` block on thumbnail generation for 60 beats.

### 12.7 Claude bridge

- **Replay tests**: Agent SDK sessions are recorded once as NDJSON (init, partial deltas, tool
  use, hook events, permission requests, result) and replayed through the bridge; tests
  assert the chat view model's state after each event and that `PostToolUse` on a talk file
  triggers a reload. No API calls in CI.
- **Tool tests**: each app tool (`talk_state`, `talk_layout`, `talk_goto`, `talk_frame`,
  `talk_materials`, `talk_insert_beat`, `talk_set_notes`) has schema validation tests and
  handler tests against a fixture; `talk_frame` is checked against the golden frame for the
  same time.
- **Permission tests**: a write inside the talk is auto-allowed, a write in the paper folder
  prompts, a write elsewhere is denied by default, and "Allow for this talk" persists in
  `.sage/`.
- **Live smoke** (nightly, with a real login or key on the CI Mac): one short session asks
  Claude to insert a caption on a fixture beat; the test checks the file changed, the layout
  is still valid, and the frame at that hold differs from the golden only inside the caption's
  box. Cost is capped by `maxBudgetUsd`.
- **Skill triggering**: the init message must list `academic-talk-film`; the live smoke
  confirms that "slides for the paper" invokes it.

### 12.8 Skill evals

The skill keeps its `evals/` directory. Two existing evals are updated to the new format and
two are added: "port a hand-written hold into a beat" and "fix a validator diagnostic". Evals
run with the `skill-creator` harness on skill changes and weekly; results are kept in
`skill/evals/results/` so regressions are diffable.

### 12.9 Continuous integration

GitHub Actions on `macos-latest` (Apple silicon). Per PR: lint and typecheck, core unit and
property tests, WebKit golden frames, canvas tests, sidecar integration, Swift unit tests, and
XCUITest when `apps/mac` changed. Nightly: Chromium parity, real-time playback smoke, full
XCUITest, Agent live smoke, performance measures. A PR cannot merge with a changed golden
unless the contact sheet is attached and the change is described.

### 12.10 Manual release checklist

Before a release build, and before each real talk given from the app: present the deck on an
external display and a projector, presenter view on the laptop, clicker and keyboard both
advance, fullscreen enter and exit, display disconnect during a talk, a Claude edit arriving
while presenting is ignored until the presentation ends, and the public file opens from
`file://` in Safari and Chrome with no network.

### 12.11 Test data and privacy

Fixtures are real decks, so they carry real coauthor names and data; the repository is private.
The `fixtures/edge` and `fixtures/minimal` talks use placeholder text and can be shared.
Recorded Agent sessions are scrubbed of absolute home paths before commit.

---

## 13. Risks and open questions

1. **Auth and terms** for the embedded Agent SDK (Section 6.4). Resolve in Phase 0; design auth
   as a swappable layer.
2. **WebKit versus Chromium rendering.** Phase 0 measured a 0.99 percent median difference,
   mostly from the font stack (fixed in the engine by putting `system-ui` first and Menlo for
   mono) plus a WebKit round cap on zero-length dashes (fixed with an `L 2L` dash array).
   Remaining: `takeSnapshot` flattens 3D, so exact frames come from Chromium (Sections 4, 6.2).
3. **App Sandbox.** Spawning Node and reading arbitrary paper folders argue for a non-sandboxed
   Developer ID app in v1. Revisit if Mac App Store distribution ever matters.
4. **Source editing fidelity.** Rewriting attributes and innerHTML in HTML the human did not
   write must not reflow Claude's formatting. Position-aware parsing (parse5 with location
   info) and range replacement, with golden tests, is the mitigation.
5. **Undo across two authors.** Undo applies only to the human's edits; a Claude edit is a new
   baseline. The navigator shows "changed by Claude" badges so this is visible.
6. **Auto-hold on helpers that defer work** (a helper that registers motion inside a tween
   callback) is invisible to the recorder. Convention: helpers register everything up front;
   the validator warns when a beat records no motion.
7. **Scope creep toward Keynote.** The structured builds layer must stay small. Anything that
   needs more than one parameter panel is Claude's job.

---

## 14. Immediate next steps

1. Initialise the pnpm workspace and the Xcode project skeleton in this folder; commit.
2. Run the three Phase 0 spikes in parallel, SDK spike first because its outcome can change
   the Claude pane design.
3. Write `docs/format.md` from Section 3 as the normative spec and start the ISSTA port
   alongside the layout runtime, since the port is the test that proves the format.
