# Filament presets

**Source of truth:** `catalog.json` in this folder.

| File | Role |
|------|------|
| [Manufacturing objectives](../../../docs/manufacturing/OKRs.md) | Material catalog contract |
| `catalog.json` | Brand filament presets; source for `src/materials/catalog.json` |

After editing the catalog, sync the UI mirror explicitly:

```sh
cargo test -p nbcad-export --lib materials::tests::regen_frontend_catalog_mirror -- --ignored --exact
```

Normal builds do not modify the mirror; export tests check that it matches.
