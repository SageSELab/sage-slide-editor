# Starter library (`lib/*.js`)

Helpers ported from the ISSTA 2026 deck (`fixtures/issta26/lib/` in the SAGE talk editor repo,
the worked example). Each file registers `Talk.lib.<name>`; beats reach it as `B.lib.<name>`.
Every helper takes `B` first and **beat-relative** times, so it registers in whichever beat
calls it. Copy only the files a talk uses into its `lib/`, list them in `talk.json` `"lib"`
(order matters: a helper that calls another loads after it), and adapt the selectors and data.

Files marked **generates DOM** build elements when the script loads (before any beat runs).
They throw if their container id is missing from the scenes, which blanks the film, so copy
them together with the markup they expect, or edit the data and ids first.

| File | Signature | Expects in the scenes |
|---|---|---|
| `device.js` | `press(B, t)`, `release(B, t)`, `menuIn(B, t)`, `menuOut(B, t)`, `browserIn(B, t)`, `browserOut(B, t)`, `rigShow(B, t, on)` | the device rig in `scenes/layers.html`: `#rig` (with `data-a`), `.touch#fg` holding the SVG `circle#ring`, `#menu`, `#browser` inside `.screen` |
| `codepane.js` | `tline(B, sel, t, dur = 0.5)` (a line types in), `grow(B, sel, t, stagger = 0.16)` (`.ln.new` lines open from height 0, then type), `flash(B, sel, t, color)` (line background), `pulse(B, sel, t, dur)` (a dot along its CSS `offset-path`) | `.code` panes with `.ln` lines (theme: `.code .ln.new { height: 0 }`) |
| `stations.js` | `SX` (x offsets), `station(B, k, s)`: builds station `k` (0..4) lighting up at `s`, dims the previous one, slides `#bugcard` | `#stn1`..`#stn5`, `#bugcard`; the `MICRO` array holds each station's own micro-animation and is ISSTA-specific: rewrite it |
| `dots.js` (**generates DOM**) | `mkDots(id, [[cls, n], ...])`, `mkCells(id, n)` return the new elements; `pop(B, els, t, step, { dur = 0.4, from = 0.3 })`, `fill(B, els, t, step, color)` | the containers named in the four `mk*` calls at the top (`#g50`, `#g46`, `#g46b`, `#g50b`): replace those calls with the talk's own grids |
| `bars.js` (**generates DOM**) | `buildBars(B, id, t)` (stacked outcome rows, then segments grow), `piles(B, t)` (falling bars per category) | `#rq1`, `#rq2`, `#piles`; the `SYN`, `REAL`, `PILES` data are the paper's numbers: replace them and keep the source path in a comment |
| `flow.js` | `flowIn(B, sel, t, dx)` (chips slide into a box), `boxPulse(B, sel, t, label)` (the box lights up; with `label`, a `B.set` text step) | a box whose markup text is the value before the step |
| `heatmap.js` (**generates DOM**) | `build(B, t)` (row labels, then every cell pops in); `FSE`, `BUGS`, `ROWS` data | `#hmg` (grid columns in the theme) |
| `term.js` (**generates DOM**, needs `codepane.js` first) | `replay(B, base)` (each line types in at `tAt(base, i)`; `#termclock` steps by `B.set`), `TLINES`, `mmss(s)`, `tAt(base, i)` | `#termlines`, `#termclock` |
| `slideno.js` | no call: a `Talk.ready` hook that writes "pane / total · chapter" (or "Backup n / m") into `#slideno` and turns it dark over dark beats | `<div id="slideno"></div>` in `scenes/layers.html` |

Text a helper rewrites at runtime (`B.set` text steps, `B.count`, `B.type`) is owned by the
motion code: change it there, not in the scene. The SAGE app refuses an in-place text edit on
such an element for the same reason.
