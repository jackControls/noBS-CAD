---
type: Concept
title: MCP harness
status: active
updated: 2026-07-28
---

# MCP harness

`mcp-server/` provides `nbcad-mcp`: a **stdio** MCP server for local
automation and testing (no required cloud).

Canonical notes (after mission docs merge): `docs/mcp-harness.md`.  
Proposals: `docs/proposed-architecture.md`.

## Honest today

| Fact | Meaning |
|------|---------|
| Static ~100 tools, `listChanged: false` | Focus-scoped tools not shipped |
| Independent document per MCP process | Fork of truth vs the visible UI |
| Same Rust planner + native OCCT as desktop | Shared crates; separate instances |

Use MCP as an engine/automation probe until UI co-link exists.

## Proposed next

1. Focus-scoped tools + `notifications/tools/list_changed`
2. Attach MCP to **one** active UI document (first milestone)
3. Multi-window routing later if needed (not P0)

See also `docs/agent-mcp.md`, `mcp-server/README.md`.
