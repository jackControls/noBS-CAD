# Draft PR notes — 3MF print export (human summary)

## Why this exists

Slicers (Bambu Studio, Orca, PrusaSlicer, Cura) want **mesh packages**, not CAD
B-rep. Exporting **STEP** and opening it in a slicer forces the slicer to
remesh. That often looks broken: few triangles, “split compound” dialogs, and
no filament/profile metadata.

noBS CAD already has solid STEP for CAD interchange. This work adds the
**additive print path**: tessellate in-app → write **standard 3MF** (mm) with
materials and optional slicer Metadata (“profiles” in the filament/hint sense).

## What “3MF with profiles” means here

| Included | Not included (v1) |
|----------|-------------------|
| Consortium 3MF geometry + basematerials colors | Full sliced G-code.3mf projects |
| Per-body objects (not one fused mystery compound) | AMS machine pairing / wipe-tower authoring |
| Slicer Metadata targets: Bambu / Orca / Prusa / Cura | Claiming vendor filament IDs never go stale |
| Filament catalog + body appearance in `.nbcad` | 3MF **import** |

Use **Import / drag onto plate** in Bambu — not “Open Project” — if you want to
keep your existing printer profile.

## Depends on MCP landing first

**Depends on PR #24** (steerable MCP disclosure + file-bridge).

This branch is stacked on that tip so the print pack can advertise:

- `solid_export_3mf` (preferred for slicers)
- `solid_export_stl` (fallback mesh)
- `material_catalog`
- `solid_export_step` (keep for CAD handoff)

## How to try (once UI/MCP binaries are built)

1. Model a part (or attach a session).
2. Assign filament appearance (UI panel) or accept defaults.
3. Export 3MF with `slicer_target: bambu_studio` (or Orca/Prusa/Cura/standard).
4. Open in the slicer → Import → verify bodies/colors/slots.

Fixtures under `crates/export/fixtures/smoke/` are ready for manual smoke.
