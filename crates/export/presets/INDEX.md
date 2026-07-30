# Filament presets

**Source of truth:** `catalog.json` in this folder.

| File | Role |
|------|------|
| [INDEX.md](INDEX.md) | This file |
| [OKRs.md](OKRs.md) | Pointer to manufacturing OKRs |
| `catalog.json` | Brand filament presets (synced to `src/materials/catalog.json` by `build.rs`) |

Do not invent a second catalog schema. Add rows here; cargo build of `nbcad-export` mirrors to the UI.
