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

## Mechanical design guidance

- [GD&T intro](machine-design/concepts/gdt-intro.md) - Function, datums and inspectable tolerances.
- [Fits and clearances](machine-design/concepts/fits-clearances.md) - Worst-case limits and measured fit coupons.
- [Design for manufacturing and assembly](machine-design/concepts/dfm-overview.md) - Process, material, hardware and assembly decisions.
- [Manufacturing process checks](machine-design/concepts/dfm-process-guidelines.md) - Tool access, mold release, print orientation and qualification.
- [Sources and attribution](machine-design/SOURCES.md) - References used by these pages.

Use the listed resources for their stated scope, then consult the cited sources
for more detail. The bundle is guidance for design decisions; it does not supply
certified material allowables, standards tables or physical qualification.

## Hosted page

GitHub Pages builds from this bundle (see `.github/workflows/pages-knowledge.yml`).
Agents should prefer reading the Markdown files or bundled MCP resources.
