---
type: Concept
title: Bearings, hubs, and seats (CAD-time)
description: Shaft/housing seats, fit roles, preload/spacer stacks, and load/speed/life as VERIFY to catalog — no invented L10 tables.
status: draft
updated: 2026-09-20
topics: machine-elements, bearings, shafts, fits, mechanisms, am, dfm
keywords: bearing seat, housing bore, shaft seat, inner ring, outer ring, press fit hub, lead-in, shoulder, abutment, spacer stack, preload, float, L10 life, radial load, axial load, C0 C dynamic
related_recipes: turbine-fit-coupons, vertical-axis-turbine, d-screw-vise-fit, revolved-spacer
sources: nasa-bearing, mit-272, nist-gdt-2, doe-3d
---

# Bearings, hubs, and seats (CAD-time)

CAD owns **seat geometry**, **fit roles**, and **axial stacks**. Catalogs own
load ratings, speed limits, and life (L10) curves. Prefer a named purchased
bearing with its drawing over inventing capacity tables in Help.

**Attribution:** rotating-machinery role language aligned with public-domain
NASA bearing notes (`nasa-bearing`); mechanisms context from MIT OCW 2.72
(`mit-272`, link-only). Fit-class teaching via NIST. No L10 / dynamic-capacity
charts here — VERIFY against the bearing maker.

Purchased SKU detail, shield/seal tradeoffs, and collar envelopes:
[bearing supports / hubs / axial retention](../../concepts/bearing-stacks.md).

## Vocabulary

| Term | Meaning |
|------|---------|
| **Inner / outer ring** | Rotating vs stationary race — name which before setting fits |
| **Shaft seat** | Journal diameter + shoulder/abutment that locate the **inner** ring |
| **Housing seat** | Bore + shoulder that locate the **outer** ring |
| **Hub** | Press or locate feature for a pulley/gear/collar on a shaft |
| **Spacer stack** | Inner-ring and/or outer-ring spacers that set axial location or preload |
| **Preload vs float** | Intentional axial clamp vs one bearing free to slide axially |
| **L10 / life / C / C0** | Catalog VERIFY quantities — not Help tables |

## Golden path (CAD-time)

1. **Name duty** — radial load, axial/thrust, speed (continuous vs intermittent),
   environment (dust, moisture), and which ring rotates. Prefer
   [research before commit](../../concepts/research-before-commit.md) before
   cutting seats.
2. **Pick hardware** — record bearing designation, bore, OD, width, seal/shield,
   and supplier drawing. Collar/hub SKUs are separate envelopes
   ([bearing-stacks](../../concepts/bearing-stacks.md)).
3. **Load / speed / life = VERIFY** — dynamic capacity, static capacity, limiting
   speed, and L10 (or equivalent) stay on the **catalog or a cited method**.
   Do not invent life tables in CAD or Help. Prefer a bearing that meets duty
   with margin, then freeze geometry.
4. **Shaft seat** — journal diameter for the inner ring; shoulder or spacer
   abutment diameter that clears seals/shields; lead-in chamfer; optional grind
   relief so a fillet does not hold the race off the shoulder
   ([shafts / keys / rings](shafts-keys-retaining-rings.md),
   [fillet vs chamfer](fillet-chamfer.md)).
5. **Housing seat** — bore for the outer ring; depth ≥ width (or intentional
   stand-proud); wall around printed seats meets process min
   ([AM thin walls](am-thin-walls.md),
   [FDM holes / printed fits](am-fdm-holes-fit-allowances.md)).
6. **Fit roles** — assign **roles**, not tribal “H7 everywhere”:

   | Interface | Common intent | Notes |
   |-----------|---------------|-------|
   | Shaft ↔ **inner** ring | Often light press / firm locate | Press on the inner ring only |
   | Housing ↔ **outer** ring | Slip, transition, or light press | Printed bores shrink — coupon first |
   | Hub OD ↔ mate bore | Press hub / pulley / gear | Lead-in + shoulder stop |

   Class language: [fits & clearances](fits-clearances.md). Preferred-fit codes
   stay link-out (ISO 286).
7. **Preload / spacer stacks** — for two bearings, compute inner-ring stack and
   housing shoulder spacing from the **same datums** (widths + spacer + shim
   tolerances). Name **locate**, **float**, or **specified preload**. Prefer
   measuring free rotation after each retaining step; excess clamp raises drag
   and can damage bearings. Annular spacers: `revolved-spacer`.
8. **Assembly path** — route press force through the pressed ring, not the
   rolling elements; leave sleeve/tool access and removal path
   ([locating schemes](locating-scheme-dof.md)).
9. **VERIFY gate** — catalog load/speed/life; abutment dims from the bearing
   drawing; fit coupons for printed seats; free rotation after retention.
   An ideal revolute joint proves kinematics, not friction or durability.

## Prefer these patterns

| Need | Prefer |
|------|--------|
| Size for life / speed | Catalog C, C0, limiting speed, L10 method — cite, do not invent |
| Locate a race axially | Shoulder + spacer/collar sized to the abutment drawing |
| Soft printed housing | Coupon the bore; prefer slip/transition outer + firm inner |
| Two-bearing shaft | Named float or preload; matched spacer math from one datum set |
| Hub on shaft | Lead-in + shoulder stop; press force on the hub, not the bearing |

## Live examples

- `revolved-spacer` — annular spacers in shaft/bearing stacks
- `turbine-fit-coupons` / `vertical-axis-turbine` — hub and seat fit practice
- `d-screw-vise-fit` — qualify running fits before locking product geometry

## Further reading (link only)

- NASA rolling-element bearing notes (`nasa-bearing` in [SOURCES](../SOURCES.md))
- MIT OCW 2.72 — mechanisms, gears, bearings (`mit-272`)
- Product / SKU depth: [bearing-stacks](../../concepts/bearing-stacks.md)

Related: [mechanisms overview](mechanisms-overview.md),
[shafts, keys, and retaining rings](shafts-keys-retaining-rings.md),
[fits & clearances](fits-clearances.md),
[springs and couplings](springs-couplings.md),
[fit coupons & recipes map](fit-coupons-recipes-map.md),
[taxonomy](../taxonomy.md).
