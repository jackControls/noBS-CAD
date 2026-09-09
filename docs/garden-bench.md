# Editable crown garden bench

This is an original native design, not an imported FreeCAD bench. It is a
parametric modeling and assembly example: 1200 mm seat width, 450 mm seat
height, rounded timber seat slats, crowned and slotted back pickets, contrasting
frame members, and bullnose armrests. The earlier `bench` suite remains a small
rectangular-stock regression fixture.

Run from the repository root with an OCCT-enabled MCP binary:

```sh
cargo xtask test-mcp garden-bench --server /absolute/path/to/nbcad-mcp --out /absolute/path/to/results
```

To build visibly in a new native window and save an editable project:

```sh
cargo xtask test-mcp garden-bench --server /absolute/path/to/nbcad-mcp --desktop /absolute/path/to/nbcad --save /absolute/path/to/crown-garden-bench.nbcad --out /absolute/path/to/results
```

Use binaries from the same source revision. The example requires the slot
center-constraint and capsule-tangency fixes that accompany it. It launches a
new document rather than overwriting the user's current work. The recipe uses
the shared product groups through `cad_interface`; it has no UI selectors or
model-file surgery. STEP/STL are not intermediate or deliverable substitutes.

## Design and editing

Component definitions own the native bodies; occurrences reuse them. The
seat's first occurrence is grounded and face-referenced rigid mate frames
locate the remaining members. Mate offsets are explicit assembly dimensions;
this example does not claim a global parameter that resizes the entire bench.
Front legs and continuous rear posts support the seat. Aprons terminate at leg
faces, lower rails carry the stretcher, and two native clearance pockets keep
the rear seat from intersecting the rear posts.

Every stock sketch has driving width/depth dimensions. The back picket adds
persisted crown and edge fillets plus a face-mounted slot sketch and through
cut. The slot has driving width and center spacing, vertical orientation, and
a located center datum. Only that locating point is fixed; the slot remains
editable. Its explicit center-coincidence constraint is validated by the same
engine command used by MCP and the application.

`report.json` maps named components to their sketch names, body IDs, extrusion
feature IDs and slot dimension ID. Sketch coordinates describe the component's
local definition, while occurrence placement describes the assembled location.
Use the component and feature map when editing; do not move sketch geometry
merely to imitate occurrence placement.

The recipe edits the slot width from 18 to 20 mm, proves the cut volume changes,
then edits picket height from 315 to 340 mm and checks dependent features and
all assembly poses. A fresh MCP process restores the native history and makes
another height edit to 350 mm. The displayed/saved design retains 340 mm
pickets. No-op cuts, recompute errors, unconstrained slot geometry, misplaced
occurrences, or imported history fail the example. These focused checks do
not impose an all-tools coverage gate.

Material colors are visual designations. Connection hardware
and fabrication tolerances beyond the demonstrated post clearances are not
specified by this recipe.
