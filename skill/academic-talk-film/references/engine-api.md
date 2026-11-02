# The sage-talk/1 format and the beat API (`B`)

The film engine (`talk.js`) is unchanged from v1: one clock, deterministic `render(t)`, holds.
What changed is how a talk is written. Nothing in the source holds an absolute time: each beat
registers its motion **relative to its own start**, and the layout runtime (`talk-layout.js`)
places the beats on the clock at page load from the spine. `talkc build` compiles the folder
into `build/index.html`; never edit `build/`. The hand-written single-file API (`T.in(sel, c3 + 4.2)`,
`cp(...)`, chapter constants) is in `legacy/` for old decks only.

## The talk folder

```
talk/
  talk.json          spine: metadata, chapters, beats (ids, labels, notes, hold), lib, materials
  scenes/<ch>.html   one or more whole <div class="scene"> elements per chapter; objects have ids
  scenes/layers.html elements that persist across chapters (#slideno, a device rig, a world layer)
  beats/<ch>.js      Talk.beat('<ch>.<beat>', (B) => { ... }) registrations, one file per chapter
  lib/*.js           per-talk helpers, Talk.lib.<name> = { fn(B, ...) } (starter: assets/lib-starter)
  theme.css          per-talk CSS on top of talk.css (inlined into the build)
  assets/            fonts, logos, faces, screenshots, QR codes (the only folder the build copies)
  build/             generated: index.html, shots/, public/<slug>.html
  .sage/             the app's state (session, thumbnails, frames); never edit
```

The worked example is the ISSTA 2026 deck in the SAGE talk editor repository:
`fixtures/issta26/` (61 holds, 9 chapters, 13 lib helpers, a dark passage, backups, a public
end card). Read its `talk.json`, a scene, and the matching `beats/*.js` before writing a chapter.

## talk.json

```json
{
  "format": "sage-talk/1",
  "title": "…", "venue": "ISSTA 2026",
  "stage": { "width": 1920, "height": 1080 },
  "theme": "theme.css",
  "layers": "scenes/layers.html",
  "lib": ["lib/device.js", "lib/codepane.js", "lib/slideno.js"],
  "materials": { "paper": "../paper", "pdf": "../paper/main.pdf", "package": "../replication" },
  "defaults": { "holdPad": 1.0, "tail": 1.0 },
  "chapters": [
    { "id": "line", "label": "The line", "scene": "scenes/line.html",
      "beats": [ { "id": "title", "label": "Title", "notes": "Thank you. …", "hold": 5 } ] },
    { "id": "omt", "label": "One more thing", "dark": true, "private": true, "scene": "scenes/omt.html", "beats": [ … ] },
    { "id": "backup", "label": "Backup", "backup": true, "private": true, "dark": true, "beats": [ … ] }
  ],
  "public": { "id": "end", "label": "Paper", "tail": 0, "scene": "scenes/end.html", "motion": "beats/end.js",
              "beats": [ { "id": "end", "label": "Paper", "hold": 4 } ] }
}
```

- Ids use letters, digits, `-` and `_` (no dots: a beat's full id is `chapter.beat`).
- `hold` is the hold time **relative to the beat's start**, in seconds. Write it explicitly.
- `notes` are the presenter notes (the validator warns when a main beat has none).
- `scene` is optional: a chapter may use DOM from another chapter's scene (the starter's and
  ISSTA's backups live inside the dark passage's scene). `motion` defaults to `beats/<id>.js`.
- `dark` on a chapter (or on one beat, to override it) drives the slide counter's dark style and
  the navigator tint; the black itself is a `#black` scene the motion fades in.
- `private: true` chapters (the follow-up, the close, recruiting, backups) are cut from the
  public build; `backup: true` numbers their holds "Backup n / m" after the main holds.
- `public` is the end card appended in the public build only (its motion file loads only there).
- `materials` are paths relative to the talk; the app lists them and Claude may read them.
- Chapter markers, total duration, dark windows, backup numbering and the public/private split
  are all derived. There is nothing to shift by hand.

## Registering motion

