# Phase 0 WebKit spike: findings

Deck: `fixtures/issta26-original` (343 s, 61 holds including 8 backups, 3,109 WAAPI animations,
54 JS tweens). Machine: Mac Studio M2 Ultra, macOS 27.2, three 5K Retina displays (2x, 60 Hz).
Engines: Playwright 1.64.1 WebKit and Chromium 156, the system WKWebView (macOS 27.2), and
Google Chrome 156.0.8078.74.

| Task | Result |
|---|---|
| A. Golden-frame harness | PASS: `tests/golden/shoot.mjs` and `compare.mjs` |
| B. Cross-engine parity | PARTIAL: two real divergences (font stacks and 3D), both explained; the font one is fixable in CSS |
| C. WKWebView `takeSnapshot` vs Playwright WebKit | PASS for 2D (median 0.11 %, max 0.76 %); the snapshot path flattens 3D |
| D. Scrub performance | PASS for a sequential scrub (60 fps, p95 20 ms); PARTIAL for random jumps (about 26 fps) |
| E. Presenter relay | PASS: native BroadcastChannel works across two WKWebViews, and the Swift relay works too |
| F. Capabilities | PASS: WAAPI, color-mix, background-clip:text, blur filters, plaintext-only, Manrope |

## A. Golden-frame harness: PASS

`tests/golden/` installs with plain `npm install` and sits outside the pnpm workspace. See its README.

- `shoot.mjs <index.html> --engine webkit|chromium|chrome-cli [--holds] [--around 0.5] [--times ...]`
  renders each frame as a fresh `file://...?t=T&capture` load at 1920x1080 with deviceScaleFactor 1.
  It waits for `load`, then `document.fonts.ready`, then two rAFs.
  It writes `t0036.000.png` files and a `manifest.json` with the engine, version, hold index, label,
  frame kind and any page errors. Holds come from `window.T.cps`, with `?cplist` as the fallback.
  The 61 holds take 11 s in WebKit and 5 s in Chromium, with 4 pages in parallel.
- `compare.mjs A B [--threshold 0.1] [--fail-above %] [--aa]` diffs each frame with pixelmatch.
  It writes diff PNGs, a `report.json` with the percentage and diff bounding box per frame, and an
  `index.html` contact sheet sorted worst first. It exits 1 when any frame is over the limit.
  Given a single folder, it writes only a contact sheet.
- `--engine chrome-cli` runs the skill's current method: system Chrome with
  `--headless=new --virtual-time-budget=3000`. **Playwright Chromium matches it byte for byte.**
  At 5 of 5 holds (20.5, 36, 86.5, 240.8, 303.8) the PNG files are identical, with 0 differing
  pixels even under `--aa --threshold 0`.

## B. WebKit vs Chromium on the ISSTA deck: PARTIAL

All 61 holds, compared at pixelmatch threshold 0.1 with anti-aliasing ignored:

| Variant | Median | p90 | Max | Frames > 1 % |
|---|---|---|---|---|
| Deck as is | **0.99 %** | 3.16 % | **8.53 %** (t=36.0) | 30 / 61 |
| Deck with the two fixes below | 0.13 % | 0.61 % | 8.18 % (t=36.0) | 5 / 61 (all 3D) |
| Same, excluding the 5 exploded-view holds | 0.13 % | - | 0.74 % | 0 |
| Fixed deck, holds and the frames 0.5 s either side (183 frames) | 0.14 % | 1.18 % | 8.18 % | 22 / 183 |

The differences, worst first:

1. **Font stacks (most frames, and the main cause of the 0.99 % median).**
   - `--text: -apple-system, "SF Pro Text", system-ui, ...`: Chromium does not recognise
     `-apple-system`; it measures the same as the serif fallback. Chromium therefore falls through to
     the named family **"SF Pro Text"**, a static face without Apple's size-specific tracking. WebKit
     resolves `-apple-system` to the system UI font, with optical sizing and tracking.
   - The effect is large. The same 23 px string is **534 px** wide in Chromium and **487 px** in
     WebKit, so Chromium is about 10 % wider and lines wrap in different places. Examples:
     - t=12.5: "execution feedback in training" wraps only in Chromium.
     - t=36 and t=41: the `.laylabel small` captions wrap differently.
     - t=240.8 (Summary): every stat row reflows and moves down.
     - t=266.8 (Thank you): the second line of the subtitle differs.
   - `system-ui` measures 486.5 px in **both** engines.
   - `--mono: ui-monospace, "SF Mono", Menlo, ...`: WebKit resolves `ui-monospace` to SF Mono.
     Chromium does not support `ui-monospace`, and "SF Mono" is not installed under that name, so
     Chromium uses **Menlo**. This changes every code pane (t=86.5, 201.3, 303.8).
   - Manrope (`--display`) renders identically in both engines.
