# noBS CAD MCP server

`nbcad-mcp` is a native **stdio** JSON-RPC MCP server (protocol revision
`2025-06-18`, with lifecycle negotiation for prior revisions). It covers most
currently implemented sketch and solid-modeling tools, exposes one persistent
headless CAD document per process, and uses the same Rust planner plus native
OCCT adapter as the desktop app for solid operations.

> Notes: [docs/mcp-harness.md](../docs/mcp-harness.md).  
> Proposed ideas (focus tools, UI co-link, …):  
> [docs/proposed-architecture.md](../docs/proposed-architecture.md).
>
> **Today:** large static tool list (`tools.listChanged: false`), and an
> **independent** document from the visible UI. Treat this server as a local
> automation/testing surface, not as a live UI session.

## Build and verify

Native OCCT 7.9.x must be installed or supplied through `OCCT_ROOT`.

```sh
cargo build --release --manifest-path mcp-server/Cargo.toml
cargo test --manifest-path mcp-server/Cargo.toml
```

The resulting MCP command is:

```text
/absolute/path/to/noBS-CAD/mcp-server/target/release/nbcad-mcp
```

Configure that command as a stdio server named `nbcad` in any MCP
client. No command arguments or environment variables are needed when OCCT
is installed in its default Homebrew location. A typical client-equivalent
configuration is:

```json
{
  "mcpServers": {
    "nbcad": {
      "command": "/absolute/path/to/noBS-CAD/mcp-server/target/release/nbcad-mcp"
    }
  }
}
```

**Transport:** stdio is the current supported offline path. Put logs on
**stderr**; stdout is JSON-RPC. Local/offline behavior is the invariant;
internal IPC may evolve later.

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
(118° is the application default). Matching definitions/edit tools preserve
these operations in the same replayable history.

`solid_hole` also accepts optional ISO metric coarse/fine or ASME B1.1
UNC/UNF internal-thread data. Use a common `6H` class for ISO metric or `2B`
for Unified threads unless the design requires another fit. The hole
`diameter` remains the editable predrill diameter; `thread.nominal_diameter`
is the major diameter. `modeled` creates a 60° helical B-rep, while
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
one/two-direction Rectangular Pattern, Circular Pattern, Combine, and Split
Body through the same replayable history as the interactive application.

`cad_project_model` returns the authoritative versioned `model.json`, and
`cad_load_project_model` transactionally restores and recomputes it. The
outer ZIP-based `.nbcad` packaging and live desktop-session attachment are
not part of this first server slice; currently each MCP process owns an
independent document.

There is no MCP `solid_export_3mf` tool yet; STEP export lives in the UI.
3MF with materials/colors remains a documented target, not current MCP
functionality.
