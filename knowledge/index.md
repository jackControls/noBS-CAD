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
- [MCP harness](concepts/mcp-harness.md) - Headless/live routing and engineering resources.
- [Contribution process](concepts/process.md) - Lightweight contribution and review expectations.
- [Export & print](concepts/export-print.md) - Interchange, print export and qualification boundaries.
- [Gear identification and compatible pairs](concepts/gears.md) - Module/DP, OD limits, pressure angle, ratio changes and mounting.
- [Additive workholding](concepts/additive-workholding.md) - Captured guides, assembly access, D-flat roots and qualification.
- [Small wind rotors and low-speed generators](concepts/small-wind-generators.md) - Power, startup, gearing, motor dimensions and measured loads.
- [Bearing supports and axial retention](concepts/bearing-stacks.md) - Hardware variants, inner-race contact, spacer stacks and low-drag assembly.

## Read through MCP

The native MCP server embeds this Markdown corpus at build time. Use standard
`resources/list` to discover titles and descriptions, then `resources/read` with
the returned URI, for example `nbcad://knowledge/concepts/gears.md`. Resources are
read-only and available without a checkout or network connection. They describe
the bundled source revision; rebuild to pick up later knowledge changes.

Resolve links between knowledge pages relative to the current resource URI:
from `nbcad://knowledge/concepts/gears.md`, `additive-workholding.md` means
`nbcad://knowledge/concepts/additive-workholding.md`. Links starting `../../docs/`
or `../../mcp-server/` identify supporting paths in a checkout of the same source
revision; they are not additional MCP resources. External HTTPS sources can be
opened separately when network access is available.

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
Agents should prefer reading the Markdown files or bundled MCP resources.
