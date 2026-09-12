---
okf_version: "0.2"
---

# noBS CAD — Open Knowledge Format (OKF) index

Portable knowledge bundle for humans and agents. Specification:
[Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).

Keep concepts **thin**. Longer material lives in the repository’s
[goals](../docs/goals.md), [MCP harness notes](../docs/mcp-harness.md), and
[proposed architecture](../docs/proposed-architecture.md).

## Concepts

- [Product stance](concepts/product-stance.md) - Local-first mechanical CAD priorities.
- [Architecture](concepts/architecture.md) - Kernel, shell, and project-file boundaries.
- [MCP harness](concepts/mcp-harness.md) - Current local automation behavior and proposed next steps.
- [Contribution process](concepts/process.md) - Lightweight contribution and review expectations.
- [Export & print](concepts/export-print.md) - Current interchange support and additive targets.

## Machine design (domain help)

Open design-time help (GD&T, elements, mechanisms, materials, DFM).
Prefer **seeded** pages before web search; see taxonomy for **planned** gaps.

- [Taxonomy](machine-design/taxonomy.md) - Seeded vs planned topic map.
- [SOURCES](machine-design/SOURCES.md) - Provenance ids and licenses.
- [GD&T intro](machine-design/concepts/gdt-intro.md) - Datums, FCF, Rule #1 teaching.
- [Fits and clearances](machine-design/concepts/fits-clearances.md) - Class-level fits (no designation charts).
- [DFM overview](machine-design/concepts/dfm-overview.md) - Process families and heuristics.
- [DFM process guidelines](machine-design/concepts/dfm-process-guidelines.md) - Molding, cast, sheet, weld, EDM, CNC.
- [Fasteners and joints](machine-design/concepts/fasteners-joints.md) - Stub — threaded joints overview.
- [Materials vocabulary](machine-design/concepts/materials-vocabulary.md) - Stub — property words, not allowables.

Notes: [machine-design KB](../docs/machine-design-kb.md),
[distill vs link](../docs/machine-design-distill-vs-link.md),
[help search ADR](../docs/machine-design-help-search.md).

## Hosted page

GitHub Pages builds from this bundle (see `.github/workflows/pages-knowledge.yml`).
Agents should prefer reading these markdown files directly from the repo.
