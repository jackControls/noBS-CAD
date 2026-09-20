---
type: Concept
title: AM cable exits, wire windows, and strain relief
description: Design wire windows and cable exits for FDM enclosures so insulation survives assembly, flex, and print — with intentional strain relief.
status: draft
updated: 2026-09-20
topics: enclosures, cables, dfam, am, fdm
keywords: cable exit, strain relief, grommet, wire window, cord grip
related_recipes: turbine-fit-coupons, mounting-plate
sources: nwtc-guns-dfm, doe-3d, palni-dfma
---

# AM cable exits, wire windows, and strain relief

A **wire window** is not leftover air after a pocket. It is a named feature with
an exit face, a minimum aperture for the cable bundle, edge treatment, and a
**strain-relief** plan so tug loads do not land on solder joints or thin walls.

**Attribution:** DFAM / enclosure hygiene adapted from Guns / NWTC LibreTexts
DFM ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) and DOE Module
3D (public domain). Heuristics only — confirm with cable OD, jacket, and a
flex coupon.

## Name the exit class

| Class | Intent |
|-------|--------|
| **Open window / slot** | Service access; cable may be free to move |
| **Sized aperture** | Passes plug or ferrule once; limited play |
| **Channel / labyrinth** | Cable path inside the shell before exit |
| **Grommet / bushing seat** | Soft interface; printed bore holds purchased grommet |
| **Integrated strain relief** | Printed clip, comb, or tie-down that clamps the jacket |

Pick one primary class before cutting. Mixing “random slot + hope” fails
insulation and print walls together.

## Geometry checklist

1. **Bundle envelope** — measured OD (or max connector) + print/assembly
   allowance; do not size to bare conductor.
2. **Remaining wall** — after the window, every adjacent shell must stay ≥
   process min ([AM thin walls](am-thin-walls.md)).
3. **Edge treatment** — chamfer or fillet entry/exit so jacket does not saw on
   a knife edge ([fillet vs chamfer](fillet-chamfer.md)).
4. **Split-line story** — if the cable is trapped at close, plan which half
   owns the channel and how the mating half closes without pinching.
5. **Strain relief** — clamp or tie the **jacket** to the case so tension never
   reaches the joint; leave a service loop when rework matters.
6. **Orientation** — prefer exits that avoid sharp Z stair-steps on the jacket
   path; support strategy for overhanging lips —
   [supports & overhangs](am-supports-overhangs.md).

## Strain relief roles

- **Tie-down boss / slot** — zip-tie or lacing path molded into the shell.
- **Comb / labyrinth** — increases friction length without crushing.
- **Purchased cord grip / grommet** — name the part; model the seat, not the
  rubber details ([hardware pocket research](am-hardware-pocket-research.md)).
- **Cover clamp** — clamshell or plate that sandwiches the jacket when closed
  ([clamshell retainer](am-clamshell-retainer.md)).

Say which role carries pull, bend, and twist. One feature rarely does all three.
