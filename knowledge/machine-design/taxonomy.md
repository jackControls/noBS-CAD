---
type: Concept
title: Machine-design taxonomy
description: Topic map — seeded pages vs planned gaps for the open machine-design KB.
status: draft
updated: 2026-09-11
searchable: false
---

# Machine-design taxonomy

Open help for **design-time** decisions in noBS CAD. Product/architecture
concepts stay in [the OKF index](../index.md).

**Coverage honesty:** agents should search **seeded** pages first. For
**planned** rows, prefer linked further-reading / web — do not invent from an
empty topic.

Provenance: [SOURCES](SOURCES.md).

## A. Geometric product definition

| Topic | Status |
|-------|--------|
| GD&T intro, datums, FCF, Rule #1 teaching | **seeded** — [gdt-intro](concepts/gdt-intro.md) |
| Fits & clearances (class-level) | **seeded** — [fits-clearances](concepts/fits-clearances.md) |
| Drawing vs MBD / PMI walkthrough | **planned** |
| Inspection / metrology bridge | **planned** |

## B. Machine elements

| Topic | Status |
|-------|--------|
| Fasteners & joints (stub→deepen) | **seeded (thin)** — [fasteners-joints](concepts/fasteners-joints.md) |
| Shafts, keys, retaining rings | **planned** |
| Bearings | **planned** |
| Springs, seals, couplings | **planned** |
| Power screws / lead screws | **planned** (vise recipe exists) |

## C. Mechanisms

| Topic | Status |
|-------|--------|
| Linkages, gears, cams, belts, mobility | **planned** — until then link MIT OCW (`mit-272`) |
| Product joints demo | use recipe `vertical-axis-turbine` |

## D. Materials

| Topic | Status |
|-------|--------|
| Property vocabulary | **seeded (thin)** — [materials-vocabulary](concepts/materials-vocabulary.md) |
| Selection / allowables tables | **planned** (no MatWeb scrape) |

## E. Design for manufacturing

| Topic | Status |
|-------|--------|
| DFM overview | **seeded** — [dfm-overview](concepts/dfm-overview.md) |
| Process guidelines | **seeded** — [dfm-process-guidelines](concepts/dfm-process-guidelines.md) |
| DFAM deep dive | **planned** beyond coupon notes |

## F. Design hygiene

| Topic | Status |
|-------|--------|
| Requirements → embodiment → BOM / purchased parts | **planned** |

## Live examples

Scripted recipes remain the screen source. See
[machine-design KB notes](https://github.com/jackControls/noBS-CAD/blob/docs/machine-design-kb/docs/machine-design-kb.md)
(blob URL for Pages readers).
