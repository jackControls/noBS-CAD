---
type: Concept
title: Selection and topology ids for MCP mutates
description: Capture stable Body/Face/Edge ids from solid_scene before fillet/hole/chamfer mutates; never guess topology after a rebuild.
status: draft
updated: 2026-09-20
topics: mcp, agents, modeling, selection, topology
keywords: topology id, face_id, edge_id, body_id, solid_scene, selection, MCP mutate, stable id, edge chain, fillet edges, hole face
related_recipes: fillet-basics, mounting-plate, angle-bracket
---

# Selection and topology ids for MCP mutates

Fillet, chamfer, hole, and many body ops need **topology ids** (body / face /
edge), not prose (“the top front edge”). Agents must **read ids from inspect**
and pass them explicitly.

## Where ids come from

| Step | Tool / habit |
|------|----------------|
| After each solid write | `solid_scene` (and document/sketch status as needed) |
| Record | Stable **Body** id; **Face** / **Edge** ids for the next op |
| Mutate | `solid_fillet` / `solid_chamfer` / `solid_hole` / … with those ids |
| Re-inspect | Ids can shift after some rebuilds — **re-read** before the next edit |

Viewport picking is for humans. MCP mutates should not assume an invisible
“current selection” unless the tool contract says so.

## Checklist

1. **Inspect first** — [inspect between mutates](inspect-between-mutates.md).
2. **Copy ids from the payload** — do not invent sequential integers.
3. **Same body** — edge/face ids belong to a body id; do not mix bodies.
4. **Chains** — when an API offers tangent/chain options, say so explicitly;
   do not assume the kernel chained edges you never named.
5. **After `solid_edit_*`** — re-scene before another topology consume.
6. **Drawings / PMI** — associative dims also key off topology; stale refs
   reject rather than silently lie — re-project after model edits.
7. **Blank-doc lessons** — `fillet-basics` shows the id round-trip on a clean
   solid; replay on blank docs only.

## Anti-patterns

- Chaining five mutates with “edge 1” guessed from the first scene
- Reusing edge ids after a Boolean or delete-rebuild without re-inspect
- Claiming success from a tool ack without confirming the edged faces exist
- Using assembly occurrence poses as a substitute for solid topology ids

Related: [inspect between mutates](inspect-between-mutates.md),
[edit history](edit-history-not-delete-rebuild.md),
[datum / sketch plane](../machine-design/concepts/datum-sketch-plane-choice.md),
[soft disclosure](soft-disclosure-focus-packs.md).
