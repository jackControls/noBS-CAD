---
type: Concept
title: Machine-design taxonomy
description: Topic map — seeded pages vs planned gaps for the open machine-design KB.
status: draft
updated: 2026-09-20
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
| Tolerance stack-up (method) | **seeded (citation-only)** — [tolerance-stackup-intro](concepts/tolerance-stackup-intro.md) |
| Drawing vs MBD / PMI walkthrough | **planned** |
| Inspection / metrology bridge | **planned** |

## B. Machine elements

| Topic | Status |
|-------|--------|
| Fasteners & joints | **seeded** — [fasteners-joints](concepts/fasteners-joints.md), [fastener-clearance-counterbore](concepts/fastener-clearance-counterbore.md), [am-heat-set-inserts](concepts/am-heat-set-inserts.md) |
| Shafts, keys, retaining rings | **planned** |
| Bearings / hubs / seats | **seeded (partial)** — [bearing-stacks](../concepts/bearing-stacks.md) |
| Springs, seals, couplings | **planned** |
| Power screws / lead screws | **planned** (vise recipe exists) |

## C. Mechanisms

| Topic | Status |
|-------|--------|
| Linkages, gears, cams, belts, mobility | **planned** — until then link MIT OCW (`mit-272`) |
| Technic-style beam/pin envelope | **seeded (unofficial)** — [technic-envelope](concepts/technic-envelope.md) |
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
| DFAM deep dive | **seeded (partial)** — [am-snap-fit](concepts/am-snap-fit.md), [am-thin-walls](concepts/am-thin-walls.md), [am-clamshell-retainer](concepts/am-clamshell-retainer.md), [am-heat-set-inserts](concepts/am-heat-set-inserts.md), [am-ribs-gussets-draft](concepts/am-ribs-gussets-draft.md), [am-supports-overhangs](concepts/am-supports-overhangs.md) |
| Fillet vs chamfer | **seeded** — [fillet-chamfer](concepts/fillet-chamfer.md) |
| Alignment nubs vs pins | **seeded** — [alignment-nubs-pins](concepts/alignment-nubs-pins.md) |
| Locating schemes / DOF | **seeded** — [locating-scheme-dof](concepts/locating-scheme-dof.md) |
| Tolerance stack-up intro | **seeded (citation-only)** — [tolerance-stackup-intro](concepts/tolerance-stackup-intro.md) |
| Technic-style envelope | **seeded (unofficial P2)** — [technic-envelope](concepts/technic-envelope.md) |

## F. Design hygiene

| Topic | Status |
|-------|--------|
| Requirements → embodiment → BOM / purchased parts | **planned** |


## G. Assembly validation

| Topic | Status |
|-------|--------|
| Interference / clearance at solved poses | **seeded** — [assembly-interference](../concepts/assembly-interference.md) (product check; distinct from fit classes) |
| Fit classes (clearance / transition / interference) | **seeded** — [fits-clearances](concepts/fits-clearances.md) |
| Validate before show (shot pack) | **seeded** — [validate-before-show](../concepts/validate-before-show.md) |
| Adversarial mesh / wall probe audit | **seeded** — [adversarial-mesh-audit](../concepts/adversarial-mesh-audit.md) |

## Live examples

Scripted recipes remain the screen source. See
[machine-design KB notes](https://github.com/jackControls/noBS-CAD/blob/docs/machine-design-kb/docs/machine-design-kb.md)
(blob URL for Pages readers).