2. **3D (`preserve-3d`, `perspective`, `backface-visibility`).** This affects the five exploded-view
   holds, t=35.5 to 56.5 (4.2 to 8.5 %), and tiles caught mid-flip (t=20.0, 2.2 %).
   - What it looks like: Playwright WebKit draws the phone layers flattened onto the device, and a
     flipping tile shows its back face mirrored.
   - Cause: Playwright WebKit screenshots and `takeSnapshot` both use WebKit's non-composited paint
     path, which cannot draw 3D. The on-screen WKWebView is correct (see C), and this is not a bug in
     the deck.
   - Evidence: a minimal two-plane page (`probe/min3d.html`) behaves the same way. Changing the deck's
     own CSS (opacity animations, backface, overflow and so on; `probe/3d-bisect.mjs`) makes no
     difference.
3. **Stray 4 px grey dots, WebKit only.** They appear at (650,420), (1270,420), (560,640) and
   (1360,640) on many frames, for example t=5, 12.5, 36 and 86.5.
   - Cause: `T.draw()` sets both `stroke-dasharray` and `stroke-dashoffset` to L for an undrawn path.
     That leaves a zero-length dash at the end of the path. With round caps, WebKit paints a dot there
     and Chromium does not.
   - The dots come from the `#nl1...` connector paths, and they are also visible on screen.
4. **Residual differences (0.1 to 0.7 %).** These are glyph rasterisation and anti-aliasing at text
   edges, plus resampling of the QR codes and logos (t=266.8). None of it is visible at normal size.
5. **No visible differences** in blur filters, `color-mix()`, `background-clip:text` gradients,
   shadows or clipping.
   - With the font fix in, frames 0.5 s before and after each hold (mid-transition blur) differ no more
     than the holds themselves: median 0.15 % before and 0.09 % after.
   - The deck uses no `backdrop-filter` on the stage; only the editor bar uses it.

The "fixed" rows used the two changes below. They were applied to a scratch copy in
`tests/golden/out/fixture-patched`; `fixtures/` was not modified.

```css
--text: system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
--mono: Menlo, Consolas, monospace;   /* or bundle a mono woff2 */
```
```js
// talk.js draw(): a gap longer than the path, so no zero-length dash is left at the end
p.style.strokeDasharray = `${L} ${2 * L}`;
```

## C. Real WKWebView snapshots: PASS for 2D, with a 3D caveat

`.build/wkspike snap` runs a real NSApplication run loop with a 1920x1080 WKWebView in a borderless
window parked at (-20000, -20000). It calls `takeSnapshot(with:)` with `afterScreenUpdates = true` and
`snapshotWidth = 1920 / backingScale` points. That gives a true 1x render of exactly 1920x1080 px, with
no resampling. All 61 holds were captured in three modes:

| Comparison | Median | p90 | Max |
|---|---|---|---|
| WKWebView reload with `?t` vs Playwright WebKit | 0.113 % | 0.207 % | 0.762 % (t=201.3, small mono text) |
| WKWebView `T.seek(t)` vs Playwright WebKit | 0.113 % | 0.207 % | 0.762 % |
| WKWebView reload vs `T.seek` in **random order** | **0.000 %** | 0 | 0 (pixel-identical) |

The differences between WKWebView and Playwright are only text anti-aliasing and glyph positioning,
because the system WebKit is newer than Playwright's build. 33 of the 61 frames are over 0.1 %, so
comparing app snapshots against Playwright goldens needs a threshold of about 1 %.

Cost per frame:
- Reload: 118 ms median to load, then 188 ms median (p95 300) to settle and snapshot.
- Seek: 1 ms to seek, then 54 ms median (p95 93).

**Seek is 4 to 5 times faster than reload and gives identical pixels**, even when the holds are
visited in random order.

Gotchas found:
- **Occlusion stalls offscreen views.** A window parked offscreen counts as occluded, so WebKit stops
  rAF and the settle step hangs.
  - Fix: call the private method `-[WKWebView _setWindowOcclusionDetectionEnabled:NO]`. The tool calls
    it through the ObjC runtime, because setting that key through KVC fails silently.
  - With the fix in place, `visibilityState` reports `visible` and rAF runs.