```js
// beats/phone.js
Talk.beat('phone.exploded', (B) => {
  B.out('#c1-h, #c1-s', 0, { dur: 0.5, stagger: 0.03 });   // leave what the last hold showed
  B.in('#c2-eye', 0.4, { dur: 0.8, y: 14 });
  B.in('#c2-h', 0.6);
  B.anim('#rig', 0.8, 1.2, [{ transform: 'translate(1180px,120px) scale(1.15)' }], { ease: 'inOut' });
  B.lib.device.press(B, 1.6);                                // a lib helper takes B and a relative t
});
Talk.beat('phone.layout', (B) => { … });
```

Beats with no registration are pure holds (an info diagnostic). A registration the spine does
not list is a warning and never runs.

### B methods (t = seconds from the beat's start)

| Call | What it does |
|---|---|
| `B.in(sel, t, {dur=1, y=40, x=0, scale=1, blur=12, stagger=0, ease='out'})` | fade/blur/translate in from the offset to rest |
| `B.out(sel, t, {dur=.6, y=-30, x=0, scale=1, blur=10, stagger=0, ease='inOut'})` | fade/blur out toward the offset |
| `B.anim(sel, t, dur, keyframes, {ease, stagger})` | raw WAAPI keyframes; one keyframe = from the current value |
| `B.show(sel, t)` / `B.hide(sel, t)` | snap visible / invisible (two keyframes, so `show` hides before t) |
| `B.words(sel, t, {stagger=.09, dur=.9, y=30, blur=8})` | word-by-word reveal of `<span class="w">` children |
| `B.count(sel, t, dur, to, {from=0, format})` | counts the element's text; the film owns that text |
| `B.type(sel, t, dur, {cursor})` | typewriter over the element's own text (empty before t) |
| `B.draw(sel, t, dur, a, b, ease)` | strokes an SVG path from fraction a to b of its length |
| `B.tween(t, dur, fn, ease)` | arbitrary `fn(p)`, p in 0..1, for what WAAPI cannot do |
| `B.set(sel, t, {text, class: {name: bool}, style: {prop: value}})` | a discrete step (see below) |
| `B.els(sel)` | the stage elements matching sel (or an element / list passed through) |
| `B.lib.<name>` | the helpers registered by `lib/*.js` |
| `B.at`, `B.T` | escape hatches: the beat's absolute start and the raw engine (absolute times). The validator reports them (info); use only inside a helper that needs them |

`sel` is a selector string, an element, or a list of elements. Easings: `out` (expo settle,
the default for arrivals), `inOut`, `in`, `spring` (overshoot, for marks and chips), `linear`,
or any CSS easing such as `steps(24)`.

### B.set semantics

`B.set` replaces the hand-written text-swap and class-toggle tweens.

- One step track per element and key: the text, each class name, each style property.
- A step applies from its time **inclusive**; between steps the latest one at or before the
  current time wins.
- Before the first step the value is the one **captured at registration**, i.e. the markup.
  Put the initial state in the scene, not in a step at t = 0 of some later beat.
- Seeking backwards is exact (no history dependence), so `?t=` frames and the app's scrubber
  agree with playback.
- Motion that spans beats (a visibility window, a glitch running past a hold, a clock in a
  terminal) is a pair of steps in the beats where it opens and closes.
- A step counts as motion ending at its time for the beat's hold seeding.

## Timing rules

**Boundary rule.** Beat k+1 starts at hold k and owns [hold k, hold k+1). Motion registered at
t = 0 of a beat starts exactly on the previous hold, so the audience sees it only after the
click. Leave the previous pane at t = 0 of the beat that replaces it (the ISSTA chapters all
open with `B.out(…, 0, …)`).

**Explicit holds.** Kevin times holds by feel (authored slack after the motion ran 0.7 to 2.8
s in the ISSTA deck; none sat at a fixed pad), so every beat carries `"hold"`. A beat without
one is seeded at its last motion end plus `defaults.holdPad` (1.0 s); the app writes the value
back the first time the beat is timed. A hold earlier than the beat's own motion end is a
warning, legitimate when a long motion is meant to keep running under the talking (a counter,
a heat map filling in).

**No ghosts.** An entrance that starts before its beat's start (negative t, or `B.at`/`B.T`
arithmetic) shows up at the previous hold: `ghost-entrance`, an error. `talkc validate --render`
also checks in Chromium that no `data-a` element is visible at a hold that no beat brought in
(`ghost-visible`).

