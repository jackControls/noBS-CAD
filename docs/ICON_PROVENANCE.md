# noBS CAD Icon Provenance

Last reviewed: 2026-09-10

This file records the source and design rationale for the NB product mark and
every icon rendered by `src/components/icons.tsx`. It is an engineering
provenance record, not a legal opinion.

## NB product mark

`public/app-icon.svg` is the canonical editable source. It was authored directly
for the 2026-07-26 noBS CAD rename as a geometric N/B monogram on the
application's dark rounded tile:

- N: sketch/entity blue (`#5da9ff`);
- B: iris/action purple (`#8b7ce8`);
- tile and border: existing noBS CAD panel/edge colors;
- construction: SVG paths and rectangles only, with no embedded font, bitmap,
  external reference, or third-party asset.

The compact header renders the letters `NB` with the same blue/iris design
language. Desktop PNG, ICNS, ICO, and Windows Store outputs under
`src-tauri/icons/` are generated derivatives. Mobile-only output from the icon
generator is removed because mobile is not a current product target:

```sh
npx tauri icon public/app-icon.svg -o src-tauri/icons
```

The browser favicon loads the canonical SVG directly. This provenance record
documents authorship; it does not make a trademark-availability claim.

## Product-owned CAD glyphs

On 2026-07-20 the previous custom glyph table was replaced wholesale. The
current paths were authored directly as noBS CAD source from operation
semantics and the shared rules below. They do not import or embed external SVG,
bitmap, font, screenshot, or vendor asset files.

Design rules:

- 24×24 coordinate grid, 1.6-unit rounded monochrome strokes.
- Open construction geometry and section diagrams instead of skeuomorphic
  toolbar artwork.
- Dashed lines mean a path, datum, centerline, or construction relationship.
- Small open arrowheads communicate direction; dots communicate selected or
  defining points.
- Color is supplied by application state, never encoded in an individual path.
- Familiar geometry is used only to explain the underlying operation. No icon
  may be traced from a third-party product or reference capture.

The complete custom inventory is:

<!-- custom-icon-inventory:start -->
| Family | Icon IDs | Construction rationale |
|---|---|---|
| Solid construction | `extrude`, `revolve`, `sweep`, `loft`, `rib` | Profile/result diagrams joined by a path, axis, or section rails. |
| Solid refinement and bodies | `hole`, `externalThread`, `fillet`, `chamfer`, `shell`, `draft`, `combine`, `splitBody`, `moveCopy` | Cross-sections and overlapping primitive geometry describe the resulting body change. |
| Repetition and transforms | `rectPattern`, `circPattern`, `pathPattern`, `scale` | Repeated frames plus an explicit grid, orbit, path, or resize cue. |
| References, centers, and evaluation | `plane`, `midplane`, `planeAngle`, `axis`, `section`, `interference`, `centerMark`, `centerLine` | Datum/center lines, section hatching, circular-center construction, and overlap marks. |
| Sketch creation | `line`, `midpointLine`, `rect`, `circle`, `arc`, `polygon`, `ellipse`, `slot`, `conic`, `dimension` | Canonical mathematical geometry with defining points and construction lines. |
| Sketch editing | `offset`, `extend`, `break` | Before/after geometry, continuation lines, and a deliberate gap. |
| Constraints | `coincident`, `midpointC`, `collinear`, `hv`, `equal`, `parallel`, `perpendicular`, `tangent`, `concentric`, `symmetry`, `fix`, `autoConstrain`, `curvature` | The constrained geometric relationship itself, with small construction cues where needed. |
| Machining | `camFace`, `camAdaptive`, `camPocket`, `camContour`, `camChamfer`, `camDrill`, `camThread`, `camToolLibrary` | Isometric stock and cutting geometry; shaded helical drill surfaces and cutting-point facets; a rack of distinct cutters for the tool library. |
| CAM workflow | `camSimulate`, `camNcSimulate`, `camPostNc`, `camPostEvents` | Stock/play badge, NC sheet/play badge, NC sheet/export arrow, and a connected event list. |
| CAM setup and operation pages | `camModel`, `camNewSetup`, `camSetup`, `camTool`, `camGeometry`, `camHeights`, `camPasses`, `camLinking` | Solid part; stock with WCS axes and an optional creation badge; end mill; selected face; reference planes; successive cut depths; curved entry/cut/exit. |
| Manufacture workspace | `camManufacture` | Milling head and cutter over stock on a machine table, replacing the generic wrench in both workspace entry points. |
<!-- custom-icon-inventory:end -->

