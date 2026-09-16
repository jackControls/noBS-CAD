---
type: Concept
title: Parametric primitives primer
description: Tiny MCP command patterns for sketch, extrude, hole, combine, fillet/chamfer, datum and 3MF export; when to step vs replay scripts.
status: draft
updated: 2026-09-15
related_recipes: []
---

# Parametric primitives primer

Agent-facing command patterns. Full checkout twin:
[docs/agentic/PARAMETRIC_PRIMITIVES.md](../../docs/agentic/PARAMETRIC_PRIMITIVES.md).

## Step-by-step vs script

- **Careful / new geometry** → MCP tools one-at-a-time; read `solid_scene` between mutates.
- **Proven pattern** → `cad_interface` `{"action":"script","path"|"recipe":…,"mode":"fast"}` on a **blank** document.
- Live UI: `cad_list_sessions` → `cad_attach` first.

## Worked order

`sketch_begin` → draw/constrain → `sketch_finish` → `solid_extrude` → `solid_hole` →
`solid_combine` (`join`/`cut`) → `solid_fillet` / `solid_chamfer` →
`construction_plane_offset` → `solid_scene` → `solid_export_3mf`.

Minimal runnable source (not catalog-registered):
`examples/scripts/parametric-primitives-primer.nbcad.jsonc`.

## Family → tools (canonical names)

| Family | Tools | Use when | Args sketch |
|--------|-------|----------|-------------|
| Sketch | `sketch_begin`, `sketch_finish`, `sketch_add_rectangle_locked`, `sketch_add_constraint` | Profile on a plane | begin `{name,plane}`; locked rect + fix |
| Solid build | `solid_extrude` (+ revolve/sweep/loft/rib) | Profile → body | `{sketch_name,profile_indices,operation,extent,…}` |
| Hole | `solid_hole` | Face drill | `{body_id,face_id,position,diameter,extent,style}` |
| Combine | `solid_combine` | Join/cut/intersect bodies | `{target_body_id,tool_body_ids,operation,keep_tools}` |
| Refine | `solid_fillet`, `solid_chamfer` | Edges | `{body_id,edge_ids,radius\|distance,tangent_chain}` |
| Datum | `construction_plane_offset` (+ midplane/at_angle) | Support plane | `{name,offset,reference}` |
| Inspect/print | `solid_scene`, `solid_export_3mf` | IDs / slicer | 3mf `{body_ids?,slicer_target:"standard"}` |

Prefer returned session IDs; in scripts use `$ref` / `$select` / `$project`.
Deeper: mcp-server README, native-scripts, examples/scripts README, STEERABLE_MCP.
