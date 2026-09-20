---
type: Concept
title: DFM process guidelines
description: Starting manufacturability heuristics by process family; confirm with your shop.
status: draft
updated: 2026-09-11
topics: dfm, cnc, sheet-metal, casting, injection-molding, welding, edm
keywords: draft, wall thickness, bend radius, tool access, fillet, pocket depth
related_recipes: mounting-plate, angle-bracket, fillet-basics
sources: nwtc-guns-dfm
---

# DFM process guidelines

**Attribution:** heuristics adapted from Guns / NWTC LibreTexts
*[Ch. 2 — DFM Guidelines for Specific Manufacturing Processes](https://eng.libretexts.org/Courses/Northeast_Wisconsin_Technical_College/Design_for_Various_Manufacturing_Methods/02%3A_DFM_Guidelines_for_Specific_Manufacturing_Processes)*,
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Numbers below are **starting guidance**, not shop standards — confirm with
your process, material, and vendor.

## Injection molding

Aim for even walls; avoid sudden thick-to-thin jumps. Add draft on walls
parallel to pull. Prefer ribs and supported bosses over massive sections.
Round sharp corners; put gates and parting lines where cosmetics matter least.

## Casting

Draft and even sections help fill and shrink predictably. Generous fillets;
simple parting lines. Leave machining stock only where you will really cut.

## Sheet metal

Keep bend radii consistent (often on the order of sheet thickness). Keep
holes and slots well clear of bend lines. Give flanges enough length; add
relief where bends meet. Prefer features that fit standard punches/dies.

## Welding

Fewer welds usually beat many tiny ones. Give the torch or robot access.
Match thicknesses at the joint when you can; allow for shrinkage in locators.

## EDM

Conductive materials only. Internal corners follow wire/electrode limits —
plan a small radius. Deep narrow cavities and ultra-fine finish cost time.

## CNC machining

Internal corners need real end-mill radii. Deep pockets need reachable tools
and sensible depth-to-diameter. Minimize setups; loosen non-critical
tolerances; prefer near-net blanks over hogging air.

## Additive (bridge)

Orientation, supports, anisotropy, and hole shrinkage dominate. Use
[fit coupons](fits-clearances.md) before locking mating geometry
(`turbine-fit-coupons`, `d-screw-vise-fit`).

Related: [DFM overview](dfm-overview.md), [taxonomy](../taxonomy.md).
