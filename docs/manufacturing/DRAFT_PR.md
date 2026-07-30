# Draft PR — 3MF print export (for humans)



**Scope:** standalone A+ PR on `feat/3mf-print-export` — soft MCP disclosure,

native 3MF/STL export, and the MCP print pack. Not stacked on PR #24.



## Plain-language goal



Agents (and the desktop app) should hand slicers a **real 3MF mesh package**,

not a STEP file that the slicer has to remesh.



| Format | Use it for |

|--------|------------|

| **3MF** | Additive / slicers (preferred) |

| **STL** | Simple mesh fallback (no materials) |

| **STEP** | CAD interchange only |



Opening STEP in Bambu/Orca often shows deflection dialogs and a tiny triangle

count — that is the **slicer remeshing CAD**, not a print package from noBS.



## What agents get (MCP print pack)



With focus `print` (or via `cad_list_all_tools`):



| Tool | What it returns |

|------|-----------------|

| `solid_export_3mf` | Base64 ZIP 3MF (mm, colors, optional slicer Metadata). **Prefer this.** |

| `solid_export_stl` | Base64 binary STL (no appearance) |

| `material_catalog` | Built-in filament presets (brand / type / color ids) |

| `body_appearances` | Current per-body color/filament assignments |

| `set_body_appearance` | Assign filament — prefer `body_id` + `preset_id` |

| `solid_export_step` | Base64 AP242 STEP (CAD handoff; keep using for CAD tools) |



Slicer Metadata (Bambu/Orca/Prusa/Cura) = **compatible hints on import**, not a

full pre-sliced project.



### Typical agent recipe



1. Model headlessly (or `cad_attach` a read-only session snapshot).

2. Optional: `cad_set_focus` → `print`.

3. `material_catalog` → `set_body_appearance` with `body_id` + `preset_id`.

4. Call `solid_export_3mf` with `slicer_target` (`bambu_studio` default, or

   `orca_slicer` / `prusa_slicer` / `cura` / `standard`).

5. Decode `bytes_base64` → write `.3mf` → open in the slicer with

   **Import / drag onto plate** (not “Open Project” if you want to keep your

   printer profile).



Rebuild and point MCP clients at the release binary after code changes:



```powershell

cargo build --release --manifest-path mcp-server/Cargo.toml

```



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

- PIP demo fixtures use AABB clearance smoke checks (≥ 0.4 mm), not full DFM validation



## Status



| Item | State |

|------|--------|

| Export crate + unit tests | Done |

| MCP `solid_export_3mf` golden (`PK` ZIP) | Done |

| Print-pack disclosure tags | Done |

| UI export + appearance panel | Included; needs desktop smoke |

| Manual slicer open (KR3.6) | Checklist in `VALIDATION.md` |



## Out of scope (v1)



- 3MF import

- Full sliced G-code.3mf / AMS machine pairing

- Guaranteeing vendor filament IDs never change



Refs: #13, #9.

