---
type: Concept
title: Mechanisms overview (CAD-time)
description: Golden-path hub for mechanisms — name motion class, pick element family, lock envelopes/centers/DOFs, then VERIFY with coupons or purchased hardware.
status: draft
updated: 2026-09-20
topics: mechanisms, machine-elements, joints, assembly
keywords: mechanism, motion class, rotary to rotary, rotary to linear, intermittent, path generation, linkage, gear, cam, belt, pulley, mobility, DOF, center distance, envelope
related_recipes: vertical-axis-turbine, d-screw-vise, d-screw-vise-fit, revolved-spacer, turbine-fit-coupons
sources: mit-272, doe-3d
---

# Mechanisms overview (CAD-time)

A **mechanism** turns named motion into named motion with constraints you can
sketch, seat, and VERIFY. CAD owns envelopes, centers, joint axes, and
interference at poses; catalogs and coupons own tooth forms, cam laws, belt
profiles, and duty ratings. Prefer purchased machine elements when load, wear,
or timing accuracy matters.

This page is the **discoverability hub**. Detail lives on the linked Concepts.
Do **not** invent tooth, cam, or belt charts in Help — cite datasheets and
[SOURCES](../SOURCES.md).

**Attribution:** motion-class and element-family framing aligned with MIT OCW
[2.72 Elements of Mechanical Design](https://ocw.mit.edu/courses/2-72-elements-of-mechanical-design-spring-2009/)
(`mit-272`, [CC BY-NC-SA](https://creativecommons.org/licenses/by-nc-sa/4.0/) —
**link-out only**, not a chapter mirror); DFM checklist flavor from DOE Module 3D
(public domain).

## Golden path (CAD-time)

1. **Name the motion class** — what goes in, what must come out:
   - **Rotary → rotary** (ratio, direction, continuous or reversing)
   - **Rotary → linear** (lead/travel, stroke, backdrive risk)
   - **Intermittent** (dwell, index, rise/return)
   - **Path / guidance** (coupler curve, straight-line approx, constrained slide)
2. **Pick the element family** — gears, belts/chains, linkages, cams, screws,
   or a purchased actuator. Prefer one family that matches the motion class
   before stacking exotic hybrids.
3. **Lock envelopes, centers, and DOFs** — shaft centers, base circles, stroke
   boxes, joint axes, and which DOFs each joint removes
   ([locating schemes](locating-scheme-dof.md),
   [linkages / mobility](mechanisms-linkages-mobility.md)).
4. **VERIFY** — coupons, purchased hardware drawings, and interference at
   extreme poses before freezing product geometry
   ([research before commit](../../concepts/research-before-commit.md),
   [assembly interference](../../concepts/assembly-interference.md),
   [fit coupons map](fit-coupons-recipes-map.md)).

## Motion class → preferred families

| Motion class | Prefer first | Notes |
|--------------|--------------|-------|
| Rotary → rotary (ratio) | Gears or timing belts | Same module/DP + PA for gears; purchased belt profile for sync |
| Rotary → linear | Power/lead screw or cam + follower | Lead ↔ travel documented; cam law from datasheet |
| Intermittent / dwell | Cam or indexed linkage | Rise–dwell–return as a **motion story**, not a pretty lobe |
| Path / guidance | Linkage or slide + guides | Name joints/DOFs before fancy coupler curves |
| Soft sync / long span | Belt or chain + idlers | Center distance, wrap, tension path |

## Related Concepts

| Topic | Id | Page |
|-------|----|------|
| Gears (identify / pair) | `concepts.gears` | [gears](../../concepts/gears.md) |
| Linkages / mobility | `machine-design.concepts.mechanisms-linkages-mobility` | [mechanisms-linkages-mobility](mechanisms-linkages-mobility.md) |
| Cams (CAD-time) | `machine-design.concepts.mechanisms-cams` | [mechanisms-cams](mechanisms-cams.md) |
| Belts & pulleys | `machine-design.concepts.mechanisms-belts-pulleys` | [mechanisms-belts-pulleys](mechanisms-belts-pulleys.md) |
| Power / lead screws | `machine-design.concepts.power-screws-lead-screws` | [power-screws-lead-screws](power-screws-lead-screws.md) |
| Shafts / keys / rings | `machine-design.concepts.shafts-keys-retaining-rings` | [shafts-keys-retaining-rings](shafts-keys-retaining-rings.md) |
| Bearings / hubs / seats | `concepts.bearing-stacks` | [bearing-stacks](../../concepts/bearing-stacks.md) |
| Springs / couplings | `machine-design.concepts.springs-couplings` | [springs-couplings](springs-couplings.md) |
| Technic-style envelope | `machine-design.concepts.technic-envelope` | [technic-envelope](technic-envelope.md) |

## Checklist

- [ ] Motion class named (in → out)
- [ ] Element family chosen and justified
- [ ] Centers / envelopes / joint DOFs locked
- [ ] Purchased SKUs or coupon plan named where duty matters
- [ ] Extreme-pose interference reviewed

## Further reading (link only)

- MIT OCW 2.72 — mechanisms, gears, bearings (`mit-272` in [SOURCES](../SOURCES.md))
- Gear pair math and mounting: [gears](../../concepts/gears.md)

Related: [taxonomy](../taxonomy.md), [SOURCES](../SOURCES.md).
