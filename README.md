# SAGE Talk Editor

Native macOS editor and presenter for "film with checkpoints" talks, with Claude embedded.
See PLAN.md for the design, phases, and testing strategy.

- `packages/engine`  talk.js engine, theme, editor overlay (shared by every surface)
- `packages/core`    talk format: schema, layout, compiler, validator, source edits, `talkc`
- `packages/sidecar` Node process the Mac app talks to: core services + Claude Agent SDK bridge
- `apps/mac`         SwiftUI/AppKit app
- `skill/`           academic-talk-film skill (v1 baseline, v2 in progress)
- `fixtures/`        `issta26-original` is a read-only copy of the real ISSTA 2026 deck
- `spikes/`          Phase 0 experiments; findings in `docs/phase0-memo.md`
