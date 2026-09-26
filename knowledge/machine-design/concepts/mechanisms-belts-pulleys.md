---
type: Concept
title: Belts and pulleys (CAD-time)
description: Center distance, wrap, tension path, and idler roles; prefer purchased belt profiles — no invented pitch or tension charts.
status: draft
updated: 2026-09-20
topics: mechanisms, machine-elements, shafts, bearings
keywords: belt, timing belt, V-belt, HTD, GT2, pulley, sheave, center distance, wrap angle, idler, tensioner, flange, belt profile, synchronous belt
related_recipes: revolved-spacer, vertical-axis-turbine, turbine-fit-coupons, mounting-plate
sources: mit-272, doe-3d, nasa-bearing
---

# Belts and pulleys (CAD-time)

**Belts** transmit rotary motion (and often ratio) across a **center distance**
with a tension path you can sketch. CAD owns pulley envelopes, flanges, shaft
seats, and idler locations; belt **pitch / profile / length** and tension
procedure stay on the supplier — prefer purchased timing or V-belt systems over
inventing tooth charts in Help.

**Attribution:** drive-layout roles aligned with MIT OCW
[2.72 Elements of Mechanical Design](https://ocw.mit.edu/courses/2-72-elements-of-mechanical-design-spring-2009/)
(`mit-272`, CC BY-NC-SA — **link-out only**); rotating-seat hygiene with
public-domain NASA bearing notes. No belt-length calculators or tension tables
here.

## Vocabulary

| Term | Meaning |
|------|---------|
| **Timing / synchronous belt** | Toothed belt + matching pulley profile (e.g. GT2, HTD families) — **name the profile** |
| **V-belt / flat** | Friction drives; different wrap and tension story than timing |
| **Center distance** | Shaft-to-shaft spacing; primary envelope driver |
| **Wrap angle** | Belt contact on a pulley; idlers often exist to add wrap |
| **Idler / tensioner** | Pulley that sets path, wrap, or tension — fixed or spring-loaded |
| **Flange** | Side wall that keeps the belt on the pulley |

## CAD-time checklist

1. **Name the belt family** — timing profile (purchased) vs V/flat. Prefer a
   catalog belt + pulley pair before modeling decorative teeth
   ([gears](../../concepts/gears.md) when teeth mesh on shafts instead).
2. **Lock center distance** — driver/driven shaft centers, adjustment slot or
   fixed span, and how tension will be taken up.
3. **Wrap and path** — sketch the belt centerline; add idlers when wrap on a
   small pulley is insufficient or the path must clear structure.
4. **Tension path** — who moves (motor plate, idler arm, jack screw)? Leave
   tool access and lock after set ([power screws](power-screws-lead-screws.md)
   when a screw tensions).
5. **Pulley envelope** — OD, width, flanges, hub, bore/key
   ([shafts / keys](shafts-keys-retaining-rings.md),
   [bearing stacks](../../concepts/bearing-stacks.md)).
6. **Ratio** — tooth counts (timing) or effective diameters (V/flat) from the
   catalog pair; do not invent pitch tables in Help.
7. **Printed pulleys** — teeth and flanges shrink; coupon mesh with the real
   belt before product ([fits](fits-clearances.md),
   [AM thin walls](am-thin-walls.md)).
8. **VERIFY** — belt length/part number, tension method, and flange clearance
   against the supplier drawing
   ([research before commit](../../concepts/research-before-commit.md)).

## Prefer these patterns

| Need | Prefer |
|------|--------|
| Accurate ratio, no slip | Purchased timing belt + matching pulley profile |
| Long span, shock isolation | V-belt or flat with named tensioner |
| Add wrap on a small pulley | Idler placed to increase wrap, not random “extra roller” |
| Soft shaft join without ratio | [Coupling](springs-couplings.md), not a tiny belt loop |

## Live examples

- `revolved-spacer` — spacers in pulley/shaft stacks
- `vertical-axis-turbine` / `turbine-fit-coupons` — hub and seat fit practice
- `mounting-plate` — slotted motor plates often provide center-distance adjust

Related: [mechanisms overview](mechanisms-overview.md),
[chains & sprockets](mechanisms-chains-sprockets.md),
[gears](../../concepts/gears.md),
[shafts / keys / rings](shafts-keys-retaining-rings.md),
[springs / couplings](springs-couplings.md),
[taxonomy](../taxonomy.md).
