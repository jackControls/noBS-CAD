---
type: Concept
title: Fasteners and joints
description: Threaded joints, preload language, and purchased-versus-designed hardware.
status: draft
updated: 2026-09-11
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

## In this product

`d-screw-vise` uses an interrupted helical screw, wear nut, and purchased M3
keepers. `garden-bench` is timber stock plus fasteners as open inputs. Keep
hardware as named purchased parts.

Related: [Materials vocabulary](materials-vocabulary.md),
[taxonomy](../taxonomy.md).
