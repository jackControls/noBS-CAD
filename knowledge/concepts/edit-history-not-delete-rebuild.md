---
type: Concept
title: Edit history — do not delete-rebuild
description: Prefer solid_edit_* and feature definitions over deleting bodies or features and remodeling; fillet-basics style discipline for agents.
status: draft
updated: 2026-09-20
topics: mcp, agents, modeling, workflow, history
keywords: edit history, delete rebuild, solid_edit_fillet, solid_edit_extrude, solid_edit_hole, feature edit, parametric edit, fillet-basics, remodel from scratch
related_recipes: fillet-basics, mounting-plate, angle-bracket
---

# Edit history — do not delete-rebuild

When a dimension or edge set is wrong, **edit the feature** — do not delete the
body (or the feature) and rebuild the whole part. Delete-rebuild burns stable
ids, breaks downstream fillets/holes, and hides what changed in review.

The modeling golden pattern: run `fillet-basics`, then
`solid_edit_extrude` to change stock distance — ids and checks remain coherent.

## Prefer these tools

| Intent | Prefer |
|--------|--------|
| Change extrude depth | `solid_edit_extrude` + readback definitions |
| Change fillet/chamfer set or radius | `solid_edit_fillet` / `solid_edit_chamfer` |
| Change hole size/points/role | `solid_edit_hole` + `solid_hole_definitions` |
| Change revolve/sweep/loft/rib/shell | matching `solid_edit_*` |
| Move/copy instances | `solid_edit_move_copy` (when applicable) |

Read definitions (`solid_*_definitions` / hole definitions) **before and after**
edits so you know what the document actually stores.

## When delete is acceptable

- The feature is **wrong type** (should have been revolve, not extrude) and no
  edit path can convert it
- The body is an **experiment** on a throwaway document with no downstream deps
- You are following a recipe that intentionally resets a blank doc

Even then: prefer a **new blank document** over silently gutting a reviewed part.

## Agent checklist

1. Identify the **feature id** / definition to change (`solid_scene`, definitions).
2. Call the matching **`solid_edit_*`** with the new parameters.
3. **Inspect** (`solid_scene`) — feature errors, body count, downstream features.
4. Re-run only the **dependent** ops if the product requires it — do not
   remodel unrelated geometry.
5. Capture a before/after note for humans when the change is review-critical.
6. Shot pack if the claim is visual
   ([validate before show](validate-before-show.md)).

## Tie-ins

- Edge breaks: [fillet vs chamfer](../machine-design/concepts/fillet-chamfer.md)
- Holes: [hole wizard vs modeled](../machine-design/concepts/hole-wizard-vs-modeled.md)
- Plane mistakes: fix plane/edit feature — 
  [datum / sketch plane](../machine-design/concepts/datum-sketch-plane-choice.md)
- Inspect loop: [inspect between mutates](inspect-between-mutates.md)

## Anti-patterns

- Delete body → sketch again → extrude again to change 12→18 mm
- Recreating fillets because one edge was missing from the set
- “Faster to start over” on a document that already has review comments

Related: [agent MCP workflow](agent-mcp-workflow.md), recipes in frontmatter `related_recipes`.
