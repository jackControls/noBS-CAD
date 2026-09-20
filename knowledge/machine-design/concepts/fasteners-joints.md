---
type: Concept
title: Fasteners and joints
description: Threaded joints and purchased hardware — preload basics plus pointers to clearance holes, counterbores, and AM heat-set inserts.
status: draft
updated: 2026-09-20
topics: fasteners, joints, machine-elements
keywords: bolt, preload, thread, washer, locking, NASA RP-1228, screw joint, engagement
related_recipes: d-screw-vise, garden-bench
sources: nasa-fastener
---

# Fasteners and joints

Most assemblies are held by **purchased fasteners**, not by modeled threads
alone. Call out the real hardware (size, grade/class, length, head, locking)
on the drawing or BOM, and keep CAD threads as modeled geometry plus a
specification.

Core ideas (NASA Fastener Design Manual, public domain — see
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

## Hole and insert roles (deepen here)

For **clearance vs counterbore vs tap vs insert**, use
[Fastener clearance & counterbore](fastener-clearance-counterbore.md).
For FDM bosses and crush ribs, use
[AM heat-set inserts](am-heat-set-inserts.md).
For **hex nut traps / captive nuts**, use
[Captive nut and hex nut trap](captive-nut-hex-trap.md).
For **cosmetic CAD threads vs real hole roles**, use
[Cosmetic threads vs modeled clearance](cosmetic-threads-vs-clearance.md).

Full preload/torque/engagement distill from NASA-RP-1228 remains a longer TODO —
do not treat this overview as sizing guidance.

## In this product

`d-screw-vise` uses an interrupted helical screw, wear nut, and purchased M3
keepers. `garden-bench` is timber stock plus fasteners as open inputs. Keep
hardware as named purchased parts.

Related: [Materials vocabulary](materials-vocabulary.md),
[taxonomy](../taxonomy.md).
