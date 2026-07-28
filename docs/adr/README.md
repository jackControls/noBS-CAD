# Architecture Decision Records

Lightweight ADRs for cross-cutting recommendations. Each file is a **proposal**
until accepted. Long design prose lives in `docs/mcp-harness.md` and
`docs/proposed-architecture.md` (mission PR).

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-rust-everywhere.md) | Rust everywhere for cross-platform | Proposed |
| [0002](0002-bevy-viewport.md) | Bevy as viewport/ECS subsystem | Proposed — **defer** |
| [0003](0003-3mf-export.md) | 3MF (+ STL) with materials/colors | Proposed target |
| [0004](0004-rename.md) | Project rename shortlist | Proposed — **defer** |
| [0005](0005-main-goals.md) | High-level product directions | Proposed |
| [0006](0006-dynamic-mcp-focus.md) | Focus-scoped MCP + UI co-link | Proposed; multi-window **deferred** |

Merge after the mission/MCP harness docs PR so goals and proposed-architecture
docs exist. Do not start Bevy or rename ahead of reliable CAD + local MCP
fundamentals.
