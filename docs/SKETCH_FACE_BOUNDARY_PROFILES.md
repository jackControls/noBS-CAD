# Projected support-face boundary in a sketch

A sketch created on a planar body face receives **that face's boundary edges as
projected geometry**. The boundary can close a region the user drew against it,
so a semicircle whose two endpoints rest on the face edge becomes a selectable
profile for Extrude, Revolve, Sweep, Loft and Rib instead of staying an open
chain.

This is the behavior a user expects from "sketch on this face": the face they
picked has edges, and those edges are part of the sketch.

## What is projected

| Property | Value |
|----------|-------|
| Source | The support face's own edges (`FaceDto::edge_keys`), not every coplanar edge of the body |
| Fallback | Scenes that publish no boundary keys (some imported or assembly bodies) project every coplanar edge, the same set the snap midpoints use |
| Shape | The body edge's tessellated polyline in sketch coordinates, plus the exact circle when the edge is circular |
| Lifetime | Rebuilt from stable `EdgeId`s on sketch open and on every kernel commit. Never written to the project file |
| Identity | Reserved `id` range above every authored entity id (`PROJECTED_EDGE_ID_BASE`) |

`ProjectedEdgeDto` (in `crates/sketch/src/dto.rs`) is runtime-only. It is part
of the session `SketchDto`, which the viewport and the profile catalog read,
but `ProjectSketchV2` (the persisted project record) does not carry it — the
same rule the support-edge snap midpoints already follow.

## Profile rules

Segments derived from projected edges join the same segment graph the authored
curves build (`profile_catalog_item` in `crates/sketch/src/manager.rs`), which
is what lets the projection seal a loop. Two rules keep existing documents
unchanged:

1. **A face bounded only by projections is not a profile.** The support
   boundary is a real face of the planar subdivision, but the user never drew
   it. `extract_bounded_faces` reports `authored_edges` per face and the
   catalog drops faces with zero.
2. **Nesting only sees emitted profiles.** Because the bare face outline is
   never emitted, a rectangle drawn on a face stays at nesting depth 0. Adding
   the outline as ordinary sketch geometry would have made it the depth-zero
   outer loop and turned every drawn shape inside it into a hole — a shape that
   can no longer be extruded.

Provenance survives noding through the reserved id range: a piece shared by
authored geometry and a projected edge keeps the smaller authored id
(`node_segments_impl` dedupe), so it still counts as authored.

The kernel still receives analytic curves. A projected straight edge becomes a
line, a projected circular edge becomes one arc (or a full circle), and
anything longer stays an explicit polyline (`projected_profile_curve`).

## Snapping

Drawing against the boundary snaps onto it. `SketchSession::nearest_projected_edge_point`
returns the perpendicular foot on the nearest projected edge, and the
acquisition is reported as `SnapTarget::ProjectedEdge { edge, position }`.

This acquisition is **geometric only**: it commits no durable relation, because
the projection itself is runtime geometry that is rebuilt from the body and
never persisted. A point landed this way is still a normal free sketch point
that can be dragged anywhere.

## Refresh and invalidation

- `begin_sketch_with_options` and `edit_sketch` install the projection through
  `install_support_references`, next to the support-edge snap midpoints. A
  sketch that no longer sits on a face clears it.
- `commit_solid` calls `refresh_projected_face_boundaries`, so a project loaded
  from disk regains its projections as soon as the kernel republishes the body,
  and a rebuilt body refreshes them in place.
- A sketch whose history stage is masked by a later topology writer keeps its
  previous projection, matching how datum-hosted sketches keep their frozen
  basis.
- A support face that disappears is already reported as a broken reference on
  the sketch feature; the projection is simply empty.

## Viewport

Projected geometry is drawn only for the **active** sketch, in its own color
(`--cad-projected`, purple in both themes, matching the "projected geometry"
convention in mainstream CAD). It is never a pick, hover, grip or constraint
target, so no pick state depends on it.

The Sketch Palette **Projected Geometries** row toggles it. Browser
(`src/components/viewport/Viewport.tsx`) and native (`draw_projected_edges` in
`src-tauri/src/native_viewport/platform.rs`) renderers both honor the toggle;
the native side receives it as `hide_projected_geometry` on the presentation
payload, inverted so an older payload keeps the reference geometry visible.

## Tests

- `cargo test -p nbcad-solid profile::tests` — derived segments seal loops,
  projected-only faces report zero authored edges, and overlapping authored
  geometry keeps its provenance.
- `cargo test -p nbcad-sketch --test projected_face_boundary` — a face sketch
  projects its four boundary edges; a semicircle drawn against the boundary
  becomes a depth-0 profile; a rectangle drawn inside a face stays the only
  profile; projections survive save/reload through the recompute; and geometry
  snaps exactly onto the projected boundary.
- `npm run test:viewport-theme` — the projected color token matches both
  themes, stays legible, and is distinct from authored sketch geometry.
- `node scripts/run-e2e.mjs e2e-face-boundary-profile.mjs` — browser-engine
  check of the picker behavior (requires `npm run build:wasm`).

## Deferred

- A durable point-on-edge relation with a sliding degree of freedom. Today the
  snap is positional, so an edit that drags the endpoint away reopens the
  region.
- Projected edges as reference geometry for Revolve axes, Sweep paths or Rib
  centerlines (only profile closure consumes them today).
- Re-projecting when a support face moves. A face-hosted sketch keeps its
  frozen basis, so a moved face already detaches the authored geometry.
