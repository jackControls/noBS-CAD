---
type: Concept
title: AM warpage, cooling, and flatness for large plates
description: Keep large FDM plates and lids flatter — orientation, ribbing, cooling, and when to split or fixture instead of fighting curl.
status: draft
updated: 2026-09-20
topics: dfam, am, fdm, print, enclosures
keywords: warpage, curling, flatness, large plate FDM, cooling, bed adhesion
related_recipes: mounting-plate, garden-bench, turbine-fit-coupons
sources: nwtc-guns-dfm, doe-3d
---

# AM warpage, cooling, and flatness for large plates

Large **plates**, lids, and enclosure floors curl, dish, and lose hole-pattern
accuracy when thermal gradients and residual stress win. Flatness is a
**design + process** problem — not only a slicer checkbox.

**Attribution:** process habits adapted from Guns / NWTC LibreTexts DFM
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) and DOE Module 3D
(public domain). Machine-specific bed/enclosure settings are **link-out**.

## What fails first

- Mating flanges that rock (seal and screw clamp fight each other)
- Boss/standoff patterns out of plane ([boss patterns](am-boss-standoff-patterns.md))
- Hole grids that no longer match the purchased PCD
- Cosmetic “flat” skins that telegraph ribs as sink or bulge

## Design levers (before dialing the printer)

1. **Split the part** — two smaller plates with a locate joint often beat one
   hero plate.
2. **Rib / corrugate** — stiffen against dish with ribs toward the neutral axis;
   keep even walls ([ribs & gussets](am-ribs-gussets-draft.md)).
3. **Symmetric mass** — heavy bosses on one face only encourage banana curves;
   balance or lighten.
4. **Orientation** — put the critical flat on the bed when accuracy matters;
   accept support tradeoffs ([thin walls / orientation](am-thin-walls.md),
   [supports](am-supports-overhangs.md)).
5. **Relief** — slots, crofs, or segmented flanges that allow local compliance
   instead of global curl fighting every screw.
6. **Datum story** — three-point mount or defined pads so a slightly cupped
   part still locates ([locating schemes](locating-scheme-dof.md)).

## Process levers (confirm on your machine)

- Bed adhesion and first-layer squish (elephant foot vs lift)
- Chamber / draft control for high-shrink materials
- Cooling fan policy on large solid skins (too aggressive → corner lift)
- Slow large solid infill skins; avoid sudden thick-to-thin thermal sinks
- Fixture or weight during cool-down for critical flats (shop practice)

Numbers and temperatures are **machine-/filament-specific** — prefer measuring over copying a
universal °C table from this page.

## Coupon / verify

Print a representative **span** (not a 20 mm square) with the real rib and boss
density. Measure flatness / rock on a surface plate or known flat, then check
the hole pattern against the mating part. Pair with
[fit coupons map](fit-coupons-recipes-map.md).
