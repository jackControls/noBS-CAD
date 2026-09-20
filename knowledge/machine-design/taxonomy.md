---
type: Concept
title: Machine-design taxonomy
description: Topic map — seeded pages vs planned gaps for the open machine-design KB (human + agent door).
status: draft
updated: 2026-09-20
searchable: false
---

# Machine-design taxonomy

Open help for **design-time** decisions in noBS CAD. Product/architecture
concepts stay in [the OKF index](../index.md).

**Human door:** use this page as the topic map (seeded → link; planned → web /
further reading). **Agent door:** `cad_help` `topics` / `search` / `get` using
the **ids** in the tables (path with `/` → `.`).

**Coverage honesty:** agents should search **seeded** pages first. For
**planned** rows, prefer linked further-reading / web — do not invent from an
empty topic.

Provenance: [SOURCES](SOURCES.md). Browse note:
[How humans find help today](../../docs/agentic/HUMAN_HELP.md).

## A. Geometric product definition

| Topic | Status | Id / title |
|-------|--------|------------|
| GD&T intro, datums, FCF, Rule #1 teaching | **seeded** | `machine-design.concepts.gdt-intro` — [GD&T intro](concepts/gdt-intro.md) |
| Fits & clearances (class-level) | **seeded** | `machine-design.concepts.fits-clearances` — [fits-clearances](concepts/fits-clearances.md) |
| Tolerance stack-up (method) | **seeded (citation-only)** | `machine-design.concepts.tolerance-stackup-intro` — [tolerance-stackup-intro](concepts/tolerance-stackup-intro.md) |
| Cosmetic threads vs clearance / tap / insert | **seeded** | `machine-design.concepts.cosmetic-threads-vs-clearance` — [cosmetic-threads-vs-clearance](concepts/cosmetic-threads-vs-clearance.md) |
| Drawing vs MBD / PMI walkthrough | **planned** | — |
| Inspection / metrology bridge | **planned** | — |

## B. Machine elements

| Topic | Status | Id / title |
|-------|--------|------------|
| Fasteners & joints | **seeded** | `machine-design.concepts.fasteners-joints` — [fasteners-joints](concepts/fasteners-joints.md); also [fastener-clearance-counterbore](concepts/fastener-clearance-counterbore.md), [am-heat-set-inserts](concepts/am-heat-set-inserts.md), [captive-nut-hex-trap](concepts/captive-nut-hex-trap.md) |
| Hardware pocket / actuator / bolt circle research | **seeded** | `machine-design.concepts.am-hardware-pocket-research` — [am-hardware-pocket-research](concepts/am-hardware-pocket-research.md) |
| Shafts, keys, retaining rings | **planned** | — |
| Bearings / hubs / seats | **seeded (partial)** | `concepts.bearing-stacks` — [bearing-stacks](../concepts/bearing-stacks.md) |
| Springs, seals, couplings | **planned** | — |
| Power screws / lead screws | **planned** | (vise recipe exists) |

## C. Mechanisms

| Topic | Status | Id / title |
|-------|--------|------------|
| Linkages, gears, cams, belts, mobility | **planned** | until then link MIT OCW (`mit-272`) |
| Technic-style beam/pin envelope | **seeded (unofficial)** | `machine-design.concepts.technic-envelope` — [technic-envelope](concepts/technic-envelope.md) |
| Product joints demo | recipe | `vertical-axis-turbine` |

## D. Materials

| Topic | Status | Id / title |
|-------|--------|------------|
| Property vocabulary | **seeded (thin)** | `machine-design.concepts.materials-vocabulary` — [materials-vocabulary](concepts/materials-vocabulary.md) |
| Selection / allowables tables | **planned** | (no MatWeb scrape) |

## E. Design for manufacturing

| Topic | Status | Id / title |
|-------|--------|------------|
| DFM overview | **seeded** | `machine-design.concepts.dfm-overview` — [dfm-overview](concepts/dfm-overview.md) |
| Process guidelines | **seeded** | `machine-design.concepts.dfm-process-guidelines` — [dfm-process-guidelines](concepts/dfm-process-guidelines.md) |
| DFAM (snap / walls / ribs / supports / inserts / clamshell) | **seeded (partial)** | [am-snap-fit](concepts/am-snap-fit.md), [am-thin-walls](concepts/am-thin-walls.md), [am-clamshell-retainer](concepts/am-clamshell-retainer.md), [am-heat-set-inserts](concepts/am-heat-set-inserts.md), [am-ribs-gussets-draft](concepts/am-ribs-gussets-draft.md), [am-supports-overhangs](concepts/am-supports-overhangs.md) |
| Cable exits / wire windows / strain relief | **seeded** | `machine-design.concepts.am-cable-exits-strain-relief` — [am-cable-exits-strain-relief](concepts/am-cable-exits-strain-relief.md) |
| Fillet vs chamfer | **seeded** | `machine-design.concepts.fillet-chamfer` — [fillet-chamfer](concepts/fillet-chamfer.md) |
| Alignment nubs vs pins | **seeded** | `machine-design.concepts.alignment-nubs-pins` — [alignment-nubs-pins](concepts/alignment-nubs-pins.md) |
| Locating schemes / DOF | **seeded** | `machine-design.concepts.locating-scheme-dof` — [locating-scheme-dof](concepts/locating-scheme-dof.md) |
| Draft vs layer anisotropy | **cross-linked** | draft on [am-ribs-gussets-draft](concepts/am-ribs-gussets-draft.md); anisotropy on [am-thin-walls](concepts/am-thin-walls.md) — no separate page |
| Living hinge sizing | **deepened on** | [am-snap-fit](concepts/am-snap-fit.md) (HIT; not a separate page) |

## F. Design hygiene

| Topic | Status |
|-------|--------|
| Requirements → embodiment → BOM / purchased parts | **planned** (partially covered by hardware-pocket + research-before-commit) |

## G. Assembly validation

| Topic | Status | Id / title |
|-------|--------|------------|
| Interference / clearance at solved poses | **seeded** | `concepts.assembly-interference` — [assembly-interference](../concepts/assembly-interference.md) |
| Fit classes (clearance / transition / interference) | **seeded** | `machine-design.concepts.fits-clearances` — [fits-clearances](concepts/fits-clearances.md) |
| Validate before show (shot pack) | **seeded** | `concepts.validate-before-show` — [validate-before-show](../concepts/validate-before-show.md) |
| Adversarial mesh / wall probe audit | **seeded** | `concepts.adversarial-mesh-audit` — [adversarial-mesh-audit](../concepts/adversarial-mesh-audit.md) |

## `cad_help` topics labels (useful seeds)

Frontmatter `topics:` on Concept pages feed `cad_help` **topics**. Expect labels
such as: `dfam`, `am`, `fdm`, `fasteners`, `joints`, `hardware`, `enclosures`,
`cables`, `threads`, `fits`, `gdt`, `locators`, `print`, `snap-fit`,
`manufacturing`, `research`, `validation`, `assembly`, `mcp`, `bearings`,
`mechanisms`. Use `topics` then `search` with those words; `get` with an id
from the tables above.

## Live examples

Scripted recipes remain the screen source. See
[machine-design help search](../../docs/machine-design-help-search.md) and
recipe ids in page frontmatter (`related_recipes`).
