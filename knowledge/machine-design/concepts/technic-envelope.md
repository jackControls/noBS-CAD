---
type: Concept
title: Technic-style beam and pin envelope (unofficial)
description: Open-source LDraw nominals (LDU→mm) for brick/Technic-compatible envelopes — unofficial, not a LEGO Group spec; measure and coupon before commit.
status: draft
updated: 2026-09-20
topics: mechanisms, joints, dfam, lego, technic
keywords: Technic, Lego, LEGO, LDraw, LDU, stud pitch, brick height, plate height, stud diameter, anti-stud, beam hole pitch, pin diameter, axle cross-section, axle length, printed Technic hole
related_recipes: repeated-bracket-assembly
sources: ldraw-ffs, ldraw-opls, technic-scad, doe-3d
---

# Technic-style beam and pin envelope (unofficial)

> **Warning — unofficial.** Nominal design envelope for brick / Technic-style
> mechanisms distilled from **open** community CAD specs — **not** a LEGO® Group
> specification, not a trademark license, not a clutch-power guarantee.
> **Measure your bricks/pins** and keep a VERIFY table
> ([research before commit](../../concepts/research-before-commit.md)).

LEGO® and Technic are trademarks of the LEGO Group, which does not sponsor or
endorse this help page. Prefer purchased pins/axles when clutch and wear matter.

## Calipers first

Open CAD libraries publish **design** grids (exact LDU counts). Physical ABS has
mold play, generation drift, and clone variance. Golden path:
**physical calipers → coupon → lock**. Prefer **mm** project units
([MCP workflow](../../concepts/agent-mcp-workflow.md)).

## LDU conversion (LDraw)

[LDraw File Format Specification](https://www.ldraw.org/article/218.html)
(`ldraw-ffs`) defines **LDraw Units (LDU)** and states the real-world
approximations:

| Conversion | Value |
|------------|-------|
| 1 LDU | **0.4 mm** (also ≈ 1/64 in) |

Those are **approximations** — LDraw says verify key points against real parts.
Community metrology (link-only further reading) finds ~0.4 mm/LDU is the practical
metric convention for stud pitch.

**How to convert:** `mm ≈ LDU × 0.4`. Example: 20 LDU → 8.0 mm.

## Brick / stud nominals (LDraw)

From the same LDraw LDU table (design grid, not production drawings):

| Quantity | LDU | ≈ mm (×0.4) | Notes |
|----------|-----|-------------|-------|
| Stud / module pitch (brick width per stud) | 20 | **8.0** | Horizontal grid |
| Brick height (body, excluding stud) | 24 | **9.6** | Classic brick module |
| Plate height | 8 | **3.2** | ⅓ brick height |
| Stud diameter | 12 | **4.8** | Design OD |
| Stud height | 4 | **1.6** | Design height |

**Anti-stud / underside tubes:** LDraw models studs and underside tubes so plates
and bricks stack on the same 20 LDU grid. Tube IDs and wall thicknesses are part-
geometry details (see official library primitives) — **measure** the anti-stud
grip on your bricks; do not treat forum OD/ID folklore as certified.

Official library rules also treat **1 stud = 20 LDU** for dimension language
([Official Parts Library Specifications](https://www.ldraw.org/article/512.html),
`ldraw-opls`).

## Technic beam / pin / axle nominals

Technic-style beams share the **same 8 mm hole pitch** as the stud grid
(1 hole step = 20 LDU = 8 mm). Pin/axle holes are the **12 LDU (≈4.8 mm)** class
in LDraw space — the same LDU diameter as the stud.

| Quantity | Open nominal | Notes |
|----------|--------------|-------|
| Beam hole pitch | **8.0 mm** (20 LDU) | Along beam; same module as stud pitch |
| Pin / round hole ID (design) | **≈4.8 mm** (12 LDU) | LDraw hole class; production often slightly larger — measure |
| Beam thickness (design class) | **≈8 mm** (20 LDU) | Physical liftarms often ~7.4–7.9 mm — measure |
| Axle length module | **N × 8 mm** | Length in “L” / studs; e.g. 3L ≈ 24 mm useful length class |
| Axle cross-section | **+ / cross** fitting ~4.8 mm envelope | Two perpendicular splines in a ~4.8 mm circumscribed class (open CAD kits) |

Open MIT-licensed [Technic.scad](https://github.com/cfinke/Technic.scad)
(`technic-scad`) uses **8 mm** hole spacing and **~4.85 mm** hole/pin diameter as
print-oriented starting constants — compatible intent, not a LEGO drawing.

## Printed mates (DFAM golden path)

For FDM parts that must accept purchased Technic pins/axles or mate to ABS bricks:

1. **Lock the grid** — pitch **8.0 mm**, hole class **~4.8 mm** design from LDraw.
2. **Name the fit** — slip vs friction/clutch
   ([fits & clearances](fits-clearances.md)).
3. **Bias for print** — start near the open kit hole (~4.85 mm) or add a small
   diametral allowance vs 4.8 mm, then **coupon** on your printer/material
   ([FDM holes / fit allowances](am-fdm-holes-fit-allowances.md)).
4. **Prefer purchased pins/axles** when wear or clutch matters; printed pins are
   a different material system ([alignment nubs vs pins](alignment-nubs-pins.md)).
5. **Avoid overconstraint** — dense pin fields fight shrink
   ([locating schemes](locating-scheme-dof.md)).
6. **No trademarked logos/word marks** on distributable geometry.

## Design rules if you proceed

1. Record **pitch**, **hole ID**, **pin/axle OD**, and fit class in a VERIFY table.
2. Print hole/axle **coupons** before a full beam lattice.
3. Keep project units in **mm**; convert from LDU only at the research step.
4. Cite open sources in the drawing notes when sharing (LDraw LDU table + measured).

## Checklist

- [ ] Caliper measurements recorded (pitch, hole ID, pin/axle OD)
- [ ] LDU→mm conversion checked (×0.4) where LDraw geometry was the start
- [ ] Fit class named (slip vs friction)
- [ ] Coupon printed and measured after cool-down
- [ ] No trademarked marks on distributable geometry
- [ ] Locator count reviewed for overconstraint

## Further reading (link only)

- LDraw File Format Spec — LDU table: https://www.ldraw.org/article/218.html
- LDraw Official Parts Library Specs: https://www.ldraw.org/article/512.html
- Technic.scad (MIT): https://github.com/cfinke/Technic.scad
- Empirical LDU length note (community metrology): https://itn-web.it.liu.se/~stegu76/lego/LDUlength.pdf
- Independent reverse-engineering narrative (verify license before reuse): https://www.cailliau.org/Alphabetical/L/Lego/Dimensions/

Related: [mechanisms overview](mechanisms-overview.md),
[linkages / mobility](mechanisms-linkages-mobility.md),
[SOURCES](../SOURCES.md).
