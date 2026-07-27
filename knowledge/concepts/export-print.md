---
type: Concept
title: Export and print
status: active
updated: 2026-07-27
---

# Export and print

Tracking: [#13](https://github.com/jackControls/noBS-CAD/issues/13) · ADR 0003

## Today

- STEP import
- AP242 STEP export in the **UI** (geometry interchange; not editable history)
- No 3MF on `main`
- No MCP `solid_export_3mf` / STEP MCP tools
- Theme/appearance dialog ≠ part materials/colors

## Required next

- **3MF** export from OCCT tessellation (preferred print package)
- **Materials and colors are core** for 3MF (not optional polish) — v1 may be per-body
- **STL** fallback; document that STL drops rich appearance
- MCP tools: `solid_export_3mf`, `solid_export_stl` (print focus — #10)
- Units in 3MF metadata where practical
- Golden fixture: colored cube → 3MF (quest path — #16)

3MF is the manufacturing mesh package; it does not replace STEP for CAD interchange.
