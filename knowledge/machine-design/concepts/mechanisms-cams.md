---
type: Concept
title: Cams (CAD-time)
description: Follower types and rise–dwell–return as a motion story; base circle and pressure angle as VERIFY against datasheets — no invented cam charts.
status: draft
updated: 2026-09-20
topics: mechanisms, machine-elements, joints
keywords: cam, follower, plate cam, disk cam, cylindrical cam, knife-edge, flat-face, roller follower, rise dwell return, base circle, pitch curve, pressure angle, cam law
related_recipes: revolved-spacer, d-screw-vise, vertical-axis-turbine, turbine-fit-coupons
sources: mit-272, doe-3d
---

# Cams (CAD-time)

A **cam** imposes a prescribed displacement on a **follower** as a function of
cam rotation (or translation). CAD models the blank, shaft seat, and follower
envelope; the **cam law** (rise / dwell / return) and safe **pressure angle**
come from analysis or a purchased cam — not from inventing lobe numbers in Help.

**Attribution:** cam vocabulary and motion-story framing aligned with MIT OCW
[2.72 Elements of Mechanical Design](https://ocw.mit.edu/courses/2-72-elements-of-mechanical-design-spring-2009/)
(`mit-272`, CC BY-NC-SA — **link-out only**). No displacement, velocity, or
pressure-angle charts here.

## Vocabulary

| Term | Meaning |
|------|---------|
| **Plate / disk cam** | Flat cam rotating about an axis; follower usually radial or offset |
| **Cylindrical / barrel cam** | Groove or face on a cylinder; follower travels along the axis |
| **Follower type** | Knife-edge, flat-face, or **roller** (prefer roller for wear) |
| **Rise / dwell / return** | Motion **story** vs cam angle — what the follower must do |
| **Base circle** | Smallest cam radius to the pitch reference — envelope driver |
| **Pitch curve** | Path of the follower reference point |
| **Pressure angle** | Force transmission angle — **VERIFY** from analysis/datasheet, do not invent limits in Help |

## CAD-time checklist

1. **Write the motion story** — degrees of rise, dwell(s), return, and any
   soft stops. Prefer a named story over a freehand “egg” lobe
   ([mechanisms overview](mechanisms-overview.md)).
2. **Pick follower class** — roller preferred for wear; flat-face needs face
   width and side-load thought; knife-edge is teaching/demo, not durability.
3. **Lock the base-circle envelope** — minimum radius, blank OD, hub, and
   shaft seat ([shafts / keys](shafts-keys-retaining-rings.md),
   [bearing stacks](../../concepts/bearing-stacks.md)).
4. **Follower guide** — slide or pivot that keeps the follower on the intended
   path; name fit class and stroke box ([fits](fits-clearances.md)).
5. **Spring or gravity return** — if the follower must stay in contact, name
   the return spring seat ([springs / couplings](springs-couplings.md)).
6. **Pressure angle / undercutting** — treat as VERIFY gates against a cited
   method or supplier drawing. Prefer a purchased cam profile when timing or
   load matters.
7. **Assembly & access** — key/flat, axial retention, and tool access to change
   the cam or roller.
8. **VERIFY** — sweep cam rotation for interference and lost contact; coupon
   printed lobes for shrink before claiming timing
   ([research before commit](../../concepts/research-before-commit.md),
   [assembly interference](../../concepts/assembly-interference.md)).

## Prefer these patterns

| Need | Prefer |
|------|--------|
| Simple intermittent lift | Plate cam + roller follower + named rise–dwell–return |
| Axial indexing along a shaft | Cylindrical cam with purchased or cited groove law |
| Accurate high-cycle timing | Purchased cam / indexer; CAD owns envelope only |
| Soft rotary→linear without a cam law | [Power / lead screw](power-screws-lead-screws.md) or [slider-crank](mechanisms-linkages-mobility.md) |

## Live examples

- `revolved-spacer` — hub/spacer patterns in cam/shaft stacks
- `d-screw-vise` — alternate rotary→linear when a screw is the better story
- `turbine-fit-coupons` — qualify seats before product

Related: [mechanisms overview](mechanisms-overview.md),
[linkages / mobility](mechanisms-linkages-mobility.md),
[gears](../../concepts/gears.md),
[power screws](power-screws-lead-screws.md),
[taxonomy](../taxonomy.md).
