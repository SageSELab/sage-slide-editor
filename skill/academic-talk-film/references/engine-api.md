# talk.js engine, page contract, editor, public build

## Page contract

```
<div class="film">
<div class="stage">            <!-- fixed 1920×1080, scaled to the window -->
  <div class="scene" id="title">…</div>
  <div class="scene" id="c2">…</div>   <!-- one scene per chapter; all stacked, all full-stage -->
  <div class="scene" id="black" style="background:#000;opacity:0"></div>   <!-- dark passage -->
  <div class="scene dk" id="c8">…</div>
  <div id="slideno"></div>
</div>
</div>
<script type="application/json" id="text-overrides">{"text":{},"notes":{}}</script>
<script src="talk.js"></script>
<script src="edit.js"></script>
<script>(() => { … const T = new Talk({ duration, chapters, checkpoints: CP }); … T.start(); })();</script>
```

- Everything inside `.stage` is positioned in px on the 1920×1080 canvas. `.scene` is `position:absolute; inset:0`.
- `data-a` on an element sets `opacity:0`; the script brings it in. Static elements (always visible) have no `data-a`.
- Scenes are stacked in DOM order. Give chapter scenes a `z-index` in the per-talk `<style>` when a persistent object (the device rig, a world layer) must sit above or below them.
- The dark passage is a `#black` scene faded to opacity 1 plus scenes with class `dk` (which flips the color tokens).

## Constructing

```js
const CP = [];
const cp = (at, label, notes, backup = false) => CP.push({ at, label, notes, backup });
const T = new Talk({
  duration: 343.0,
  chapters: [{ at: 0, label: 'The line' }, { at: 27.6, label: 'Inside the phone' }, …, { at: 240.9, label: 'One more thing', dark: true }, { at: 271.9, label: 'Backup' }],
  checkpoints: CP,
});
```

`checkpoints` is the caller's array; register holds after construction, the engine sorts them in `start()`. Chapter markers drive the scrub bar segments and the chapter label in the slide counter; put each marker 0.1 s after the first hold of the chapter so the label flips after the hold, not on it.

## Authoring methods (all times in seconds, absolute)

| Call | What it does |
|---|---|
| `T.in(sel, t, {dur=1, y=40, x=0, scale=1, blur=12, stagger=0, ease='out'})` | fade/blur/translate in from offset to rest. `stagger` spaces multiple matches. |
| `T.out(sel, t, {dur=.6, y=-30, x=0, scale=1, blur=10, stagger=0, ease='inOut'})` | fade/blur out toward offset. |
| `T.anim(sel, t, dur, keyframes, {ease, stagger})` | raw WAAPI keyframes (`[{opacity:0},{opacity:1}]`, `[{transform:'translateX(…)'}]`, `[{width:'0%'},{width:'67%'}]`, `[{background:'…'}]`…). One keyframe = animate from the current value. |
| `T.show(sel, t)` / `T.hide(sel, t)` | snap visible / invisible at t. |
| `T.words(sel, t, {stagger=.09, dur=.9, y=30, blur=8})` | word-by-word reveal of `<span class="w">` children; shows the container. |
| `T.count(sel, t, dur, to, {from=0, format})` | counts the element's text from `from` to `to`. `format: v => Math.round(v)+'%'`. |
| `T.type(sel, t, dur, {cursor})` | typewriter over the element's own text. Empties it at p≤0. |
| `T.draw(sel, t, dur, a, b, ease)` | strokes an SVG path from fraction `a` to `b` of its length. |
| `T.tween(t, dur, fn, ease)` | arbitrary JS tween, `fn(p)` with p in 0..1 (use for anything WAAPI cannot do: visibility toggles, text swaps, layouts). |
| `T.els(sel)` | elements in the stage matching sel. |

Easings: `out` (expo settle, the default for arrivals), `inOut`, `in`, `spring` (overshoot, for marks and chips), `linear`.

Patterns built from these in the example deck: `tline(id, t)` (reveal a code line with a clip-path wipe), `press(t)`/`release(t)` (finger ring on the device), `menuIn/menuOut`, `browserIn/browserOut`, `flash(sel, t, color)`, `grow(sel, t)` (a code line growing from height 0), `rigShow(t, on)`, `mkDots(id, spec)` (a dot grid by category), station builds with `sAt(k)`. Copy them from `references/example-index.html` rather than reinventing.

## Playback and keys

Space / → play to the next hold (press again while playing to jump there) · ← previous hold · Enter play through · Home / End · F fullscreen · N presenter window (notes, talk clock, mirrored frame, synced over BroadcastChannel) · T reset the talk clock · H hide the scrub bar · click right 88% next, left 12% back · E edit mode · Esc leave edit mode · ⌘S save edits.

URL parameters: `?cp=7` open at hold 7 · `?t=61.5` hold at a time · `&capture` hide the controls (for screenshots) · `?edit` open in edit mode · `&cplist` append a `<pre id="cplist">` with "n time label" lines · `&hide=sel,sel` hide elements · `&at=x,y` list what is painted at a stage coordinate (`<pre id="dbgat">`) · `&eds` list the editable elements · `&dbgpath=sel` print the override path of an element.

`T.onRender = (t) => {…}` runs after every render; the starter uses it to fill `#slideno` with "pane / total · chapter" (and "Backup n / m" for backup holds) and toggle its dark style from the chapter's `dark` flag.

## In-page editing

`edit.js` makes visible text editable (E), stores edits as overrides keyed by the element's nth-of-type path in the `text-overrides` JSON block, keeps a localStorage draft, and saves with ⌘S:

- served by `serve.py` (http://localhost:8765, started by `Edit talk.command`): POST /save rewrites the block in `index.html`, previous file kept as `index.html.bak`. Works in every browser.
- opened from disk: Chrome blocks file writes from `file://`, so the save can only offer a download. Tell Kevin to use the server.

Presenter notes are edited in the presenter window; they save with the main window. When you change slide text in the markup, check the overrides block first, an override masks the markup.

## Public build

`python3 build-public.py [slug]` writes `public/<slug>.html`:

- removes HTML between `<!-- private:start -->` and `<!-- private:end -->`, and script between `// private:start` and `// private:end` (use these around the follow-up chapter, the recruiting slide, the backups);
- un-comments HTML between `<!-- public:start` and `public:end -->`, and script between `/* public:start` and `public:end */` (use these for the end card and its timing);
- flips `const PUBLIC = false;` to `true`, so `DURATION` and chapter filtering (`private`, `publicOnly` flags) switch;
- strips presenter notes from every `cp(...)`, swaps the editor for a tiny overrides applier, removes the presenter and clock keys, autoplays the title build, adds a hint pill, hides the slide counter, uses CSS `zoom` for the fit (iOS-safe), inlines CSS, JS, font, and images as data URIs.

The starter `index.html` already has these markers in place.
