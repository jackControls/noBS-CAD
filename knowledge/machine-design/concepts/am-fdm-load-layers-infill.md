---
type: Concept
title: FDM load path vs layer orientation / infill roles
description: CAD-time load direction vs layer planes; shells carry structure; infill is not a datasheet; coupons for critical loads — no invented % strength tables.
status: draft
updated: 2026-09-20
topics: dfam, am, fdm, print, orientation
keywords: FDM load path, layer orientation, anisotropy, shells vs infill, perimeters strength, bed face tension, infill not structural datasheet
related_recipes: turbine-fit-coupons
sources: nwtc-guns-dfm, doe-3d
---

# FDM load path vs layer orientation / infill roles

FDM parts are **anisotropic**: strength along layers usually differs sharply from
strength across layers. At CAD time, treat **primary load direction** and
**bed face** as one decision — not a slicer afterthought.

**Attribution:** process habits from Guns / NWTC LibreTexts DFM
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) and DOE Module 3D
(public domain). **No invented percent-of-solid strength tables** for shells or
infill — vendor/process notes are starting guidance; lock critical loads on
coupons.

## Golden path (CAD-time)

1. **Name the primary load** — tension, bending, compression, shear, or impact;
   which face/edge takes it; static vs cyclic.
2. **Choose the bed face** so primary **tension** lies **in-plane with layers**
   when the part allows (layer bonds do not carry peel/tension across Z if you
   can avoid it). Trade against accuracy, supports, and cosmetics —
   [thin walls / orientation](am-thin-walls.md).
3. **Shells (perimeters / top-bottom skins) carry structure** — size outer walls
   and skins for the load path; ribs and gussets reinforce shells
   ([ribs & draft](am-ribs-gussets-draft.md)).
4. **Infill is fill, not a structural datasheet** — pattern and % change mass,
   print time, and some buckling feel, but do **not** treat a slicer infill %
   as a published allowable. Do not invent “X% infill = Y% strength” charts in
   CAD notes.
5. **Coupon critical loads** — print orientation-matched load coupons (or
   product-like coupons) before freezing brackets, clips, and hinges
   ([snap-fit / hinges](am-snap-fit.md), [fit coupons map](fit-coupons-recipes-map.md)).
6. **Export orientation** must match the qualification print
   ([export & print](../../concepts/export-print.md)).

Hub: [DFAM for FDM overview](dfam-fdm-overview.md).

## Shells vs infill (roles)

| Role | CAD / design intent |
|------|---------------------|
| **Outer shells / perimeters** | Primary load path, impact faces, screw bosses, snap beams |
| **Top / bottom skins** | Close the shell; bending skins need enough solid layers for the span |
| **Infill** | Interior fill for printability and light stiffening — **not** a substitute for wall/rib design |
| **Local solid regions** | Prefer modeled solid or near-solid where inserts, traps, or high bearing stress live |

If a feature needs predictable strength, put material in **walls, ribs, and
orientation** first — then pick a modest infill that prints cleanly.

## What not to do

- Orient a tensile strap so layers peel under the primary load “because it
  supports less.”
- Quote a blog “% strength vs solid” table as design truth.
- Rely on dense infill alone to fix a thin shell or wrong bed face.
- Freeze living hinges or load-critical snaps without a bend-vs-layer plan
  ([AM snap-fits](am-snap-fit.md)).

## CAD-time checklist

1. State primary load direction in part coordinates.
2. State intended bed face and why (strength vs support vs cosmetics).
3. Confirm shells/ribs on the load path; infill is secondary.
4. Plan orientation-matched coupons for any load-critical region.

Related: [DFAM FDM overview](dfam-fdm-overview.md),
[AM thin walls](am-thin-walls.md), [SOURCES](../SOURCES.md).
