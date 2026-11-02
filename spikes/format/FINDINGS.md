# Phase 0 format spike: findings

The beat format reproduces the ISSTA opening exactly.

## Built

- `packages/engine/src/talk-layout.js`: the classic-script layout runtime. It provides `Talk.beat`, `Talk.lib`, `Talk.ready` and `Talk.boot`, the beat-scoped `B` (all T methods relative to the beat start, plus `B.at`, `B.lib`, `B.set`, `B.T`), holds, chapters, duration, checkpoints, and `?cplist`, `?layout` and `?hide`. `talk.js` is unchanged.
- `fixtures/issta26/`:
  - `talk.json`, with `layers` and a per-chapter `motion` field
  - `theme.css`
  - `scenes/layers.html`, `line.html`, `phone.html`
  - `beats/line.js`, `phone.js`
  - `lib/world.js`, `phone.js`, `slideno.js`
  - `assets/`, a copied subset
  - `build/`, generated
- `spikes/format/build.mjs`: inlines the theme and the spine, copies the engine and assets, gives each lib/beat file its own inline script with a `sourceURL`, and syntax-checks each one.
- `spikes/format/diff.mjs`: Chrome headless + pixelmatch at threshold 0, plus raw byte counts, plus cplist and slideno comparison. `--orig` points it at a control.

## Scope

t=0 to 66.5, 13 holds (Title … Navigation). Notes were extracted from the `cp()` calls programmatically.

## Results (65 frames: every hold, hold ±0.5, 29 mid-motion times)

- cplist identical.
- slideno: pane number and chapter identical; the total differs (13 vs 53).
- Against the control (original truncated after `cp(66.5)`, scenes c3 to c8 removed): 64 of 65 frames byte-identical.
  - t=58.0 is the exception: the original's window is `t<=58.0`, while `B.set` steps take effect at their time (inclusive). 58.01 matches.
- Against the real original: 0 to 1 px, except 28 to 57 s (103 to 32,516 px of device text). Later-chapter fill-both animations on `#menu`, `#browser` and `#fg` make Chrome composite those elements as layers, which changes text rasterization. Injecting only the `#menu` animation drops t=29 from 32,516 to 634 px.
- Fixed bug: rounding `start+t` to 1e-6 moved the computed time 13.5+6/7. The runtime now snaps only when |v−round6(v)|<1e-9.

## Boundary rule

Beat k+1 starts at hold k, owns [hold k, hold k+1), and motion at hold k is its t=0. The holds rebase to 5, 8.5, 7, 7, 8.5, 5, 5, 5, 5.5, 4, 2, 2, 2.

## Cross-beat motion: `B.set` step tracks

- One engine tween per (element, text | class | style property), which reads `T.t`.
- It applies the latest step at or before t, otherwise the value captured at registration.
- Exact under backward seeks; the original `setState` was history-dependent.
- Windows are set pairs in the opening and closing beats, and the initial state lives in markup (`.lay` has `visibility:hidden`).
- `B.at` and `B.T` are escape hatches; the port did not use them.

## Helpers

`world` (DOM generation at load, `px`, and `nodeT` with relative times as parameters), `phone` (`focus`, `cardFlash`, `setState` via `B.set`), and `slideno` (a `Talk.ready` hook whose dark state comes from chapter flags).

- `lastEnd` comes from wrapping `T.anim` and `T.tween` on the instance during each beat:
  - `anim`: t+stagger·(n−1)+dur
  - `tween`: t+dur
  - `set`: t
- Layout is a single pass with no separate recorder: beat functions run once against the real T, so side effects run once.

## Auto-hold

| Beat | lastEnd | Hold |
|---|---|---|
| title | 4.30 | 5 |
| fifteen | 8.50 | 8.5 |
| measured | 7.16 | 7 |
| never | 6.80 | 7 |
| exploded | 5.70 | 8.5 |
| layout | 4.20 | 5 |
| listeners | 2.70 | 5 |
| state | 3.70 | 5 |
| lifecycle | 3.20 | 5.5 |
| crash | 3.10 | 4 |
| output | 0.90 (2.10 as the original tween) | 2 |
| cosmetic | 0.90 | 2 |
| navigation | 1.00 | 2 |

- With pad 0.3, 0 of 13 match; no single pad fits more than 2.
- 2 of 13 originals put the hold before the motion end (measured −0.16; output −0.10).

## Spec changes

1. Boundary rule normative.
2. Hold-before-motion-end becomes a warning (or `{overHold:true}`); the real ghost check is an entrance that starts before the hold and ends after it.
3. Auto-hold for new beats only; explicit holds once a beat is timed; `holdPad` 0.3 is too short (authored slack is 0.7 to 2.8).
4. `B.set` semantics: inclusive steps, per-key tracks, initial value captured, `lastEnd` = t, cross-beat windows as pairs, initial state in markup; validator flags `B.at`/`B.T`.
5. Scene files hold whole `.scene` elements; multiple scenes per chapter; layers emitted first (only `z-index:auto` ties care about DOM order).
6. The spine names the motion file, or the convention is `beats/<chapter>.js`.
7. Registration order is semantic (first animation on a property fills both ways; later ones composite on top; tweens run in order). `moveBeat` can change rendering, so the validator should flag one-keyframe opacity anims that become the first owner, after every reorder.
8. First chapter marker at 0; the others at first beat start + 0.1.
9. Specify the float-snapping rule.
10. `Talk.lib`, `Talk.ready`, lib loads before beats and may generate DOM; debug params move into the runtime.
11. `edit.js` overrides keyed by nth-of-type paths break when the DOM is re-assembled; key by id or drop them.
12. Golden frames: subsets cannot be compared with full-deck frames (up to 1.6% of pixels, so the 0.1% threshold fails); use a truncated control and avoid sampling exactly on step times.
13. Build: `talk.css` loads the font relative to itself, so the build copies `assets/` and the engine into `build/`; `talkc` needs to decide copy vs `../` paths.

## Estimate

This slice was 13 of about 53 holds and about 200 of about 760 script lines. The rest (press/menu/browser/pulse/flash/grow/tline, the station loop as one beat per station, generated charts, the dark passage, backups, private/public) is about 2 to 3 days. Diff against the real original once complete.
