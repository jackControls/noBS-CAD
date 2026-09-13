---
type: Concept
title: GD&T intro
description: Tolerance zones, datums, feature control frames, and ASME Rule #1 teaching ideas from NIST.
status: draft
updated: 2026-09-11
topics: gdt, datums, drawings, inspection
keywords: GD&T, datum, DRF, feature control frame, MMC, LMC, Rule 1, envelope, ASME Y14.5, ISO GPS
related_recipes: turbine-fit-coupons, d-screw-vise-fit
sources: nist-gdt-1, nist-gdt-2, asme-y14, iso-gps
---

# GD&T intro

Manufacturing is imprecise. A CAD solid is exact; a machined or printed part is
not. **Geometric dimensioning and tolerancing (GD&T)** states which variation
is allowed, relative to **datums**, so design, make, and inspect share one
intent.

**Attribution:** teaching rewrite adapted from NIST / Berez
*Fundamentals of GD&T* Part I and Part II
([Part I](https://zenodo.org/records/7647256),
[Part II](https://zenodo.org/records/8237278)),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
This page is **not** a substitute for [ASME Y14.5](https://www.asme.org/codes-standards)
or ISO GPS (ISO 1101 and related). Never paste standard tables into the repo.

## Why plus/minus is not enough

Coordinate plus/minus on a drawing can stack in ways the designer did not mean,
and it is a poor fit for relationships that are not simple sizes (hole-pattern
position, sealing-face flatness, pin perpendicularity).

GD&T instead defines **tolerance zones** — shape, size, and where they sit —
that the finished feature must fall in.

## Building blocks

| Term | Meaning |
|------|---------|
| **Datum feature** | Real, imperfect part geometry used to establish a datum (a face, hole, pin, …). |
| **Datum** | Theoretically exact plane, axis, or point derived from datum features. |
| **Datum simulator** | Precision tooling or CMM math that approximates the datum in the real world. |
| **Datum reference frame (DRF)** | Ordered set of datums that constrains degrees of freedom. **Order matters.** |
| **Feature of size** | Feature controllable by a size limit (holes, pins, widths, spheres, cylinders, … — follow your edition). |
| **Feature control frame** | Rectangular callout: characteristic, tolerance (and modifiers), datum refs. |
| **Basic dimension** | Theoretically exact size/location used to define a geometric tolerance zone. |

Characteristic families (names; learn symbols from open decks or the standard):

- **Form** — shape of a single feature; usually no datum.
- **Orientation** — angular relationship to datums.
- **Location** — where a feature sits. In **ASME Y14.5-2018**, concentricity and
  symmetry were **removed** — prefer position, profile, or runout as appropriate.
- **Runout / profile** — rotating or surface-boundary controls (see your edition).

## Feature control frames (how to read)

Read left to right: **what** is controlled → **how much** zone → **modifiers** →
**which datums, in which order**.

Every frame should answer “relative to what?” and “can the shop inspect this?”

## ASME Rule #1 / envelope (teaching idea)

Under **ASME Y14.5**, Rule #1 (the **envelope** idea) means that for many
features of size, **MMC** behaves like an envelope: as the feature approaches
MMC (smallest hole / largest pin within size limits), form is inherently
constrained. Exact legal wording lives in the standard — this is the NIST
Part I teaching idea, not a citation of ASME text.

**ISO GPS** does **not** always treat envelope as the same default; the
systems can disagree here. Pick one system per drawing set and verify the
edition you use.

**MMC / LMC** also appear as modifiers so some geometric tolerances can grow
as the feature departs from MMC (**bonus tolerance**). Use as an assembly
lever, not a default on every callout.

## Design checklist (teaching order)

Rewritten from the NIST Part II “every part is different” teaching arc
(not a standards checklist):

1. What must the part **do** (function)?
2. Which features should be **datums**, mimicking how it actually locates?
3. Control **form of datum features** so the DRF is meaningful.
4. Control **relationships between datums** when needed.
5. Apply **size** limits where they matter.
6. Add **form without DRF**, then **position / orientation / profile / runout**
   to the DRF as function requires.
7. Can metrology actually measure this?

## Further reading (link only)

- NIST Parts I / II (CC BY) — distill spine above
- [ASME codes & standards](https://www.asme.org/codes-standards) — Y14.5, Y14.41, Y14.46
- [Ford, Engineering Graphics](https://uw.pressbooks.pub/enggraphics/) — CC BY-NC-SA

Related: [Fits & clearances](fits-clearances.md), [DFM overview](dfm-overview.md),
[taxonomy](../taxonomy.md).
