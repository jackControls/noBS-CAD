---
type: Concept
title: Chains and sprockets (CAD-time)
description: CAD-time chain/sprocket envelopes, center distance, wrap, and tension path; prefer purchased pitch — no invented pitch or tension charts.
status: draft
updated: 2026-09-20
topics: mechanisms, machine-elements, shafts, bearings
keywords: chain, roller chain, sprocket, pitch, center distance, wrap angle, idler, tensioner, slack strand, master link, ANSI chain, BS chain, purchased pitch
related_recipes: revolved-spacer, vertical-axis-turbine, turbine-fit-coupons, mounting-plate
sources: mit-272, doe-3d, nasa-bearing
---

# Chains and sprockets (CAD-time)

**Roller (and similar) chains** transmit rotary motion across a **center
distance** with a tension path you can sketch. CAD owns sprocket envelopes,
hubs, shaft seats, guards, and idler locations; **pitch / strand / length** and
tension procedure stay on the supplier — prefer a purchased chain + sprocket
pair over inventing pitch or tension charts in Help.

**Attribution:** drive-layout roles aligned with MIT OCW
[2.72 Elements of Mechanical Design](https://ocw.mit.edu/courses/2-72-elements-of-mechanical-design-spring-2009/)
(`mit-272`, CC BY-NC-SA — **link-out only**); rotating-seat hygiene with
public-domain NASA bearing notes. No chain-length calculators or tension tables
here.

Sibling soft-sync family: [belts & pulleys](mechanisms-belts-pulleys.md). Hub:
[mechanisms overview](mechanisms-overview.md).

## Vocabulary

| Term | Meaning |
|------|---------|
| **Pitch** | Distance between successive roller centers — **name the purchased pitch** (e.g. ANSI #25 / #35, metric families) |
| **Sprocket** | Toothed wheel matched to that pitch and tooth form |
| **Center distance** | Shaft-to-shaft spacing; primary envelope driver |
| **Wrap angle** | Chain contact on a sprocket; small sprockets often need more wrap |
| **Idler / tensioner** | Sprocket (or roller) that sets path, wrap, or slack take-up |
| **Slack strand** | Low-tension side; idlers / guides often live here |
| **Master link / connecting link** | Field join; leave access if serviceable |

## CAD-time checklist

1. **Name the chain family** — purchased pitch and strand count before modeling
   decorative teeth. Prefer catalog sprocket + chain over freehand tooth charts
   ([gears](../../concepts/gears.md) when teeth mesh on shafts instead;
   [belts](mechanisms-belts-pulleys.md) for quieter soft sync).
2. **Lock center distance** — driver/driven shaft centers, fixed span vs
   adjustment (slotted motor plate, swing arm), and how slack will be taken up.
3. **Wrap and path** — sketch the chain centerline; add idlers when wrap on a
   small sprocket is insufficient or the path must clear structure/guards.
4. **Tension path** — who moves (motor plate, idler arm, jack screw)? Leave tool
   access and a lock after set ([power screws](power-screws-lead-screws.md) when
   a screw tensions). Prefer take-up on the **slack** strand unless the catalog
   says otherwise.
5. **Sprocket envelope** — OD (tip), width, hub, bore/key, guard clearance
   ([shafts / keys](shafts-keys-retaining-rings.md),
   [bearing stacks](../../concepts/bearing-stacks.md)).
6. **Ratio** — tooth counts from the catalog pair; do not invent pitch tables in
   Help. Odd/even tooth counts and wear sharing are supplier guidance.
7. **Guards & pinch** — chain runs pinch; leave guard envelopes and service
   access in the assembly early.
8. **Printed sprockets** — teeth and hubs shrink; coupon mesh with the **real
   purchased chain** before product ([fits](fits-clearances.md),
   [AM thin walls](am-thin-walls.md),
   [printed gears DFAM](am-printed-gears-dfam.md) for tooth/orientation habits).
9. **VERIFY** — pitch/part number, length (or link count), tension method, and
   tip/guard clearance against the supplier drawing
   ([research before commit](../../concepts/research-before-commit.md)).

## Prefer these patterns

| Need | Prefer |
|------|--------|
| High torque, dirty/oily span | Purchased roller chain + matching sprockets |
| Quiet sync, low stretch priority | Timing belt family ([belts](mechanisms-belts-pulleys.md)) |
| Accurate shaft ratio, compact | Gears ([gears](../../concepts/gears.md)) |
| Add wrap on a small sprocket | Idler placed to increase wrap, not a random “extra roller” |
| Soft shaft join without ratio | [Coupling](springs-couplings.md), not a tiny chain loop |

## Live examples

- `revolved-spacer` — spacers in sprocket/shaft stacks
- `vertical-axis-turbine` / `turbine-fit-coupons` — hub and seat fit practice
- `mounting-plate` — slotted motor plates often provide center-distance adjust

Related: [mechanisms overview](mechanisms-overview.md),
[belts & pulleys](mechanisms-belts-pulleys.md),
[gears](../../concepts/gears.md),
[shafts / keys / rings](shafts-keys-retaining-rings.md),
[springs / couplings](springs-couplings.md),
[taxonomy](../taxonomy.md).
