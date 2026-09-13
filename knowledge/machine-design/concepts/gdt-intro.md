---
type: Concept
title: GD&T intro
description: Choose functional datums, distinguish size from geometry, and plan inspectable tolerances.
status: stable
updated: 2026-09-13
topics: gdt, datums, drawings, inspection
keywords: GD&T, datum, DRF, feature control frame, MMC, LMC, Rule 1, envelope, ASME Y14.5, ISO GPS
related_recipes: turbine-fit-coupons, d-screw-vise-fit
sources: nist-gdt-1, nist-gdt-2
---

# GD&T intro

A CAD model describes nominal geometry. Manufacturing introduces variation:
a nominally round shaft can be tapered, a flat mounting face can warp, and
correctly sized holes can still be misplaced. **Geometric dimensioning and
tolerancing (GD&T)** describes acceptable geometric variation so a part can
be made and inspected against its intended function.

This introduction adapts *Fundamentals of Geometric Dimensioning and
Tolerancing*: [Part I](https://zenodo.org/records/7647256), Jaime Berez,
version 1.1.0 (2023), and [Part II](https://zenodo.org/records/8237278),
Jaime Berez and Maxwell Praniewicz, version 1.0.0 (2023). Both are licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the explanations
here are shortened and rewritten. Use the governing standard and edition
for a production drawing.

## Establish the references

A **datum feature** is real part geometry, such as a mounting face or bore.
A **datum** is a theoretically exact reference established from that geometry.
Attach datum identification to the feature, rather than directly to its
theoretical axis. A **datum reference frame** establishes ordered references;
their order affects how the part is located during inspection.

Choose references from assembly function. For a bearing housing, start with
the mounting and locating surfaces used by the actual assembly. Then consider
how a fixture or measurement system will establish those references. A
convenient CAD origin alone does not explain how a manufactured part locates.

## Read the tolerance control

A **feature control frame** identifies the geometric characteristic, tolerance
zone and applicable modifiers, followed by datum references when required.
**Basic dimensions** define theoretically exact geometry used by the control;
they do not supply an independent plus/minus tolerance.

- **Form** controls such as flatness and circularity do not reference datums.
- **Orientation** controls angular relationships to datums.
- **Position** controls location. ASME Y14.5-2018 removed concentricity and
  symmetry; choose a supported control that expresses the intended function.
- **Profile** controls a specified contour or surface; datum references depend
  on whether form alone or additional relationships are controlled.
- **Runout** controls variation relative to a datum axis during rotation.

For each callout, identify the controlled feature, the allowed zone and how
it will be measured. Adding datum references to every callout does not make
a drawing more complete.

## Size and form are related differently across systems

For an individual regular feature of size, ASME Rule #1 normally couples size
limits to form through a boundary of perfect form at **maximum material
condition (MMC)**, subject to the standard's exceptions. MMC is the largest
permitted shaft or smallest permitted hole. This does not require perfect
form at **least material condition (LMC)**. Where an MMC geometric tolerance
modifier applies, departure from MMC can permit additional geometric
tolerance; it is a separate choice from the size limits.

ISO GPS uses an independency principle. Do not assume a size tolerance supplies
the same default form envelope as ASME. State the governing system and edition
in the drawing set, then apply its rules consistently. See
[ISO 8015](https://www.iso.org/standard/55979.html) and
[ASME standards](https://www.asme.org/codes-standards).

## Apply this while designing

1. Identify the contacts, motion and load paths the part must provide.
2. Choose datum features that reflect its actual mounting and location.
3. Allocate size, form and relationship tolerances to those functional needs.
   A control need not constrain all six degrees of freedom.
4. Check the tolerance stack across mating parts, including assembly access.
5. Record an inspection method and acceptance criteria for critical features.

Keep model parameters, drawing limits and physical measurements distinct.
A successful recipe or an ideal assembly mate does not establish that the
manufactured parts satisfy their tolerances. Continue with
[fits and clearances](fits-clearances.md),
[bearing supports and axial retention](../../concepts/bearing-stacks.md), and
[design for manufacturing](dfm-overview.md).
