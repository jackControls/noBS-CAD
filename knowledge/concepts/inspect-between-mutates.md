---
type: Concept
title: Inspect between mutates (solid_scene discipline)
description: Agent ops — call solid_scene / document inspect between geometry writes; never chain blind mutates.
status: draft
updated: 2026-09-20
topics: mcp, agents, validation, modeling, workflow
keywords: inspect between mutates, solid_scene, cad_document, feature errors, body ids, blind mutate, MCP discipline, scene inspect, between writes
related_recipes: fillet-basics, mounting-plate, angle-bracket
---

# Inspect between mutates (solid_scene discipline)

MCP agents that **chain writes** without reading the scene invent bodies, miss
feature errors, and present blank frames. Discipline: **inspect → mutate →
inspect** again.

## Primary tools

| Tool | Use between writes |
|------|--------------------|
| **`solid_scene`** | Active bodies, stable Body/Face/Edge ids, meshes, **feature errors** |
| **Document / sketch status** | Unfinished sketch, focus, expected feature list |
| **`assembly_interference_check`** | Multi-body overlap at solved poses (when assembly) |

Soft focus may hide tools from a short list — they stay **callable**. Prefer
`cad_list_all_tools` over inventing APIs
([agent MCP workflow](agent-mcp-workflow.md)).

## Mandatory loop

1. **Before** the first mutate: confirm blank vs existing doc; note body count.
2. **After each** solid/sketch write: `solid_scene` (or equivalent inspect).
3. **Read feature errors** — do not ignore red/error fields and continue.
4. **Confirm ids** you will reuse (face/edge for fillet, hole positions).
5. **Only then** next mutate (fillet, hole, pattern, Boolean).
6. Before “looks good”: [validate before show](validate-before-show.md) shot pack.

## Checklist

- [ ] Body count matches intent (no surprise empty or duplicate solids)
- [ ] Feature errors empty or explicitly handled
- [ ] Stable ids recorded for the next op
- [ ] Sketch finished before feature that consumes it
- [ ] Units still mm (or documented exception)
      ([unit systems](unit-systems-mm-default.md))
- [ ] No camera-inside-solid “proof”
      ([validate before show](validate-before-show.md))

## Why agents skip this

- Optimistic chaining (“extrude then fillet then hole”)
- Treating a successful tool ack as geometric success
- Using Help search as a substitute for scene state

A successful MCP response ≠ printable or reviewable geometry. Pair with
[adversarial mesh audit](adversarial-mesh-audit.md) before export and
[edit history not delete-rebuild](edit-history-not-delete-rebuild.md) when
fixing dimensions.

## One-step example

Blank doc → sketch rectangle on XY → extrude → **`solid_scene`** (one body,
no errors) → fillet edges by id → **`solid_scene`** again → hole positions →
**`solid_scene`** → shot pack. That is E5-shaped discipline from the modeling
goldens — not optional polish.

## Anti-patterns

- Five mutates, one inspect at the end
- Re-picking faces by guess after ids shifted because of rebuild
- Claiming “done” from JSON alone without `solid_scene`

Related: [MCP harness](mcp-harness.md), [assembly interference](assembly-interference.md),
[datum / sketch plane choice](../machine-design/concepts/datum-sketch-plane-choice.md).
