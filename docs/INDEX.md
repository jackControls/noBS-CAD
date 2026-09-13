# Documentation

## Start using CAD

- [Install and make your first part](INSTALL.md) — download, run the fillet lesson,
  edit a dimension, then save and reopen the project.
- [Connect an MCP agent](INSTALL.md#connect-an-mcp-agent) — packaged server setup
  and a concrete first task.
- [Recipe library](../examples/scripts/README.md) — short lessons, assemblies and
  print-fit coupons.
- [Assemblies](ASSEMBLIES.md) — reusable parts, joints, motion and interference.
- [Drawings](2D_DRAWINGS.md) — sheets, dimensions and export coverage.
- [CAM](cam/README.md) — toolpaths, stock simulation, posts and safety limits.
- [Flagship designs and validation](flagship-examples.md) — bench, vise and turbine.
- [Engineering knowledge](../knowledge/index.md) — materials, gears, bearings,
  workholding and printing guidance, also available offline through MCP.

## Automate and author recipes

- [MCP interface](../mcp-server/README.md) — operations and current boundaries.
- [Native scripts](native-scripts.md) — construction source and presentation controls.
- [Live document ownership](mcp-harness.md) — discovery, attachment and ordered edits.
- [Shared product interface](interface.md) — groups and operation contracts.
- [Native drawing export](native-drawing-export.md) — SVG/DXF payloads and references.
- [Manufacturing export](manufacturing/INDEX.md) — STL/3MF implementation and validation.

## Contribute and develop

- [Developer setup](DEVELOPMENT.md) — the canonical build, native SDK and test guide.
- [Contributing](../CONTRIBUTING.md) and [edge-case hunt](EDGE_CASE_HUNT.md) — focused
  improvements and useful bug reproductions.
- [Project direction](goals.md) — reliability, performance and ease of use.
- [Architecture proposals](proposed-architecture.md) — future approaches and rationale.
- [Agent and maintainer guidance](agentic/INDEX.md) — disclosure, source installation
  and implementation contracts.

<details>
<summary>Specialist implementation references</summary>

- [CAM foundation](CAM.md) and [High Speed Roughing](CAM_ADAPTIVE.md).
- [OCCT packaging](OCCT_PACKAGING.md), [Windows packaging](WINDOWS_PACKAGING.md) and
  [Ubuntu packaging](LINUX_PACKAGING.md).
- [Windows native viewport debugging](WINDOWS_NATIVE_VIEWPORT_DEBUGGING.md).
- [Sketch constraint matrix](SKETCH_CONSTRAINT_PAIRWISE_MATRIX.md),
  [modeling selection](MODELING_VIEWPORT_SELECTION.md) and
  [viewport interaction](VIEWPORT_INTERACTION_THEME.md).
- [Icon provenance](ICON_PROVENANCE.md), [MCP milestones](../mcp-server/OKRs.md) and
  [presentation review](demo-presentation.md).

</details>

Shared agent guidance belongs in `docs/agentic/`. Editor-specific `AGENTS.md`
and `.cursor/` files remain gitignored under the repository's existing policy.
