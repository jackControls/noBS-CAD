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

## Read actual slicer evidence

Keep the exported geometry and native placement identifiable by hash. Record
the printer, nozzle, material and process profile, then inspect actual G-code:
each intended part must start on the bed, remain inside the selected nozzle's
printable area and have a coherent first-layer footprint. Keep warnings and
support paths separate; disabling support guarantees neither a printable roof
nor a warning-free result.

For a horizontal passage, inspect the final overhanging wall against the prior
layer, including line width and print order. A short transverse bridge on the
following layer cannot support a long wall already printed in air. Conversely,
a long move labeled as a bridge may cross existing infill rather than one
equally long empty span. Measure the actual unsupported region and its anchors.

Where clearance permits, tangent sloped roof faces can preserve a circular
tool envelope while limiting each layer's inward step. A small flat ceiling
can retain more roof stock than a pointed peak. Check both the retained
clearance and remaining material, then reslice the native geometry; do not
silently alter critical fits using a slicer's geometry-changing options.

Short bridges still depend on material, cooling, speed and flow.
[Prusa's bridging guidance](https://help.prusa3d.com/article/poor-bridging_1802)
describes those process tradeoffs. A toolpath review cannot establish sag,
adhesion or strength; print and measure a representative feature before claiming
physical qualification.

See [goals](../../docs/goals.md) for the accepted direction and
[proposed architecture](../../docs/proposed-architecture.md) for ideas that
have not shipped.
