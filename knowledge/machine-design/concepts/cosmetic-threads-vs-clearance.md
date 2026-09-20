---
type: Concept
title: Cosmetic threads vs modeled clearance
description: When CAD helix / cosmetic threads are display aids versus when you must model clearance, tap drill, or insert pilots for real hardware.
status: draft
updated: 2026-09-20
topics: threads, fasteners, manufacturing, cad, dfm
keywords: cosmetic thread, modeled thread, helix, thread display, tap drill, clearance hole, major diameter, pitch diameter, thread engagement, CAD thread, visual thread
related_recipes: d-screw-vise, mounting-plate
sources: nasa-fastener, nwtc-guns-dfm, vendor-cad-help
---

# Cosmetic threads vs modeled clearance

CAD **threads** are often **cosmetic**: a helix or textured face that
communicates “this is threaded” without defining the manufactured hole. Agents
who treat the helix major as a drill size, or who boolean-subtract a pretty
thread into FDM, ship unprintable or wrong-fit parts.

**Attribution:** fastener hygiene (NASA RP-1228, public domain) plus common CAD
help patterns (paraphrase only — [SOURCES](../SOURCES.md) `vendor-cad-help`).

## Three different models

| Model | What it is for | What it is not |
|-------|----------------|----------------|
| **Cosmetic / visual thread** | Drawing clarity, BOM communication | Drill size, strength, print path |
| **Simplified hole (major / drill)** | Manufacturing intent for clearance or tap drill | Pretty helix |
| **Functional thread solid** | Rare: rolled/cut thread as geometry for special mates | Default for purchased screws |

Default for purchased fasteners: **simplified hole + specification** (thread
designation on BOM/drawing). Keep cosmetics optional and out of boolean
cutters unless you have a deliberate reason.

## Clearance vs thread-bearing

- **Clearance hole** — shank passes; thread lives in the **other** part or nut.
  Diameter from clearance role, not from cosmetic major —
  [fastener clearance](fastener-clearance-counterbore.md).
- **Tap drill / pilot** — material will become the female thread (or receive an
  insert). Size from tap chart or insert drawing — not from the cosmetic OD.
- **Insert pilot** — [heat-set inserts](am-heat-set-inserts.md).
- **Nut trap** — [captive nut / hex trap](captive-nut-hex-trap.md).

## AM-specific warning

Printing a fine cosmetic helix as real geometry usually produces:

- Unsupported thin crests
- Unclean internal threads that seize or strip
- Mesh shards on export ([adversarial mesh audit](../../concepts/adversarial-mesh-audit.md))

Prefer: clearance + nut/insert, or a **coupon** of a coarse printed thread only
when you explicitly accept printed-thread limits.

## CAD hygiene checklist

1. Label the hole **role** (clearance / tap / insert / cosmetic-only).
2. Put thread callouts in BOM or drawing notes; do not rely on helix count.
3. Suppress or exclude cosmetic faces from manufacturing exports when they are
   display-only.
4. For special helical features (leadscrews, printed worms), treat them as
   **mechanism design** with coupons — not as fastener cosmetics.

## Anti-patterns

- Boolean of a library “M3 thread” solid into FDM as the mating feature
- Using cosmetic **major** as clearance diameter
- Assuming CAD thread engagement equals rated strength
- Shipping STL/3MF with unresolved thread display facets as functional walls

Related: [fasteners & joints](fasteners-joints.md),
[fits & clearances](fits-clearances.md),
[research before commit](../../concepts/research-before-commit.md).
