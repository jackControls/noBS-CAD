---
type: Concept
title: Fit coupons and recipes map
description: Hub mapping machine-design concepts to related_recipes and coupon intent — start here to find demos for fits, AM joints, and hardware.
status: draft
updated: 2026-09-20
topics: dfam, fits, am, recipes, manufacturing, help
keywords: fit coupons, recipe map, related_recipes, turbine-fit-coupons, d-screw-vise-fit, coupon map, demo scripts, help recipes hub, clearance coupon, AM coupon
related_recipes: turbine-fit-coupons, d-screw-vise-fit, mounting-plate, fillet-basics, d-screw-vise, garden-bench, vertical-axis-turbine, repeated-bracket-assembly, angle-bracket
sources: nwtc-guns-dfm, doe-3d
---

# Fit coupons and recipes map

Use this page as a **cross-link hub**: Concept teaching → `related_recipes` chips
→ Scripts / `.nbcad.jsonc` demos. Help does not embed a viewport; recipes are
the live geometry door.

**How agents/humans navigate:** `cad_help` `topics` / `search` → `get` a Concept
id → follow `related_recipes` in frontmatter → open Scripts. Humans: same path
via [HUMAN_HELP](../../../docs/agentic/HUMAN_HELP.md).

## Primary coupon recipes

| Recipe id | Coupon / demo intent | Start from concepts |
|-----------|----------------------|---------------------|
| `turbine-fit-coupons` | Clearance / fit / AM joint coupons | [fits](fits-clearances.md), [snap-fits](am-snap-fit.md), [thin walls](am-thin-walls.md), [nubs](alignment-nubs-pins.md), [clamshell](am-clamshell-retainer.md) |
| `d-screw-vise-fit` | Vise fit / screw stack coupons | [fits](fits-clearances.md), [fastener clearance](fastener-clearance-counterbore.md), [tolerance stack-up](tolerance-stackup-intro.md) |
| `fillet-basics` | Fillet / blend demo | [fillet vs chamfer](fillet-chamfer.md), [ribs](am-ribs-gussets-draft.md) |
| `mounting-plate` | Plate / hole / boss patterns | [boss standoffs](am-boss-standoff-patterns.md), [fastener clearance](fastener-clearance-counterbore.md), [warpage](am-warpage-cooling-flatness.md) |

## Assembly / product recipes (context, not pure coupons)

| Recipe id | When to open | Concepts |
|-----------|--------------|----------|
| `d-screw-vise` | Screw/joint product context | [fasteners](fasteners-joints.md), [captive nut](captive-nut-hex-trap.md), [heat-set](am-heat-set-inserts.md) |
| `garden-bench` | Larger structural / fastener context | [fasteners](fasteners-joints.md), [DFM overview](dfm-overview.md) |
| `vertical-axis-turbine` | Product joints / hardware pockets | [hardware pocket](am-hardware-pocket-research.md), [bearing stacks](../../concepts/bearing-stacks.md) |
| `repeated-bracket-assembly` | Locate / pattern repetition | [locating schemes](locating-scheme-dof.md), [nubs](alignment-nubs-pins.md) |
| `angle-bracket` | Simple bracket DFM | [DFM process](dfm-process-guidelines.md), [ribs](am-ribs-gussets-draft.md) |

## Concept → recipe cheat sheet (enclosure / AM agents)

| Need | Concept id (get) | Typical recipes |
|------|------------------|-----------------|
| Lid / gasket / labyrinth | `machine-design.concepts.am-enclosure-lid-gasket-labyrinth` | `turbine-fit-coupons`, `mounting-plate` |
| Vent / finger trap | `machine-design.concepts.am-ventilation-grille-finger-trap` | `mounting-plate` |
| Boss / standoff grid | `machine-design.concepts.am-boss-standoff-patterns` | `mounting-plate`, `turbine-fit-coupons` |
| Glue vs screw vs snap | `machine-design.concepts.am-assembly-join-choice` | `turbine-fit-coupons`, `d-screw-vise` |
| Large plate flatness | `machine-design.concepts.am-warpage-cooling-flatness` | `mounting-plate`, `garden-bench` |
| Cable exit | `machine-design.concepts.am-cable-exits-strain-relief` | `turbine-fit-coupons` |
| Snap / living hinge | `machine-design.concepts.am-snap-fit` | `turbine-fit-coupons` |

## Discipline

- Coupons **before** committing the full housing
  ([research before commit](../../concepts/research-before-commit.md)).
- Recipe ids in frontmatter must exist in the product catalog — do not invent
  chips.
- This hub is searchable so “fit coupon” / “recipes map” land here; deep
  teaching stays on the linked Concept pages.
