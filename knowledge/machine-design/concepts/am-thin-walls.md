---
type: Concept
title: AM thin walls and print orientation
description: FDM min wall, thin-wall traps, layer-line anisotropy, and bed-face orientation before locking geometry.
status: draft
updated: 2026-09-20
topics: dfam, am, fdm, dfm, print
keywords: thin wall, min wall, FDM, anisotropy, print orientation, overhang
related_recipes: turbine-fit-coupons
sources: nwtc-guns-dfm, doe-3d
---

# AM thin walls and print orientation

For fused deposition (FDM/FFF) and similar layer processes, **wall thickness**
and **print orientation** decide whether a feature survives the printer — not
only whether the solid is manifold.

**Attribution:** process habits adapted from Guns / NWTC LibreTexts DFM
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) and DOE Module 3D
(public domain). Numbers below are **starting guidance**, not shop standards.

## Min wall (role-based)

- Pick a **process min wall** from nozzle, layer height, material, and slicer
  (often on the order of a few nozzle widths for reliable skins — confirm with
  your profile; treat this page as orientation guidance, not a universal millimeter rule).
- Apply min wall **per role**: outer shell, cavity wall, rib, boss, clip beam,
  hinge web. Deep pockets and seats subtract from parent walls — compute
  remaining thickness after every cut.
- Avoid sudden thick-to-thin jumps that trap heat or tear at layer bonds.
- Thin fins parallel to the nozzle path print differently from fins across
  layers; treat orientation as part of the thickness decision.

Trap pattern: a deep seat or wire window that leaves a paper-thin remaining
wall on one side. Section before commit. Snap seats: see
[AM snap-fits](am-snap-fit.md).

## Print orientation

Choose the bed face for:

1. **Accuracy** — critical flats and hole axes relative to Z.
2. **Strength** — load direction vs layer planes (**anisotropy**).
3. **Support** — overhangs, bridges, and cleanup cost.
4. **Cosmetics** — layer lines on visible faces.

**Layer lines / anisotropy:** tensile and bending strength along layers often
differ sharply from strength across layers. Prefer putting primary tension in
plane with layers when the part allows. Flexures and living hinges need an
explicit bend-vs-layer plan.

Keep **anisotropy** distinct from **draft** (taper for demold / support peel /
sliding mates). Draft lives on
[AM ribs, gussets, and draft](am-ribs-gussets-draft.md); both may apply, but
they answer different questions.

## Holes and mating features

Printed holes often shrink relative to CAD. Prefer **role-based allowances**
(clearance / locate / press) and [fit coupons](fits-clearances.md) over one
global XY compensation. Export orientation must match the qualification print —
see [export and print](../../concepts/export-print.md).

## CAD-time checklist

1. Name process + nozzle + material before freezing thin features.
2. Section every deep pocket; list remaining walls.
3. State bed face and why (accuracy / strength / support).
4. Coupon thin walls, snaps, and critical fits before committing the assembly.

Related: [DFM process guidelines](dfm-process-guidelines.md) (additive bridge),
[additive workholding](../../concepts/additive-workholding.md).
