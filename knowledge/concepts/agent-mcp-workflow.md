---
type: Concept
title: MCP workflow — help, focus, inspect, edit, sessions
description: Preferred cad_help loop, soft focus, inspect between writes, topology ids, solid_edit_*, mm units, headless vs attach.
status: draft
updated: 2026-09-20
topics: mcp, workflow, modeling, sessions
keywords: cad_help, solid_scene, cad_list_all_tools, solid_edit, topology id, headless, cad_attach, mm
related_recipes: fillet-basics, mounting-plate, angle-bracket
---

# MCP workflow — help, focus, inspect, edit, sessions

Humans and MCP share one OKF help corpus (`cad_help` + `nbcad://knowledge/…`
resources = same embeds). Soft focus steers the advertised tool list; every
tool stays callable.

## Help first

| Step | Tool |
|------|------|
| Discover | `cad_help` `search` (default 5 / max 10 hits, ~280-char snippets) |
| Open | `cad_help` `get` with a returned **id** |
| Full page | `resources/read` on the selected `nbcad://knowledge/...` URI |
| Browse labels | `cad_help` `topics` (page size 50) |

Caps locked 2026-09-19. Sharper queries beat dumping pages. Preferred order:
`search` → `get` → optional `resources/read` → datasheets → web. Standards
URLs in pages are citations.

## Soft focus

Default disclosure is **dynamic**: spine ∪ active ∪ soft packs (TTL / LRU).
Out-of-focus tools stay **callable**. Hard errors are missing ids, unfinished
sketches, or kernel failure — soft focus is guidance.

| Mode | Behavior |
|------|----------|
| `dynamic` (default) | Narrow advertised list for the phase |
| `full_static` | Advertise everything (clients that need it) |

| Pack | Phase |
|------|--------|
| `document` | Name, project load/export, session metadata |
| `sketch` | Sketch create / constraints / dimensions |
| `solid` | Extrude, revolve, sweep, loft, rib |
| `modify` | Fillet, chamfer, hole |
| `body_ops` | Shell, patterns, combine, split, STEP import |
| `datums` | Construction planes / datum features |
| `history` | Rollback, delete, reorder |
| `inspect` | Read-only solid/sketch catalogs |
| `print` | 3MF/STL/STEP export, materials |
| `cam` | Tool library, toolpaths, post, sim |
| `assembly` | Components, joints, interference |

Golden path: `cad_list_focus_areas` → `cad_set_focus` for the phase → mutate.
When planning or the short list looks thin, call **`cad_list_all_tools`**
(schemas + focus tags).

## Inspect → mutate → inspect

| Tool | Between writes |
|------|----------------|
| `solid_scene` | Bodies, Body/Face/Edge ids, meshes, feature errors |
| Document / sketch status | Sketch state, focus, expected features |
| `assembly_interference_check` | Multi-body overlap at solved poses |

Preferred loop: note blank vs existing doc → write → `solid_scene` → read
feature fields → keep ids for the next op → next write. Pair visual claims with
[validate before show](validate-before-show.md); mesh export claims with
[adversarial mesh audit](adversarial-mesh-audit.md).

## Topology ids

Pass **Body / Face / Edge ids** from inspect into fillet, chamfer, hole, and
body ops. Copy ids from the payload; keep face/edge ids on the same body.
After rebuilds, Booleans, or `solid_edit_*`, re-read ids before the next
topology consume.

## Edit with `solid_edit_*`

When a dimension or edge set needs a change, edit the feature in place.

| Intent | Prefer |
|--------|--------|
| Extrude depth | `solid_edit_extrude` |
| Fillet / chamfer set or radius | `solid_edit_fillet` / `solid_edit_chamfer` |
| Hole size / points / role | `solid_edit_hole` + definitions |
| Revolve / sweep / loft / rib / shell | matching `solid_edit_*` |

Read `solid_*_definitions` before and after. Use a blank document when the
feature type itself is wrong and needs a different construction path.

## Units and drivers

- Default project units: **mm** (document/recipe may say otherwise).
- Include units in the plan (“extrude 12 mm”). Convert inch vendor data once in
  a VERIFY table ([research before commit](research-before-commit.md)).
- Prefer named **driving** dimensions editable via `solid_edit_*`. Treat
  driven/reference dims as readbacks.
- Keep expression trees shallow; re-inspect after changing a driver.

## Headless vs attach

| Goal | Mode |
|------|------|
| Goldens, coupons, recipes, CI | **Headless** |
| Drive the user's open window | **Attach** after `cad_list_sessions` |
| Pull latest UI export into MCP | `cad_refresh` while attached |
| End live binding | `cad_detach` |

Snapshot bridge (`NBCAD_SESSION_DIR`): UUID v4 session ids; desktop publishes
`<uuid>/{model.json,…}`; attach needs valid `model.json`; refresh is explicit;
MCP edits stay in memory (session files are read-side). Other session
strategies remain available as the product evolves.

## Blank-document scripts

Recipes and long `cad_interface` / `cad_script` demos assume a **blank**
document (or one you intentionally wiped).

| Situation | Action |
|-----------|--------|
| Teaching / coupon / recipe id | `cad_new_project` → `cad_interface` `{ "action": "script", "recipe": "<id>", "mode": "fast" }` |
| Live desktop already has work | New project or headless for the lesson |
| One feature on an existing part | `solid_edit_*` + inspect |
| Recipe needs a clean restart | New blank doc |

`related_recipes` on help pages match `cad_interface` `recipes`. Humans open
the same `.nbcad.jsonc` via Scripts / presentation.

Design package scripts: keep one authoritative `VERSION` /
`DESIGN_VERSION` string; for working designs prefer `design_vM_N.nbcad.jsonc`
(version in filename **and** inside JSONC metadata), prune prior
`design_v*.nbcad.jsonc` (and leftover `gen_v*.py`) when cutting — see
[design VERSION / JSONC scripts](design-version-scripts.md).

## Export format (AM)

Prefer **3MF** for print packages when available; STL as fallback. Keep
`.nbcad` for history and STEP for CAD interchange. Preflight and slicer
evidence: [export and print](export-print.md).

## Fits and clearances (quick pointer)

Role-based clearances and fit coupons beat a single global XY offset — see
[fits & clearances](../machine-design/concepts/fits-clearances.md) and
[fit coupons map](../machine-design/concepts/fit-coupons-recipes-map.md).

Related: [MCP harness](mcp-harness.md), [research before commit](research-before-commit.md),
[validate before show](validate-before-show.md),
[design VERSION / JSONC scripts](design-version-scripts.md),
[STEERABLE_MCP](../../docs/agentic/STEERABLE_MCP.md).
