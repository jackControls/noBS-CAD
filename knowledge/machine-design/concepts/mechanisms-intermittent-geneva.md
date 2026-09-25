---
type: Concept
title: Intermittent motion / Geneva (CAD-time)
description: CAD-time intermittent / Geneva roles — index, dwell, lock arc, envelopes; VERIFY purchased indexer or analyzed cam — no invented slot charts.
status: draft
updated: 2026-09-20
topics: mechanisms, machine-elements, joints
keywords: intermittent motion, Geneva drive, Geneva wheel, Maltese cross, indexing, dwell, lock arc, driver pin, slot, center distance, indexer, rotary table, rise dwell return
related_recipes: revolved-spacer, d-screw-vise, vertical-axis-turbine, turbine-fit-coupons
sources: mit-272, doe-3d
---

# Intermittent motion / Geneva (CAD-time)

**Intermittent** motion advances a load through discrete indexes with a
**dwell** between steps. A **Geneva** (Maltese-cross style) is one classic
embodiment: a driver pin enters a slot, indexes the wheel, then a **lock arc**
holds the wheel during dwell. CAD owns centers, envelopes, pin/slot clearance,
and interference at poses; slot counts, pin diameters, and timing laws come
from a purchased indexer or cited analysis — not invented charts in Help.

**Attribution:** intermittent / indexing vocabulary aligned with MIT OCW
[2.72 Elements of Mechanical Design](https://ocw.mit.edu/courses/2-72-elements-of-mechanical-design-spring-2009/)
(`mit-272`, CC BY-NC-SA — **link-out only**). No slot-geometry or acceleration
charts here.

## Vocabulary

| Term | Meaning |
|------|---------|
| **Index** | Discrete angular (or linear) step of the output |
| **Dwell** | Stationary interval while the driver continues |
| **Geneva wheel** | Slotted output wheel (often 4–6+ slots) |
| **Driver / crank** | Pin (or roller) that enters a slot to index |
| **Lock arc** | Concentric arc that traps the wheel during dwell |
| **Center distance** | Driver axis → wheel axis — primary envelope driver |
| **Purchased indexer** | Cam / Geneva / servo indexer bought as a unit; CAD owns mount + load |

## CAD-time checklist

1. **Name the motion story** — indexes per rev, dwell fraction, direction, and
   whether reverse is allowed
   ([mechanisms overview](mechanisms-overview.md)).
2. **Pick embodiment class** — Geneva, external cam + follower, ratchet, or
   purchased servo/cam indexer. Prefer purchased when duty, accuracy, or
   life matters.
3. **Lock envelopes** — center distance, wheel OD, driver pin circle, lock-arc
   clearance, and shaft seats
   ([shafts / keys](shafts-keys-retaining-rings.md),
   [bearing stacks](../../concepts/bearing-stacks.md)).
4. **Pin / slot roles** — clearance vs locate; roller pin preferred for wear;
   name fit class ([fits](fits-clearances.md)). Do **not** invent slot width
   or pin Ø from Help.
5. **Lock arc** — concentric hold during dwell; check that the pin is clear of
   the next slot before the arc engages.
6. **Load path at index** — shock at pin entry; prefer soft entry or purchased
   profile when inertia is high
   ([cams](mechanisms-cams.md) for rise–dwell–return as an alternate story).
7. **Assembly & access** — key/flat, axial retention, and tool access to change
   pin or wheel.
8. **VERIFY** — sweep driver rotation for interference, lost lock, and double
   engagement; coupon printed slots only for envelope checks — timing and life
   stay datasheet / analysis
   ([research before commit](../../concepts/research-before-commit.md),
   [assembly interference](../../concepts/assembly-interference.md)).

## Prefer these patterns

| Need | Prefer |
|------|--------|
| Simple teaching / low-duty index | Geneva envelopes + VERIFY against a cited geometry |
| Production index / rotary table | Purchased indexer; CAD owns mount, load, guards |
| Soft intermittent lift (not pure index) | [Cam + follower](mechanisms-cams.md) with named rise–dwell–return |
| Continuous ratio, no dwell | [Gears](../../concepts/gears.md) / [belts](mechanisms-belts-pulleys.md) / [chains](mechanisms-chains-sprockets.md) |
| Printed Geneva “for real duty” | Envelope demo only — buy the indexer for load/life |

## Live examples

- `revolved-spacer` — hub/spacer patterns in driver/wheel stacks
- `turbine-fit-coupons` — qualify seats before product
- `d-screw-vise` — alternate when continuous rotary→linear is the better story

Related: [mechanisms overview](mechanisms-overview.md),
[cams](mechanisms-cams.md),
[linkages / mobility](mechanisms-linkages-mobility.md),
[gears](../../concepts/gears.md),
[taxonomy](../taxonomy.md).
