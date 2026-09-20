---
type: Concept
title: Unit systems — mm default and formula dimension pitfalls
description: Prefer millimetre project units; avoid inch/mm mixing and brittle formula dims that break parametric edits.
status: draft
updated: 2026-09-20
topics: modeling, mcp, units, dimensions, parametric
keywords: unit system, millimetre, mm default, inch mm mix, formula dims, parametric dimension, unit pitfall, project units, scale export
related_recipes: fillet-basics, mounting-plate, turbine-fit-coupons, revolved-spacer
---

# Unit systems — mm default and formula dimension pitfalls

noBS CAD agent work should assume **millimetres** unless the document or recipe
explicitly says otherwise. Unit mistakes show up as 25.4× scale bugs in mesh
export, bolt circles, and “formula” dimensions that look clever until edit.

## Defaults

1. **Project units = mm** for new mechanical work and recipes.
2. Say units in the plan (“extrude 12 mm”, not “extrude 12”).
3. Purchased inch hardware still gets **mm hole models** with a VERIFY note
   converting from the vendor inch drawing
   ([research before commit](research-before-commit.md)).
4. Export preflight must confirm slicer scale
   ([export preflight 3MF vs STL](export-preflight-3mf-stl.md)).

## Mixing inch and mm

| Hazard | What happens |
|--------|----------------|
| Mental inch on mm doc | 1/4″ typed as `0.25` → quarter-millimetre holes |
| Mesh import | STL without units →  inch interpreted as mm or vice versa |
| Vendor PDF | Inch PCD pasted as mm numbers |
| Dual dimensions | Drawing shows both; **model** must stay single-system |

Checklist: vendor unit → conversion → VERIFY table → CAD number in **mm**.

## Formula dimension pitfalls

Parametric formulas are useful; brittle formulas are not.

1. Prefer **named driving dimensions** you can `solid_edit_*` over deep expression
   trees nobody can read.
2. Avoid formulas that encode **unit conversions** (`*25.4`) hidden in sketches —
   convert once at research time instead.
3. Do not reference **fragile ids** that vanish after delete-rebuild
   ([edit history](edit-history-not-delete-rebuild.md)).
4. After editing a driver, **inspect** dependents
   ([inspect between mutates](inspect-between-mutates.md)).
5. Coupon critical fits; formulas do not qualify printers.

## Agent checklist

- [ ] Document/recipe units confirmed (mm)
- [ ] All spoken numbers include unit words in the plan
- [ ] Vendor inch data converted in VERIFY, not in ad-hoc formulas
- [ ] Export/slicer scale checked once
- [ ] No silent `25.4` multipliers scattered in sketches

## Anti-patterns

- “It’s CAD, units don’t matter until export”
- Mixing Technic community mm folklore with inch screws without a table
  ([technic envelope](../machine-design/concepts/technic-envelope.md))
- Formula-driven entire parts that only the author can edit

Related: [tolerance stack-up](../machine-design/concepts/tolerance-stackup-intro.md),
[agent MCP workflow](agent-mcp-workflow.md),
[datum / sketch plane](../machine-design/concepts/datum-sketch-plane-choice.md).
