---
type: Concept
title: AM boss-to-boss and standoff patterns
description: PCB and plate standoff patterns for FDM — boss pairs, height match, screw roles, and grid hygiene before committing hole circles.
status: draft
updated: 2026-09-20
topics: dfam, am, fdm, fasteners, hardware, enclosures
keywords: standoff, boss to boss, PCB standoff, stand-off pattern, mounting boss grid, spacer boss, stacked boss, through standoff, heat-set boss pair, FDM standoff height, bolt circle bosses
related_recipes: mounting-plate, turbine-fit-coupons, garden-bench
sources: nasa-fastener, nwtc-guns-dfm, doe-3d
---

# AM boss-to-boss and standoff patterns

A **standoff pattern** sets board or plate height, screw roles, and remaining
walls together. Treat it as a small assembly: two bosses (or boss + purchased
standoff), a fastener stack, and a locate story — not four unrelated cylinders.

**Attribution:** joint hygiene from NASA Fastener Design Manual RP-1228
(public domain) plus AM wall habits from Guns / NWTC
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Vendor PCB hole
charts are **link-out / measure**.

## Pattern classes

| Class | Intent |
|-------|--------|
| **Boss-to-boss (printed)** | Mating bosses in base + lid/board carrier; screw or insert in one side |
| **Boss + purchased standoff** | Metal/nylon standoff between boards; printed seats only |
| **Through-bolt stack** | Clearance both sides + nut/trap; height from spacers |
| **Snap / friction peg** | Low reuse; see [snap-fits](am-snap-fit.md) — usually wrong for PCB service |

## Design roles (name each)

1. **Height** — free length between mating faces; match the BOM standoff or
   stack of spacers. Mismatch → board bend or crushed gaskets.
2. **Screw role** — clearance, tap, or insert pilot
   ([fastener clearance](fastener-clearance-counterbore.md),
   [heat-set inserts](am-heat-set-inserts.md)).
3. **Anti-rotation / locate** — one tight fit or pin/slot so the pattern does
   not fight four equal interference holes
   ([locating schemes](locating-scheme-dof.md)).
4. **Grid / PCD** — from the **purchased** board or plate drawing; VERIFY before
   modeling ([hardware pocket research](am-hardware-pocket-research.md)).
5. **Base blend** — fillet/gusset into the parent so bosses survive print and
   torque ([ribs & gussets](am-ribs-gussets-draft.md)).

## FDM notes

- Match boss **heights** across a pattern; a 0.4 mm systematic short on one
  corner warps the board.
- Prefer insert axis near build **Z**; coupon torque on a 2×2 boss grid before
  the full housing.
- Remaining wall between adjacent bosses must stay ≥ process min after pilots
  ([thin walls](am-thin-walls.md)).
- For large plates, standoff grids interact with warpage —
  [warpage & flatness](am-warpage-cooling-flatness.md).

## Anti-patterns

- Copying a board outline without VERIFY of hole Ø and PCD
- Four identical press-fits (overconstraint) instead of locate + clearance
- Mixing heat-set and self-tap randomly across the same pattern
- Tall skinny bosses with no fillet into a thin floor
- Using cosmetic threads in the boss as the real joint —
  [cosmetic threads](cosmetic-threads-vs-clearance.md)

Related: [captive nut traps](captive-nut-hex-trap.md),
[fits](fits-clearances.md), [fit coupons map](fit-coupons-recipes-map.md).
