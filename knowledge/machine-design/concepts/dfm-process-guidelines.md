---
type: Concept
title: DFM process guidelines
description: Short manufacturability heuristics for molding, casting, sheet, weld, EDM, and CNC.
status: draft
updated: 2026-09-11
topics: dfm, cnc, sheet-metal, casting, injection-molding, welding, edm
keywords: draft, wall thickness, bend radius, tool access, fillet, pocket depth
related_recipes: mounting-plate, angle-bracket, fillet-basics
sources: nwtc-guns-dfm
---

# DFM process guidelines

Teaching heuristics rewritten from Guns / NWTC LibreTexts Chapter 2
(**CC BY 4.0**). Numbers are **starting guidance**, not shop standards — confirm
with your process and material.

## Injection molding

- Keep walls **uniform** (often ~1–3 mm for many plastics); taper thickness changes.
- Add **draft** (~1–2° per side) on walls parallel to pull.
- Prefer **ribs** (~half wall thickness class) over thick sections; support bosses.
- **Fillet** sharp corners; place gates and parting lines where finish matters least.

## Casting

- Draft and uniform sections to control fill, shrinkage, and porosity.
- Generous fillets; simple parting lines.
- Plan machining stock only where needed; talk risers/feeders with the foundry.

## Sheet metal

- Bend radius often **≈ sheet thickness**; keep it consistent.
- Keep holes/cutouts **well clear** of bend lines (commonly a few thicknesses).
- Adequate flange length; relief notches where bends meet.
- Design for **standard** punches/dies when you can.

## Welding

- Fewer welds beat many small ones — combine parts when function allows.
- Joint **access** for torch or robot; matched thicknesses at the joint.
- Allow for **shrinkage** in locating dimensions.

## EDM

- Conductive materials only.
- Internal corners follow electrode/wire limits — plan a small radius.
- Thin walls and deep narrow cavities cost time and risk heat damage.
- Ultra-tight tolerance and finish are possible but expensive.

## CNC machining

- Internal corner radii should match **real end mills**; deep pockets need reachable tools.
- Limit depth relative to tool diameter; minimize setups (3-axis when enough).
- Loosen non-critical tolerances; near-net blanks beat hogging huge blocks.

## Additive (bridge)

Orientation, supports, anisotropy, and hole shrinkage dominate. Use
[fit coupons](fits-clearances.md) before committing mating geometry
(`turbine-fit-coupons`, `d-screw-vise-fit`).

Related: [DFM overview](dfm-overview.md), [taxonomy](../taxonomy.md).
