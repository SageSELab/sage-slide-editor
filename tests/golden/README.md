# Golden frames

Frame-level regression tests for talk films. Every frame is rendered through the
deterministic path the editor uses: a fresh load of `index.html?t=T&capture`
(`render(t)` once at boot, controls hidden), 1920x1080, deviceScaleFactor 1, then
`document.fonts.ready` and two `requestAnimationFrame` ticks before the screenshot.

This folder sits outside the pnpm workspace; install it on its own:

```sh
cd tests/golden
npm install
npx playwright install webkit chromium
```

## Shoot

```sh
# every hold (checkpoint), WebKit: the engine the Mac canvas uses
node shoot.mjs ../../fixtures/issta26-original/index.html --engine webkit --holds --out out/issta26/webkit

# every hold plus 0.5 s either side (the plan's golden set)
node shoot.mjs <index.html> --engine webkit --holds --around 0.5 --out out/x/webkit

# specific times, Chromium
node shoot.mjs <index.html> --engine chromium --times 12.5,36,86.5 --out out/x/chromium

# the method the academic-talk-film skill uses today (system Chrome CLI, virtual time)
node shoot.mjs <index.html> --engine chrome-cli --times 20.5,36 --out out/x/chrome-cli
```

Options: `--engine webkit|chromium|chrome-cli`, `--holds`, `--around S`, `--times a,b,c`
(repeatable), `--no-backups`, `--width/--height`, `--concurrency N` (default 4).
Holds come from `window.T.cps` (falling back to the deck's `?cplist` output).
Files are named by time (`t0036.000.png`) so folders from different engines line up;
`manifest.json` records engine, browser version, hold index, label, kind
(`hold`/`before`/`after`/`time`) and any page errors.

## Compare

```sh
node compare.mjs out/issta26/webkit out/issta26/chromium --out out/issta26/webkit-vs-chromium --fail-above 1
open out/issta26/webkit-vs-chromium/index.html
```

- pixelmatch with `--threshold 0.1` (per-pixel colour tolerance); anti-aliased pixels are
  ignored unless `--aa`.
- Reports the percentage of differing pixels per frame, median/p90/max, and the bounding
  box of the differences; exits 1 if any frame exceeds `--fail-above` percent
  (default 0.1, the plan's same-engine threshold).
- Writes `diff/<frame>.png`, `report.json`, and `index.html`: a contact sheet, worst
  frame first, with A | B | diff for each frame.
- `node compare.mjs <dir>` with one folder writes a contact sheet only (golden review).

## Thresholds that held in the Phase 0 spike

| Comparison | Median | Max | Suggested `--fail-above` |
|---|---|---|---|
| Playwright Chromium vs Chrome CLI (same Chromium build) | 0 % | 0 % | 0.01 |
| WKWebView `takeSnapshot` vs Playwright WebKit | 0.11 % | 0.76 % | 1 (text rasterisation only) |
| Playwright WebKit vs Chromium, ISSTA deck as is | 0.99 % | 8.5 % | (fails: fonts + 3D) |
| same, with the font-stack fix | 0.13 % | 8.2 % (3D only) | 1, with 3D frames as documented exceptions |

See `spikes/webkit/FINDINGS.md` for why.

`out/` is gitignored. Goldens that get checked in should live in a fixture-specific folder
and be regenerated only by an explicit command whose contact sheet is reviewed in the PR.

## Known limitation: 3D

Playwright's WebKit screenshots (and `WKWebView.takeSnapshot` in the app) paint through
WebKit's non-composited path, which flattens `transform-style: preserve-3d`, ignores
`perspective`, and does not honour `backface-visibility`. The composited on-screen view is
correct. WebKit goldens of 3D frames (the ISSTA exploded view, 35.5–56.5 s, and mid-flip
tiles) therefore show a flattened picture; treat those frames as documented exceptions or
shoot them in Chromium.
