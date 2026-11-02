---
name: academic-talk-film
description: Build a conference or research talk for Kevin Moran as a continuous, animation-first "film with checkpoints" (Apple-keynote motion graphics, one idea per click, real numbers pulled from the paper and its replication package), written as a sage-talk/1 talk folder (talk.json spine, scenes, beat-relative motion) and compiled with talkc or edited in the SAGE Talk app. Use this skill whenever Kevin asks for talk slides, a conference presentation, a keynote, a job-talk deck, a seminar deck, or "slides for the paper", even if he says "slides" or "PowerPoint" rather than "film"; whenever he asks to edit, re-time, restructure, fix, or publish a talk folder (talk.json, scenes/, beats/) or an older single-file deck built with this engine (index.html + talk.js); and when he wants a public web version of a talk put on his website.
---

# Academic talk films

Kevin's talks are not slide decks. Each one is a single 1920×1080 film with checkpoints: Space plays to the next hold, and the audience watches objects arrive, transform, and leave rather than reading bullet points. The look comes from Apple keynote segments and the films on his publications page: one hero object per beat, big display type that arrives word by word, devices drawn as HTML mocks, counters that count, lines that draw. Plain text is the exception, and every number on screen is real and traceable to the paper or its replication package.

A talk is a **sage-talk/1 folder**: `talk.json` (the spine: chapters, beats, holds, notes), `scenes/<chapter>.html`, `beats/<chapter>.js` (motion, at times relative to each beat's start), `lib/*.js` helpers, `theme.css`, `assets/`. `talkc` (the SAGE talk editor's compiler) builds it into `build/index.html`, validates it, lists its holds, photographs frames, and publishes it. The worked example is the ISSTA 2026 deck in the SAGE talk editor repository, `fixtures/issta26/` (61 holds); read its `talk.json` and a chapter's scene and beats file before writing your first chapter.

## What you deliver

A talk folder next to the paper source, named `<venue><yy>.talk` (for example `issta26.talk`). The `.talk` extension makes it a SAGE Talk document package: still an ordinary folder for git, Dropbox, `talkc` and you, but Finder shows it as one document that opens in the SAGE Talk app (Show Package Contents reveals the files). An existing plain folder such as `talk/` keeps working; rename it only if Kevin asks (the app offers to). It contains:

- `talk.json`, `scenes/`, `beats/`, `lib/`, `theme.css`, `assets/` (font, logos, headshots, screenshots, QR codes).
- `PLAN.md`, the storyboard, and `README.md` with the keys, the commands and the hold count.
- `build/` is generated (`talkc build`); `build/public/<slug>.html` when he asks to publish.

## The process

### 1. Gather the material before designing anything

Read the paper in full (the `.tex` sources if present, else the PDF) and inventory the replication package: datasets (CSVs), generated patches, logs, trajectories, prompts, codebooks. Note where every headline number lives, because the deck will cite real values, and when Kevin asks "where did that 67% come from" you need the file. Also collect: venue, date, city, author list and who presents, affiliations and logos, time limit and Q&A, any co-presenter or student to spotlight, and anything that must not be named (an under-review follow-up, for example, is "a follow-up study" or "ongoing work", never the venue).

If the paper or package is missing, ask for it or for a path before storyboarding. The paper is the minimum; the package is what makes the deck feel real (actual bug reports, actual test code, actual patches, actual counts). Record the paths in `talk.json` `"materials"` (relative to the talk).

### 2. Storyboard first, in PLAN.md

Write the storyboard before touching the talk files and get Kevin's go-ahead on it. Structure it as chapters, each a list of holds with an id, the hero object, the words on screen, the motion that gets there, the motion time, and the data source in brackets. Every hold becomes one beat. The template, the mapping from holds to beats, and a worked example are in `references/storyboard.md`. Budget: a 15-minute talk is roughly 6 to 8 minutes of motion across 30 to 55 holds; the rest is Kevin talking on a hold.

The canonical arc for an empirical paper: a historical or motivational line → the gap this work fills → one concrete example walked through on a device → how the benchmark or approach was built (one click per step) → how things were evaluated → results, one chart per click with the big number landing last → implications → summary with a package card and QR tiles → "One more thing" dark chapter if there is follow-up work → thank-you close with contacts → an optional recruiting slide for a student → backup holds.

