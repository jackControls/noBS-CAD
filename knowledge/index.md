---
okf_version: "0.2"
---

# noBS CAD — Open Knowledge Format (OKF) index

Portable knowledge bundle for humans and agents. Specification:
[Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).

Keep concepts **thin**. Longer material lives in the repository’s
[goals](../docs/goals.md), [MCP harness notes](../docs/mcp-harness.md),
[proposed architecture](../docs/proposed-architecture.md), and
[machine-design KB notes](../docs/machine-design-kb.md).

## Concepts

- [Product stance](concepts/product-stance.md) - Local-first mechanical CAD priorities.
- [Architecture](concepts/architecture.md) - Kernel, shell, and project-file boundaries.
- [MCP harness](concepts/mcp-harness.md) - Current local automation behavior and proposed next steps.
- [Contribution process](concepts/process.md) - Lightweight contribution and review expectations.
- [Export & print](concepts/export-print.md) - Current interchange support and additive targets.

## Machine design

Open design-time help (GD&T, elements, mechanisms, materials, DFM).
Prefer **seeded** pages before web search; see taxonomy for **planned** gaps. Provenance: [SOURCES](machine-design/SOURCES.md).

- [Taxonomy](machine-design/taxonomy.md) - Topic map for the domain KB.
- [Sources](machine-design/SOURCES.md) - License and provenance table.
- [GD&T intro](machine-design/concepts/gdt-intro.md) - Datums and feature control frames.
- [Fits & clearances](machine-design/concepts/fits-clearances.md) - Clearance, locational, interference.
- [Fasteners & joints](machine-design/concepts/fasteners-joints.md) - Preload and purchased hardware.
- [Materials vocabulary](machine-design/concepts/materials-vocabulary.md) - Properties for CAD choices.
- [DFM overview](machine-design/concepts/dfm-overview.md) - Process families and heuristics.
- [DFM process guidelines](machine-design/concepts/dfm-process-guidelines.md) - Molding, cast, sheet, weld, EDM, CNC.

## Hosted page

GitHub Pages builds from this bundle (see `.github/workflows/pages-knowledge.yml`).
Agents should prefer reading these markdown files directly from the repo.
