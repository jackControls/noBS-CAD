# Part design through MCP

These examples build editable parts using ordinary modeling tools over the real
MCP stdio connection. They complement the built-in print-in-place export demos.
All lengths are millimetres; each example starts a fresh headless document.

- **Mounting plate:** dimension a 60 × 40 mm rectangle, extrude 5 mm, then make
  four 5 mm through holes with centres 10 mm from each edge. Learn how to inspect
  the current body and select its upward face after each operation.
- **Spacer:** dimension a radial section from radius 5 to 10 mm and length 12 mm,
  then revolve it 360° about the sketch Y axis. The finished bore is 10 mm and
  outer diameter is 20 mm. Global Y is the axis of the finished part.
- **Angle bracket:** close six line segments into a 40 × 30 mm L section with
  5 mm walls, then extrude it 20 mm wide. Check the empty corner remains empty
  through the independent volume expectation.

## Run and save the demonstrations

Build the native server with the OCCT SDK configured as described in
[the MCP harness](../../../docs/mcp-harness.md). Node.js 20 or newer is required.
Run from the repository root:

```sh
cargo build --locked --manifest-path mcp-server/Cargo.toml
node mcp-server/examples/part-design/run.mjs --server /absolute/path/to/nbcad-mcp --out /absolute/path/to/demo-output
```

The executable is normally `mcp-server/target/debug/nbcad-mcp` (append `.exe`
on Windows). On Windows, put the OCCT `bin` directory on `PATH` as well as setting
`OCCT_ROOT`. `NBCAD_MCP_BIN` is an alternative to `--server`.

Each output folder contains an editable `model.json`, the resolved `calls.json`,
the server's recorded `script.json`, `checks.json`, and STEP, STL and 3MF files.
Load `model.json` through `cad_load_project_model` to keep feature history.
STEP import preserves solid geometry but does not reconstruct that history.

To package the saved models for File → Open in the app (after `npm ci`):

```sh
node --import tsx scripts/package-mcp-part-demos.mjs /absolute/path/to/demo-output
```

Open each generated `.nbcad` file and inspect the feature tree and part. These
are saved-file demonstrations; this does not claim a live UI/MCP shared-session
test or complete issue #15.

With the app dev server on port 7199, set `NBCAD_PART_DEMOS` to that output
directory and run `node scripts/e2e-mcp-part-demos.mjs` to check File → Open,
retained feature history, one body and no recompute errors. The browser smoke
does not verify native Bevy rendering: the browser viewport is an interaction
surface, and the visible solid is drawn by the desktop native child view.

## Golden checks

`cargo test --locked --manifest-path mcp-server/Cargo.toml` automatically runs
the examples through an integration test. It uses the existing MCP Windows and
Linux CI jobs, with no additional workflow. The runner has no npm dependencies.

Each example verifies one nonempty body, no recompute errors, finite vertices,
valid triangle indices, bounds within 0.1 mm and mesh volume against an analytic
expectation. Relative volume tolerance is 0.1% for the plate and bracket and 1%
for the coarsely tessellated circular spacer. Missing a plate hole exceeds the
plate tolerance. Volume is computed from the mesh; it is not an exact kernel
mass-property measurement.

The checks repeat after replaying `cad_script`, restoring the editable model,
and exporting/reimporting STEP into fresh processes. STL is checked for its
binary triangle-record length; 3MF is checked for the ZIP header and model entry.
These checks do not replace manifold validation or slicer inspection. Strict
JSON parsing also prevents native diagnostic text from corrupting MCP stdout.

## Usability lessons

1. **Use dimensioned tools for exact sizes.** Pointer-style rectangle calls snap
   coordinates to the grid; an intended 12 mm spacer became 10 mm during this
   exercise. `sketch_add_rectangle_locked` supplies driving width and height.
2. **Inspect, then select.** Never copy body or face IDs from a previous document.
   The plate resolves its current upward planar face by normal, then projects
   the requested world point into that face's local `u/v` axes. The runner fails
   if the selector is ambiguous.
3. **Check results after mutations.** A successful tool response can contain
   recompute errors. Inspect them and check geometry before exporting.
4. **Record a replayable recipe.** Use `cad_script` plus an editable model; an
   exported mesh alone is not a parametric design demonstration.

The fixture strings `$body_id`, `$top_face_id`, and objects `{"$top_uv":[x,y,z]}`
are runner substitutions, not MCP syntax. `calls.json` contains the actual
resolved arguments sent to MCP. Sketch1/profile 0 is intentional for these fresh,
single-profile examples; general agents should discover sketches and profiles.

Next coverage: dimension edits, recovery from an invalid operation, and a real
UI-owned attach → submit → await → refresh → undo loop. Existing headless examples
do not establish live-document usability.
