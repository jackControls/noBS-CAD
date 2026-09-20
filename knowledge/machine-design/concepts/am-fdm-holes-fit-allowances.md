---
type: Concept
title: FDM holes and printed-fit allowances
description: Role-based clearance, locate, and press allowances for FDM printed holes; prefer coupons; XY shrink habits without universal mm tables.
status: draft
updated: 2026-09-20
topics: dfam, am, fdm, fits, clearances, print
keywords: FDM hole, printed hole, hole shrink, XY compensation, clearance hole print, press fit print, locate fit FDM, printed-fit allowance
related_recipes: turbine-fit-coupons, d-screw-vise-fit, revolved-spacer
sources: nwtc-guns-dfm, doe-3d, nist-gdt-2
---

# FDM holes and printed-fit allowances

Printed FDM holes often finish **undersize** relative to CAD, especially in the
XY plane, and behave differently when the hole axis is vertical vs horizontal.
Treat fit as a **role + process pair**, not a single global offset.

**Attribution:** process habits from Guns / NWTC DFM
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) and DOE Module 3D
(public domain). Fit-class vocabulary aligns with
[fits & clearances](fits-clearances.md) (NIST / Berez teaching rewrite,
CC BY 4.0). **No invented universal millimeter charts** — numbers you see in
vendor notes or shop folklore are **starting guidance**; lock on coupons.

## Role-based intent (say the role out loud)

| Role | Intent for a printed hole | CAD habit |
|------|---------------------------|-----------|
| **Clearance** | Fastener or shaft always passes / spins with gap | Oversize CAD hole vs mating OD; leave cleanup stock only if you will ream/drill |
| **Locate** | Snug alignment (transition / locational feel) | Near nominal; prefer pins/dowels or post-machine if repeatability matters |
| **Press / interference** | Always grips (insert, bearing, pin) | Undersize vs mating OD **or** design crush features; heat-set inserts often win over raw plastic press |

Say whether an allowance is **radial** or **diametral**. Mixing those is a
common print-to-part bug. Same nominal on a reamed metal hole and an as-printed
FDM hole are not the same fit.

## XY shrink and orientation habits (no fake tables)

- **As-printed circles in XY** often shrink toward the toolpath centerline;
  horizontal (side) holes add overhang/teardrop effects —
  [supports & overhangs](am-supports-overhangs.md).
- Prefer **role-based CAD allowances** and physical coupons over one global
  “XY compensation %” that silently changes every other feature.
- If you use slicer hole/XY compensation, **document it** on the coupon that
  qualified the assembly — export orientation must match
  ([export & print](../../concepts/export-print.md)).
- Thin walls around holes: remaining wall after the bore still must meet min
  wall ([thin walls](am-thin-walls.md)).
- Vertical holes (axis ≈ Z) and horizontal holes need **separate** coupons when
  both appear in one part.

## Prefer coupons before locking

1. Print a **hole ladder** or mating pin/shaft coupon in the same material,
   nozzle, layer height, and orientation as the product feature.
2. Measure ID vs CAD; record radial/diametral clearance for clearance / locate /
   press roles you actually use.
3. Update CAD allowances from that evidence — not from a blog table.
4. Re-coupon when material, nozzle, or major slicer profile changes.

Hub for recipe links: [fit coupons map](fit-coupons-recipes-map.md). Fit class
language: [fits & clearances](fits-clearances.md).

## Related hardware patterns

- Screw clearance / counterbore roles:
  [fastener clearance & counterbore](fastener-clearance-counterbore.md)
- Heat-set insert bores: [AM heat-set inserts](am-heat-set-inserts.md)
- Captive nuts: [captive nut / hex trap](captive-nut-hex-trap.md)
- Hole feature vs sketched hole in CAD:
  [hole wizard vs modeled](hole-wizard-vs-modeled.md)

## CAD-time checklist

1. Name hole **role** (clearance / locate / press) and mating part.
2. State print **orientation** of the hole axis vs bed.
3. Check remaining wall and boss around the bore.
4. Plan a coupon; do not freeze critical printed fits from CAD alone.

Related: [DFAM FDM overview](dfam-fdm-overview.md),
[SOURCES](../SOURCES.md).
