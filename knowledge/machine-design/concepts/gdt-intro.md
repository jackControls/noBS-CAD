---
type: Concept
title: GD&T intro
description: Why plus/minus is not enough, and how datums and feature control frames state intent.
status: draft
updated: 2026-09-11
---

# GD&T intro

Manufacturing is imprecise. A CAD model is exact; a part is not. **Geometric
dimensioning and tolerancing (GD&T)** is a symbolic language for saying which
variation is allowed, relative to datums, so design, make, and inspect share
one intent.

This page teaches concepts. It is **not** a substitute for
[ASME Y14.5](https://www.asme.org/codes-standards) or ISO GPS (ISO 1101 and
related). Do not copy standard tables into the repo. See [SOURCES](../SOURCES.md).

## Plus/minus versus geometric intent

Coordinate plus/minus on a drawing can stack in ways the designer did not
mean, and it is a poor fit for relationships that are not simple sizes
(position of a hole pattern, flatness of a sealing face, perpendicularity of
a pin).

GD&T instead defines **tolerance zones** (shape, size, and where they sit)
that the finished feature must fall in.

## Building blocks

- **Datum** — a theoretically exact plane, axis, or point taken from real
  features (a face, a hole, a pin).
- **Datum reference frame (DRF)** — an ordered set of datums that constrains
  degrees of freedom for measurement and function.
- **Feature of size** — a feature with opposing surfaces (a hole, a pin, a
  slot) that can have a size tolerance plus geometric controls.
- **Feature control frame** — the rectangular callout: characteristic symbol,
  tolerance value, modifiers, and datum references.

Characteristic families (names only): **form**, **orientation**, **location**,
**runout**, and **profile**. Learn the symbols from an open teaching deck or
the standard; do not invent unofficial symbols in help text.

## MMC / LMC (concept)

**Maximum material condition (MMC)** is the condition where the feature
contains the most material (smallest hole, largest pin) within size limits.
Some position controls allow extra tolerance as the feature departs from MMC
(**bonus tolerance**). Use this as a design lever for assembly, not as a
default on every feature.

## Design-time checklist (short)

1. What must the part **do** (mate, seal, spin, locate)?
2. Which features establish the functional DRF?
3. Which relationships need geometric controls versus size only?
4. Can the shop and inspector actually measure this?
5. Open the standard when the callout must be contractual.

## Open teaching spine

NIST / Berez **Fundamentals of GD&T** Part I and Part II (Zenodo; CC BY —
confirm Part I on the record) are the preferred distillation sources.

Related: [Fits & clearances](fits-clearances.md), [taxonomy](../taxonomy.md).
