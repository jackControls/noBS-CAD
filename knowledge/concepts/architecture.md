---
type: Concept
title: Architecture
status: active
updated: 2026-07-27
---

# Architecture

## Kernel

- Rust crates: `core`, `sketch`, `solid`, `occt`, `wasm`
- Native B-rep via OCCT 7.9.x (`crates/occt`)
- Same planner/history for desktop and MCP

## Shells

- Desktop: Tauri 2 + React/TypeScript UI
- Viewport today: Three.js (desktop migration candidate: Bevy as display/ECS subsystem — not a B-rep replacement)
- Browser build: useful for e2e; not the long-term primary UX

## Files

- `.nbcad` — editable project archive (format may change in pre-alpha)
- STEP import / AP242 STEP export — interchange
- Planned: 3MF (+ STL) for print mesh export

Related: [Export & print](export-print.md), [MCP harness](mcp-harness.md).