- **`takeSnapshot` cannot capture 3D.** The same WKWebView renders the exploded view and the tile flips
  correctly on screen; `takeSnapshot` returns them flattened.

  | Capture | Exploded view, t=36 | Tile flip, t=20 | Minimal test page |
  |---|---|---|---|
  | On screen (`screencapture`) | `out/deck36-screen.png`: correct | `out/deck20-screen.png`: correct | `out/min3d-screen.png`: correct |
  | `takeSnapshot` | `out/deck36-snapshot.png`: flattened | - | `out/min3d-snapshot.png`: flattened |
  | ScreenCaptureKit, visible window | `out/deck36-sck-visible.png`: correct, 312 ms | - | - |

  ScreenCaptureKit (`SCScreenshotManager.captureImage` on the window) does capture composited 3D. It
  needs the Screen Recording permission, and it fails on an offscreen window with error -3811.
- **Window release.** Set `NSWindow.isReleasedWhenClosed = false` for windows created in Swift.
  Otherwise closing the window over-releases it and crashes.

## D. Scrub performance: PASS for sequential scrubbing, PARTIAL for random jumps

Setup:
- A visible 1280x720 window, which is 2560x1440 at the 2x backing scale.
- JS drives `T.render(t)` from rAF, advancing t by 1/60 s per frame across the whole deck: 20,580
  renders covering 343 s.
- After each render, the test reads `document.body.offsetHeight` to force style and layout, so their
  cost is counted.
- WebKit clamps `performance.now()` to 1 ms resolution.

| Full deck, sequential, 60 steps/s | Median | p95 | p99 | Max |
|---|---|---|---|---|
| `T.render(t)`, JS only | 1 ms | 2 ms | 2 ms | 6 ms |
| Render plus style and layout | **9 ms** | **11 ms** | 12 ms | 19 ms |
| rAF interval (frame to frame) | **17 ms** | **20 ms** | 29 ms | 954 ms (one stall) |

Sequential scrubbing holds 60 fps: 4.2 % of frames took more than 20 ms and 0.7 % took more than
33 ms.

Random jumps behave differently. The test made 600 seeks to random times across the deck, as when
dragging the scrubber between chapters.
- Render plus layout stays cheap: 12 ms median, 18 ms p95.
- The rAF interval does not: **38 ms median and 92 ms p95, about 26 fps**.
- The time goes into painting a mostly new frame (blur filters and large images), not into JS.

A "windowed" render, which only updates animations whose time range overlaps the move, did not help:
8 ms vs 9 ms, with 0 style mismatches over 200 random steps. Most of the cost is WebKit's style
recalculation for the 2,097 animated elements, not the `currentTime` writes.

## E. Two web views relaying state: PASS (both approaches work)

Two WKWebViews in one app process, the second loaded with `?presenter=1` (`.build/wkspike relay`).

**Native BroadcastChannel works** between the two views, using the default `WKWebsiteDataStore` and the
`file://` origin.
- A bare `new BroadcastChannel('spike')` message arrived in the other view.
- The deck's own `talk-sync` channel moved the presenter to `T.t = 100` after `T.seek(100)` in the
  main view.

**The Swift relay also works, with the deck unmodified.**
- How it works: a document-start user script replaces `window.BroadcastChannel` with a shim. The shim's
  `postMessage` sends to `webkit.messageHandlers.bc`. Swift then forwards each message to the other
  views with `callAsyncJavaScript("__bcDeliver(name, data, sentAt)")`.
- Main to presenter: `T.seek(100)` in the main view made the presenter show "hold 18 / 61 · 1:40".
- Presenter to main: the presenter's Space key sent `{cmd:'next'}`. The main view played to the next
  hold (100.5 s), and the presenter followed.
- Latency over 37 relayed messages: delivery took 10 ms median (p95 20 ms). The Swift hop, from receipt
  to JS completion, took 16 ms median (p95 26 ms).

## F. Capabilities in WKWebView: PASS

Results come from the JS probe (`.build/wkspike probe`, written to `out/probe.json`) and from visual
checks of the snapshots.

| Feature | Result in WKWebView |
|---|---|
| WAAPI | A paused 1000 ms animation with `currentTime = 500` gives opacity 0.5, `blur(6px)`, translateZ 50 px and `offsetDistance` 50 %, as expected |
| `color-mix()` | Supported; computes to `color(srgb 0.749 0.353 0.949 / 0.25)` |
| `background-clip: text` | Works prefixed and unprefixed; `.grad` headings render as gradient text (t=5, "How Far are We?") |
| `filter: blur()`, `backdrop-filter` | Both supported; blur transitions render correctly in the snapshots |
| `contenteditable="plaintext-only"` | Honoured: `execCommand('bold')` returns false, and `insertHTML('<b>bold</b> <i>it</i>')` leaves the plain text "bold it" |
| Manrope woff2 | `document.fonts.check('700 40px Manrope')` is true and the face is `loaded`; it measures 565.8 px vs 551.4 px for the fallback |
| `offset-path`, `preserve-3d` | Both supported; for 3D in snapshots, see C |

