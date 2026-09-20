---
type: Concept
title: Requirements → embodiment → BOM (CAD-time)
description: CAD-time hygiene — name requirements, pick embodiment, decide purchased vs print, assign BOM roles before freezing mates.
status: draft
updated: 2026-09-20
topics: design-hygiene, bom, requirements, embodiment, hardware, dfm, workflow
keywords: requirements, embodiment, BOM, purchased part, printed part, make vs buy, COTS, SKU, BOM role, phantom, reference designator, VERIFY table, freeze geometry
related_recipes: mounting-plate, turbine-fit-coupons, d-screw-vise-fit, vertical-axis-turbine
sources: doe-3d, nasa-fastener
---

# Requirements → embodiment → BOM (CAD-time)

Before mating geometry freezes, name **what must be true**, how the CAD
**embodiment** realizes it, and which items are **purchased** vs **printed /
machined in-house**. Help stays CAD-time roles — not a Stage-Gate or ERP
lecture.

**Attribution:** DFM / joint-hygiene habit from DOE Module 3D (public domain)
and fastener process notes (`nasa-fastener`). Catalog dims stay on datasheets
([research before commit](../../concepts/research-before-commit.md),
[hardware pocket research](am-hardware-pocket-research.md)).

## Vocabulary

| Term | CAD-time meaning |
|------|------------------|
| **Requirement** | Named must-be-true (fit, load path, access, duty) — not a feature wishlist |
| **Embodiment** | The CAD realization (print, machine, buy, or hybrid) that meets it |
| **Purchased / COTS** | Named **SKU** with envelope + critical dims from a drawing/datasheet |
| **Printed / in-house** | Geometry you own — still needs coupons and fit class |
| **BOM role** | How the line item behaves: purchased, fabricated, phantom/assy, fastener kit |

## Golden path (CAD-time)

1. **Write the requirement set** — functional musts only (locate, seal, transmit,
   access, service). Prefer fewer named musts over feature sprawl.
2. **Pick embodiment per must** — buy actuator / bearing / fastener; print the
   case; machine the shaft. One must → one primary embodiment before hybrids.
3. **Name purchased SKUs early** — envelope, PCD, spline, lead, pitch from the
   vendor drawing ([hardware pocket](am-hardware-pocket-research.md)). Do not
   invent pocket dims.
4. **Decide print vs buy for each body** — structural duty, wear, timing accuracy,
   and tolerance class push toward purchased machine elements
   ([mechanisms overview](mechanisms-overview.md),
   [DFM overview](dfm-overview.md)).
5. **Assign BOM roles** — purchased line, fabricated line, fastener kit, and any
   phantom/assy that exists only for structure. Same name in CAD tree and BOM.
6. **VERIFY before freeze** — table of SKU / critical dim / source; coupons for
   printed mates; interference at poses
   ([research before commit](../../concepts/research-before-commit.md),
   [fit coupons map](fit-coupons-recipes-map.md),
   [assembly interference](../../concepts/assembly-interference.md)).

## Prefer these patterns

| Need | Prefer |
|------|--------|
| Actuator / bearing / fastener | Named SKU + measured envelope before pocket cut |
| Structural case / lid / bracket | Print or machine in-house; buy inserts/fasteners |
| Timing / wear / high-cycle element | Purchased gear, cam, belt, chain, indexer |
| Ambiguous make-vs-buy | Coupon the printed option **and** leave the purchased envelope |
| BOM vs CAD tree fight | One role name shared by tree node and BOM line |

## Checklist

- [ ] Requirements named (musts, not wishlist)
- [ ] Embodiment chosen per must (buy / print / machine)
- [ ] Purchased SKUs + critical-dim sources recorded
- [ ] BOM roles match CAD tree (purchased / fab / kit / phantom)
- [ ] VERIFY table green (or waived with reason) before freeze

## Related

- [Research before commit](../../concepts/research-before-commit.md)
- [Hardware pocket research](am-hardware-pocket-research.md)
- [Mechanisms overview](mechanisms-overview.md)
- [DFM overview](dfm-overview.md)
- [Fasteners & joints](fasteners-joints.md)
- [Fit coupons / recipes map](fit-coupons-recipes-map.md)

Related: [taxonomy](../taxonomy.md).
