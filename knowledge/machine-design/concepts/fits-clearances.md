---
type: Concept
title: Fits and clearances
description: Clearance, locational, and interference fits as design intent, with recipe coupons.
status: draft
updated: 2026-09-11
---

# Fits and clearances

A **fit** is the designed relationship between two mating features of size
(typically a hole and a shaft). Choose it from function, process capability,
and whether the joint should slide, locate, or press.

Teaching-level classes:

- **Clearance** — always a gap (running or sliding).
- **Locational / transition** — may be slight clearance or slight
  interference; used to locate, not to transmit large loads by press.
- **Interference** — always overlap; press, shrink, or freeze assembly.

Say whether a number is **radial** or **diametral**. Mixing those is a common
print-to-part bug. Process matters: a CNC reamed hole and an FDM printed hole
do not share the same allowance, even at the same nominal.

Standards (ISO hole-basis `H7/g6` and similar, ANSI/ASME B4) are
**link-only**. Do not paste tables. Pick a system, name the class, and keep
nominals as design inputs.

## In this product

Recipes `turbine-fit-coupons` and `d-screw-vise-fit` print dimensioned
specimens of the actual mating geometry **before** committing the full
flagship. Treat coupon results as printer/material evidence, not a universal
fit table.

Physical qualification remains separate from software replay.

Related: [GD&T intro](gdt-intro.md), [DFM overview](dfm-overview.md),
[taxonomy](../taxonomy.md).
