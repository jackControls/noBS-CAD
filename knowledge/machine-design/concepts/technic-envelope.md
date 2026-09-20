---
type: Concept
title: Technic-style beam and pin envelope (unofficial)
description: Approximate public pitch / pin envelope notes for LEGO-Technic-compatible experimentation — unofficial, not licensed dims; verify before commit.
status: draft
updated: 2026-09-20
topics: mechanisms, joints, dfam
keywords: Technic, LEGO compatible, Lego pin, beam pitch, stud pitch, pin diameter, axle envelope, brick unit, unofficial clone
related_recipes: repeated-bracket-assembly
sources: doe-3d
---

# Technic-style beam and pin envelope (unofficial)

> **Warning — unofficial.** This page is a **generic experimental envelope** for
> agents exploring brick/beam-compatible mechanisms. It is **not** a LEGO®
> Group specification, not a license to use trademarks in product branding, and
> not a guarantee of clutch power or legality of published clone dims. **Measure
> your bricks/pins** and keep a VERIFY table
> ([research before commit](../../concepts/research-before-commit.md)).

## Why this exists

Agents often search for “Technic pin diameter” or “beam pitch” and get forum
folklore. Prefer: **physical calipers → coupon → lock**. Numbers below are
**approximate public community figures** for orientation only.

## Approximate public figures (verify!)

| Quantity | Approximate community figure | Notes |
|----------|------------------------------|-------|
| Stud / module pitch | ~8 mm | Classic brick grid; confirm on your set |
| Beam hole pitch | ~8 mm along beam | Same module family in many Technic-style beams |
| Pin / axle hole ID | ~4.8 mm class | Pin OD and hole ID differ; measure both |
| Beam thickness | ~7.4–8 mm class | Varies by generation and clone |

Treat every cell as **suspect until measured**. Do not paste these into a
shipping drawing as certified. Prefer **mm** project units
([unit systems](../../concepts/unit-systems-mm-default.md)).

## Design rules if you proceed

1. Lock **pitch** and **pin/hole roles** (slip vs friction) in a VERIFY table.
2. Print **coupons** of hole ID and pin OD before a full beam lattice.
3. Prefer purchased pins/axles when clutch and wear matter; printed pins are a
   different material system ([alignment nubs vs pins](alignment-nubs-pins.md)).
4. Avoid trademarked logos/word marks in CAD exports meant for distribution.
5. Overconstraint still applies — a dense pin field fights shrink
   ([locating schemes](locating-scheme-dof.md)).
6. Name **clearance fit vs friction** explicitly
   ([fits & clearances](fits-clearances.md)).

## Checklist

- [ ] Caliper measurements recorded (pitch, hole ID, pin OD)
- [ ] Fit class named (slip vs press/friction)
- [ ] Coupon printed and measured after cool-down
- [ ] No trademarked marks on distributable geometry
- [ ] Locator count reviewed for overconstraint

## Anti-patterns

- Shipping “LEGO-compatible” claims from this help page alone
- Mixing stud-pitch and proprietary clone pitches in one lattice
- Using undocumented forum screenshots as the only source
- Treating community mm figures as ISO preferred fits

Related: [fits & clearances](fits-clearances.md), [gears](../../concepts/gears.md).
