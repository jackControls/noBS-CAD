---
type: Concept
title: AM enclosure lid, gasket, and labyrinth seal
description: Generic FDM enclosure lid strategies — flat gasket seat, printed labyrinth, crush lip — and when each beats a bare snap or screw stack.
status: draft
updated: 2026-09-20
topics: enclosures, dfam, am, fdm, seals, joints
keywords: enclosure lid, gasket seat, labyrinth seal, dust seal, crush lip, tongue and groove, O-ring groove AM, lid rebate, weather lip, light-tight seam, FDM enclosure seal, mating flange
related_recipes: turbine-fit-coupons, mounting-plate
sources: nwtc-guns-dfm, doe-3d, palni-dfma
---

# AM enclosure lid, gasket, and labyrinth seal

An enclosure **lid** is a mating system, not a flat plate on four screws. Name
the **seal class**, the **clamp method**, and the **service cycle** before
cutting rebates. FDM layers leak light and dust along Z seams unless the
mating path is intentional.

**Attribution:** enclosure / DFA habits adapted from Guns / NWTC LibreTexts
DFM ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), DOE Module 3D
(public domain), and PALNI DFMA ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).
Heuristics only — IP / weather ratings need a measured coupon, not this page.

## Seal classes (pick one primary)

| Class | Intent | Typical mates |
|-------|--------|---------------|
| **Bare face** | Service cover; no seal claim | Flat flange + screws / snaps |
| **Crush lip / knife** | Soft plastic-on-plastic dust barrier | Thin ridge into a flat or channel |
| **Tongue & groove / labyrinth** | Longer leak path; no elastomer | Interlocking walls along the perimeter |
| **Gasket seat** | Soft purchased gasket or foam | Groove or rebate sized to gasket cross-section |
| **O-ring groove** | Round elastomer; higher clamp discipline | Vendor groove + compression % (link-out chart) |

Do not claim “weatherproof” from a labyrinth alone. Labyrinths slow dust and
splash; elastomers and clamp load do sealing work.

## Lid anatomy (roles)

1. **Mating flange** — continuous land wide enough for screws, snaps, or
   gasket support after print allowance.
2. **Seal feature** — one of the classes above; keep it unbroken at corners
   (filleted path, not sharp inner corners that tear gaskets).
3. **Clamp stack** — screws into [heat-set inserts](am-heat-set-inserts.md) /
   [nut traps](captive-nut-hex-trap.md), or a [clamshell](am-clamshell-retainer.md)
   / [snap](am-snap-fit.md) pattern. Say which features carry clamp vs locate.
4. **Locate** — pins, nubs, or asymmetric keys so the seal is not asked to
   align the lid ([alignment nubs](alignment-nubs-pins.md),
   [locating schemes](locating-scheme-dof.md)).
5. **Service story** — hinge, tether, captive screws, or full removal; plan
   cable exits that survive open/close ([cable exits](am-cable-exits-strain-relief.md)).

## FDM notes

- Prefer the **seal path in the XY plane** when possible so layer rings do not
  open a stair-step leak along the perimeter.
- Gasket grooves need remaining wall ≥ process min after the cut —
  [thin walls](am-thin-walls.md). Paper-thin groove floors crush or crack.
- Labyrinth walls are tall thin features — check overhangs and support cleanup
  ([supports](am-supports-overhangs.md)).
- Coupon: print a short arc of the seal, clamp with the real stack, check dust
  / light / water spray as appropriate. Do not scale a 20 mm coupon to a
  300 mm lid without a flatness plan ([warpage & flatness](am-warpage-cooling-flatness.md)).

## Anti-patterns

- Screws through a gasket with no compression stop (over-crush → leak + take-set)
- Interrupted labyrinth at every screw boss (“comb” of leaks)
- Modeling an O-ring as a CAD torus boolean instead of a groove + BOM line
- Relying on snap beams alone for a sealed service lid
- Sharp rectangular gasket grooves that nick foam on first install

Related: [assembly join choice](am-assembly-join-choice.md),
[fits](fits-clearances.md), [hardware pocket research](am-hardware-pocket-research.md).
