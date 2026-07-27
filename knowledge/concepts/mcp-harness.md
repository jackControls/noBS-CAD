---
type: Concept
title: MCP harness
status: active
updated: 2026-07-27
---

# MCP harness

`mcp-server/` provides `nbcad-mcp`: a stateful, stdio MCP server with granular sketch/solid tools and one persistent feature history per process.

## Why it matters

This is the **direct AI harness** — CAD for AI, built with AI — without a cloud service.

## Agent rules

1. Keep one process for a whole modeling session.
2. Use stable IDs from `solid_scene` / sketch tools for later ops.
3. Prefer MCP reproduction for geometry bugs.
4. Grow goal-level tools later; keep granular tools for fidelity.

See also `docs/agent-mcp.md` and `mcp-server/README.md` in the repository.
