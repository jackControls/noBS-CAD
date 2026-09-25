---
type: Concept
title: Hole wizard vs modeled hole and simple patterns
description: Prefer solid hole features (roles, positions, threads) over sketch-circle boolean subtracts; pattern positions deliberately.
status: draft
updated: 2026-09-20
topics: modeling, fasteners, holes, mcp, dfm
keywords: hole wizard, modeled hole, simple hole, hole pattern, solid_edit_hole, solid_hole_definitions, sketch circle subtract, clearance hole pattern, bolt circle, PCD
related_recipes: mounting-plate, d-screw-vise, garden-bench
sources: nasa-fastener, nwtc-guns-dfm
---

# Hole wizard vs modeled hole and simple patterns

“Hole wizard” here means the product **hole feature** path (`solid_hole_*` /
`solid_edit_hole`) with explicit **roles and positions** — not a SolidWorks
brand feature. Prefer it over sketching circles and boolean-subtracting
cylinders for fastener holes.

## Prefer the hole feature when

- You need **clearance / counterbore / countersink / tap / thread** roles
  ([fastener clearance & counterbore](fastener-clearance-counterbore.md))
- Positions must stay **editable** as a set (`solid_edit_hole`)
- You will attach **cosmetic vs real** thread policy
  ([cosmetic threads](cosmetic-threads-vs-clearance.md))
- Downstream drawings/BOM should see hole metadata

## Sketch-circle subtract is OK when

- Non-fastener **air passages**, vents, or organic cuts
- One-off geometry that is not a purchased screw path
- You accept weaker editability and weaker role documentation

Even then, name the **intent** in a note or VERIFY table.

## Simple patterns checklist

1. **Freeze the role** (clearance vs tap vs insert pilot) before diameters.
2. **Locate positions** on a plane with known sketch/coordinate frame
   ([datum / sketch plane](datum-sketch-plane-choice.md)).
3. Prefer a **bolt circle / PCD** or rectangular grid you can cite from a
   vendor drawing ([hardware pocket research](am-hardware-pocket-research.md)).
4. Use hole feature **multi-point** positions when available — one feature, many
   points — over duplicated independent holes you will forget to edit.
5. After pattern: `solid_scene` inspect
   ([MCP workflow](../../concepts/agent-mcp-workflow.md)).
6. Prefer keeping cosmetic helix major separate from drill size.

## Prefer edit over delete-rebuild

Changing diameter, depth, or points: use **`solid_edit_hole`** and
`solid_hole_definitions` to read back. Deleting the solid and re-subtracting
circles loses ids and review history
([MCP workflow](../../concepts/agent-mcp-workflow.md)).

## AM notes

Printed holes shrink; coupon clearance holes beside the plate. Heat-set pilots
are not clearance holes ([heat-set inserts](am-heat-set-inserts.md)).

## Sibling pages

Counterbore depth and head recess sizing stay on
[fastener clearance & counterbore](fastener-clearance-counterbore.md).
Vendor PCD research stays on
[hardware pocket research](am-hardware-pocket-research.md).

Related: [fasteners & joints](fasteners-joints.md),
[fits & clearances](fits-clearances.md),
[drawing vs MBD / PMI](drawing-vs-mbd-pmi.md).
