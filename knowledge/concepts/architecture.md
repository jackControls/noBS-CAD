---
type: Concept
title: Architecture
status: active
updated: 2026-07-28
---

# Architecture

## Kernel

- Rust crates: `core`, `sketch`, `solid` (host-neutral model logic)
- `occt` — native geometry adapter; `wasm` — browser adapter path
- Same planner code for desktop and MCP — not yet the same session

## Shells

- Desktop: Tauri 2 + React/TypeScript UI
- Viewport today: Three.js; Bevy is a deferred proposal
- Browser build: useful for e2e / Playwright

## Files

- `.nbcad` — editable project archive (may change in pre-alpha)
- STEP import / AP242 STEP export — CAD interchange
- 3MF (+ materials/colors) — **target**, not current functionality

Related: [Export & print](export-print.md), [MCP harness](mcp-harness.md),
`docs/proposed-architecture.md`.
