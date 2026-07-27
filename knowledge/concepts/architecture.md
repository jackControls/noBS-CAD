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
- Same **planner/history code** for desktop and MCP — not yet the same **session**
  ([#11](https://github.com/jackControls/noBS-CAD/issues/11))

## Shells

- Desktop: Tauri 2 + React/TypeScript UI (today: one window label `main`)
- Viewport today: Three.js
- Bevy as display/ECS subsystem: proposed, **deferred**
  ([#20](https://github.com/jackControls/noBS-CAD/issues/20)) — not a B-rep replacement; after MCP co-link
- Browser build: Playwright e2e; WASM + OpenCascade.js (different kernel path than native MCP)

## Multi-window

Central product requirement ([#12](https://github.com/jackControls/noBS-CAD/issues/12)):
several windows/docs; MCP must address which window/document. Product lean:
stdio **broker**. Headless: one MCP per doc is fine.

## Files

- `.nbcad` — editable project archive (format may change in pre-alpha)
- STEP import / AP242 STEP export — CAD interchange
- Planned: 3MF (+ STL) with **materials and colors** core
  ([#13](https://github.com/jackControls/noBS-CAD/issues/13))

ADRs: `docs/adr/` (architecture ADRs PR). Related:
[Export & print](export-print.md), [MCP harness](mcp-harness.md).
