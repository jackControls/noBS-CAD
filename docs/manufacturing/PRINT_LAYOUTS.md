# Named views and multipart print layouts

Named Views in the CAD Browser organize presentation and print placement together.
Create or edit a named view from its Browser context menu. Save a camera, body
inclusion, and translation/rotation offsets for any component occurrence. Parent
placement changes carry their children. Rotations pivot about the occurrence
origin; translations follow world axes. These are presentation changes: mechanical
assembly poses, joints, features, and exact geometry remain unchanged.

Every named view can be selected in the STL/3MF export dialog. Marking a view
**Use as a print layout** enables printer settings and automatic export checks;
it does not create another tree, grouping model, or export restriction.

Assembly 3MF exports use the existing CAD occurrence hierarchy. Root occurrences
become build objects; their nested bodies and children become component resources.
Mesh definitions are reused, while every included repeated occurrence is retained.
Bambu Studio and OrcaSlicer may flatten deeper nesting into one multipart object
per CAD root. Relative alignment and quantities remain intact. Body inclusion
affects all occurrences of that body; occurrence visibility also remains respected.
Definition scope intentionally exports each selected retained body once in part
coordinates, regardless of visibility, and cannot use a named view.

## Check and correct a layout

The default is the pinned Bambu Studio X2D 0.4 mm profile: **256 x 256 x 261 mm**.
The dual-nozzle shared region is **235.5 x 256 x 256 mm**, starting at **X = 20.5 mm**
and ending at X = 256 mm. Bambu Studio and OrcaSlicer profile choices use the same
generated catalog in Rust and the frontend. Profiles retain each nozzle's polygon,
height, usable origin, exclusions, upstream revision, and hashes of inherited files.
Saved layouts freeze their resolved geometry; profile updates never rewrite them.
Selecting a profile again explicitly adopts the catalog's current pinned values.

The slicer profiles specify 261 mm main-nozzle height, while
[Bambu's nominal specification](https://blog.bambulab.com/xcellence-made-simple-bambu-lab-presents-the-x2d/)
says 260 mm. We preserve the slicer source values. Dimensions, origin and XY margin
are editable; changing dimensions or origin switches to a custom rectangular
envelope and clears sourced polygon constraints. Margin reserves space for brim
and other operations, without simulating slicer-generated toolpaths.

Checks use convex printable polygons and conservative exclusion bounds. The
importer rejects unsupported geometry instead of silently discarding it. Packing
searches obstacle edges and a bounded grid; failure means this conservative
proposal did not fit, not that every possible arrangement is impossible.

## Build-time printer catalog

`crates/core/data/printer-sources.json` pins full upstream commit revisions.
Run `cargo xtask printer-profiles --fetch` to fetch the profile and its inheritance
chain, validate geometry, and regenerate `crates/core/data/printers.json`.
Review and commit the manifest/catalog diff together. To update sources, change
the pinned revisions first. Only normalized geometry facts and provenance are
embedded; upstream G-code and process presets are never bundled.

Build CI on Windows, Linux, macOS and browser WASM runs
`cargo xtask printer-profiles --fetch --check` before compiling. It verifies that
freshly fetched, pinned sources reproduce the checked-in catalog and fails on
network/source/geometry errors or drift. Rust embeds that JSON with `include_str!`;
the frontend imports the same JSON. Local builds require no network. The task can
also regenerate/check from `target/printer-profiles` without `--fetch`.

Profile sources are attributed to [Bambu Studio](https://github.com/bambulab/BambuStudio)
and [OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer); exact paths, revisions and
SHA-256 hashes are recorded in every sourced bed. Runtime downloads are deferred;
the build task already owns the normalization and validation rules.

Checks report included quantities, excluded occurrences, below/above-bed parts,
envelope violations, and possible intersections of transformed mesh bounds.
Bounds overlaps are conservative warnings, including intentional multipart
geometry; they are not exact collision or support tests. Warnings permit a
deliberate export. Geometry/timeline corruption still prevents export.

**Check layout and propose corrections** offers a deterministic arrangement of
whole CAD-root groups, preserving internal placement, rotations, and repeats.
Review each proposed XYZ movement, apply it to the draft, then check again and
save. The proposal uses 2 mm between group bounds, drops group minima to the bed,
and is withheld entirely when the complete arrangement does not fit. It does not
rotate parts automatically or fix internal group intersections. Change occurrence
orientation or create additional named views when needed.

## Portable handoff and API

Desktop and MCP share the same Rust layout resolver and 3MF writer. Standard,
Bambu Studio, and OrcaSlicer targets write portable millimetre models with core
component/build transforms and optional Materials Extension color groups. They
do not write printer, process, support, AMS, or sliced toolpath settings. Core
base material names remain chemistry/color hints. Per-face paint and physical
filament slot assignment remain slicer work. The existing Prusa metadata path
continues using flattened instance meshes in this milestone.

`set_named_views` accepts optional `occurrence_offsets`, `print_layout`, and
`print_bed`, with an optional `expected_model_json` mutation precondition.
`named_view_solution` resolves a saved view without changing the model.
`solid_export_3mf` / `solid_export_stl` accept `named_view` with assembly scope.
`solid_export_preflight` accepts the same body selection and named view, returning
a `layout` report with issues and proposed additional root translations.
Legacy body-level presentation offsets remain readable; new editing uses
occurrence offsets. Native export remains required; browser development can save
and display views but does not tessellate manufacturing exports.

## Acceptance evidence

On 2026-10-03 the installed Windows **Bambu Studio 2.8.2.61** and
**OrcaSlicer 2.4.1** imported and re-exported the portable acceptance fixture.
The fixture contains a rotated multipart root with two repeated copies of one
source mesh, plus an independent third occurrence. Independent XML/matrix tests
verified three retained parts in two groups (2 + 1), and equivalent world vertex
positions to 0.001 mm. Internal CAD nesting becomes slicer multipart parts.

Repeat on Windows from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-3mf-slicers.ps1
```

Use `-BambuStudio` and `-OrcaSlicer` for alternate executable paths. Artifacts and
logs are written beneath `target/slicer-acceptance`. This checks model import,
grouping, quantities, and placement. It does not qualify GUI import options,
different-color multi-material assignment, slicing, or physical print quality.
