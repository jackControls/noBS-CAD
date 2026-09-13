---
type: Concept
title: Design for manufacturing and assembly
description: Choose the process, material, hardware and assembly sequence before committing detailed geometry.
status: stable
updated: 2026-09-13
topics: dfm, dfa, manufacturing, materials, fasteners
keywords: process selection, material properties, hardware, assembly access, inspection
related_recipes: turbine-fit-coupons, d-screw-vise-fit, garden-bench, vertical-axis-turbine, d-screw-vise
sources: nwtc-guns-dfm
---

# Design for manufacturing and assembly

Choose how a part will be made and assembled while its dimensions are still
cheap to change. A workable design accounts for tool access, process variation
and the order in which the parts come together.

## Before modeling

1. State the function, working travel, loads, environment and intended lifetime.
2. Choose a process and material together. Availability, stock size and production
   quantity matter alongside geometry.
3. Name the surfaces that locate, slide, clamp or transmit load. Give those
   relationships explicit dimensions and tolerances.
4. Choose purchased hardware before sizing its pockets, clearance and access.
5. Write an assembly sequence, including removal of wear parts. Combine parts
   only when motion, material and service access permit it.

These principles are adapted from Bryan Guns, NWTC,
[Design for Manufacturing](https://eng.libretexts.org/Courses/Northeast_Wisconsin_Technical_College/Design_for_Various_Manufacturing_Methods/01%3A_Design_for_Manufacturing_%28DFM%29),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Wording and the CAD
workflow below are tailored to noBS CAD; no assembly-time tables are reproduced.

## Turn the decisions into an editable design

For the vise, distinguish the jaw load path, guide contact, running clearance,
screw travel and fastener access. Drive mating dimensions from shared parameters;
changing the jaw width should not leave an unrelated guide or mounting hole behind.
[Additive workholding](../../concepts/additive-workholding.md) explains the
captured guide, interrupted screw and hand-clearance checks.

Specify real hardware by size, length, head, grade and supplier dimensions where
needed. Keep clearance envelopes distinguishable from purchased parts. For the
current hardware list, read the committed recipe rather than copying a second
list into a help article.

A material name or viewport color is not a design calculation. Record the grade,
process, orientation and source of any property used in a calculation. Stiffness,
strength, temperature resistance and long-term deformation answer different
questions. Record those assumptions alongside the dimensions they affect; do not
turn an illustrative calculation into a load rating.

## Evidence before release

Use [fits and clearances](fits-clearances.md) to state the allowable size range.
Check assembly placement, travel and interference, then review the drawing and
BOM against the intended assembly sequence. Use the committed fit-coupon recipes
for the actual mating geometry and chosen printer/material/process.

Keep software results and physical observations separate. Successful replay,
export and ideal joint motion establish useful digital evidence; a physical
prototype establishes whether parts assemble, move and survive their intended use.
Feed measured corrections back into the parameters and replay the recipe.

Related: [manufacturing process checks](dfm-process-guidelines.md),
[GD&T intro](gdt-intro.md), [sources](../SOURCES.md).
