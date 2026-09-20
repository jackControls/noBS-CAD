---
type: Concept
title: Shafts, keys, and retaining rings (CAD-time)
description: Stepped shafts, keyseats vs keyways, and retaining-ring grooves — roles, VERIFY gates, and links to fits and bearing stacks without catalog tables.
status: draft
updated: 2026-09-20
topics: machine-elements, shafts, fasteners, fits, bearings, mechanisms
keywords: shaft, stepped shaft, shoulder, undercut, keyseat, keyway, parallel key, woodruff, retaining ring, circlip, snap ring, groove, E-clip, axial retention
related_recipes: revolved-spacer, turbine-fit-coupons, vertical-axis-turbine, d-screw-vise-fit
sources: nasa-bearing, nist-gdt-2, doe-3d
---

# Shafts, keys, and retaining rings (CAD-time)

Rotating machinery almost always needs a **named shaft envelope**, a **torque
path** (key, spline, press, set screw), and **axial retention** (shoulder,
collar, retaining ring). CAD models the geometry; catalogs and coupons decide
fits and groove sizes. Prefer purchased keys/rings with supplier drawings over
inventing groove tables in Help.

**Attribution:** role language aligned with public-domain NASA bearing notes and
NIST fits teaching; DFM checklist flavor from DOE Module 3D. No ISO key or
circlip dimension charts here.

## Vocabulary

| Term | Meaning |
|------|---------|
| **Shoulder** | Step that axially locates a bearing, gear, or collar |
| **Undercut / relief** | Small groove so a fillet does not hold a race/hub off the shoulder |
| **Keyseat** | Slot in the **shaft** |
| **Keyway** | Slot in the **hub** (gear, pulley, collar) |
| **Retaining ring / circlip** | Spring ring in a groove; external (shaft) or internal (bore) |
| **E-clip / push-on** | Alternate keepers — different envelope; name the SKU |

## CAD-time checklist

1. **Name the shaft duty** — torque, bending, continuous vs intermittent, and
   which faces locate bearings ([bearing stacks](../../concepts/bearing-stacks.md)).
2. **Step plan** — diameters for seats, hubs, and free spans; each shoulder has a
   **role** (locate race, stop hub, clear seal). Prefer clear axial stack math over
   a single “pretty taper.”
3. **Fillet vs undercut** — blend for strength; relieve when a purchased race must
   seat flat ([fillet vs chamfer](fillet-chamfer.md)).
4. **Torque path** — key, Woodruff, spline, press hub, or set-screw collar.
   Model the **seat and access**, not a decorative rectangle. Prefer VERIFY of
   key width/height from the shaft/hub catalog pair.
5. **Keyseat vs keyway** — shaft slot and hub slot are different features; keep
   lengths and end radii from the key standard or vendor drawing.
6. **Axial retention class** — shoulder + spacer, shaft collar, or retaining ring.
   Rings need a **groove diameter, width, and corner** from the ring maker —
   prefer citation over inventing numbers
   ([fits](fits-clearances.md), [research before commit](../../concepts/research-before-commit.md)).
7. **Assembly order** — rings and press hubs often require a sequence; leave tool
   access and lead-in ([fillet vs chamfer](fillet-chamfer.md)).
8. **Printed hubs** — press/key seats shrink and oval; coupon the interface before
   product ([AM thin walls](am-thin-walls.md), fit coupons).
9. **VERIFY** — groove charts, key stress, and fatigue claims need cited methods;
   Help stays role + checklist only.

## Prefer these patterns

| Need | Prefer |
|------|--------|
| Locate a bearing axially | Shoulder + spacer or collar sized to the race abutment |
| Transmit torque on a hub | Named key/spline/press with matched seat + hub feature |
| Removable axial stop | Catalog retaining ring + groove from that catalog |
| Soft printed hub | Clearance/transition coupon; avoid relying on a tiny printed key alone |

## Live examples

- `revolved-spacer` — annular spacers in shaft/bearing stacks
- `turbine-fit-coupons` / `vertical-axis-turbine` — hub and seat fit practice
- `d-screw-vise-fit` — qualify running fits before locking product geometry

Related: [mechanisms overview](mechanisms-overview.md), [belts & pulleys](mechanisms-belts-pulleys.md), [bearing stacks](../../concepts/bearing-stacks.md),
[fits & clearances](fits-clearances.md),
[power screws / lead screws](power-screws-lead-screws.md),
[springs and couplings](springs-couplings.md),
[locating schemes](locating-scheme-dof.md),
[taxonomy](../taxonomy.md).
