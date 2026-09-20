---
type: Concept
title: Requirements → embodiment → BOM (CAD-time)
description: CAD-time hygiene — name requirements, pick embodiment, make-vs-buy, BOM roles matching the CAD tree, and VERIFY before freezing mates (no ERP lecture).
status: draft
updated: 2026-09-20
topics: design-hygiene, bom, requirements, embodiment, hardware, dfm, workflow
keywords: requirements, embodiment, BOM, purchased part, printed part, make vs buy, COTS, SKU, BOM role, phantom, reference designator, fastener kit, indentured BOM, VERIFY table, freeze geometry, standardize parts, buy before invent
related_recipes: mounting-plate, turbine-fit-coupons, d-screw-vise-fit, vertical-axis-turbine
sources: doe-3d, nasa-fastener, nwtc-guns-dfm, palni-dfma
---

# Requirements → embodiment → BOM (CAD-time)

Before mating geometry freezes, name **what must be true**, how the CAD
**embodiment** realizes it, and which items are **purchased** vs **printed /
machined in-house**. Help stays CAD-time roles — not a Stage-Gate or ERP
lecture.

**Attribution:** DFM / DFA habits from DOE Module 3D (public domain —
`doe-3d`: standardize parts, prefer fewer unique fasteners, design for
assembly access) and NWTC / PALNI DFM–DFA distill (`nwtc-guns-dfm`,
`palni-dfma`: buy before invent, merge only when motion/material/service
allows). Purchased fastener lines follow joint hygiene in
`nasa-fastener`. Catalog dims stay on datasheets
([research before commit](../../concepts/research-before-commit.md),
[hardware pocket research](am-hardware-pocket-research.md)).

## Vocabulary

| Term | CAD-time meaning |
|------|------------------|
| **Requirement** | Named must-be-true (fit, load path, access, duty, service) — not a feature wishlist |
| **Embodiment** | The CAD realization (print, machine, buy, or hybrid) that meets one primary must |
| **Purchased / COTS** | Named **SKU** with envelope + critical dims from a drawing/datasheet |
| **Printed / in-house** | Geometry you own — still needs coupons and fit class |
| **Make vs buy** | Per-body decision: invent geometry only when catalog stock cannot meet the must |
| **BOM role** | How the line item behaves: purchased, fabricated, phantom/assy, fastener kit |
| **Phantom / assy** | Structure-only node (grouping) — may appear in the CAD tree without a purchasable SKU |
| **Fastener kit** | Consolidated purchased hardware lines (size/grade/finish) — prefer few unique sizes |
| **Reference designator** | Stable tag shared by CAD tree node, BOM line, and drawing balloon (e.g. `BRG-1`) |
| **Indentured vs flat** | Nested tree vs flat pick-list view of the same roles — names must still match |

## Golden path (CAD-time)

1. **Write the requirement set** — functional musts only (locate, seal, transmit,
   access, service, environment). Prefer fewer named musts over feature sprawl.
2. **Pick embodiment per must** — buy actuator / bearing / fastener; print the
   case; machine the shaft. One must → one primary embodiment before hybrids.
3. **Make vs buy per body** — prefer purchased machine elements and stock shapes
   when timing, wear, tolerance class, or strength matter
   ([DFM overview](dfm-overview.md),
   [mechanisms overview](mechanisms-overview.md)). Invent printed geometry for
   envelopes, brackets, and AM-friendly structure — not for mystery “strong
   filament” substitutes for named bearings or grades.
4. **Name purchased SKUs early** — envelope, PCD, spline, lead, pitch, finish
   from the vendor drawing ([hardware pocket](am-hardware-pocket-research.md)).
   Do not invent pocket dims. Record SKU + source in the VERIFY table.
5. **Assign BOM roles** — purchased line, fabricated line, fastener kit, and any
   phantom/assy that exists only for structure. Same **reference designator**
   (or shared role name) in CAD tree, BOM, and drawing balloon.
6. **Standardize hardware families** — few unique screw sizes/lengths/finishes
   across the assembly (DOE standardize habit). Group as a **fastener kit** when
   the BOM would otherwise grow a unique M3×N for every pocket
   ([fasteners & joints](fasteners-joints.md)).
7. **Separate locate vs clamp / join** — pins/nubs locate; screws or snaps join
   ([alignment nubs](alignment-nubs-pins.md),
   [locating schemes](locating-scheme-dof.md),
   [AM join choice](am-assembly-join-choice.md)). Do not let “add another screw”
   substitute for a named locating scheme.
8. **VERIFY before freeze** — table of SKU / critical dim / source; coupons for
   printed mates; interference at poses; tool access after the cover closes.
   Green (or waived with reason) before freezing mates
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
| BOM vs CAD tree fight | One reference designator / role name shared by tree, BOM, balloon |
| Many unique screws | Standardize length/finish; kit the remainder |
| Late “we need a part number” | Stop — reopen VERIFY; do not invent a SKU after mates freeze |

## VERIFY table (CAD brief)

Capture before freezing pockets and mates (same spirit as
[research before commit](../../concepts/research-before-commit.md)):

| Item | Role | CAD guess | Datasheet / measure | Source | Status |
|------|------|-----------|---------------------|--------|--------|
| Purchased SKU | purchased | … | … | catalog rev | OK / WAIVE |
| Critical envelope / PCD | purchased | … | … | drawing | … |
| Fabricated body | fab / print | … | process + coupon | KB / printer | … |
| Fastener family | kit | M3×? | grade/finish/locking | datasheet | … |
| Phantom / assy node | phantom | name only | — | tree | … |

Changing a VERIFY row past process tolerance ⇒ regenerate affected features;
if make-vs-buy flips, scrap the wrong embodiment rather than patch mates.

## Anti-patterns (freeze too early)

- Modeling clearance holes before the fastener **SKU / length / finish** is named
- Printing a “bearing” or “gear” that should be purchased for wear/timing
- CAD tree names that do not match BOM lines or balloons
- One unique screw length per boss (tool-change and wrong-length traps)
- Freezing mates, then discovering the purchased envelope does not fit
- Wishlist features with no must (scope creep disguised as requirements)

## Checklist before freezing mates

- [ ] Requirements named (musts, not wishlist)
- [ ] Embodiment chosen per must (buy / print / machine)
- [ ] Make-vs-buy decided per body; purchased SKUs + critical-dim sources recorded
- [ ] BOM roles match CAD tree (purchased / fab / kit / phantom) with shared names
- [ ] Fastener families standardized where function allows
- [ ] Locate vs clamp / join separated
- [ ] VERIFY table green (or waived with reason) before freeze
- [ ] Interference / access checked at relevant poses

## Related

- [Research before commit](../../concepts/research-before-commit.md)
- [Hardware pocket research](am-hardware-pocket-research.md)
- [Mechanisms overview](mechanisms-overview.md)
- [DFM overview](dfm-overview.md)
- [Fasteners & joints](fasteners-joints.md)
- [Fit coupons / recipes map](fit-coupons-recipes-map.md)
- [AM assembly join choice](am-assembly-join-choice.md)

Related: [taxonomy](../taxonomy.md), [SOURCES](../SOURCES.md).
