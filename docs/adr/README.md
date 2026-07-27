# Architecture Decision Records

Lightweight ADRs for cross-cutting recommendations. Each file is a proposal
until accepted in an issue/PR discussion.

**Working design prose** for MCP lives in `docs/mcp-harness.md` (mission /
harness docs PR). These ADRs stay short decision records — avoid duplicating
long design text here.

| ADR | Title | Status | Tracking |
|-----|-------|--------|----------|
| [0001](0001-rust-everywhere.md) | Rust everywhere for cross-platform | Proposed | CI [#14](https://github.com/jackControls/noBS-CAD/issues/14) |
| [0002](0002-bevy-viewport.md) | Bevy as viewport/ECS subsystem | Proposed — **defer** | [#20](https://github.com/jackControls/noBS-CAD/issues/20) |
| [0003](0003-3mf-export.md) | 3MF (+ STL) with materials/colors | Proposed | [#13](https://github.com/jackControls/noBS-CAD/issues/13) |
| [0004](0004-rename.md) | Project rename shortlist | Proposed — **defer** | [#21](https://github.com/jackControls/noBS-CAD/issues/21) |
| [0005](0005-main-goals.md) | Seven main goals | Proposed | epic [#9](https://github.com/jackControls/noBS-CAD/issues/9) |
| [0006](0006-dynamic-mcp-focus.md) | Focus-scoped MCP + co-link / multi-window | Proposed | [#10](https://github.com/jackControls/noBS-CAD/issues/10) [#11](https://github.com/jackControls/noBS-CAD/issues/11) [#12](https://github.com/jackControls/noBS-CAD/issues/12) |

Merge after the mission/MCP harness docs PR so `docs/mcp-harness.md` and
`docs/goals.md` exist. Do **not** start Bevy (#20) or rename (#21) before P0
harness issues (#10–#12).
