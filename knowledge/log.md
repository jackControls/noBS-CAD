# noBS CAD knowledge update log

## 2026-09-11

- **Machine-design help**: scaffolded `knowledge/machine-design/` (taxonomy,
  SOURCES with stable ids, six seed concepts), distill-vs-link policy,
  adversarial review fixes (preferred-fit table removed, SA link-only,
  Rule #1 / checklist honesty, DFM attribution), and help-search ADR
  (Rust `nbcad-help` + in-process Tantivy; Node help scripts transitional).
- **Validation**: `check:help-sources` + `build:help-index` (to be replaced by
  Rust `nbcad-help check|export` — see ADR).

## 2026-07-29

- **Update**: Aligned the bundle with OKF v0.2 and current `main`.
- **Validation**: Added automated structure and internal-link checks.

## 2026-07-28

- **Update**: Aligned concepts with maintainer feedback — goals vs proposals,
  co-link first / multi-window deferred, and agent steering files kept internal.

## 2026-07-27

- **Creation**: Seeded the bundle from the README product stance and MCP docs.
