---
name: academic-talk-film
description: Build a conference or research talk for Kevin Moran as a continuous, animation-first HTML "film with checkpoints" (Apple-keynote motion graphics, one idea per click, real numbers pulled from the paper and its replication package), using the bundled talk.js engine. Use this skill whenever Kevin asks for talk slides, a conference presentation, a keynote, a job-talk deck, a seminar deck, or "slides for the paper", even if he says "slides" or "PowerPoint" rather than "film", and whenever he asks to edit, re-time, restructure, or publish a deck that was built with this engine (index.html + talk.js in a talk/ folder). Also use it when he wants a public web version of a talk put on his website.
---

# Academic talk films

Kevin's talks are not slide decks. Each one is a single 1920×1080 film with checkpoints: every animation is registered at an absolute time on one clock, Space plays to the next hold, and the audience watches objects arrive, transform, and leave rather than reading bullet points. The look comes from Apple keynote segments and the films on his publications page: one hero object per beat, big display type that arrives word by word, devices drawn as HTML mocks, counters that count, lines that draw. Plain text is the exception, and every number on screen is real and traceable to the paper or its replication package.

The engine, theme, editor, save server, and public-build script are bundled in `assets/`. The ISSTA 2026 deck that this skill was distilled from is in `references/example-index.html` and `references/example-plan.md`; read it when you want to see how a chapter, a device mock, a counter grid, or a backup section is actually written.

## What you deliver

A `talk/` folder next to the paper source containing:

- `index.html`, the film: scenes (HTML) at the top, then one script with absolute times and `cp(...)` holds.
- `talk.js`, `talk.css`, `edit.js`, `serve.py`, `Edit talk.command`, `build-public.py` from `assets/` (copied by `scripts/new-talk.sh`).
- `assets/` with the font, logos, headshots, screenshots, QR codes.
- `PLAN.md`, the storyboard, and `README.md` with the keys and the editing workflow.
- `public/<slug>.html`, the self-contained web version, when he asks to publish.

## The process

### 1. Gather the material before designing anything

Read the paper in full (the `.tex` sources if present, else the PDF) and inventory the replication package: datasets (CSVs), generated patches, logs, trajectories, prompts, codebooks. Note where every headline number lives, because the deck will cite real values, and when Kevin asks "where did that 67% come from" you need the file. Also collect: venue, date, city, author list and who presents, affiliations and logos, time limit and Q&A, any co-presenter or student to spotlight, and anything that must not be named (an under-review follow-up, for example, is "a follow-up study" or "ongoing work", never the venue).

If the paper or package is missing, ask for it or for a path before storyboarding. The paper is the minimum; the package is what makes the deck feel real (actual bug reports, actual test code, actual patches, actual counts).

### 2. Storyboard first, in PLAN.md

Write the storyboard before touching HTML and get Kevin's go-ahead on it. Structure it as chapters, each a list of holds with the hero object, the words on screen, the motion that gets there, the motion time, and the data source in brackets. The template and a worked example are in `references/storyboard.md`. Budget: a 15-minute talk is roughly 6 to 8 minutes of motion across 30 to 55 holds; the rest is Kevin talking on a hold.

The canonical arc for an empirical paper: a historical or motivational line → the gap this work fills → one concrete example walked through on a device → how the benchmark or approach was built (one click per step) → how things were evaluated → results, one chart per click with the big number landing last → implications → summary with a package card and QR tiles → "One more thing" dark chapter if there is follow-up work → thank-you close with contacts → an optional recruiting slide for a student → backup holds.

### 3. Scaffold and build

```
bash <skill>/scripts/new-talk.sh <paper-dir>/talk "Short title"
```

Then write `index.html` chapter by chapter. The rules that make the deck feel like Kevin's are in `references/style.md`; the engine's API and the page contract are in `references/engine-api.md`. The essentials:

