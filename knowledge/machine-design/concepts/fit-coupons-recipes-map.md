---
type: Concept
title: Fit coupons and recipes map
description: Concept → related_recipes map for fit/AM coupons and product demos.
status: draft
updated: 2026-09-20
topics: dfam, fits, am, recipes
keywords: fit coupons, related_recipes, turbine-fit-coupons, d-screw-vise-fit, clearance coupon
related_recipes: turbine-fit-coupons, d-screw-vise-fit, mounting-plate, fillet-basics, d-screw-vise, garden-bench, vertical-axis-turbine, repeated-bracket-assembly, angle-bracket, revolved-spacer
sources: nwtc-guns-dfm, doe-3d
---

# Fit coupons and recipes map

Coupon the critical joint before committing the flagship. Recipe ids below are
the same catalog as Help `related_recipes` / `cad_interface` `recipes`.

## Coupon recipes

| Recipe id | Intent | Concepts |
|-----------|--------|----------|
| `turbine-fit-coupons` | Clearance / fit / AM joint coupons | [fits](fits-clearances.md), [snap-fits](am-snap-fit.md), [thin walls](am-thin-walls.md), [nubs](alignment-nubs-pins.md), [clamshell](am-clamshell-retainer.md) |
| `d-screw-vise-fit` | Vise fit / screw stack coupons | [fits](fits-clearances.md), [fastener clearance](fastener-clearance-counterbore.md), [tolerance stack-up](tolerance-stackup-intro.md) |
| `fillet-basics` | Fillet / blend demo | [fillet vs chamfer](fillet-chamfer.md), [ribs](am-ribs-gussets-draft.md) |
| `mounting-plate` | Plate / hole / boss patterns | [boss standoffs](am-boss-standoff-patterns.md), [fastener clearance](fastener-clearance-counterbore.md), [warpage](am-warpage-cooling-flatness.md) |

## Product / assembly recipes

| Recipe id | Context | Concepts |
|-----------|---------|----------|
| `d-screw-vise` | Screw / joint product | [fasteners](fasteners-joints.md), [captive nut](captive-nut-hex-trap.md), [heat-set](am-heat-set-inserts.md) |
| `garden-bench` | Larger structural / fastener | [fasteners](fasteners-joints.md), [DFM overview](dfm-overview.md) |
| `vertical-axis-turbine` | Product joints / hardware pockets | [hardware pocket](am-hardware-pocket-research.md), [bearing stacks](../../concepts/bearing-stacks.md) |
| `repeated-bracket-assembly` | Locate / pattern repetition | [locating schemes](locating-scheme-dof.md), [nubs](alignment-nubs-pins.md) |
| `revolved-spacer` | Annular / spacer stacks | [bearing stacks](../../concepts/bearing-stacks.md), [power screws](power-screws-lead-screws.md) |
| `angle-bracket` | Simple bracket DFM | [DFM process](dfm-process-guidelines.md), [ribs](am-ribs-gussets-draft.md) |

## Enclosure / AM quick map

| Need | Concept id | Typical recipes |
|------|------------|-----------------|
| Lid / gasket / labyrinth | `machine-design.concepts.am-enclosure-lid-gasket-labyrinth` | `turbine-fit-coupons`, `mounting-plate` |
| Vent / finger trap | `machine-design.concepts.am-ventilation-grille-finger-trap` | `mounting-plate` |
| Boss / standoff grid | `machine-design.concepts.am-boss-standoff-patterns` | `mounting-plate`, `turbine-fit-coupons` |
| Glue vs screw vs snap | `machine-design.concepts.am-assembly-join-choice` | `turbine-fit-coupons`, `d-screw-vise` |
| Large plate flatness | `machine-design.concepts.am-warpage-cooling-flatness` | `mounting-plate`, `garden-bench` |
| Cable exit | `machine-design.concepts.am-cable-exits-strain-relief` | `turbine-fit-coupons` |
| Snap / living hinge | `machine-design.concepts.am-snap-fit` | `turbine-fit-coupons` |

Recipe ids in frontmatter must exist in the product catalog. Deep teaching stays
on the linked Concept pages — see [research before commit](../../concepts/research-before-commit.md).
