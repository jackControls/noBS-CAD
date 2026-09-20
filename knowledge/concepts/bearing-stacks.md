---
type: Concept
title: Bearing supports, hubs, and axial retention
description: Purchased bearing seats, press-fit hubs, shaft lead-in, shoulders, spacer stacks, and low-drag assembly for printed housings.
status: stable
updated: 2026-09-20
topics: bearings, machine-elements, fits, am, dfm
keywords: bearing seat, press fit hub, lead-in, shaft shoulder, spacer stack, interference seat
related_recipes: turbine-fit-coupons, vertical-axis-turbine, d-screw-vise-fit, revolved-spacer
sources: nasa-bearing, nist-gdt-2
---

# Bearing supports, hubs, and axial retention

Use this when a printed housing supports a rotating shaft or when a collar,
washer or spacer retains a bearing. Trace the radial and axial load paths and
identify which surfaces rotate before setting clearances.

## Choose real hardware

Record the exact bearing designation, bore, outside diameter, width, seal or
shield type and supplier drawing. The same nominal bearing envelope can have
different starting resistance and environmental protection. NSK distinguishes
noncontact ZZ shields and VV seals from contact seals: low torque trades off
against water exclusion. Choose for the actual environment; an indoor low-power
experiment and an outdoor mechanism need different qualification.
[NSK shield and seal comparison](https://www.nsk.com/content/dam/nsk-marketing/projects-completed/literature/product-brochures/deep-grooves-bbs_product-brochure/en_deep-grooves-bbs_product-brochure/preview-pdf_deep-grooves-bbs_product-brochure_en/EN_Deep%20Grooves%20BBs_Product_Brochure_low-res.pdf).

Specify a collar by bore, outside diameter, width, screw envelope and fastening
method. Prefer modeling the real seat/shoulder stack over a convenient thin annulus labeled as an unspecified
purchased collar. Set-screw and clamp collars can differ in size and shaft
marking; preserve installation/removal access after the housing is assembled.
For example, Ruland's 8 mm set-screw MSC-8-F is 16 mm OD and 8 mm wide, while its
two-piece clamp MSP-8-F is 18 mm OD and 9 mm wide. These are different parts,
not interchangeable clearance envelopes.
[Set-screw catalog](https://www.ruland.com/shaft-collars/set-screw-shaft-collar/msc-metric.html?p=4),
[clamp collar](https://www.ruland.com/msp-8-f.html).

## Press-fit hub and bearing seat (roles)

Name **which ring** is stationary and which rotates, then assign fit **roles**
(not tribal “H7 everywhere”):

| Interface | Common intent | Notes |
|-----------|---------------|-------|
| Shaft ↔ **inner** ring | Often light press / firm locate | Press on the inner ring only |
| Housing bore ↔ **outer** ring | Slip, transition, or light press | Printed bores shrink — coupon first |
| Hub OD ↔ mate bore | Press hub / pulley / gear | Lead-in + shoulder stop |

See [fits & clearances](../machine-design/concepts/fits-clearances.md) for class
language. Preferred-fit codes stay **link-out**; treat this page as guidance, not an
ISO 286 chart.

### Hub / seat geometry checklist

1. **Lead-in** — short chamfer or radius on the entering end of shaft, hub, or
   housing bore so the ring starts square ([fillet vs chamfer](../machine-design/concepts/fillet-chamfer.md)).
2. **Shoulder / abutment** — positive axial stop at the correct race face;
   diameter must clear seals/shields per the bearing drawing.
3. **Relief / undercut** — optional grind relief so the fillet does not hold the
   race off the shoulder.
4. **Depth** — seat depth ≥ bearing width (or intentional stand-proud); prefer
   clearance so seals stay off a rubbing flat floor.
5. **Wall around printed seats** — remaining housing wall after the bore must
   meet process min ([AM thin walls](../machine-design/concepts/am-thin-walls.md)).

## Separate contact from clearance

An inner-race spacer or shaft shoulder must bear on the inner ring without
touching stationary shields, seals or the housing. Housing shoulders must
support the outer ring without rubbing rotating parts. Use the selected
bearing's abutment and fillet dimensions, including chamfers and face recesses.
A solid annular bearing envelope cannot verify those contacts. Minimum shaft
abutment diameter alone does not define the largest safe spacer diameter.
[NSK bearing dimensions](https://www.nsk.com/my-en/engineering/608-esm-md.html).

For two bearings, calculate the inner-ring stack and housing shoulder spacing
from the same datums, including widths, spacer length and shim tolerances.
Define the intended axial location, permitted float or specified preload.
Prefer measuring and coupons before clamping an uncertain printed stack between collars until it appears
tight: excess fit or unintended preload can increase drag and damage bearings.
Provide adjustment and measure free rotation after each retaining operation.
[NSK fits and internal clearance](https://www.nsk.com/tools-resources/abc-bearings/fits-and-internal-clearance/).

Fit each ring with force applied to that ring; route installation
force through the pressed ring, not the balls. Include shaft lead-ins, deburring, bearing insertion
direction and access for the pressing sleeve, fasteners and removal tool.
[NSK mounting guidance](https://www.nsk.com/eu-en/tools-resources/technical-services/mounting-tools/).

## Verify the complete assembly

Check assembly paths, running clearance, shaft runout, axial movement and tool
access. Print representative seats before the housing, then measure starting
and running resistance with the actual bearings and retention hardware.
Catalog bearing load ratings cover the bearing; rate the printed housing and clamps separately.
An ideal revolute joint proves a kinematic relationship, not bearing friction,
alignment, retention or durability. See [additive workholding](additive-workholding.md)
and [small generators](small-wind-generators.md) for related checks.

Related: [locating schemes](../machine-design/concepts/locating-scheme-dof.md),
[tolerance stack-up intro](../machine-design/concepts/tolerance-stackup-intro.md).
