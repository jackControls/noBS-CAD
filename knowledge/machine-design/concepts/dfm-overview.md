---
type: Concept
title: DFM overview
description: Design-for-manufacturing principles and workflow — distilled from CC BY DFM OERs.
status: draft
updated: 2026-09-11
topics: dfm, dfa, manufacturing
keywords: DFM, DFA, DFMA, part count, tolerance cost, process selection
related_recipes: turbine-fit-coupons, d-screw-vise-fit, garden-bench, vertical-axis-turbine, d-screw-vise
sources: nwtc-guns-dfm, palni-dfma, doe-3d
---

# DFM overview

**Design for manufacturing (DFM)** means choosing geometry a real process can
make repeatably. **DFA** is the assembly counterpart (access, fastener count,
error-proofing). Decide the process early; it changes minimum radii, walls,
draft, splits, and tolerances.

Primary distillation: Bryan Guns, NWTC LibreTexts *Design for Various
Manufacturing Methods* (**CC BY 4.0**); PALNI *Design for Manufacture and
Assembly* (**CC BY 4.0**). Do not copy Boothroyd proprietary timing tables.

## Core principles

1. **Minimize part count** — combine features when motion, material, or service
   access does not require a separate part.
2. **Standardize** — prefer purchased / catalog hardware and common stock.
3. **Simplify processes** — fewer setups, special tools, and secondary ops.
4. **Design for assembly** — grasp, orient, insert; symmetry and self-alignment help.
5. **Material–process fit** — pick materials the process likes (weldable, moldable, printable).
6. **Tolerances that earn their keep** — tight only where function needs it; see [GD&T](gdt-intro.md).
7. **Cut secondary operations** — design so paint, grind, or drill are not mandatory.

## Workflow

Conceptual design → **process selection** (volume, material, complexity) →
detailed design under process rules → prototype/validate → feedback → release.

Engage manufacturing early. Document trade-offs.

## Process map

See [DFM process guidelines](dfm-process-guidelines.md) for injection molding,
casting, sheet metal, welding, EDM, and CNC heuristics.

## In noBS CAD

Flagship recipes are manufacturing **candidates**. Replay and drawings are
software evidence. Fit coupons bridge to a specific printer and material.

## Further reading (link only)

- [UArk Jensen — Mechanical Design & Manufacturing](https://uark.pressbooks.pub/mechanicaldesign/) — CC BY-NC survey
- [MIT OCW 2.008](https://ocw.mit.edu/courses/2-008-design-and-manufacturing-ii-spring-2025/) — CC BY-NC-SA process physics

Related: [Fits & clearances](fits-clearances.md), [Materials vocabulary](materials-vocabulary.md),
[SOURCES](../SOURCES.md).
