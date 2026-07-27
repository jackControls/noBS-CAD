# ADR 0003 — 3MF (and STL) print export

- Status: Proposed
- Date: 2026-07-27

## Context

Interchange today is STEP (AP242 export). Makers need slicer-friendly mesh packages. **3MF** is the preferred modern print format; STL remains ubiquitous. (Request wording “3ml” interpreted as **3MF**.)

## Decision (proposed)

1. Add Rust export: OCCT tessellation → **3MF** primary, **STL** fallback.
2. Expose in UI (File export) and MCP (`solid_export_3mf`, `solid_export_stl`).
3. Preserve units/metadata in 3MF when practical.
4. Keep STEP as CAD interchange; 3MF/STL are manufacturing outputs, not editable history.

## Consequences

- New dependencies / packaging for 3MF writers
- Golden fixture: unit cube export smoke test
- Optional later: mesh repair hints, thin-wall warnings

## Acceptance sketch

- [ ] Cube via MCP/API exports valid 3MF opened by a common slicer
- [ ] STL path works for the same body
- [ ] Docs updated in README + knowledge/concepts/export-print.md