- **Absolute time with chapter constants.** `const c3 = c2 + 36;` then every time in the chapter is `c3 + 4.2`. Later chapters are offsets of earlier ones, so inserting or removing a beat is a local shift (`scripts/shift-times.py`) rather than a rewrite.
- **A hold is `cp(at, label, notes)`.** Put it after the current beat's motion has finished and before anything of the next beat starts moving. If a tile fades in 0.2 s before the hold, the audience sees a ghost. One idea per click: if Kevin would say "and then" during a segment, split it into two holds.
- **Everything animated carries `data-a`** (starts invisible) and is brought in with `T.in`, `T.words`, `T.count`, `T.draw`, `T.type`, or `T.anim`. Objects that persist across beats stay put and transform; do not fade a whole scene out just to fade the next in.
- **Devices are HTML.** A phone mock (`.rig > .device > .screen`) with a themed app inside, so you can tap it, scroll it, open a menu, crash it, swap the app. Real screenshots are for one beat of authenticity, not for every slide.
- **Real data only.** Counters count to the paper's numbers; charts are built from the package's CSVs; code panes show the actual test, patch, or trajectory. Keep the source path in a comment next to the data.
- **Backups** go after the close, registered with `cp(at, label, notes, true)`; the counter shows them as "Backup n / m".
- **Dark passages** (the "One more thing" chapter) flip the theme via a black scene and `.dk`; the chapter entry carries `dark: true` so the slide counter follows.

### 4. Check every frame before showing him

`render(t)` is deterministic, so headless Chrome can photograph any instant:

```
bash <skill>/scripts/cplist.sh talk/            # hold number, time, label
bash <skill>/scripts/shoot.sh talk/ 27.5 61.3   # PNGs at those times
```

Shoot every hold and look at each PNG with the Read tool. Also shoot a frame 0.5 s before and after any hold you changed, to catch something moving early or a stale element lingering. Syntax-check the script with `node -e` before shooting; a parse error renders a blank stage. Common failure modes and their fixes are in `references/gotchas.md`; read it the first time something looks wrong, because most of them (backward-filling animations, invisible panes swallowing clicks, descenders clipped by blur) are not obvious from the frame.

### 5. Iterate the way he gives feedback

Kevin refers to slides by the number in the bottom-right counter and to chapters by name. Map the number with `cplist.sh` before editing, confirm the mapping in your reply when it is ambiguous (he has typed 26 meaning 36), and after each round:

- re-shoot the holds you touched and look at them,
- shift chapter markers, the duration, and dark windows if timings moved,
- rebuild the public version if one exists,
- commit in the paper repo with a short message (use `git commit -F` with a message file; apostrophes break heredocs).

Text-only edits can also be made by him in the page: `E` enters edit mode, ⌘S saves into `index.html` when the deck is served by `serve.py`. Read the `text-overrides` JSON block at the bottom of `index.html` before changing slide text, because an override there masks the markup.

### 6. Publish when asked

`python3 build-public.py` writes a single self-contained file: private regions (follow-up chapter, backups, recruiting slide, notes, editor) are stripped and an end card with links is appended. Where it goes on his sites, how QR codes are generated, and how the paper PDF is hosted are in `references/publishing.md`.

## Voice on screen

Kevin's slides say the fact. Headlines are short claims ("Effectiveness on real bugs", "No tool fixed it", "How far are we?"), eyebrows name the chapter in small caps, subtitles are one or two lines in his paper voice (see the `moran-paper-voice` skill for the register), and numbers are big and alone. No bullet lists, no titles-as-jokes, no "Outline" slide, no slide that is only text. Names of datasets, tools, and co-authors are bold on first appearance. The co-presenter is bold on the title. Anything under review is described without its venue.

## Files in this skill

- `assets/` — `talk.js` (engine), `talk.css` (light theme + dark passage + component vocabulary), `edit.js` (in-page text editor), `serve.py` and `Edit talk.command` (local server that saves edits), `build-public.py` (public build), `starter/index.html` (a minimal working film to grow), `manrope-latin.woff2`.
- `scripts/new-talk.sh` (scaffold), `shoot.sh` (frames at times), `cplist.sh` (hold list), `shift-times.py` (move a block of times).
- `references/engine-api.md` — every `Talk` method, keys, URL parameters, the editor, the public build markers.
- `references/style.md` — the visual and writing rules with concrete patterns (title build, device beats, station builds, bar charts, counters, summary, close, recruiting slide).
- `references/storyboard.md` — PLAN.md template and the hold budget.
- `references/gotchas.md` — the failure modes met while building the ISSTA deck and the fixes.
- `references/publishing.md` — public build, site locations, QR codes, PDF hosting.
- `references/example-index.html`, `references/example-plan.md` — the finished ISSTA 2026 deck and its storyboard, for lifting patterns.
