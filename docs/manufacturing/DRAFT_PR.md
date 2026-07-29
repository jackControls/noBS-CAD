# Draft PR — 3MF print export (for humans)

**Stacking:** merge **[PR #24](https://github.com/jackControls/noBS-CAD/pull/24)** (steerable MCP) first.
This draft builds on that tip and adds the **print pack** tools + writers.

## Plain-language goal

Agents (and the desktop app) should hand slicers a **real 3MF mesh package**,
not a STEP file that the slicer has to remesh.

| Format | Use it for |
|--------|------------|
| **3MF** | Additive / slicers (preferred) |
| **STL** | Simple mesh fallback (no materials) |
| **STEP** | CAD interchange only (already in #24) |

Opening STEP in Bambu/Orca often shows deflection dialogs and a tiny triangle
count — that is the **slicer remeshing CAD**, not a print package from noBS.

## What agents get (MCP print pack)

After #24’s soft disclosure, focus `print` advertises:

| Tool | What it returns |
|------|-----------------|
| `solid_export_3mf` | Base64 ZIP 3MF (mm, colors, optional slicer Metadata). **Prefer this.** |
| `solid_export_stl` | Base64 binary STL (no appearance) |
| `material_catalog` | Built-in filament presets (brand / type / color ids) |
| `solid_export_step` | Base64 AP242 STEP (CAD handoff; keep using for CAD tools) |

### Typical agent recipe

1. Model (or `cad_attach` a UI session from #24’s file bridge).
2. Optional: `cad_set_focus` → `print`.
3. Optional: `material_catalog` then set body appearance in the document.
4. Call `solid_export_3mf` with `slicer_target` (`bambu_studio` default, or
   `orca_slicer` / `prusa_slicer` / `cura` / `standard`).
5. Decode `bytes_base64` → write `.3mf` → open in the slicer with
   **Import / drag onto plate** (not “Open Project” if you want to keep your
   printer profile).

Response shape:

```json
{
  "format": "3mf",
  "encoding": "base64",
  "bytes_base64": "UEsDB...",
  "slicer_target": "bambu_studio"
}
```

## What humans get (desktop)

- Export **3MF** / **STL** from the UI
- Body filament / appearance picker (brand catalog)
- Same slicer targets as MCP
- Docs under `docs/manufacturing/`

## Under the hood (shared)

- New `crates/export` writers + smoke fixtures (cube + print-in-place latch)
- OCCT tessellation → one 3MF object per body
- UI and MCP share `ExportFacade` (same bytes path)

## Status

| Item | State |
|------|--------|
| Export crate + unit tests | Done |
| MCP `solid_export_3mf` golden (`PK` ZIP) | Done |
| Print-pack disclosure tags | Done (on top of #24) |
| UI export + appearance panel | Included; needs desktop smoke |
| Manual slicer open (KR3.6) | Checklist in `VALIDATION.md` |
| Rebase onto `main` after #24 merges | Pending |

## Out of scope (v1)

- 3MF import
- Full sliced G-code.3mf / AMS machine pairing
- Guaranteeing vendor filament IDs never change

Refs: #13, #9, #24.
