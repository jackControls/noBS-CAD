---
type: Concept
title: Fastener clearance, counterbore, and tapped vs insert
description: Hole roles for purchased screws — clearance, countersink, counterbore, tap drill vs heat-set insert — before locking AM or machined geometry.
status: draft
updated: 2026-09-20
topics: fasteners, joints, dfm, manufacturing
keywords: clearance hole, counterbore, countersink, tap drill, insert pilot, heat-set
related_recipes: d-screw-vise, mounting-plate, garden-bench
sources: nasa-fastener, nwtc-guns-dfm
---

# Fastener clearance, counterbore, and tapped vs insert

Every screw path needs an explicit **hole role** — clearance, locate, tap,
or insert pilot. Freeze the role before diameters; a bare “M3 hole” is not a
role.

**Attribution:** high-level joint hygiene from NASA Fastener Design Manual
RP-1228 (public domain). Nominal drill charts and ISO preferred sizes are
**purchase/link-out** — not reproduced here.

## Hole roles

| Role | Intent | Typical mate |
|------|--------|--------------|
| **Clearance** | Shank passes freely; clamp elsewhere | Through plate + nut / insert in other part |
| **Close / locational clearance** | Limits lateral play without press | Alignment-sensitive covers |
| **Tap drill → cut thread** | Material becomes the female thread | Metal / thick plastic (low cycle) |
| **Insert pilot** | Receives heat-set / press insert | FDM bosses — see [heat-set inserts](am-heat-set-inserts.md) |
| **Counterbore** | Recesses a socket / hex head + optional washer | Flush or guarded heads |
| **Countersink** | Recesses a flat / oval head to a cone | Cosmetic flush; watch thin walls |

Say **through** vs **blind**, and which part carries the **thread**.

## Clearance vs thread (decision)

1. Will this joint **open often**? Prefer metal insert or nut over tapped FDM.
2. Is there **access** for a nut or press-nut on the far side?
3. Is the loaded part **plastic** with short engagement? Prefer insert length
   from the vendor drawing, not “a few threads look fine.”
4. Does the head need to sit **below** a mating face? Counterbore depth ≥ head
   height + optional washer; leave floor thickness ≥ process min
   ([AM thin walls](am-thin-walls.md)).

## Counterbore / countersink checklist

- Head style from the BOM (socket cap, button, flat, hex) drives recess shape.
- Counterbore **diameter** clears the head (and tool) with a small radial gap —
  not the same as shank clearance.
- Countersink **angle** must match the head (commonly 82° / 90° families —
  confirm hardware; treat this page as vocabulary, not a sizing chart).
- Keep recess floors flat enough for washer face contact when used.
- On FDM, deep counterbores steal wall; section the stack.

## CAD hygiene

- Model **purchased** hardware as named BOM items; CAD threads are geometry
  aids, not strength certificates. Preload / torque roles:
  [fasteners & joints](fasteners-joints.md).
- Couple hole roles with [fits & clearances](fits-clearances.md) when shafts or
  dowels share the same plate.
- For printed stacks, qualify with coupons before locking XY shrink
  (`turbine-fit-coupons`, `d-screw-vise-fit`).
