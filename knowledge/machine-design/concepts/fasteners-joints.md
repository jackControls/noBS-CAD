---
type: Concept
title: Fasteners and joints
description: Threaded joints and purchased hardware — preload basics plus pointers to clearance holes, counterbores, and AM heat-set inserts.
status: draft
updated: 2026-09-20
topics: fasteners, joints, machine-elements
keywords: bolt, preload, thread, washer, locking, NASA RP-1228, screw joint, engagement, grip length, purchased hardware, BOM fastener
related_recipes: d-screw-vise, garden-bench, mounting-plate
sources: nasa-fastener
---

# Fasteners and joints

Most assemblies are held by **purchased fasteners**, not by modeled threads
alone. Call out the real hardware (size, grade/class, length, head, locking)
on the drawing or BOM, and keep CAD threads as modeled geometry plus a
specification.

Core ideas (NASA Fastener Design Manual RP-1228, public domain — see
[SOURCES](../SOURCES.md)):

- **Preload** clamps the joint so working loads do not open it.
- **Grip, engagement, and thread runout** must match the stack of parts.
- **Locking** (prevailing torque, chemical, mechanical) is a choice, not an
  afterthought on vibrating machinery.
- **Fatigue** of bolts is often about staying tight and avoiding bending, not
  only tensile area.
- Mixed materials and coatings affect galling and corrosion.

Modeled ISO/UN holes in noBS CAD are geometry aids. They do not certify
strength. Do not publish load ratings from CAD alone.

## Checklist before locking hardware

1. **Name the purchased part** — M3×12 SHCS class/grade, washer, nut/insert.
2. **Hole role** — clearance, counterbore, tap, or insert pilot
   ([fastener clearance & counterbore](fastener-clearance-counterbore.md)).
3. **Grip stack** — clamped thickness + washer; length that leaves full nut
   engagement without bottoming blindly.
4. **Locate vs clamp** — pins/nubs locate; screws clamp
   ([alignment nubs](alignment-nubs-pins.md), [locating schemes](locating-scheme-dof.md)).
5. **AM path** — heat-set insert vs hex trap vs printed thread
   ([heat-set inserts](am-heat-set-inserts.md),
   [captive nut trap](captive-nut-hex-trap.md),
   [cosmetic threads](cosmetic-threads-vs-clearance.md)).
6. **Access** — tool clearance, one-side assembly, captive hardware if needed.
7. **VERIFY table** for any vendor envelope
   ([research before commit](../../concepts/research-before-commit.md)).

## Hole and insert roles (deepen here)

| Need | Page |
|------|------|
| Clearance / counterbore / tap vs insert | [Fastener clearance & counterbore](fastener-clearance-counterbore.md) |
| FDM bosses and crush ribs | [AM heat-set inserts](am-heat-set-inserts.md) |
| Hex nut traps / captive nuts | [Captive nut and hex nut trap](captive-nut-hex-trap.md) |
| Cosmetic CAD threads vs real holes | [Cosmetic threads vs modeled clearance](cosmetic-threads-vs-clearance.md) |
| Hole feature vs sketch pattern | [Hole wizard vs modeled hole](hole-wizard-vs-modeled.md) |

Full preload/torque/engagement distill from NASA-RP-1228 remains a longer TODO —
do not treat this overview as sizing guidance.

## In this product

`d-screw-vise` uses an interrupted helical screw, wear nut, and purchased M3
keepers. `garden-bench` is timber stock plus fasteners as open inputs.
`mounting-plate` exercises clearance patterns. Keep hardware as named purchased
parts.

Related: [Materials vocabulary](materials-vocabulary.md),
[AM assembly join choice](am-assembly-join-choice.md),
[taxonomy](../taxonomy.md).
