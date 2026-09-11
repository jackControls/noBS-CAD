---
type: Concept
title: GD&T intro
description: Tolerance zones, datums, feature control frames, and Rule #1 — distilled from NIST teaching materials.
status: draft
updated: 2026-09-11
topics: gdt, datums, drawings, inspection
keywords: GD&T, datum, DRF, feature control frame, MMC, LMC, Rule 1, ASME Y14.5, ISO GPS
related_recipes: []
sources: nist-gdt-1, nist-gdt-2
---

# GD&T intro

Manufacturing is imprecise. A CAD solid is exact; a machined or printed part is
not. **Geometric dimensioning and tolerancing (GD&T)** states which variation
is allowed, relative to **datums**, so design, make, and inspect share one
intent.

This page is **our** short teaching rewrite. Primary distillation sources:
NIST / Berez **Fundamentals of GD&T** Part I and Part II
([Zenodo](https://zenodo.org/records/7647256),
[Part II](https://zenodo.org/records/8237278), **CC BY 4.0**). It is **not** a
substitute for [ASME Y14.5](https://www.asme.org/codes-standards) or ISO GPS
(ISO 1101 and related). Never paste standard tables into the repo.

## Why plus/minus is not enough

Coordinate plus/minus on a drawing can stack in ways the designer did not mean,
and it is a poor fit for relationships that are not simple sizes (hole-pattern
position, sealing-face flatness, pin perpendicularity).

GD&T instead defines **tolerance zones** — shape, size, and where they sit —
that the finished feature must fall in.

## Building blocks

| Term | Meaning |
|------|---------|
| **Datum feature** | Real, imperfect part geometry used to establish a datum (a face, hole, pin). |
| **Datum** | Theoretically exact plane, axis, or point derived from datum features. |
| **Datum simulator** | Precision tooling or CMM math that approximates the datum in the real world. |
| **Datum reference frame (DRF)** | Ordered set of datums that constrains degrees of freedom for function and measurement. **Order matters.** |
| **Feature of size** | Feature with opposing surfaces (hole, pin, slot) that can have a size limit plus geometric controls. |
| **Feature control frame** | Rectangular callout: characteristic, tolerance (and modifiers), datum refs. |
| **Basic dimension** | Theoretically exact size/location used to define a geometric tolerance zone; not a ± size by itself. |

Characteristic families (names; learn symbols from open decks or the standard):

- **Form** — shape of a single feature (flatness, straightness, circularity, cylindricity); usually no datum.
- **Orientation** — angular relationship to datums (perpendicularity, parallelism, angularity).
- **Location** — where a feature sits (position, concentricity/coaxiality, symmetry — follow the edition you use).
- **Runout / profile** — rotating or surface-boundary controls (see the standard for symbols).

## Feature control frames (how to read)

Read left to right: **what** is controlled → **how much** zone → **modifiers** →
**which datums, in which order**.

Design-time habit: every frame should answer “relative to what?” and “can the
shop inspect this?”

## Rule #1 (envelope idea)

For features of size, **maximum material condition (MMC)** behaves like an
**envelope**: as the feature approaches MMC (smallest hole / largest pin within
size limits), form is inherently constrained. Exact legal wording lives in the
standard — treat this as the teaching idea from NIST Part I, not a citation of
ASME text.

**MMC / LMC** also appear as modifiers on some position controls so the allowed
geometric tolerance can grow as the feature departs from MMC (**bonus
tolerance**). Use that as an assembly lever, not a default on every callout.

## Design checklist (from NIST Part II teaching arc)

1. What must the part **do** (mate, seal, spin, locate)?
2. Which features establish the functional **DRF**, and in what precedence?
3. Which relationships need geometric controls versus size only?
4. Prefer **datum-based** inspection intent over vague “best fit” when function
   cares about a specific face or axis.
5. Can metrology actually measure this (CMM, gauges, optical)?
6. Open the standard when the callout is contractual.

## ASME versus ISO GPS (one sentence)

ASME Y14.5 is one common language in North American product definition; ISO
**GPS** (ISO/TC 213, e.g. ISO 1101) is the parallel international system. Concepts
overlap; symbols and defaults differ. Pick one system per drawing set and stay
consistent. Details: buy/read the standards — [link only](../SOURCES.md).

## Further reading (link only)

- NIST GD&T Part I / II (CC BY) — distill spine above
- [ASME codes & standards](https://www.asme.org/codes-standards) — Y14.5, Y14.41 (digital product definition), Y14.46 (AM)
- [Ford, Engineering Graphics and Design](https://uw.pressbooks.pub/enggraphics/) — CC BY-NC-SA student drawing/GD&T intro

Related: [Fits & clearances](fits-clearances.md), [DFM overview](dfm-overview.md),
[taxonomy](../taxonomy.md).