### 3. Scaffold and build

```
bash <skill>/scripts/new-talk.sh <paper-dir>/issta26.talk "Short title"
```

This copies `assets/starter-v2/`: a minimal working talk (title, one chapter, the dark passage with the close, a backup, a public end card) that already validates and builds. Grow it chapter by chapter: for each chapter add its entry and beats to `talk.json`, its scene, and its `beats/<chapter>.js`. Copy helpers you need from `assets/lib-starter/` (device, code panes, stations, dot grids, bar charts, flow, heat map, terminal replay, slide counter; signatures in its README) into `lib/` and list them in `"lib"`. The format and the `B` API are in `references/engine-api.md`; the visual rules in `references/style.md`. The essentials:

- **Times are relative to the beat.** `Talk.beat('results.rq1', (B) => { B.in('#c6-h1', 0.6, { dur: 1 }); … })`. A beat starts at the previous hold; its `"hold"` in `talk.json` is relative to that start. Inserting, moving or deleting a beat never shifts another beat's numbers.
- **Explicit holds.** Give every beat a `"hold"`: its motion end plus the slack Kevin wants (0.5 to 1.0 s to start). The next beat's motion starts at its own t = 0, which is that hold, so nothing moves before the click. One idea per click: if Kevin would say "and then" during a beat, split it.
- **Leave a pane at t = 0 of the beat that replaces it.** Objects that persist across beats stay put and transform; do not fade a whole scene out just to fade the next in.
- **Everything animated carries `data-a`** (starts invisible) and is brought in with `B.in`, `B.words`, `B.count`, `B.draw`, `B.type`, `B.show` or `B.anim`. Discrete changes (text swaps, class toggles, visibility windows across beats) are `B.set` steps, with the initial state in the markup.
- **Devices are HTML.** A phone mock (`.rig > .device > .screen`) in `scenes/layers.html` with a themed app inside, so you can tap it, scroll it, open a menu, crash it, swap the app. Real screenshots are for one beat of authenticity.
- **Real data only.** Counters count to the paper's numbers; charts are built from the package's CSVs; code panes show the actual test, patch, or trajectory. Keep the source path in a comment next to the data.
- **Backups** are a chapter with `"backup": true, "private": true`; the counter shows "Backup n / m".
- **Dark passages** ("One more thing") are a chapter with `"dark": true, "private": true` whose first beat fades in the `#black` scene; content scenes there carry class `dk`.

### 4. Check every beat before showing him

Validate first, then look. `render(t)` is deterministic, so any instant can be photographed:

```
bash <skill>/scripts/talkc.sh validate issta26.talk --render     # diagnostics with codes, file:line and beat
bash <skill>/scripts/talkc.sh layout issta26.talk                # hold number, time, label
bash <skill>/scripts/talkc.sh shoot issta26.talk --holds --around 0.5   # every hold and 0.5 s either side
bash <skill>/scripts/talkc.sh shoot issta26.talk --beats results.rq1 --times 61.3
```

(`scripts/talkc.sh` runs `talkc` from PATH, `$SAGE_REPO`, or the SAGE talk editor checkout.) Fix every error the validator reports before shooting; warnings are judgement calls (see `references/gotchas.md`). Then look at each PNG of the beats you wrote or changed, and at 0.5 s before and after each changed hold, to catch something moving early or a stale element lingering.

### 5. Iterate the way he gives feedback

Kevin refers to slides by the number in the bottom-right counter and to chapters by name. Map the number to a beat id with `talkc layout` (or `talk_layout`), name the beat in your reply when it is ambiguous (he has typed 26 meaning 36), and after each round:

- re-validate, re-shoot the beats you touched, and look at them,
- rebuild the public version if one exists,
- commit in the paper repo with a short message (use `git commit -F` with a message file; apostrophes break heredocs).

### 6. Publish when asked

`talkc publish issta26.talk <slug>` writes `issta26.talk/build/public/<slug>.html`, one self-contained file: private chapters (follow-up, close, recruiting, backups) and notes are cut by the spine, the `public` block's end card is appended, the title autoplays, assets are inlined. Shoot it with `talkc shoot issta26.talk/build/public/<slug>.html --holds`. Where it goes on his sites, QR codes, and PDF hosting are in `references/publishing.md`.

