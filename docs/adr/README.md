# Architecture Decision Records

Lightweight ADRs for cross-cutting recommendations and decisions. Each record
states its own status. Long design prose lives in `docs/mcp-harness.md` and
`docs/proposed-architecture.md`.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-rust-shared-engine.md) | Rust for the shared engine and platform-neutral features | Proposed |
| [0002](0002-bevy-viewport.md) | Bevy as viewport/ECS subsystem | Proposed — **defer** |
| [0003](0003-3mf-export.md) | 3MF (+ STL) with materials/colors | Proposed target |
| [0005](0005-main-goals.md) | High-level product directions | Accepted |
| [0006](0006-dynamic-mcp-focus.md) | Focus-scoped MCP + UI co-link | Proposed; multi-window **deferred** |

Treat proposed and deferred ADRs as reviewable direction, not permission to
start them ahead of reliable mechanical CAD and local MCP fundamentals.