## Recommendations for the app

1. **Snapshot API.**
   - Use `takeSnapshot(with:)` with `snapshotWidth = targetPx / backingScale`.
   - Render thumbnails in a dedicated offscreen WKWebView with occlusion detection turned off, using
     `_setWindowOcclusionDetectionEnabled:`. This is a private method, which is acceptable for a
     Developer ID app. Without it, the view must stay in an on-screen window.
   - Expect about 55 ms per thumbnail with seek, so about 3.5 s for 61 holds.
2. **Seek rather than reload** for thumbnails, Claude's frame requests and export. The pixels are the
   same and seek is 4 to 5 times faster.
   - Keep reload with `?t` for cold starts and golden tests.
   - Caveat: tweens that set state only when `p >= 1` (the deck's `setState`) do not reverse when
     seeking backwards between holds. The format should require tweens to be pure functions of p.
3. **3D needs a decision.** `takeSnapshot` and Playwright WebKit both flatten `preserve-3d`,
   `perspective` and `backface-visibility`. The canvas on screen is correct either way. Options, in
   order of preference:
   - (a) The engine and skill avoid real 3D and fake it with 2D transforms or pre-rendered layers.
   - (b) Export and golden frames that need 3D are rendered in Chromium, which handles 3D: either the
     Node sidecar through Playwright, or headless Chrome.
   - (c) Capture the composited window with ScreenCaptureKit. This needs an on-screen window and the
     Screen Recording permission.
4. **Engine and theme fixes.**
   - Put `system-ui` first in `--text`; its metrics are identical in both engines.
   - Give `--mono` a font that exists by name in both engines: Menlo, or a bundled woff2 such as
     JetBrains Mono.
   - Bundling a text face as well, as the deck already does for Manrope, would make decks identical on
     non-Apple machines too.
   - In `talk.js` `draw()`, set `strokeDasharray` to `` `${L} ${2*L}` `` to remove WebKit's end-cap
     dots.
5. **Presenter.** Native BroadcastChannel works today, but use the Swift relay shim anyway (PLAN 5.5).
   - The deck code stays unchanged.
   - It keeps working if the two views ever get separate data stores.
   - It gives Swift the {t, playing} stream for the native presenter UI, at about 10 ms latency.
6. **Golden thresholds.**
   - 0.1 % within one engine and build (Chrome CLI and Playwright Chromium match exactly).
   - About 1 % for WKWebView vs Playwright WebKit.
   - About 1 % across engines once the font fix is in.
   - The 3D holds (36 to 56.5 s in the ISSTA deck) should be documented exceptions in the WebKit
     goldens.
7. **Scrubbing.** Sequential scrubbing is fine as it is. For large scrubber jumps, render at most once
   per rAF and drop intermediate pointer moves, so renders do not queue up behind 40 to 90 ms paints.

## Reproduce

```sh
cd tests/golden && npm install && npx playwright install webkit chromium
node shoot.mjs ../../fixtures/issta26-original/index.html --engine webkit   --holds --out out/issta26/webkit
node shoot.mjs ../../fixtures/issta26-original/index.html --engine chromium --holds --out out/issta26/chromium
node compare.mjs out/issta26/webkit out/issta26/chromium --out out/issta26/webkit-vs-chromium --fail-above 1

cd ../../spikes/webkit && ./build.sh
FX=$(cd ../../fixtures/issta26-original && pwd)/index.html
.build/wkspike snap  $FX out/wk-seek seek "$(cat out/times.txt)"   # also: reload | seek-shuffled
.build/wkspike scrub $FX out/scrub-full.json                        # about 6 min, opens a window
.build/wkspike relay $FX out/relay.json
.build/wkspike probe $FX out/probe.json
.build/wkspike sck   $FX $PWD/out/deck36-sck "t=36&capture"
node ../../tests/golden/compare.mjs ../../tests/golden/out/issta26/webkit out/wk-seek --out out/cmp-pw-vs-seek
```

Probe scripts in `probe/`:
- `3d-bisect.mjs`: shows that the 3D flattening is not caused by the deck's CSS.
- `fonts.mjs`: reports which font each engine resolves.
- `dot.mjs`: finds the element that paints a given pixel.
- `min3d.html`: the minimal two-plane 3D test page.