**Registration order is semantic.** The first animation registered on an element property
fills backwards (`fill: both`), so it decides what shows before it starts; later ones fill
forwards only. Beats register in talk order, so the first beat that touches an element should
bring it in with a from-0 keyframe (`B.in`, `B.show`, a two-keyframe `B.anim`). A one-keyframe
`B.out` registered first makes the element visible from t = 0; the validator flags it
(`first-owner-opacity`). Moving a beat changes registration order: re-run the validator.

**Duration** is the last hold plus `defaults.tail`; the public cut uses `public.tail`.
**Chapter markers** are derived (first chapter at 0, others at their first beat's start + 0.1 s),
so the chapter label flips just after the hold, never on it.

## Lib helpers and ready hooks

`lib/*.js` load before any beat, in the order of `talk.json` `"lib"`. Each is a classic script:

```js
(function () {
  Talk.lib.stations = {
    station: (B, k, s) => { B.in(`#stn${k + 1}`, s - 0.5, { dur: 0.7, y: 24 }); … },
  };
})();
```

Helpers take `B` first and beat-relative times. A helper may generate DOM at load (dot grids,
bar rows, terminal lines) from data kept next to the source path it came from. `Talk.ready((T,
layout) => …)` runs after layout and before the film starts (the slide counter in
`lib/slideno.js`); motion registered there is not timed and is not checked. Classic scripts with
a registry, no modules and no bundler: the film must work from `file://` and in headless Chrome.

## Page contract (what the compiler emits)

`build/index.html` is `.film > .stage` (1920×1080, scaled to the window) holding the layers and
then each chapter's scenes in spine order, **verbatim** (never re-indented: `white-space: pre`
code panes would move), the theme inlined, the spine as `<script id="talk-spine">`, then
`talk.js`, `edit.js`, `talk-layout.js`, the lib files, the motion files, `Talk.boot()`.

- Everything inside `.stage` is positioned in px on the 1920×1080 canvas; `.scene` is
  `position:absolute; inset:0`, stacked in build order. Give scenes a `z-index` in theme.css
  when a persistent object (the rig, a world layer, `#black`) must sit between them.
- `data-a` sets `opacity:0`; a beat brings the element in. Static elements carry no `data-a`.
- Objects the app's inspector should edit have an `id` (unique across all scenes) and an inline
  `style="position:absolute;left:…;top:…"`.
- The dark passage is a `#black` scene faded to opacity 1 plus scenes with class `dk`.
- Asset references must point into `assets/` (the only folder the build copies).

## Playback, keys, URL parameters

Space / → play to the next hold (again while playing: jump there) · ← previous hold · Enter play
through · Home / End · F fullscreen · N presenter window (notes, talk clock, mirrored frame) · T
reset the talk clock · H hide the scrub bar · `.` jump to the next hold · click right 88% next,
left 12% back.

`?cp=7` open at hold 7 · `?t=61.5` render one instant · `&capture` no controls (screenshots) ·
`&cplist` append `<pre id="cplist">` ("n time label") · `&layout` append the layout JSON ·
`&hide=sel,sel` hide elements · `?edit` open in the in-page text editor.

## talkc

`talkc` is the SAGE talk editor's compiler (`scripts/talkc.sh` finds it).

```
talkc build talk/                                  # build/index.html; exit 1 on a build error
talkc validate talk/ [--render] [--public] [--json] # diagnostics with codes; exit 1 on any error
talkc layout talk/ [--json] [--public]             # the hold list: "n time label"
talkc shoot talk/ [--holds] [--around 0.5] [--times 27.5,61.3] [--beats c2.layout] [--no-backups]
                                                   # PNGs in talk/build/shots (also takes an .html film)
talkc publish talk/ [slug]                         # build/public/<slug>.html, self-contained
```

Diagnostic codes (`talkc validate`): errors `json-syntax`, `file-missing`, `schema-invalid`,
`script-syntax`, `duplicate-chapter-id`, `duplicate-beat-id`, `duplicate-element-id`,
`asset-missing`, `ghost-entrance`, `ghost-visible` and `render-page-error` (with `--render`);
warnings `schema-unknown-key`, `selector-no-match`, `asset-not-in-build`, `notes-missing`,
`hold-before-motion-end`, `first-owner-opacity`, `beat-not-in-spine`, `beat-registered-twice`,
`record-script-failed`, `record-beat-failed`; infos `escape-hatch`, `beat-no-motion`. Each
diagnostic names the file, line and beat.
