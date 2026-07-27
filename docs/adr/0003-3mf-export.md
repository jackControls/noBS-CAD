# ADR 0003 — 3MF (and STL) print export

- Status: Proposed
- Date: 2026-07-27

## Context

Interchange today is STEP (AP242 export). Makers need slicer-friendly mesh packages. **3MF** is the preferred modern print format; STL remains ubiquitous.

Additive manufacturing is a **main project goal**. A print package that drops appearance data is incomplete for multi-material and painted/assigned-color workflows.

## Decision (proposed)

1. Add Rust export: OCCT tessellation → **3MF** primary, **STL** fallback.
2. Expose in UI (File export) and MCP (`solid_export_3mf`, `solid_export_stl`).
3. **Core requirement (not optional):** 3MF export must carry **materials and colors** when the model has them (body/face appearance, named materials). Round-trip enough metadata that a common slicer or 3MF viewer shows the intended colors/materials.
4. Preserve units and other useful metadata in 3MF when practical.
5. Keep STEP as CAD interchange; 3MF/STL are manufacturing outputs, not editable history.
6. STL remains a fallback for slicers that need it; STL will not preserve rich materials/colors — document that limit clearly.

## Consequences

- Document model must grow a clear appearance/material story (even if simple at first: per-body color + named material).
- 3MF writer choice must support the materials/colors part of the 3MF core/spec we target.
- Golden fixtures: unit cube **with color/material** → 3MF; plain cube → STL.
- MCP export tools should accept or reflect material/color state, not only geometry.

## Acceptance sketch

- [ ] Cube with an assigned color/material exports 3MF that shows that appearance in a common viewer/slicer
- [ ] Multi-body or multi-face color case documented (even if v1 is per-body only)
- [ ] STL path works for the same geometry; docs state color/material limits
- [ ] Units preserved in 3MF metadata where the format allows
- [ ] README / goals / export docs list materials and colors as core for 3MF
