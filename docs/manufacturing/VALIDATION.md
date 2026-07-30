# Manufacturing export validation

## Automated (required before merge)

```sh
cargo test -p nbcad-core -p nbcad-export -p nbcad-sketch --lib
```

Expect:

- appearance serde defaults + round-trip
- STL header + triangle count
- 3MF `unit="millimeter"` + basematerials color
- Bambu `Metadata/project_settings.config` filament_colour / filament_vendor
- Prusa `Metadata/Slic3r_PE.config`
- Orca metadata present
- Cura `Metadata/cura_materials.json` + basematerials
- catalog JSON parse + Bambu/Prusa/Sunlu/eSun/Anycubic presets (≥40 entries)
- project round-trip scrubbing orphan appearances

Work from dedicated worktree `C:\Users\jeffg\dev\noBS-CAD-mfg-export`. With OCCT:

```powershell
$env:OCCT_ROOT = "$PWD\vcpkg_installed\x64-windows"
$env:PATH = "$env:OCCT_ROOT\bin;$env:PATH"
cargo test --manifest-path mcp-server/Cargo.toml
```

## Manual slicer smoke (KR3.6)

Regenerate fixtures: `cargo test -p nbcad-export write_manual_smoke_fixtures --lib`

Then open from `crates/export/fixtures/smoke/`:

1. **`print_in_place_latch_bambu.3mf`** → **Bambu Studio** (Import / drag onto plate) — black housing + red bolt, two filament slots; slice & print, then slide the bolt.
2. **`print_in_place_latch_prusa.3mf`** → **PrusaSlicer** — same mechanism with PE metadata.
3. Optional: `*_orca.3mf`, `*_cura.3mf`, or simple `cube_*.3mf` colour checks.
4. App path: Extrude box → Bambu PLA Basic Red → Export 3MF; Export STL (appearance warning); Export STEP (no color expectation).

Record date/app versions when checking off GitHub issue #13.