`CUSTOM_ICON_IDS` is exported from the source file so automated checks can
compare the live registry with this inventory. Run `npm run audit:icons` to
perform that comparison and reject embedded or imported image assets in the
custom registry.

### Machining pictograms

`src/components/cam/CamToolIcon.tsx` owns the machining family approved on
2026-09-10. It uses a 64×64 coordinate grid, steel-grey stock and tools, and
muted blue to distinguish cutting paths and machined surfaces. These colours
are independent of the application's selection accent and follow the app's
explicit light/dark appearance. Disabled controls dim the complete pictogram.

The original paths were constructed from machining semantics, with a physical
twist-drill photograph informing the flute/point shape. No third-party icon
paths or raster assets are imported, embedded, traced or redistributed. The
canonical editable geometry is in `src/components/cam/CamToolIcon.tsx`.
The implementation shares one drill geometry between the drilling and tool
library icons and assigns paint/clip IDs per instance so simultaneous ribbon,
menu and browser icons cannot interfere with one another.

The simulation/output extension uses the same steel-grey/blue palette. Its
shared NC sheet and play badge distinguish predicted stock playback from
controller-code playback; the export arrow and connected event list distinguish
NC output from diagnostic events. These primitives and the geometric NC letters
were authored directly, with no third-party artwork. The same source file contains the editable paths.

The setup/page extension replaces ambiguous cursor, construction-plane and
generic dialog symbols. Shared stock/WCS geometry distinguishes setup creation
(plus badge) from editing incoming stock. A solid cube means the model workspace;
an end mill, selected face, height planes, stepped cuts and curved approach/exit
describe the five operation pages. The same operation-to-icon map supplies
browser rows and edit headers. Tool-library and simulation/output actions reuse
their approved pictograms in menus and dialogs. Standard UI controls stay
monochrome. The same source file contains the editable paths.

The compact Setups-browser creation shortcut deliberately uses a larger plain
Lucide plus (28 px target, 19 px glyph). Tool Library has a single bottom-row
entry there; the duplicate header shortcut is removed. Context-menu creation
and duplication use the general-purpose plus/copy icons.

The Manufacture workspace switcher and menu share an original mill-over-stock
pictogram. Its machine-column, spindle and stock primitives live in the canonical source.

## Licensed general-purpose icons

The following registry IDs use `lucide-react` rather than product-owned paths:

- `sketch`, `spline`, `point`, `text`
- `mirror`, `trim`
- `measure`, `select`, `fixLucide`, `code`, `box`

Lucide is distributed under the ISC license. Its copyright and permission
notice is preserved in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
The package copy is also available at `node_modules/lucide-react/LICENSE`
after dependency installation.

## Contribution requirements

For every new icon:

1. Prefer a licensed Lucide symbol for ordinary UI actions.
2. Add a custom glyph only when CAD meaning would otherwise be ambiguous.
3. Author the path directly from the feature's geometry and these design rules;
   do not work from another application's icon.
4. Add the new ID to the inventory above in the same change.
5. Inspect the icon at 15, 22, and 32 pixels in both normal and disabled states.
6. Record any external source and its license if an exception is ever approved.

## Source retention

- Commit canonical editable icon sources, the inventory, and required license
  notices. Generated platform icons derive from `public/app-icon.svg`.
- `npm run audit:icons` checks the live registry and reports source digests.
- Keep construction drafts, reference artwork, review conversations and local
  captures outside the repository. They are not release assets.
- Include this provenance document and `THIRD_PARTY_NOTICES.md` with source
  releases. Do not redistribute third-party reference artwork.
