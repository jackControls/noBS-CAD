---
type: Concept
title: MCP harness
status: active
updated: 2026-07-27
---

# MCP harness

`mcp-server/` provides `nbcad-mcp`: a **stdio** MCP server (offline, no cloud).
It is the primary AI harness — not a side demo.

Canonical design (after mission docs merge): `docs/mcp-harness.md`.  
Epic: [#9](https://github.com/jackControls/noBS-CAD/issues/9).

## Honest today

| Fact | Meaning |
|------|---------|
| Static ~100 tools, `listChanged: false` | Focus-scoped tools not shipped ([#10](https://github.com/jackControls/noBS-CAD/issues/10)) |
| Independent document per MCP process | **Fork of truth** vs UI ([#11](https://github.com/jackControls/noBS-CAD/issues/11)) |
| Single Tauri `main` window | Multi-window MCP routing not implemented ([#12](https://github.com/jackControls/noBS-CAD/issues/12)) |
| Same Rust planner + native OCCT as desktop | Crates shared; **instances** not shared yet |

Do not tell users “the agent edited your open part” until attach (#11) works.

## Target

1. Focus-scoped tools + `notifications/tools/list_changed` (#10).
2. `cad_list_sessions` / `cad_attach` to one live UI document (#11).
3. Broker routes by `window_id` / `document_id` (#12); headless CI may keep one process per doc.
4. In-the-loop: browser/UI + MCP on the same document (#15).

## Agent rules

1. Headless: one process for a modeling golden.
2. Use stable IDs from `solid_scene` / sketch tools.
3. Prefer MCP reproduction for geometry bugs.
4. After co-link: attach before claiming UI validation.
5. GPL neighbors (Open CAD Studio): ideas only (#19).

See also `docs/agent-mcp.md`, `mcp-server/README.md`.
