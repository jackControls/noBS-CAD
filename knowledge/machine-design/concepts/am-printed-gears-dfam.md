---
type: Concept
title: Printed gears — FDM DFAM
description: FDM/printed gear DFAM — orientation vs tooth load, min tooth thickness vs nozzle, backlash as coupon; no invented module strength tables.
status: draft
updated: 2026-09-20
topics: dfam, am, fdm, mechanisms, print
keywords: printed gear, FDM gear, DFAM gear, tooth orientation, layer anisotropy gear, min tooth thickness, nozzle width tooth, backlash coupon, module, spur print
related_recipes: turbine-fit-coupons, revolved-spacer
sources: nwtc-guns-dfm, doe-3d, mit-272
---

# Printed gears — FDM DFAM

Printing a **spur (or similar) gear** does not change gear **compatibility**
rules — same module/DP and pressure angle still apply — but FDM adds
**orientation**, **min feature vs nozzle**, and **backlash-as-coupon** decisions
you must lock before freezing product teeth.

Pair identity and centre-distance math live on
[gears](../../concepts/gears.md). This page is the **DFAM layer** for printed
teeth. Hub: [DFAM for FDM overview](dfam-fdm-overview.md). Load vs layers:
[FDM load / layers / infill](am-fdm-load-layers-infill.md).

**Attribution:** process habits from Guns / NWTC LibreTexts DFM
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) and DOE Module 3D
(public domain); mechanism framing link-out `mit-272`. **No invented module →
strength tables** — treat blogs that quote “module X holds Y N·m in PLA” as
anecdotes; lock duty on orientation-matched coupons or prefer purchased gears.

## Golden path (CAD-time)

1. **Identify the pair first** — `z`, module/DP, PA, centre distance, face width
   from [gears](../../concepts/gears.md). Printed or not, mates need compatible
   tooth form.
2. **Choose bed face vs tooth load** — prefer primary **tooth bending / rim
   tension in-plane with layers** when the part allows (avoid peeling teeth off
   across Z). Trade against hub accuracy, bore axis, and supports
   ([load / layers](am-fdm-load-layers-infill.md),
   [thin walls / orientation](am-thin-walls.md)).
3. **Min tooth thickness vs nozzle** — tip and root must survive several
   perimeter passes; tiny module + fat nozzle → missing tips. Prefer a module
   the nozzle can resolve, or a purchased pinion against a printed wheel when
   duty matters.
4. **Shells carry teeth** — perimeters and skins form the tooth; do not treat
   infill % as a gear allowable ([load / layers](am-fdm-load-layers-infill.md)).
5. **Backlash as coupon** — print a short mesh coupon (or product-like pair) at
   the intended orientation and centre distance; measure/feel backlash and tip
   clearance before freezing. Do not invent a universal “printed backlash =
   0.X mm” table ([fits](fits-clearances.md),
   [fit coupons map](fit-coupons-recipes-map.md)).
6. **Hub / bore / retention** — bore shrink and set-screw creep are printer-
   specific; qualify like other printed fits
   ([FDM holes](am-fdm-holes-fit-allowances.md),
   [bearing stacks](../../concepts/bearing-stacks.md),
   [shafts / keys](shafts-keys-retaining-rings.md)). See mounting notes on
   [gears](../../concepts/gears.md).
7. **Export orientation** must match the qualification print
   ([export & print](../../concepts/export-print.md)).

## Orientation patterns (prefer)

| Situation | Prefer |
|-----------|--------|
| Continuous mesh, tooth bending dominates | Bed face so tooth load is **in-layer**; bore may be vertical or horizontal — pick the trade consciously |
| Hub/bore accuracy dominates low load | Orient for round bore / clean hub; still coupon tooth strength |
| High duty / wear / precision ratio | **Purchased** metal or molded gear; printed for prototypes or light duty only |
| Tiny teeth vs nozzle | Increase module, reduce nozzle, or buy the pinion |

## Prefer instead

| Temptation | Prefer |
|------------|--------|
| Module → torque or %infill → strength charts in CAD notes | Coupon mesh at product orientation; cite datasheet for purchased gears |
| Freeze centre distance from a pretty render | Lock centres after a mesh coupon (or purchased gear drawing) |
| Orient teeth so layers peel “to support less” | Bed face so tooth bending is **in-layer** when mesh duty matters |
| Catalog plastic gear rating on a home FDM print | Treat FDM as prototype/light duty unless coupon proves otherwise |

## CAD-time checklist

1. Pair identity recorded (module/DP, PA, `z`, centre distance).
2. Bed face stated with tooth-load rationale.
3. Min tip/root vs nozzle sanity-checked.
4. Backlash/mesh coupon planned at product orientation.
5. Hub/bore/retention path named (set screw, clamp, key, press).
6. Duty: printed OK vs purchase preferred — explicit.

Related: [gears](../../concepts/gears.md),
[DFAM FDM overview](dfam-fdm-overview.md),
[FDM load / layers / infill](am-fdm-load-layers-infill.md),
[mechanisms overview](mechanisms-overview.md),
[chains / sprockets](mechanisms-chains-sprockets.md),
[belts & pulleys](mechanisms-belts-pulleys.md),
[taxonomy](../taxonomy.md).
