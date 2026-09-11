---
type: Concept
title: Machine-design taxonomy
description: Topic map for the open machine-design knowledge base (users and agents).
status: draft
updated: 2026-09-11
---

# Machine-design taxonomy

Open help for **design-time** decisions in noBS CAD. Product/architecture
concepts stay in [the OKF index](../index.md). This map is the domain
layer: GD&T, machine elements, mechanisms, materials, and DFM.

Agents should search these pages (and later MCP help tools) **before** the
web. Standards text is never copied; see [SOURCES](SOURCES.md).

## A. Geometric product definition

- Plus/minus vs GD&T intent
- Datums, datum reference frames, degrees of freedom
- Form, orientation, location, runout (concept-level)
- Feature control frames (how to read)
- MMC / LMC / bonus tolerance (concept)
- Fits and clearances
- Drawing vs model-based definition (tie to native drawing sheets)

Seed: [GD&T intro](concepts/gdt-intro.md), [Fits & clearances](concepts/fits-clearances.md).

## B. Machine elements

- Fasteners and joints
- Shafts, keys, retaining rings
- Bearings (selection language and fits, not a catalog dump)
- Springs, seals, couplings (overview)
- Power screws / lead screws

Seed: [Fasteners & joints](concepts/fasteners-joints.md).
Recipes: `d-screw-vise`, `garden-bench`.

## C. Mechanisms

- Linkages (four-bar types, Grashof)
- Gears, cams, belts/chains, screw mechanisms
- Mobility / DOF counting
- Product joints: revolute, slider, cylindrical, planar, ball, universal, pin-slot, screw

Recipe: `vertical-axis-turbine` (constrained spur drive).

## D. Materials

- Property vocabulary (stiffness, strength, fatigue, CTE, corrosion)
- Classes: steels, aluminum, stainless, plastics, composites
- Process–material coupling
- Open data sources and citation rules

Seed: [Materials vocabulary](concepts/materials-vocabulary.md).

## E. Design for manufacturing

- Process families: CNC, sheet, casting, injection mold, additive, welding
- DFM / DFA heuristics per process
- Tolerance versus cost
- DFAM notes for printable flagships
- Inspection / metrology basics (bridge to GD&T)

Seed: [DFM overview](concepts/dfm-overview.md),
[DFM process guidelines](concepts/dfm-process-guidelines.md).
Recipes: `turbine-fit-coupons`, `d-screw-vise-fit`.

## F. Design hygiene

- Requirements → embodiment → detail
- Purchased versus designed parts
- BOM and hardware callouts
- Educational disclaimers (software evidence ≠ physical qualification)

## Live examples

Scripted recipes are the screen source (`note` / `view` in `.nbcad.jsonc`).
KB articles name recipe ids; they do not invent a second demo runtime.
See [machine-design KB notes](../../docs/machine-design-kb.md).
