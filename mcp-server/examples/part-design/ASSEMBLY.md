# Parametric assembly golden

This retained draft fixture is awaiting the shared Rust script migration with
the [part examples](README.md). Its component, placement, edit, and restore
checks should survive that migration; do not add another JavaScript runner.

Run `node mcp-server/examples/part-design/assembly.mjs --server /path/to/nbcad-mcp --out /path/to/demos`, then package with `node --import tsx scripts/package-mcp-part-demos.mjs /path/to/demos`.

The file retains three sketches, a plate extrusion and four holes, a revolved spacer, and a bracket extrusion. Three component definitions produce four occurrences: the two brackets share the same feature-generated body. No STEP import is involved. Components live in one native project; this does not demonstrate externally linked part files.

The plate is grounded. A rigid joint attaches the spacer. Two planar joints with equal minimum and maximum limits lock the bracket placements on opposite sides of the plate. This is a modeling demonstration, not a fastened or manufacturing-validated assembly.

The runner checks native history, source body count, component/occurrence counts, solved joints without diagnostics, explicit bracket positions and upright orientation, and both bracket instances sharing the edited source. It changes the bracket extrusion from 20 to 25 mm, verifies the changed mesh height, then loads the saved model in a fresh MCP process and repeats those checks. Packaging reads both `.nbcad` archives back and verifies their model contents. The `before` archive retains the 20 mm extrusion; the main archive contains the 25 mm edit.

## Observed limitations

- Current main preserves picked connector offsets and axes when `source_surface_frame` is supplied. This fixture deliberately uses canonical planar anchors plus locked motion coordinates, so the placement offset is applied once. Its rigid spacer joint also supplies an explicit source frame.
- Planar surface normals are not consistently outward solid normals: the revolved spacer exposes +Y on both end planes. Face selection therefore uses plane location and parallelism, not normal sign alone.
- Solver success alone does not establish correct placement or absence of collisions. Explicit placement assertions caught overlapping bracket occurrences in an earlier version of this example. No exact interference or manufacturing clearance test is claimed.
- Current main includes desktop camera controls and the live snapshot publication fixes. This fixture exercises the MCP process and native geometry kernel headlessly; the shared interface's live desktop checks provide separate evidence.
