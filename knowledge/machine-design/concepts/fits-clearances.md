---
type: Concept
title: Fits and clearances
description: Clearance, transition, and interference fits as design intent; link-out for preferred-fit charts.
status: draft
updated: 2026-09-11
topics: fits, gdt, manufacturing
keywords: fit, clearance, interference, transition, allowance, radial, diametral, coupon
related_recipes: turbine-fit-coupons, d-screw-vise-fit
sources: nist-gdt-2, iso-286, asme-b4
---

# Fits and clearances

A **fit** is the designed relationship between two mating features of size
(typically hole and shaft). Choose it from **function**, **process capability**,
and whether the joint should slide, locate, or press.

Teaching rewrite informed by NIST / Berez GD&T Part II limits-and-fits review
([Zenodo](https://zenodo.org/records/8237278), **CC BY 4.0**). This page is
**not** ISO 286 or ASME B4.x.

## Three classes

| Class | Intent |
|-------|--------|
| **Clearance** | Always a gap (running or sliding). |
| **Transition** | May be slight clearance or slight interference; usually locates rather than heavy press. |
| **Interference** | Always overlap; press, shrink, or freeze assembly. |

Say whether a number is **radial** or **diametral**. Mixing those is a common
print-to-part bug. Process matters: a reamed hole and an FDM hole do not share
the same allowance at the same nominal.

## Preferred-fit designations (link-out only)

Standards publish **preferred fits** (ISO hole-basis pairs such as `H7/g6`, or
ANSI/ASME B4 inch families). NIST Part II summarizes ASME B4.2-era
**purpose language** for teaching — that is **not** redistributed here as a
selection table.

For contractual designations and deviation tables, open:

- [ISO 286](https://www.iso.org/) / GPS fits documentation (purchase)
- [ASME B4.x](https://www.asme.org/codes-standards) (purchase)
- NIST Part II deck (CC BY) as a teaching companion — not a substitute

Do not treat any in-app help list as an ISO/ASME fit chart.

## In noBS CAD

Recipes `turbine-fit-coupons` and `d-screw-vise-fit` print dimensioned
specimens of the **actual** mating geometry before committing the flagship.
Coupon results are printer/material evidence, not a universal fit table.
Software replay ≠ physical qualification.

Related: [GD&T intro](gdt-intro.md), [DFM overview](dfm-overview.md),
[DFM process guidelines](dfm-process-guidelines.md).
