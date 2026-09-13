---
type: Concept
title: Fits and clearances
description: Calculate mating size limits, distinguish radial from diametral clearance, and qualify the actual process.
status: stable
updated: 2026-09-13
topics: fits, gdt, manufacturing
keywords: fit, clearance, interference, transition, allowance, radial, diametral, coupon
related_recipes: turbine-fit-coupons, d-screw-vise-fit
sources: nist-gdt-2
---

# Fits and clearances

A **fit** describes the size relationship between mating features. Start with
what the joint must do: rotate, slide, locate or retain. Include assembly and
removal, not just the final pose. A nominally attractive gap is not enough;
calculate what remains when both parts reach their permitted size limits.

The terminology here adapts the limits-and-fits introduction in
*Fundamentals of Geometric Dimensioning and Tolerancing, Part II*,
[Jaime Berez and Maxwell Praniewicz, version 1.0.0 (2023)](https://zenodo.org/records/8237278),
licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The explanation is rewritten; the numerical example below is original.

## Classify the size relationship

For a circular hole and shaft, subtract shaft diameter from hole diameter.

- **Clearance fit:** the size limits allow no interference. Zero clearance
  can occur at a limiting line-to-line condition; require positive minimum
  clearance when the design needs a guaranteed size gap.
- **Transition fit:** permitted sizes can produce either clearance or
  interference. Check both outcomes against the assembly method.
- **Interference fit:** the size limits allow no clearance. Interference
  creates deformation and contact forces that require their own assessment.

These categories do not specify running friction, retention strength or a
safe assembly force. In particular, a circular bearing seat is not qualified
by assigning it a generic printed press-fit allowance.

## Calculate worst-case clearance

These are **invented teaching dimensions**, not a recommended printer fit:

```text
shaft diameter = 20.00 +/- 0.10 mm  -> 19.90 to 20.10 mm
hole diameter  = 20.60 +/- 0.15 mm  -> 20.45 to 20.75 mm

minimum diametral clearance = hole_min - shaft_max
                           = 20.45 - 20.10 = 0.35 mm
maximum diametral clearance = hole_max - shaft_min
                           = 20.75 - 19.90 = 0.85 mm
```

For ideal concentric circular features, the radial gap is half the diametral
clearance: **0.175 to 0.425 mm** in this example. Once the shaft shifts off
center, the gap is no longer equal around the circumference. Do not use the
halving rule for axial clearance or an arbitrary noncircular profile.

In a parametric model, name the nominal diametral clearance separately from
the two permitted size variations. For symmetric size tolerances:

```text
hole_nominal = shaft_nominal + nominal_diametral_clearance
minimum_clearance = nominal_diametral_clearance - hole_tolerance - shaft_tolerance
maximum_clearance = nominal_diametral_clearance + hole_tolerance + shaft_tolerance
```

With the same tolerances, reducing nominal clearance to 0.20 mm makes the
minimum **-0.05 mm**: some permitted sizes interfere. This arithmetic helps
choose dimensions and tolerances together. It only evaluates size variation;
form error, alignment, surface texture, temperature and deformation can still
prevent assembly or increase drag.

## Use standards and process evidence deliberately

A designation such as `H7/g6` refers to a standardized tolerance pairing.
Use the relevant nominal-size range and governing edition when assigning its
limits. [ISO 286-1](https://www.iso.org/standard/45975.html) explains the
code system; ASME B4.1 addresses inch fits and B4.2 metric fits. The teaching
deck's historical preferred-fit chart is not a replacement for the applicable
standard or a universal FDM fit chart.

For printed parts, make representative coupons in the intended material,
orientation and slicer process. Record measured dimensions and whether the
joint assembles, moves and retains as required. Use that evidence to adjust
the model and process; changing material metadata alone does not establish
equivalent fit or strength.

The `turbine-fit-coupons` and `d-screw-vise-fit` recipes provide mating-geometry
specimens for this work. Replay checks establish the modeled result; physical
coupons still need to be made and tested. For a D-shaped screw, qualify the
thread and flat together rather than substituting a round pin-and-hole test.

Continue with [GD&T](gdt-intro.md),
[bearing supports and axial retention](../../concepts/bearing-stacks.md),
[design for manufacturing](dfm-overview.md), and
[process-specific guidance](dfm-process-guidelines.md).
