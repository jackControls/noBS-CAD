# Native recipe library

Open **Scripts** in CAD and select a bundled example, then choose **Run in new
design**. Start with **Sketch, extrude, ease the edges**: it builds a small part,
changes its extrusion from 12 to 18 mm while retaining the fillet, and restores
the 12 mm reference. Follow [the first-part guide](../../docs/INSTALL.md#make-your-first-part)
to edit, save and reopen the result yourself.

Maximum rate builds the same model without presentation waits. Pause and Step
let you inspect the sequence; paced presentation adds chapter notes and camera
moves. All modes use the same Rust interpreter and construction source.

- [Sketch, extrude, ease the edges](fillet-basics.nbcad.jsonc): a first-part lesson
  for Solid → Refine → Fillet. Builds a fully located 60 × 30 mm sketch, extrudes
  12 mm of stock and rounds the four top edges by 2 mm. Demonstrates an 18 mm
  extrusion edit and restoration, with captioned preview frames and final checks.
- [Four-hole mounting plate](mounting-plate.nbcad.jsonc): fully located 60 × 40 × 5 mm
  stock, four 5 mm through bores and face-basis projection after each cut.
- [Revolved annular spacer](revolved-spacer.nbcad.jsonc): a located radial section,
  20 mm outside diameter, 10 mm bore and 12 mm length, revolved about Y.
- [Dimensioned angle bracket](angle-bracket.nbcad.jsonc): a closed, fully constrained
  L section with 40 × 30 mm envelope, 5 mm walls and 20 mm extrusion width.
- [Repeated bracket assembly](repeated-bracket-assembly.nbcad.jsonc): three native
  part definitions, four occurrences and explicit mating frames. Editing one
  bracket extrusion from 20 to 25 mm updates both of its occurrences. This is a
  component/placement lesson, not a fastened or manufacturing-qualified assembly.
- [Crown garden bench](garden-bench.nbcad.jsonc): a complete timber assembly from
  dimensioned sketches, native features and physical mating references. Includes
  authored captions, camera framing and final manufacturing contracts.
- [Vertical-axis turbine](vertical-axis-turbine.nbcad.jsonc): two reused Savonius
  stages, constrained 72:18 generator gearing, native part and assembly drawings,
  printable definition exports and explicit physical qualification inputs.
- [D-screw vise](d-screw-vise.nbcad.jsonc): six printed parts, 100 mm gripping
  faces and 90 mm captured-jaw travel. Its custom rounded Ø24 × 4 mm screw has a
  shallow print flat and detachable thrust fitting. Includes seven drawing
  sheets, a print layout for each part and simplified M5/M6 hardware envelopes;
  30 bodies including optional mounting hardware.
- [D-screw fit coupon](d-screw-vise-fit.nbcad.jsonc): four specimens for the actual
  print process: the custom rounded screw, matching female thread and a
  male/female captured-guide pair. Qualify their fit before making a full vise.
- [Turbine fit coupons](turbine-fit-coupons.nbcad.jsonc): four native specimens
  reuse the shaft clamp, bearing seat, motor cradle and pinion geometry, with
  driving fit dimensions, print orientations and associative drawings.
- [Version 1 editor schema](nbcad-script.schema.json): step and expression guidance
  for JSONC-aware editors. The Rust interpreter validates references, and the
  shared interface owns each modeling operation’s argument schema.

For command-line replay, use the [developer guide](../../docs/DEVELOPMENT.md#replay-a-recipe).
It covers packaged CAD (`--server-arg --mcp`), standalone servers and AppImage arguments.
MCP lists the same collection with `cad_interface {"action":"recipes"}` and runs
one with `{"action":"script","recipe":"mounting-plate","mode":"fast"}`.
The app's example list is supplied by that same Rust catalog in `crates/recipes`.
Catalog discovery does not build anything. A caller must choose a file or recipe;
there is no implicit bench run.
Use `--repeat 2` for independent headless comparison. After preserving the current
document, use `--session UUID --new --present --speed 2` to create a blank design tab
and watch the same sequence in that existing window. Omit `--new` if the named tab
is already blank. The script refuses to construct over an existing model.

See [the native script format](../../docs/native-scripts.md). Each `.nbcad.jsonc` source
replays construction; the generated `.nbcad` project retains the editable result.

The bench, turbine and vise are all runnable manufacturing candidates. The two
new sources include their editable drawing packages and teaching notes. Their
native tests check independent replay, model reload, intended dimension edits,
solved motion, interference and printable mesh integrity. See
[flagship status](../../docs/flagship-examples.md) and the individual design docs
for evidence and remaining physical qualification. The bench's full drawing
package remains open, and no flagship has a physical load or durability rating.

The migrated small fixtures preserve #89's analytic bounds/volume, independent
replay, fresh-process native restore, STEP round trip and STL/3MF checks in
`mcp-server/tests/recipes.rs`. The repeated bracket check restores both the 20 mm
baseline and 25 mm edited project, checks solved occurrence poses and verifies
all three profiles retain zero degrees of freedom. Export is a tested derivative;
native sketches and features construct the source model. The old Node recipe
runner and custom argument substitutions are not part of this library.

To add a feature lesson, commit its `.nbcad.jsonc`, add one catalog entry, and add
the focused geometry/edit check that establishes the feature's intent. Titles,
chapters, step counts and the actual operation list come from the source. Declare
the operation the lesson teaches; do not advertise every incidental setup command
as a hover lesson. Use existing native CI and replay tests, without an all-tools
percentage gate or an additional runner.
