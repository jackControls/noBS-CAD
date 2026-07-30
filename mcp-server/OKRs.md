# OKRs — mcp-server

Parent directions: [../docs/goals.md](../docs/goals.md) · As-built:
[../docs/mcp-harness.md](../docs/mcp-harness.md).

## M1 — Soft steerable surface (branch)

| KR | Target | Status |
|----|--------|--------|
| M1.1 | Default advertised tools ≪ full catalog in `dynamic` mode | On `feat/3mf-print-export` |
| M1.2 | Out-of-focus tools stay callable | On branch |
| M1.3 | 105 modeling tools tagged in disclosure matrix | On branch |
| M1.4 | Pack matrix CI (list + per-pack representatives) | On branch |

## M2 — Escape hatch (branch)

| KR | Target | Status |
|----|--------|--------|
| M2.1 | `full_static` advertises full registry | On branch |
| M2.2 | `cad_list_all_tools` always available | On branch |

## M3 — Headless sessions (partial)

| KR | Target | Status |
|----|--------|--------|
| M3.1 | `cad_list_sessions` / `cad_attach` read-only load | On branch |
| M3.2 | Live UI co-link / snapshot bridge | Proposed — not shipped |

## M4 — Print export (branch)

| KR | Target | Status |
|----|--------|--------|
| M4.1 | `solid_export_3mf` / STL / STEP + `material_catalog` | On branch |
| M4.2 | Slicer Metadata = compatible hints, not full project | By design |

## M5 — Operability

| KR | Target | Status |
|----|--------|--------|
| M5.1 | `cargo test --manifest-path mcp-server/Cargo.toml` with OCCT | Required for merge |
| M5.2 | `.github/workflows/mcp-server.yml` | Required path |
