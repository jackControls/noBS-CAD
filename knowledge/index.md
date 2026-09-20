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
- [MCP harness](concepts/mcp-harness.md) - Headless/live routing and engineering resources.
- [Agent MCP workflow](concepts/agent-mcp-workflow.md) - Tenacity, cad_help-first, soft focus, recipes.
- [Research before commit](concepts/research-before-commit.md) - VERIFY table and local help before freezing geometry.
- [Assembly interference check](concepts/assembly-interference.md) - Geometric overlap/clearance at solved poses vs fit classes.
- [Validate before show](concepts/validate-before-show.md) - Mandatory review shot pack; reject blank/inside-solid frames.
- [Adversarial mesh audit](concepts/adversarial-mesh-audit.md) - Manifold, wall probes, shards; printable-solid gate.
- [Contribution process](concepts/process.md) - Lightweight contribution and review expectations.
- [Export & print](concepts/export-print.md) - Interchange, print export and qualification boundaries.
- [Gear identification and compatible pairs](concepts/gears.md) - Module/DP, OD limits, pressure angle, ratio changes and mounting.
- [Additive workholding](concepts/additive-workholding.md) - Captured guides, assembly access, D-flat roots and qualification.
- [Small wind rotors and low-speed generators](concepts/small-wind-generators.md) - Power, startup, gearing, motor dimensions and measured loads.
- [Bearing supports and axial retention](concepts/bearing-stacks.md) - Hardware variants, inner-race contact, spacer stacks and low-drag assembly.

## Read through MCP

The native MCP server embeds this Markdown corpus at build time. Prefer **`cad_help`**
(`search` → `get` / `topics`) for discovery — snippet-first with locked caps (search
default 5 / max 10, snippet ~280 chars, get 12 KiB, topics page 50). Use standard
`resources/list` then `resources/read` with a returned URI (for example
`nbcad://knowledge/index.md`) when the full page is needed. Resources are read-only
and available without a checkout or network connection. They describe the bundled
source revision; rebuild to pick up later knowledge changes.

Resolve links between knowledge pages relative to the current resource URI:
from `nbcad://knowledge/concepts/gears.md`, `additive-workholding.md` means
`nbcad://knowledge/concepts/additive-workholding.md`. Links starting `../../docs/`
or `../../mcp-server/` identify supporting paths in a checkout of the same source
revision; they are not additional MCP resources. External HTTPS sources can be
opened separately when network access is available.

## Machine design

Open design-time help (GD&T, elements, mechanisms, materials, DFM).
Prefer **seeded** pages via `cad_help` before web search; see taxonomy for **planned**
gaps. Provenance: [SOURCES](machine-design/SOURCES.md).

- [Taxonomy](machine-design/taxonomy.md) - Topic map for the domain KB.
- [Sources](machine-design/SOURCES.md) - License and provenance table.
- [GD&T intro](machine-design/concepts/gdt-intro.md) - Datums and feature control frames.
- [Fits & clearances](machine-design/concepts/fits-clearances.md) - Clearance, locational, interference.
- [Fasteners & joints](machine-design/concepts/fasteners-joints.md) - Preload and purchased hardware.
- [Materials vocabulary](machine-design/concepts/materials-vocabulary.md) - Properties for CAD choices.
- [DFM overview](machine-design/concepts/dfm-overview.md) - Process families and heuristics.
- [DFM process guidelines](machine-design/concepts/dfm-process-guidelines.md) - Molding, cast, sheet, weld, EDM, CNC.
- [AM snap-fits](machine-design/concepts/am-snap-fit.md) - Cantilever clips, latches, living hinges.
- [AM thin walls](machine-design/concepts/am-thin-walls.md) - FDM min wall, anisotropy, print orientation.
- [Fillet vs chamfer](machine-design/concepts/fillet-chamfer.md) - When to blend vs bevel.
- [Alignment nubs vs pins](machine-design/concepts/alignment-nubs-pins.md) - Locator class: short AM nubs/socks vs pins/dowels.
- [AM clamshell retainer](machine-design/concepts/am-clamshell-retainer.md) - Slide-fit first, then optional detents.

Use the listed resources for their stated scope, then consult the cited sources
for more detail. The bundle is guidance for design decisions; it does not supply
certified material allowables, standards tables or physical qualification.

## Hosted page

GitHub Pages builds from this bundle (see `.github/workflows/pages-knowledge.yml`).
Agents should prefer `cad_help` or bundled MCP resources over scraping the hosted HTML.
