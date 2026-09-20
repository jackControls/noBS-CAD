---
type: Concept
title: Springs and couplings (CAD-time)
description: Compression/extension/torsion spring seats and shaft couplings — roles, selection packs, VERIFY gates; rate and misalignment charts stay on datasheets.
status: draft
updated: 2026-09-20
topics: machine-elements, springs, couplings, shafts, fasteners, fits, bearings, mechanisms
keywords: spring, compression spring, extension spring, torsion spring, wave spring, free length, solid height, spring seat, coupling, jaw coupling, Oldham, bellows, disc coupling, rigid coupling, flexible coupling, misalignment, hub bore, set screw, spider
related_recipes: revolved-spacer, turbine-fit-coupons, vertical-axis-turbine, d-screw-vise-fit
sources: doe-3d, nasa-bearing
---

# Springs and couplings (CAD-time)

**Springs** store energy or apply a known force/torque path; **couplings** join
two shafts (or shaft-to-hub) while naming how much misalignment and torque the
joint may take. CAD owns seats, envelopes, and access; catalogs own rate,
fatigue, and misalignment charts. Prefer purchased springs/couplings with
supplier drawings over inventing load or angle tables in Help.

**Attribution:** DFM checklist flavor from DOE Module 3D; rotating-machinery
role language aligned with public-domain NASA bearing notes. No spring-rate,
fatigue-life, or coupling misalignment charts here — cite datasheets.

Enclosure lid gaskets and labyrinths are a different seal class:
[AM enclosure lid / gasket / labyrinth](am-enclosure-lid-gasket-labyrinth.md).

## Vocabulary

| Term | Meaning |
|------|---------|
| **Free length** | Spring length with no load |
| **Solid height** | Coil-bound length (compression); must clear in the stack |
| **Active coils / rate** | Catalog properties — VERIFY from the spring maker |
| **Spring seat** | Flat or piloted face the end coil bears on |
| **Rigid coupling** | Direct shaft join; little misalignment budget |
| **Flexible coupling** | Jaw/spider, Oldham, bellows, disc, etc. — named misalignment class |
| **Hub bore / keyway** | Coupling interface to each shaft ([shafts / keys](shafts-keys-retaining-rings.md)) |

## Springs — CAD-time checklist

1. **Name the spring class** — compression, extension, torsion, wave, or
   custom leaf. Prefer a catalog family before modeling a decorative helix.
2. **Duty** — static hold, cyclic, impact, and temperature; fatigue and
   relaxation claims need the datasheet, not Help prose
   ([research before commit](../../concepts/research-before-commit.md)).
3. **Envelope** — OD/ID clearance to the bore or rod, free length, solid
   height, and travel stops so coils cannot go solid unexpectedly.
4. **Seats** — flat, countersunk, or piloted ends; avoid knife-edge contact
   and leave tool access for install
   ([fillet vs chamfer](fillet-chamfer.md)).
5. **Retention** — how the spring stays captured (pocket, guide pin, clip).
   Printed pockets shrink; coupon before product
   ([fits](fits-clearances.md), [AM thin walls](am-thin-walls.md)).
6. **Snap / living-hinge cousins** — integral flexures are not catalog springs;
   size them on the snap page ([AM snap-fits](am-snap-fit.md)).
7. **VERIFY** — rate, stress, and life charts belong on the spring datasheet or
   a cited method. Help stays role + envelope only.

## Couplings — CAD-time checklist

1. **Name the join duty** — continuous vs intermittent torque, reversing,
   speed, and whether the coupling is a fuse or a stiff transmitter.
2. **Misalignment class** — angular, parallel, axial (end float). Pick a
   **flexible** type when shafts cannot be perfectly aligned; prefer **rigid**
   only when seats and bearings already locate the axis
   ([bearing stacks](../../concepts/bearing-stacks.md),
   [locating schemes](locating-scheme-dof.md)).
3. **Hub interface** — bore, key/spline/clamp/set-screw, and length on each
   side. Model the **real hub feature**, not a glued cylinder
   ([shafts / keys / rings](shafts-keys-retaining-rings.md)).
4. **Spacer / DBSE** — distance between shaft ends; leave room for the element
   (spider, disc pack, bellows) and for assembly pull-apart.
5. **Guard and access** — rotating couplings need cover clearance and wrench
   access for fasteners ([fasteners & joints](fasteners-joints.md)).
6. **Printed hubs** — clamp/press seats oval and creep; coupon the bore and
   prefer purchased hubs when torque matters
   (`turbine-fit-coupons`, [fit coupons map](fit-coupons-recipes-map.md)).
7. **VERIFY** — torque, misalignment angle, and RPM limits need the coupling
   datasheet. Do not invent charts in CAD or Help.

## Prefer these patterns

| Need | Prefer |
|------|--------|
| Known force or return stroke | Catalog spring + seats sized to free/solid length |
| Soft printed pocket for a spring | Clearance coupon; name OD/ID and retention |
| Join two shafts with alignment uncertainty | Named flexible coupling + datasheet misalignment class |
| Precision co-linear seats already exist | Rigid coupling or integral hub — still VERIFY torque path |
| Removable torque path on a hub | Key/clamp/set-screw per shaft page + coupling hub drawing |

## Live examples

- `revolved-spacer` — annular spacers often appear in shaft/coupling stacks
- `turbine-fit-coupons` / `vertical-axis-turbine` — hub and seat fit practice
- `d-screw-vise-fit` — qualify running fits before locking product geometry

Related: [mechanisms overview](mechanisms-overview.md), [shafts, keys, and retaining rings](shafts-keys-retaining-rings.md),
[bearing stacks](../../concepts/bearing-stacks.md),
[fasteners & joints](fasteners-joints.md),
[fits & clearances](fits-clearances.md),
[power screws / lead screws](power-screws-lead-screws.md),
[AM snap-fits](am-snap-fit.md),
[taxonomy](../taxonomy.md).
