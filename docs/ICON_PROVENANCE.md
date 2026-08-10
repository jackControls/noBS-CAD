# noBS CAD Icon Provenance

Last reviewed: 2026-07-26

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
| Solid refinement and bodies | `hole`, `fillet`, `chamfer`, `shell`, `draft`, `combine`, `splitBody` | Cross-sections and overlapping primitive geometry describe the resulting body change. |
| Repetition and transforms | `rectPattern`, `circPattern`, `pathPattern`, `scale` | Repeated frames plus an explicit grid, orbit, path, or resize cue. |
| References, centers, and evaluation | `plane`, `midplane`, `planeAngle`, `axis`, `section`, `interference`, `centerMark`, `centerLine` | Datum/center lines, section hatching, circular-center construction, and overlap marks. |
| Sketch creation | `line`, `midpointLine`, `rect`, `circle`, `arc`, `polygon`, `ellipse`, `slot`, `conic`, `dimension` | Canonical mathematical geometry with defining points and construction lines. |
| Sketch editing | `offset`, `extend`, `break` | Before/after geometry, continuation lines, and a deliberate gap. |
| Constraints | `coincident`, `midpointC`, `collinear`, `hv`, `parallel`, `perpendicular`, `tangent`, `concentric`, `symmetry`, `fix`, `autoConstrain`, `curvature` | The constrained geometric relationship itself, with small construction cues where needed. |
<!-- custom-icon-inventory:end -->

`CUSTOM_ICON_IDS` is exported from the source file so automated checks can
compare the live registry with this inventory. Run `npm run audit:icons` to
perform that comparison and reject embedded or imported image assets in the
custom registry.

## Licensed general-purpose icons

The following registry IDs use `lucide-react` rather than product-owned paths:

- `sketch`, `spline`, `point`, `text`
- `mirror`, `trim`, `moveCopy`
- `equal`, `measure`, `select`, `fixLucide`

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

## Evidence retention

- `src/components/icons.tsx` is the canonical editable source for the current
  product-owned glyphs. The current 2026-07-26 snapshot has SHA-256
  `679c733b875ab8f10cd2ad8e3cabc205b8d2d8f207b608b74fef5d39d70145f8`.
  The audit command prints the live digest; this recorded digest identifies a
  snapshot but is not, by itself, proof of a creation date.
- `public/app-icon.svg` is the canonical editable NB mark. The audit command
  prints its live SHA-256 alongside the custom glyph digest. Its 2026-07-26
  SHA-256 is
  `3c0d4252cc315d928fbdef30804faac5171d32ad04a42c4eba29d8bbce88cd85`.
  Generated Tauri icons are derivatives and must not be edited as independent
  sources.
- Preserve non-code construction sketches and intermediate vector files in
  `docs/icon-drafts/`. Do not overwrite earlier drafts.
- Once version control is initialized, every icon change must commit the draft,
  final source, inventory update, and audit result together. Do not squash away
  original-design commits solely to make public history shorter.
- Preserve review discussion that explains the geometric construction and
  confirms that no third-party artwork was used.
- Release archives must include this document, the icon working-evidence
  directory, and `THIRD_PARTY_NOTICES.md`.

## Review log

| Date | Scope | Result |
|---|---|---|
| 2026-07-20 | Original custom registry replacement | Current diagram family authored directly in noBS CAD source. |
| 2026-07-25 | Registry/inventory and external-asset audit | Inventory synchronized; automated audit and working-evidence policy added. |
| 2026-07-26 | NB product mark | Original SVG monogram added; browser and Tauri platform assets generated from one canonical source. |
| 2026-08-09 | Drawing center geometry | Original center-mark and two-center-line glyphs added for the technical drawing workspace. |
