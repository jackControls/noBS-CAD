---
type: Concept
title: MCP harness
description: Current local MCP behavior and proposed UI co-link milestones.
status: stable
updated: 2026-08-21
---

# MCP harness

`mcp-server/` provides `nbcad-mcp`: a **stdio** MCP server for local
automation and testing (no required cloud).

Canonical notes: [MCP harness](../../docs/mcp-harness.md).
Proposals: [proposed architecture](../../docs/proposed-architecture.md).

## Honest today

| Fact | Meaning |
|------|---------|
| Soft focus-scoped tools, `listChanged: true` | Guidance, not a jail. Out-of-focus tools stay callable. [#10](https://github.com/jackControls/noBS-CAD/issues/10) |
| Independent document per MCP process | **Fork of truth** vs the visible UI. `cad_submit` is UI-owned apply (inbox); still not in-process shared memory; `model.json` writeback forbidden. [#11](https://github.com/jackControls/noBS-CAD/issues/11) |
| Same Rust planner + native OCCT as desktop | Shared crates; separate instances |
| No multi-window routing | One process, one document. [#12](https://github.com/jackControls/noBS-CAD/issues/12) |
| No in-the-loop UI+MCP on the same doc | Blocked on co-link. [#15](https://github.com/jackControls/noBS-CAD/issues/15) |

Use MCP as an engine/automation probe until UI co-link exists.

## Proposed next

1. Attach MCP to **one** live UI document ([#11](https://github.com/jackControls/noBS-CAD/issues/11))
2. Multi-window routing ([#12](https://github.com/jackControls/noBS-CAD/issues/12))
3. In-the-loop browser+MCP CI ([#15](https://github.com/jackControls/noBS-CAD/issues/15))

See also the [MCP playbook](../../docs/agent-mcp.md) and
[server documentation](../../mcp-server/README.md).
