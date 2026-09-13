# noBS CAD MCP server

The MCP server drives native sketches, solid features, assemblies and drawings
through the same grouped product operations used by the application. It runs
locally over **stdio** JSON-RPC (protocol `2025-06-18`).

**No source build needed for a release install:** the desktop application starts
this same server when launched with `--mcp`, without opening a window. See
[packaged MCP setup](../docs/INSTALL.md#connect-an-mcp-agent) for Windows, macOS
and Ubuntu commands. The standalone binary and developer setup below remain
available for source builds.

> Notes: [docs/mcp-harness.md](../docs/mcp-harness.md).
> Further architecture options (multi-document broker, …):
> [docs/proposed-architecture.md](../docs/proposed-architecture.md).

**Spine controls:** `cad_get_focus`, `cad_set_focus`, disclosure mode get/set,
`cad_list_all_tools`, `cad_cancel_recompute`, `cad_list_sessions`, `cad_attach`,
`cad_refresh`, `cad_detach` (explicit document discovery and attachment).

**Print:** prefer `solid_export_3mf` (mm + materials + slicer Metadata). Also
`solid_export_stl`, `solid_export_step` (CAD), `material_catalog`,
`body_appearances` / `set_body_appearance`, `solid_export_preflight`, and
`demo_export_pip_3mf`.

**Engineering knowledge:** standard `resources/list` discovers the existing
Markdown knowledge bundle; `resources/read` returns a listed URI such as
`nbcad://knowledge/concepts/gears.md`. Start with `nbcad://knowledge/index.md`
for design and workholding guidance. The corpus is compiled into the server,
available offline, and read-only; rebuild after updating `knowledge/`.

## Setup and first use

Follow [Install → Connect an MCP agent](../docs/INSTALL.md#connect-an-mcp-agent)
for packaged executable paths, exact Cursor/VS Code configuration files and a
first-part prompt. The installed application uses `--mcp`; a separately built
`nbcad-mcp` executable starts directly as a server.

Developers should use the single [build and test guide](../docs/DEVELOPMENT.md)
for OCCT runtime setup, sequential native tests and
[replay CLI examples](../docs/DEVELOPMENT.md#replay-a-recipe).
The [source installer](../docs/agentic/INSTALL_MCP.md) can configure a standalone
development server in supported clients.

Logs go to **stderr**; stdout carries JSON-RPC. Tool discovery uses soft focus
groups (`tools.listChanged: true`); undisclosed tools remain callable. Use
`full_static` or `cad_list_all_tools` when a client cannot refresh dynamic tool
lists. `cad_interface` also supports desktop launch and guarded live-window
control; the [harness guide](../docs/mcp-harness.md) explains ownership.

## Drawing and material boundaries

Native MCP drawing export supports SVG/DXF with linear, radial and angular
dimensions, notes, title information and BOM. Other annotation kinds and
dual-unit presentation are rejected by this exporter. The interactive drawing
workspace has wider annotation/export coverage and the print/PDF path. See
[drawing delivery](../docs/2D_DRAWINGS.md#export-and-print) and the
[native export contract](../docs/native-drawing-export.md).

3MF carries millimetres, per-body material names/colors and compatible slicer
metadata hints. Select and review actual filament and process settings in the
slicer. A material assignment does not establish strength, printability or a
qualified printer profile; see [export guidance](../knowledge/concepts/export-print.md).

## Modeling flow

The server is stateful. A normal sequence is:

1. `sketch_begin`
2. one or more `sketch_add_*` and constraint tools
3. `sketch_finish`
4. `sketch_profiles`
5. A solid creation tool such as `solid_extrude`, `solid_revolve`,
   `solid_sweep`, `solid_loft`, or `solid_rib`
6. `solid_scene` and `cad_document`

`sketch_begin` accepts a required `plane` object. For a stable planar face,
the optional `face_origin` value can be `face_center` or
`global_origin_projection`; omitting it preserves the support face's kernel
origin for compatibility with existing MCP clients.

After a body exists, use stable edge IDs from `solid_scene` with
`solid_fillet`/`solid_chamfer`, or a planar face ID and one or more face-local
positions with `solid_hole`. Hole positions may carry stable sketch-point
references, and finite holes support flat or angled drill-point bottoms
(118┬░ is the application default). Matching definitions/edit tools preserve
these operations in the same replayable history.

`solid_hole` also accepts optional ISO metric coarse/fine or ASME B1.1
UNC/UNF internal-thread data. Use a common `6H` class for ISO metric or `2B`
for Unified threads unless the design requires another fit. The hole
`diameter` remains the editable predrill diameter; `thread.nominal_diameter`
is the major diameter. `modeled` creates a 60┬░ helical B-rep, while
`simplified` keeps the cylindrical predrill for faster replay and preserves
the complete callout for project and STEP metadata.

Solid calls run the same Rust replay planner and native OCCT adapter as the
desktop application. IDs returned by one call are stable inputs to later
calls in the same feature history.

`sketch_profiles` returns closed profiles plus stable analytic line, arc,
circle, and spline path references. A straight line can be used directly as a
Revolve axis. Connected analytic curves can drive Sweep and guided Loft, and
line/arc/circle/spline entities can drive Rib. Loft accepts an ordered list of
profile references from two or more sketches, optional centerline/guide paths,
and G0/G1/G2 continuity. Rib supports Distance, To Next, Up to Face, and
Through All extents. Every implemented solid family exposes matching
definition/edit tools and supports New Body, Join, Cut, and Intersect where
that operation is meaningful.

Construction-plane tools create and edit Offset, Midplane, and Plane at Angle
features with stable datum IDs. Body-operation tools expose Shell, Mirror,
one/two-direction Rectangular Pattern, Circular Pattern, Combine, Split
Body, and STEP import (`solid_import_step`) through the same replayable
history as the interactive application. STEP import is a reference solid,
not recovered sketch/extrude history; dump a forward tool sequence with
`cad_script` and compare mesh bbox/counts with `cad_compare_solids`.

`cad_project_model` returns the authoritative versioned `model.json`,
`cad_load_project_model` transactionally restores and recomputes it, and
`cad_new_project` clears a headless document. For live work, discover a window
with `cad_list_sessions` and bind its intended document with `cad_attach`.
Ordinary tools and `cad_interface` grouped execution route modeling edits to that
desktop owner and await its ordered receipts. MCP does not write the live
`model.json`; the desktop applies operations and publishes completed snapshots
under `NBCAD_SESSION_DIR`. An unattached MCP process owns its own document.

`cad_submit`, `cad_await_apply` and `cad_refresh` remain lower-level diagnostics,
not extra calls required after each edit. Old desktops that do not support the
shared interface reject live writes with a version/ownership error. Live routing
landed in #91 and closed #11; multi-document brokering remains #12.
When using those diagnostics, retain both `session_id` and `seq` from
`cad_submit` and pass both to `cad_await_apply`. Sequence numbers belong to one
session. A successful whole-document replacement waits for its new publisher
and updates the initiating attachment; other queued work stays with the retired
document. Reading an old session's receipt does not change the current attachment.

## Authored recipes

Use `cad_interface` with `action: "recipes"` to discover the Rust-owned catalog.
Run a selected source with `{"action":"script","recipe":"mounting-plate"}`;
an explicit `source` or absolute `.nbcad.jsonc` `path` is also accepted instead
of a recipe ID. These choices all use one interpreter and the ordinary grouped
operations. The app and `cargo xtask run-script` consume the same catalog.

Scripts require a blank document, stop at a failing operation and run their final
checks. Fast mode executes locally without presentation waits; present mode adds
authored notes and camera transitions in an attached desktop. `cad_script` remains
the older forward-trace export and is not the authored recipe command.

See [native scripts](../docs/native-scripts.md) for controls and source format,
and [the recipe library](../examples/scripts/README.md) for runnable examples and
their geometry/edit/replay evidence.

**Print handoff:** `solid_export_preflight` → `set_body_appearance` (optional) →
`solid_export_3mf` (preferred for slicers). Use `solid_tessellate` to inspect
triangle counts before exporting. `demo_export_pip_3mf` returns a built-in
print-in-place demo (AABB clearance smoke ≥ 0.4 mm) without mutating the document.
