---
type: Concept
title: Export and print
description: CAD interchange, mesh print export, preflight and physical qualification boundaries.
status: stable
updated: 2026-09-11
---

# Export and print

## Development branch

- STEP import
- AP242 STEP export in the UI
- 3MF from OCCT tessellation, with body appearance/material metadata
- STL fallback without the same appearance metadata
- Mesh preflight and explicit selection/assembly placement for print export

## Choose and verify

Keep `.nbcad` for editable project history and STEP for CAD interchange. Prefer
3MF for a print package, then inspect scale, body selection, orientation and
slicer interpretation. A manifold mesh, material name or successful preflight
does not validate strength, support strategy, fit or manufacturing settings.
Qualify mating parts with process-specific samples; see
[additive workholding](additive-workholding.md).

Older release snapshots can predate these exports. Read the operation catalog
and export result for the running version rather than assuming every format
preserves all project or assembly information.

See [goals](../../docs/goals.md) for the accepted direction and
[proposed architecture](../../docs/proposed-architecture.md) for ideas that
have not shipped.
