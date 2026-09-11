---
type: Concept
title: Fits and clearances
description: Clearance, transition, and interference fits; teaching names for preferred fits; recipe coupons.
status: draft
updated: 2026-09-11
topics: fits, gdt, manufacturing
keywords: fit, clearance, interference, transition, H7, g6, RC, FN, allowance, radial, diametral
related_recipes: turbine-fit-coupons, d-screw-vise-fit
sources: nist-gdt-2
---

# Fits and clearances

A **fit** is the designed relationship between two mating features of size
(typically hole and shaft). Choose it from **function**, **process capability**,
and whether the joint should slide, locate, or press.

## Three classes

| Class | Intent |
|-------|--------|
| **Clearance** | Always a gap (running or sliding). |
| **Transition** | May be slight clearance or slight interference; locates, usually not a heavy press. |
| **Interference** | Always overlap; press, shrink, or freeze assembly. |

Say whether a number is **radial** or **diametral**. Mixing those is a common
print-to-part bug. Process matters: a reamed hole and an FDM hole do not share
the same allowance at the same nominal.

## Preferred-fit language (teaching)

Standards publish **preferred fits** (ISO hole-basis pairs such as `H7/g6`, or
ANSI RC/LC/LT/LN/FN families). Teaching intent of common hole-basis examples
(names and purpose only — full deviation tables stay in the standard /
NIST deck; do not paste ISO 286 charts here):

| Example (hole/shaft) | Typical teaching use |
|----------------------|----------------------|
| `H11/c11` | Loose running; wide commercial tolerance |
| `H9/d9` | Free running; not for high accuracy |
| `H8/f7` | Close running on accurate machines |
| `H7/g6` | Sliding; move/turn freely, locate accurately |
| `H7/k6` | Locational clearance compromise |
| `H7/n6` | Locational transition; more interference bias |

Source for this teaching list: NIST GD&T Part II limits-and-fits review
(**CC BY 4.0**). For contractual numbers, open ISO 286 / ASME B4 — [link
only](../SOURCES.md).

## In noBS CAD

Recipes `turbine-fit-coupons` and `d-screw-vise-fit` print dimensioned
specimens of the **actual** mating geometry before committing the flagship.
Coupon results are printer/material evidence, not a universal fit table.
Software replay ≠ physical qualification.

Related: [GD&T intro](gdt-intro.md), [DFM overview](dfm-overview.md),
[DFM process guidelines](dfm-process-guidelines.md).
