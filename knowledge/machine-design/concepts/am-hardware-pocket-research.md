---
type: Concept
title: Hardware pocket research (servo, horn, spline, bolt circle)
description: Generic VERIFY pattern for purchased actuators and patterned fastener layouts — name the part, measure critical dims, then model pockets and bolt circles.
status: draft
updated: 2026-09-20
topics: hardware, research, dfam, fasteners, am
keywords: servo, horn, spline, bolt circle, PCD, hardware envelope, VERIFY
related_recipes: turbine-fit-coupons, mounting-plate, d-screw-vise
sources: nasa-fastener, nwtc-guns-dfm, doe-3d
---

# Hardware pocket research (servo, horn, spline, bolt circle)

Purchased actuators and patterned mounts are a
[research-before-commit](../../concepts/research-before-commit.md) problem:
name the SKU, measure critical dims (spline, boss height, bolt **PCD**), then
model the pocket.

**Attribution:** process habit only (DFM / joint hygiene). Vendor drawings and
datasheets are link-out / measure — dimensions on this page are method, not a
catalog.

## Mechanism class first

| Class | What you must name |
|-------|--------------------|
| **Actuator body** | Brand/SKU, body envelope (L×W×H), wire exit face, mounting lug style |
| **Output / horn** | Spline tooth count (or “press-on”), horn length, screw size for horn |
| **Flange / face mount** | Bolt count, PCD / pattern, clearance vs tap vs insert in the **case** |
| **Shaft / D-flat** | Journal Ø, flat length, retention (set screw, clip, press) |

Model from a named **SKU** (or measured
sample) in the VERIFY table — see
[research before commit](../../concepts/research-before-commit.md).

## VERIFY checklist (before first pocket cut)

1. **Envelope** — body max XYZ + any connector / capacitor bulge.
2. **Mount pattern** — hole count, PCD or rectangular spacing, hole role
   (clearance through case vs insert in case) —
   [fastener clearance](fastener-clearance-counterbore.md).
3. **Output geometry** — spline vs round, horn swing envelope, screw head
   clearance above the horn.
4. **Wire / cable face** — which face the leads leave; leave a planned
   [cable exit / strain relief](am-cable-exits-strain-relief.md).
5. **Access** — can the fastener tool reach after the cover closes?
6. **Print roles** — which walls are shell, boss, remaining after pocket —
   [AM thin walls](am-thin-walls.md).

Record numbers with units and source (datasheet rev, caliper note, coupon).

## Bolt circles and patterned fasteners

- Prefer **PCD + count + start angle** over placing holes one-by-one from a
  screenshot.
- Same pattern on mating parts must share a **datum story** —
  [locating schemes](locating-scheme-dof.md).
- Hole **roles** can differ by part (clearance in cover, insert in base) even
  when the pattern matches.
- For FDM, coupon one hole of the pattern before committing the full circle.

## Pocket hygiene (AM enclosures)

- Pocket depth leaves remaining floor/wall ≥ process min on every side.
- Add lead-in / chamfer on entry faces where the body slides in —
  [fillet vs chamfer](fillet-chamfer.md).
- Prefer a second locate (nubs/pins) when the actuator can rattle —
  combine with pads, nubs, or a retainer class
  ([alignment nubs](alignment-nubs-pins.md),
  [clamshell retainer](am-clamshell-retainer.md)).
- Keep melt heat (heat-set inserts) away from thin pocket walls —
  [heat-set inserts](am-heat-set-inserts.md).
