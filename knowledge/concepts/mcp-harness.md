---
type: Concept
title: MCP harness
description: Current local MCP behavior and proposed UI co-link milestones.
status: stable
updated: 2026-07-29
---

# MCP harness

`mcp-server/` provides `nbcad-mcp`: a **stdio** MCP server for local
automation and testing (no required cloud).

Canonical notes: [MCP harness](../../docs/mcp-harness.md).
Proposals: [proposed architecture](../../docs/proposed-architecture.md).

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

See also the [MCP playbook](../../docs/agent-mcp.md) and
[server documentation](../../mcp-server/README.md).
