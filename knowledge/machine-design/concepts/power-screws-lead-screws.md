---
type: Concept
title: Power screws and lead screws (CAD-time)
description: Lead vs pitch, friction/backdrive, printed vs purchased nuts, and VERIFY gates — vise recipe context without load ratings from CAD.
status: draft
updated: 2026-09-20
topics: mechanisms, fasteners, joints, machine-elements, dfam
keywords: power screw, lead screw, pitch, lead, starts, backdrive, Acme, trapezoidal, printed nut, wear nut, jack screw, vise screw, efficiency, self-locking
related_recipes: d-screw-vise, d-screw-vise-fit, revolved-spacer
sources: nasa-fastener, doe-3d
---

# Power screws and lead screws (CAD-time)

A **power screw** turns rotary motion into linear motion (vise, jack, axis).
CAD can model the helix and envelopes; it does **not** certify load, wear, or
self-locking. Prefer purchased screws/nuts when duty cycle or safety matters.

**Attribution:** joint hygiene ideas aligned with NASA Fastener Design Manual
RP-1228 (public domain) plus DFM checklists. No torque/load tables here.

## Vocabulary

| Term | Meaning |
|------|---------|
| **Pitch** | Axial distance between adjacent thread flanks |
| **Lead** | Axial travel per revolution (= pitch × starts) |
| **Starts** | Number of parallel threads |
| **Backdrive** | Linear load turning the screw; “self-locking” is conditional |
| **Wear nut** | Replaceable nut (often the printed or soft member) |

## CAD-time checklist

1. **Purchased vs printed** — name the screw/nut SKU or the printed wear pair;
   prefer catalog ratings over implying duty from a cosmetic helix
   ([cosmetic threads](cosmetic-threads-vs-clearance.md)).
2. **Lead ↔ travel** — document lead so turn counts are not invented.
3. **Nut role** — captive / flanged / trapezoid / printed — and how it is
   retained ([captive nut](captive-nut-hex-trap.md)).
4. **Alignment** — screw axis vs slide guides; overconstraint fights the nut
   ([locating schemes](locating-scheme-dof.md)).
5. **Fits** — running clearance on guides and nut; coupon before product
   (`d-screw-vise-fit`, [fits](fits-clearances.md)).
6. **Access** — assembly order for screw, nut, thrust, keepers (vise recipe
   narrative is the worked example: `d-screw-vise`).
7. **Lubrication / wear** — printed nuts are consumables; plan replacement.
8. **VERIFY** — torque, buckling, and backdrive claims need cited methods —
   not Help prose ([research before commit](../../concepts/research-before-commit.md)).

## Live examples

- `d-screw-vise` — interrupted helical screw, wear nut, thrust stack
- `d-screw-vise-fit` — qualify thread and slide coupons first
- `revolved-spacer` — annular spacer patterns often appear in screw stacks

Related: [fasteners & joints](fasteners-joints.md),
[additive workholding](../../concepts/additive-workholding.md),
[fit coupons map](fit-coupons-recipes-map.md).
