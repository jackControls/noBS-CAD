---
type: Concept
title: Bearing supports and axial retention
description: Purchased bearing variants, inner-race contact, spacer stacks, shaft collars, access and low-drag assembly.
status: stable
updated: 2026-09-11
---

# Bearing supports and axial retention

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
method. Do not draw a convenient thin annulus and describe it as an unspecified
purchased collar. Set-screw and clamp collars can differ in size and shaft
marking; preserve installation/removal access after the housing is assembled.
For example, Ruland's 8 mm set-screw MSC-8-F is 16 mm OD and 8 mm wide, while its
two-piece clamp MSP-8-F is 18 mm OD and 9 mm wide. These are different parts,
not interchangeable clearance envelopes.
[Set-screw catalog](https://www.ruland.com/shaft-collars/set-screw-shaft-collar/msc-metric.html?p=4),
[clamp collar](https://www.ruland.com/msp-8-f.html).

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
Do not squeeze an uncertain printed stack between collars until it appears
tight: excess fit or unintended preload can increase drag and damage bearings.
Provide adjustment and measure free rotation after each retaining operation.
[NSK fits and internal clearance](https://www.nsk.com/tools-resources/abc-bearings/fits-and-internal-clearance/).

Fit each ring with force applied to that ring; do not transmit installation
force through the balls. Include shaft lead-ins, deburring, bearing insertion
direction and access for the pressing sleeve, fasteners and removal tool.
[NSK mounting guidance](https://www.nsk.com/eu-en/tools-resources/technical-services/mounting-tools/).

## Verify the complete assembly

Check assembly paths, running clearance, shaft runout, axial movement and tool
access. Print representative seats before the housing, then measure starting
and running resistance with the actual bearings and retention hardware.
Catalog bearing load ratings do not rate the printed housing or its clamps.
An ideal revolute joint proves a kinematic relationship, not bearing friction,
alignment, retention or durability. See [additive workholding](additive-workholding.md)
and [small generators](small-wind-generators.md) for related checks.
