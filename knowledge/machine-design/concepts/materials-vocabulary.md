---
type: Concept
title: Materials vocabulary
description: Property vocabulary for CAD-time talk — modulus, yield, fatigue, CTE — not certified allowables or MatWeb scrapes.
status: draft
updated: 2026-09-20
topics: materials, dfm, manufacturing
keywords: modulus, yield, fatigue, CTE, density, alloy, polymer, Sy, Sut, hardness, endurance, corrosion, allowables, filament
related_recipes: turbine-fit-coupons, garden-bench
sources: kittycad-materials
---

# Materials vocabulary

Defines **words** for CAD-time decisions — not certified allowables. Materials
Project is crystalline DFT data, not shop steel charts. Prefer KittyCAD JSON as
a *pattern* only (`kittycad-materials`). Filament appearance in the manufacturing
catalog is not an engineering allowables table.

## Symbols you will actually say (SI primary)

| Symbol / word | Meaning | CAD habit |
|---------------|---------|-----------|
| **E** | Elastic modulus (stiffness) | Stiff vs flexible; deflection talk |
| **Sy / Sut** | Yield / ultimate tensile | Prefer datasheet values over color |
| **Hardness** | Process / wear proxy | Not a substitute for Sy |
| **Fatigue / endurance** | Repeated loads | Geometry + surface dominate |
| **CTE** | Thermal expansion | Mixed-material stacks move |
| **Density** | Mass and print time | Envelope vs mass goals |
| **Corrosion / chemical** | Environment | Coatings, stainless vs plated |

## Classes you will specify

Carbon steels, alloy steels, stainless, aluminum, copper alloys, engineering
plastics, composites, elastomers. Each class **couples to a process** (weld,
machine, mold, print). Naming a class without a process is incomplete.

## Checklist before freezing a material callout

1. **Process first** — CNC bar, sheet, FDM filament, injection resin?
2. **Environment** — wet, UV, solvents, food-adjacent, elevated temp?
3. **Load story** — static, cyclic, impact, press-fit hoop stress?
4. **Mating materials** — galvanic pairs, CTE mismatch, galling.
5. **Purchased vs printed** — catalog stock beats mystery filament claims.
6. **Say “educational range ≠ allowable”** on any numeric teaching value.

## Open data rules

- Prefer cited, licensed datasets (for example KittyCAD `material-properties`,
  Apache-2.0) as a **pattern**, not as certified allowables.
- Prefer link-out datasheets; keep MatWeb/MakeItFrom outside the repo.
- Educational ranges are not design allowables. Say so on the page and in
  answers that quote numbers.

## Preferred material callouts

- Name filament/resin with process notes (nozzle, temp, orientation) before locking ABS vs PETG
- Keep help-page teaching ranges in the notebook; put drawing allowables only from a cited datasheet
- Specify alloy/grade from stock or datasheet text — viewport metal color is display only

## Pair with process pages

When the class is plastic/AM, open [AM thin walls](am-thin-walls.md) and
[warpage / flatness](am-warpage-cooling-flatness.md). When metal stock,
open [DFM process guidelines](dfm-process-guidelines.md) for the cut/form
family before inventing exotic alloys.


## Allowables honesty checklist

Materials **vocabulary** is not an allowables table. Before quoting a number:

1. **Name the dataset** (vendor datasheet, ASTM/ISO grade sheet, KittyCAD JSON pattern) — prefer a cited source over “someone said 70 MPa.”
2. **Say the condition** — heat treat, print orientation, moisture, temperature, strain rate.
3. **Separate E / Sy / Sut / fatigue** — prefer tensile data over hardness-as-Sy.
4. **Prefer cited datasheets / licensed datasets** over MatWeb/MakeItFrom scrapes in the repo or drawing title block.
5. **Mark educational ranges** as educational; shipping allowables come from the responsible engineer’s approved source.
6. **Couple material ↔ process** — FDM PETG ≠ injection PET; 6061-T6 bar ≠ cast “aluminum.”
7. **CTE / galvanic / chemical** called out when mixed stacks exist.
8. **Mass/density** only after envelope is real; density does not fix a bad load path.

## Freeze gate

- [ ] Process named (stock / print / mold / fab)
- [ ] Environment and load story named
- [ ] Mating materials / coatings noted
- [ ] No untitled strength number on the drawing
- [ ] Filament strength claims backed by a datasheet or coupon, not appearance

Related: [DFM overview](dfm-overview.md), [Fasteners & joints](fasteners-joints.md),
[AM thin walls](am-thin-walls.md), [SOURCES](../SOURCES.md).
