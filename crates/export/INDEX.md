# nbcad-export

Manufacturing mesh writers + filament catalog + slicer Metadata.

| Path | Role |
|------|------|
| [INDEX.md](INDEX.md) | This file |
| [OKRs.md](OKRs.md) | Pointer → docs/manufacturing/OKRs.md |
| [presets/INDEX.md](presets/INDEX.md) | Catalog folder index |
| `build.rs` | Mirrors `presets/catalog.json` → `src/materials/catalog.json` |
| `src/lib.rs` | Public API + tests |
| `src/facade.rs` | `ExportFacade` |
| `src/threemf.rs` | 3MF ZIP + slicer Metadata |
| `src/stl.rs` | Binary STL |
| `src/slicer.rs` | `SlicerTarget` |
| `src/materials.rs` | Catalog loader |
| `src/pip_demo.rs` | Print-in-place T-slot latch demo meshes |
| `presets/catalog.json` | Filament presets (source of truth) |
| [fixtures/INDEX.md](fixtures/INDEX.md) | Manual slicer smoke `.3mf` samples |

```sh
cargo test -p nbcad-export --lib
```
