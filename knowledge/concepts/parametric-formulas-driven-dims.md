---
type: Concept
title: Parametric formulas and driven dimensions — pitfalls
description: Prefer named driving dimensions and solid_edit_*; avoid hidden unit conversions, fragile id graphs, and driven dims mistaken for drivers.
status: draft
updated: 2026-09-20
topics: modeling, mcp, parametric, dimensions, units
keywords: parametric formula, driven dimension, driving dimension, expression tree, solid_edit, formula pitfall, reference dimension, sketch constraint, parametric edit
related_recipes: fillet-basics, mounting-plate, revolved-spacer, angle-bracket
---

# Parametric formulas and driven dimensions — pitfalls

Parametrics help when **drivers stay editable**. They hurt when formulas hide
unit conversions, reference deleted geometry, or when agents treat **driven**
(read-only) dims as knobs.

Pair with [unit systems / mm default](unit-systems-mm-default.md) for unit
policy; this page is about **expression and edit discipline**.

## Driving vs driven

| Kind | Role | Agent habit |
|------|------|-------------|
| **Driving** | Owns the value; edits reshape geometry | Prefer these for `solid_edit_*` / sketch dim edits |
| **Driven / reference** | Measures; does not push the model | Read for inspect; do not “set” it expecting update |

If the UI or inspect payload marks a dim as reference/driven, **do not** invent
a write API for it.

## Formula pitfalls

1. **Hidden `* 25.4`** — convert inch vendor data once in a VERIFY table; keep
   sketch numbers in mm.
2. **Deep expression trees** — prefer a few named drivers over
   `a = b/2 + (c-d)*e` nobody can edit safely.
3. **Ids that die on rebuild** — formulas pointing at faces/edges that vanish
   after delete-rebuild ([edit history](edit-history-not-delete-rebuild.md)).
4. **Cross-feature spaghetti** — one driver feeding five unrelated features
   without a clear stack story.
5. **Coupon skipping** — a perfect formula does not qualify printer shrink or
   tap fit.

## MCP checklist

- [ ] Drivers named in the plan (“stock_thickness = 12 mm”)
- [ ] Edits go through `solid_edit_*` / sketch dim edits — not remodel
- [ ] After driver change: [inspect between mutates](inspect-between-mutates.md)
- [ ] Driven dims used only as readbacks
- [ ] No unit conversion buried in expressions
- [ ] Critical fits still couponed ([fit coupons map](../machine-design/concepts/fit-coupons-recipes-map.md))

## Anti-patterns

- “Everything is `= width/2`” so nothing has a stable primary size
- Editing a driven readout and declaring the solid updated
- Delete-rebuild to change one number the history already exposes
- Formula-only design with no blank-doc recipe or inspect loop

Related: [unit systems](unit-systems-mm-default.md),
[edit history](edit-history-not-delete-rebuild.md),
[selection / topology ids](selection-topology-ids-mcp.md).
