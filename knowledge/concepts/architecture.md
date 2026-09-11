---
type: Concept
title: Architecture
description: Kernel, shell, viewport, and project-file boundaries in noBS CAD.
status: stable
updated: 2026-09-11
---

# Architecture

## Kernel

- Rust crates: `core`, `sketch`, `solid` (host-neutral model logic)
- `occt` — native geometry adapter; `wasm` — browser adapter path
- Same planner code for desktop and MCP; live edits are routed to the owning
  desktop document through its session inbox

## Shells

- Desktop: Tauri 2 + React/TypeScript UI
- Desktop viewport: native Rust/Bevy; isolated script previews reuse its scene systems
- Browser build: WASM geometry adapter and Three.js viewport; useful for browser contracts

## Files

- `.nbcad` — editable project archive (may change in pre-alpha)
- STEP import / AP242 STEP export — CAD interchange
- 3MF print export with appearance/material metadata, plus STL fallback

These capabilities describe the development branch that bundles this knowledge;
older release snapshots can predate them. Ideal assembly constraints and rendered
geometry do not establish physical strength or printable fit.

Related: [Export & print](export-print.md), [MCP harness](mcp-harness.md),
and the longer [proposed architecture](../../docs/proposed-architecture.md).
