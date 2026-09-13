---
type: Concept
title: Materials vocabulary
description: Stub — property vocabulary for CAD; not an allowables database.
status: draft
updated: 2026-09-11
topics: materials
keywords: modulus, yield, fatigue, CTE, density, alloy, polymer
related_recipes: []
sources: kittycad-materials
---

# Materials vocabulary

> **Stub.** Defines words, not certified allowables. Materials Project is
> crystalline DFT data — not shop steel charts. Prefer KittyCAD JSON as a
> *pattern* only (`kittycad-materials`).


Pick materials with **properties and process**, not only a viewport color.
Filament appearance in the manufacturing catalog is not an engineering
allowables table.

Useful symbols (SI primary):

- **E** — elastic modulus (stiffness)
- **Sy / Sut** — yield / ultimate tensile strength
- **Hardness** — process and wear proxy, not a substitute for Sy
- **Fatigue / endurance** — repeated loads; geometry and surface matter
- **CTE** — thermal expansion; mixed-material stacks move
- **Density** — mass and print time
- **Corrosion / chemical** — environment, coatings, stainless vs plated

Classes you will actually specify: carbon steels, alloy steels, stainless,
aluminum, copper alloys, engineering plastics, composites, and elastomers.
Each class couples to processes (weld, machine, mold, print).

## Open data rules

- Prefer cited, licensed datasets (for example KittyCAD
  `material-properties`, Apache-2.0) as a **pattern**, not as certified
  allowables.
- Do not scrape MatWeb or MakeItFrom into the repo.
- Educational ranges are not design allowables. Say so on the page.

Related: [DFM overview](dfm-overview.md), [Fasteners & joints](fasteners-joints.md),
[SOURCES](../SOURCES.md).
