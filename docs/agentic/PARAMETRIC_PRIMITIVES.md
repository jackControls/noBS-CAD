# Parametric primitives primer (agent)

Ruthless command patterns for native parametric CAD. Prefer this over thrashing
between giant flagship recipes and ad-hoc tool calls.

**MCP resource (after rebuild):** `nbcad://knowledge/concepts/parametric-primitives.md`

## MCP step-by-step vs script replay

| Situation | Use |
|-----------|-----|
| New geometry, unsure IDs/planes, debugging a failed feature | **MCP step-by-step** — one tool at a time; read `solid_scene` / returned IDs before the next mutate |
| Proven pattern you already validated (or a bundled lesson) | **Script replay** — `cad_interface` `{"action":"script","path":"..."}` or `"recipe":"..."` in `mode:"fast"` |
| Mix | Sketch the novel bit via MCP; replay proven chunks (holes pattern, fillet rim, export) as script |

Hard rule: scripts need a **blank** document. Never replay over an existing model.
Live desktop: `cad_list_sessions` → `cad_attach` first. Headless goldens need no attach.

## Tiny worked flow (mm)

Canonical order: **sketch → finish → extrude → hole → combine → fillet/chamfer → datum → inspect/export**.

1. `sketch_begin` `{name, plane:{type:"origin_plane",plane:"xy"}}`
2. `sketch_add_rectangle_locked` `{mode:"two_point", anchor:{x:0,y:0}, corner_hint:{x:40,y:30}, width_mm:40, height_mm:30, ctrl_held:true}`
3. `sketch_add_constraint` fix the origin corner point (see recipe `$select` patterns)
4. `sketch_finish` `{}`
5. `solid_extrude` `{sketch_name, profile_indices:[0], operation:"new_body", extent:{type:"distance",distance:8}, taper_angle_deg:0, flip:false, target_body_ids:[]}`
6. `solid_scene` → pick planar face + body ids
7. `solid_hole` `{body_id, face_id, position:{u,v} or projected point, diameter:5, extent:{type:"through_all"}, style:"simple", flip:false, …}`
8. Build a second body (`new_body`), then `solid_combine` `{target_body_id, tool_body_ids:[…], operation:"cut"|"join", keep_tools:false}`
9. `solid_fillet` `{body_id, edge_ids:[…], radius:2, tangent_chain:false}` / `solid_chamfer` `{body_id, edge_ids:[…], distance:0.6, tangent_chain:false}`
10. `construction_plane_offset` `{name, offset:4, reference:{type:"origin_plane",plane:"xy"}}` (cheap datum)
11. `solid_export_preflight` → `solid_export_3mf` `{body_ids:[…], slicer_target:"standard"}`

Runnable twin: [`examples/scripts/parametric-primitives-primer.nbcad.jsonc`](../../examples/scripts/parametric-primitives-primer.nbcad.jsonc)
(`cad_interface` `{"action":"script","path":"<abs>/parametric-primitives-primer.nbcad.jsonc","mode":"fast"}`).
Not a catalog recipe (keeps registration light).

## Primitive family → MCP tools

| Family | MCP tool(s) | When to use | Minimal args |
|--------|-------------|-------------|--------------|
| Sketch session | `sketch_begin`, `sketch_finish`, `sketch_profiles` | Open/close plane; list profiles before solid ops | begin: `{name,plane}`; finish: `{}` |
| Sketch draw | `sketch_add_rectangle_locked`, `sketch_add_circle_locked`, `sketch_add_line_locked`, … | Create geometry | locked rect/circle preferred for fully sized stock |
| Sketch constrain | `sketch_add_constraint`, `sketch_add_dimension` | Locate / size | `{type:"fix", entity:<point_id>}` |
| Extrude / revolve / sweep / loft / rib | `solid_extrude`, `solid_revolve`, `solid_sweep`, `solid_loft`, `solid_rib` (+ `_edit_*`) | Solid from profiles/paths | extrude: `{sketch_name,profile_indices,operation,extent,…}` |
| Hole | `solid_hole`, `solid_edit_hole` | Drill on planar face | `{body_id,face_id,position,diameter,extent,style,…}` |
| Fillet / chamfer | `solid_fillet`, `solid_chamfer` (+ edits) | Edge refine | `{body_id,edge_ids,radius\|distance,tangent_chain}` |
| Combine | `solid_combine`, `solid_edit_combine` | Join / cut / intersect bodies | `{target_body_id,tool_body_ids,operation:"join"\|"cut"\|"intersect",keep_tools}` |
| Body ops | `solid_shell`, `solid_mirror`, `solid_*_pattern`, `solid_split_body`, `solid_import_step` | Shell/mirror/pattern/split/import | see tool schema; STEP = reference solid only |
| Datums | `construction_plane_offset`, `_midplane`, `_at_angle` (+ edits) | Sketch support planes | offset: `{name,offset,reference}` |
| Inspect | `solid_scene`, `cad_document`, `cad_project_model`, `*_definitions` | IDs, history, errors | `solid_scene` `{}` after mutates |
| Print export | `solid_export_preflight`, `solid_export_3mf` (prefer), `solid_export_stl` | Slicer handoff | 3mf: `{body_ids?, slicer_target:"standard"}` |
| Script / recipes | `cad_interface` | Discover/run `.nbcad.jsonc` | `{"action":"recipes"}` / `{"action":"script","recipe"|"path"|"source",…}` |

Do **not** invent tool names. Use `cad_list_all_tools` or focus packs when unsure.
Matching `_definitions` / `_edit_*` tools preserve replayable history — prefer them over delete+rebuild.

## IDs and selections

- Trust IDs returned by the **last** successful mutate / `solid_scene` in this session.
- In scripts, prefer `$select` / `$project` / `$ref` over hard-coded numeric IDs (see native-scripts).
- Extrude `operation`: `new_body` | `join` | `cut` | `intersect` when meaningful; body-boolean across existing bodies uses `solid_combine`.

## Optional deeper reading (not required)

- [mcp-server/README.md](../../mcp-server/README.md) — full modeling flow + boundaries
- [docs/native-scripts.md](../native-scripts.md) — `.nbcad.jsonc` format, `$select`, present/fast
- [examples/scripts/README.md](../../examples/scripts/README.md) — lessons + flagships (`fillet-basics`, `mounting-plate`, garden-bench, …)
- [STEERABLE_MCP.md](STEERABLE_MCP.md) — disclosure invariants (do not break)
- Knowledge index: `nbcad://knowledge/index.md`