## Inside the SAGE Talk app

When the working directory is a talk open in the SAGE Talk app (you have the `talk_*` tools), Kevin is watching the canvas while you work: every file you save is rebuilt and reloaded, and the canvas follows the beat you edited.

- **Prefer the app's tools over `talkc` and browsers.** `talk_layout` for the hold list and the validator's diagnostics (instead of `talkc layout`/`validate`), `talk_frame` to look at a beat or time, optionally with `around` (it builds, renders with Chromium including 3D, moves Kevin's canvas there, and returns PNG paths to Read; instead of `talkc shoot`), `talk_goto` to show Kevin a beat, `talk_state` for what he is looking at and has selected, `talk_materials` for the paper and package. Do not start headless Chrome, servers, or `talkc shoot` yourself inside the app.
- **Structural spine edits go through the app:** `talk_insert_beat` adds a beat (with its label, notes and hold) at a position in a chapter, and `talk_set_notes` rewrites a beat's presenter notes. They keep `talk.json` valid and formatted, and the app marks the beats you changed. Then write the beat's motion in `beats/<chapter>.js` with Edit.
- **Never re-indent or reformat scene HTML.** Make exact, minimal Edit replacements; code panes are `white-space: pre`, so whitespace is content.
- **Text the film rewrites at runtime is edited in motion code, not scenes:** the target of `B.count`, `B.type`, a `B.set` text step, or a helper's data array. The scene holds only the value before the first step; the app refuses in-place edits of such text.
- After an edit, check `talk_layout` for new diagnostics, then `talk_frame` the beat you changed (with `around: 0.5` when you moved a hold).

## Legacy single-file decks

Decks written before the beat format are one `index.html` with absolute times, chapter constants and `cp(...)` holds, next to `talk.js`, `edit.js`, `serve.py` and `build-public.py`. For those, keep working the old way: `references/legacy/engine-api-v1.md` (the absolute-time API, editor, public-build markers), `references/legacy/gotchas-v1.md`, the finished ISSTA single-file deck and its plan (`references/legacy/example-index.html`, `example-plan.md`), the v1 engine files in `assets/legacy/`, and `scripts/legacy/` (`new-talk.sh`, `cplist.sh`, `shoot.sh`, `shift-times.py`). Do not convert a legacy deck to a talk folder unless Kevin asks; the ISSTA port in the SAGE repository shows how it is done.

## Voice on screen

Kevin's slides say the fact. Headlines are short claims ("Effectiveness on real bugs", "No tool fixed it", "How far are we?"), eyebrows name the chapter in small caps, subtitles are one or two lines in his paper voice (see the `moran-paper-voice` skill for the register), and numbers are big and alone. No bullet lists, no titles-as-jokes, no "Outline" slide, no slide that is only text. Names of datasets, tools, and co-authors are bold on first appearance. The co-presenter is bold on the title. Anything under review is described without its venue.

## Files in this skill

- `assets/starter-v2/` — the minimal working talk folder `new-talk.sh` copies (includes the Manrope font and `lib/slideno.js`).
- `assets/lib-starter/` — the ISSTA helpers as a starter library, with a README of each helper's signature.
- `assets/legacy/` — the v1 engine, theme, editor, save server, public-build script and single-file starter.
- `scripts/new-talk.sh` (scaffold a talk folder), `scripts/talkc.sh` (run talkc), `scripts/legacy/` (v1 scaffold, cplist, shoot, shift-times).
- `references/engine-api.md` — the talk folder, `talk.json`, `Talk.beat` and every `B` method, `B.set`, the timing rules, the page contract, keys, URL parameters, talkc and its diagnostic codes.
- `references/style.md` — the visual and writing rules with concrete patterns (title build, device beats, station builds, bar charts, counters, summary, close, recruiting slide).
- `references/storyboard.md` — the PLAN.md template, the hold budget, and the mapping from holds to beats.
- `references/gotchas.md` — what the tools cannot catch, and the fixes.
- `references/publishing.md` — public build, site locations, QR codes, PDF hosting.
- `references/legacy/` — the v1 API, gotchas, and the finished single-file ISSTA deck and its plan.
- `evals/` — eval cases for this skill (storyboard and scaffold, split a beat, fix a validator diagnostic, convert a hand-written hold into a beat).
