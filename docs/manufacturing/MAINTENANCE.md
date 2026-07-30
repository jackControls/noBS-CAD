# Maintaining manufacturing export (agent guide)

Tracked public guidance (do not invent a root `AGENTS.md` — that filename is gitignored by policy).

## Worktree

Manufacturing export WIP lives in a **dedicated git worktree**, not the primary checkout:

`C:\Users\jeffg\dev\noBS-CAD-mfg-export` → branch `issue/13-manufacturing-export`

Primary `C:\Users\jeffg\dev\noBS-CAD` stays on `main` (or other work). Do not stash/pop manufacturing changes across branches in the primary tree. OCCT/vcpkg may be junctioned from the primary install (`vcpkg_installed`, `.vcpkg`).

## Edit order

1. **Schema** — `crates/core/src/appearance.rs` (additive serde defaults only; no schema bump).
2. **Writers / catalog** — `crates/export/` (`lib`, `threemf`, `stl`, `slicer`, `materials`, `facade`).
3. **Catalog sync** — edit only `crates/export/presets/catalog.json`, then run `cargo test -p nbcad-export regen_frontend_catalog_mirror -- --ignored --exact`. The normal export tests verify that `src/materials/catalog.json` remains identical without mutating the source tree during a build.
4. **Hosts** — `crates/sketch` persistence, `crates/occt` tessellate, `src-tauri`, `mcp-server`.
5. **UI** — `BodyAppearancePanel`, `projectFiles`, i18n, store.
6. **Docs** — update this folder’s INDEX/OKRs/VALIDATION when behavior changes.

## Invariants

- UI and MCP must call `ExportFacade` / shared `MeshExportRequest` — no third exporter.
- STEP must not invent colors.
- Orphan `body_appearances` scrubbed on save/commit.
- Browser mesh export may remain stubbed until explicit parity work.

## Tests to run

See [VALIDATION.md](VALIDATION.md).

## Cursor rule

Project rule: `.cursor/rules/manufacturing-export.mdc` (globs for export/appearance paths).
