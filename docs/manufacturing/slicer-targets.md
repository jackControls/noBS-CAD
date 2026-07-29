# Slicer targets

`MeshExportRequest.slicer_target` controls Metadata alongside consortium 3MF.

| Target | Package contents |
|--------|------------------|
| `standard` | `3D/3dmodel.model` + `m:basematerials` |
| `bambu_studio` (default) | + `Metadata/project_settings.config` (filament_* arrays, X1C/P1S/A1/H2D-compatible printer list) + `model_settings.config` (per-object extruder) |
| `orca_slicer` | Same Metadata shape; Application / printer_model tagged Orca |
| `prusa_slicer` | + `Metadata/Slic3r_PE.config` filament arrays + `Slic3r_PE_model.config` object/volume extruder metadata (required — PS ignores basematerials) |
| `cura` | Consortium `basematerials` + `Metadata/cura_materials.json` hint list |

## What this is / is not

**Is:** model-only 3MF that opens with recognizable filament colors/slots in brand slicers.  
**Is not:** a full sliced project (no G-code, wipe tower, AMS pairing, or process profiles). Users still pick a printer profile in the slicer.

## Research notes

Bambu/Orca store filament colours in `project_settings.config` parallel arrays (`filament_type`, `filament_colour`, `filament_ids`, …). Prefer **Import 3MF / drag onto plate** over Open Project when you want colors without overwriting the user’s printer profile (Orca/Bambu behavior). Per-triangle `paint_color` is for painted multi-material — out of scope until face materials exist.

PrusaSlicer historically **ignores** consortium `basematerials` (see [prusa3d/PrusaSlicer#4503](https://github.com/prusa3d/PrusaSlicer/issues/4503)). Extruder assignment must come from `Metadata/Slic3r_PE_model.config` object/volume `metadata key="extruder"` entries, plus filament arrays in `Slic3r_PE.config`. Painting uses `slic3rpe:mmu_segmentation` (out of scope for body-level v1).

Cura primarily maps colors from consortium materials; `cura_materials.json` is a hint list for tooling.