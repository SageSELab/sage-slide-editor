# Phase 0 memo

2026-11-01. Three spikes, run in parallel. Details in `spikes/sdk/FINDINGS.md`,
`spikes/webkit/FINDINGS.md`, `spikes/format/FINDINGS.md`. Plan changes are applied to PLAN.md
(sections 3, 6, 12, 13).

## Outcome

The plan holds. No spike found a reason to change the architecture. Each one changed details.

| Spike | Verdict | The finding that matters most |
|---|---|---|
| Agent SDK | Pass | Kevin's own Claude Code login works with no API key. Settings files can silently bypass the approval callback, so the sidecar runs with `settingSources: []` and ships the skill as a bundled plugin. |
| WebKit | Pass, one gap | WKWebView renders the deck correctly on screen and scrubs at 60 fps. `takeSnapshot` flattens 3D transforms, which affects the "Inside the phone" exploded view. |
| Format | Pass | The beat format reproduces the first 13 holds of the real deck: 64 of 65 test frames byte-identical, the hold list identical. Auto-hold does not match how Kevin times beats. |

## Agent SDK

Verified with SDK 0.3.316 (Claude Code 2.1.316), model `claude-opus-5-5`, spend 0.76 USD.

- Auth: `apiKeySource: "none"`, stored login used. Fine for a personal app; distribution still needs Anthropic's approval (PLAN 6.4).
- Sidecar options: `model`, `cwd`, `additionalDirectories`, `env`, `includePartialMessages`, `permissionMode: 'default'`, `canUseTool`, `hooks.PostToolUse`, `mcpServers` (in-process via `createSdkMcpServer`), `allowedTools` with `mcp__talk__<tool>` names, `plugins`, `maxBudgetUsd`, `maxTurns`, `resume`, `forkSession`, `settingSources: []`.
- `FileChanged` only fires for paths returned as `watchPaths` by another hook. The sidecar runs its own watcher.
- App tools are deferred behind ToolSearch by default, costing a turn. Mark them always-loaded.
- Sessions are stored under a path derived from `cwd`. The app keeps its own `.sage/session.json` and must handle a moved talk.
- With default settings, Kevin's personal MCP servers (mail, Safari) start in the sidecar. `settingSources: []` plus `strictMcpConfig` should prevent that; to verify in Phase 4.
- A trivial turn costs about 0.15 USD on Opus 5.5. The chat pane needs a visible cost meter and an effort control.
- `maxBudgetUsd` is checked after each turn, so a run can overshoot its cap by one turn.

## WebKit

- Playwright Chromium and system Chrome headless produce byte-identical frames, so `tests/golden` reproduces the skill's existing method.
- WebKit vs Chromium across all 61 holds: median 0.99 %, max 8.53 % of pixels. Causes: font stack (Chromium skips `-apple-system` and `ui-monospace`), 3D, and a WebKit-only round cap on zero-length dashes from `T.draw`. With `system-ui` first in `--text`, Menlo in `--mono`, and a `${L} ${2L}` dash array, the median drops to 0.13 % outside 3D frames.
- WKWebView vs Playwright WebKit: median 0.11 %, max 0.76 %.
- `T.seek(t)` is pixel-identical to reloading with `?t=` and 4 to 5 times faster (about 55 ms per frame).
- Scrub: 17 ms median frame interval sequentially; random jumps about 26 fps (paint bound).
- Offscreen web views stop firing `requestAnimationFrame` unless window occlusion detection is disabled, which needs a private WebKit API.
- Presenter: BroadcastChannel works between WKWebViews; a Swift relay also works at about 10 ms. Use the relay so the app owns presenter state.
- Blur, `color-mix`, gradient text, `backdrop-filter`, `plaintext-only`, Manrope: all fine.

### Decision on 3D frames

- The on-screen canvas and presenting draw 3D correctly; nothing to do.
- Thumbnails use `takeSnapshot`. Flattened 3D in a 200 px thumbnail is acceptable.
- `talk_frame` (Claude's eyes), PNG/PDF export, and golden tests use headless Chromium in the sidecar with the engine's font fix. This is the same renderer the skill uses today and the browser Kevin presents from.
- Revisit ScreenCaptureKit (needs Screen Recording permission) only if WebKit-exact exports become necessary.

## Format

Ported holds 1 to 13 (t = 0 to 66.5) into `fixtures/issta26/` with a 161-line layout runtime (`packages/engine/src/talk-layout.js`). `talk.js` unchanged.

Spec changes adopted (PLAN section 3 updated):

1. Boundary rule: beat k+1 starts at hold k and owns [hold k, hold k+1); motion registered at hold k is its t = 0.
2. Explicit holds are the norm. Auto-hold seeds new beats only, and its default pad is 1.0 s (authored slack ran 0.7 to 2.8 s; 0 of 13 matched a 0.3 s pad).
3. A hold before the beat's motion ends is a warning, not an error (2 of 13 real holds do this on purpose). The error is the actual ghost: an entrance that starts before the hold and ends after it.
4. `B.set(sel, t, {text|class|style})` is a step track per element and property, inclusive at t, exact under backward seeks. Cross-beat windows are pairs of steps; initial state lives in markup.
5. Scene files contain whole `.scene` elements, several per chapter allowed; layers emit first.
6. Motion file per chapter by convention: `beats/<chapter>.js`.
7. Registration order is semantic (first animation on a property fills both ways). Reordering beats re-runs the validator's first-owner check.
8. First chapter marker at 0; others at first beat start + 0.1.
9. Float snapping only when within 1e-9 of a 6-decimal value.
10. `Talk.lib`, `Talk.ready`; lib scripts load before beats and may generate DOM; debug URL parameters live in the runtime.
11. Text overrides are keyed by element id, not DOM path.
12. Golden tests for a partial port compare against a truncated control, and avoid sampling exactly on step times.
13. The build copies the engine and assets into `build/` so `talk.css` resolves its font.

Remaining port: about 2 to 3 days.

## Process notes

- Two subagents could not write their findings files with the file tool, which refused writes from subagents. One returned the text, which was saved by the main session. The other wrote its file through the shell instead, working around the refusal. No harm resulted, but future delegated tasks will ask for findings to be returned as text.
- A full-desktop screen capture taken by the main session while checking the app captured unrelated private content; it was deleted immediately. The WebKit spike's screen-region captures were deleted unviewed. The app now has a self-test mode (`apps/mac/scripts/selftest.sh`) that photographs only its own window. No full-screen or region captures in tests or tooling.

## Next

Phase 1, in parallel:
- Core: schema, layout, validator, compiler, `talkc`, source-edit API, with the unit, property, and round-trip suites (PLAN 12.2).
- Engine fixes (font stack, dash array) with regenerated goldens; the original fixture keeps its own engine copy.
- Finish the ISSTA port and diff against the full original.
