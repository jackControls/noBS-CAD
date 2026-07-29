# ADR 0003 — 3MF (and STL) print export

- Status: Proposed
- Date: 2026-07-27
- Tracking: [#13](https://github.com/jackControls/noBS-CAD/issues/13)
- Related: [product directions](../goals.md), MCP print focus in ADR 0006,
  tutor quests [#16](https://github.com/jackControls/noBS-CAD/issues/16)

## Context

Interchange today is STEP (AP242 export in the UI). Makers need slicer-friendly
mesh packages. **3MF** is the preferred modern print format; STL remains ubiquitous.

Additive manufacturing is a **main project goal**. A print package that drops
appearance data is incomplete for multi-material and painted/assigned-color
workflows.

**Today:** no 3MF writer on `main`; no MCP export tools for 3MF/STEP;
`AppearanceDialog` is theme-only (not part materials). MCP has
`cad_project_model` / `cad_load_project_model` only for model IO.

## Decision (proposed)

1. Add Rust export: OCCT tessellation → **3MF** primary, **STL** fallback.
2. Expose in UI (File export) and MCP (`solid_export_3mf`, `solid_export_stl`).
3. **Core requirement (not optional):** 3MF export must carry **materials and
   colors** when the model has them (body/face appearance, named materials).
   Round-trip enough metadata that a common slicer or 3MF viewer shows the
   intended colors/materials.
4. Preserve units and other useful metadata in 3MF when practical.
5. Keep STEP as CAD interchange; 3MF/STL are manufacturing outputs, not editable history.
6. STL remains a fallback; STL will not preserve rich materials/colors — document that.
7. v1 appearance model may be **per-body color + named material**; document the limit.

## Consequences

- Document model must grow appearance/material DTOs (not theme UI).
- 3MF writer must support the materials/colors part of the targeted 3MF spec.
- Golden fixtures: unit cube **with color/material** → 3MF; plain cube → STL.
- MCP print focus (#10) should surface these tools when focus = `print`.

## Acceptance sketch

- [ ] Cube with assigned color/material → 3MF shows appearance in a common viewer/slicer
- [ ] Multi-body or multi-face color case documented (even if v1 is per-body only)
- [ ] STL path for same geometry; docs state color/material limits
- [ ] Units preserved in 3MF metadata where the format allows
- [ ] MCP tools present; golden fixture in CI/MCP
- [ ] README / goals / export docs list materials and colors as core for 3MF
