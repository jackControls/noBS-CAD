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

## Hosted page

GitHub Pages builds from this bundle (see `.github/workflows/pages-knowledge.yml`).
Agents should prefer reading the Markdown files or bundled MCP resources.
