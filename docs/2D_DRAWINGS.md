# 2D technical drawings

The drawing workspace turns the current parametric model into persistent,
printable vector sheets. It follows the same production boundary used by the
rest of noBS CAD: Rust owns document meaning, OCCT owns exact geometry, React
owns document UI, and Bevy remains the native interactive 3D viewport.

## Ownership boundary

| Layer | Responsibility |
| --- | --- |
| `nbcad-sketch` | Persists sheets, title blocks, view definitions, associative dimensions, notes, body filters, scale, and display options inside `model.json`. |
| `nbcad-occt` | Produces visible and hidden vector curves from the current exact B-reps with OCCT HLR and exposes stable topology endpoints for annotations. |
| Tauri host | Serializes drawing commands and exact projection requests with the live kernel. |
| React/SVG | Lays out sheets, edits properties, moves views, and exports or prints vector output. |
| Browser fallback | Projects tessellated topology for fast UI development when the native kernel is unavailable. It is not an exact manufacturing result. |
| Bevy | Owns the native 3D viewport only. Its child view is explicitly hidden while the drawing workspace is active. |

Generated projection curves are deliberately not saved. A drawing view stores
projection intent (`direction`, `up`, body IDs, scale, placement, and line
options), then regenerates its curves from the active feature history. This
keeps saved files small and prevents stale drawing geometry after a model edit.

## Current production slice

- A4, A3, and US Letter sheets in portrait or landscape.
- Persistent title-block fields.
- Front, rear, left, right, top, bottom, and isometric views.
- Per-view scale, placement, body filtering, hidden-line display, and tangent
  edge display.
- Exact native OCCT hidden-line removal for desktop output.
- Movable views and a sheet/view browser.
- Associative aligned, horizontal, and vertical dimensions attached to stable
  body/edge endpoints, with editable offset, precision, prefix, suffix, and
  values formatted in the model's millimetre, centimetre, or inch units.
- Paper-space notes with direct placement, drag repositioning, and inspector
  editing.
- Explicit broken-reference markers when an annotation can no longer resolve
  its model topology.
- Vector SVG export and the platform print dialog for PDF output.
- Browser-only projection fallback so the React sheet UI remains inspectable
  without embedding or emulating the native Bevy child view.

## Projection contract

`DrawingProjectionRequest` describes an orthographic camera in model space.
`direction` points from the model toward the viewer and `up` specifies page up.
The native kernel orthogonalizes these vectors, runs `HLRBRep_Algo` against the
selected live B-reps, and returns page-space polylines split into visible and
hidden sets. It also projects stable OCCT topology edge endpoints through the
same basis. The caller controls curve deflection; output remains in model
millimetres and is scaled during sheet layout.

The browser fallback shares this request and response format. It projects
topological edge polylines, derives mesh silhouettes, and performs depth tests
against tessellated triangles. It is suitable for visual UI work but should
not be used to approve a production drawing.

## Persistence and compatibility

Drawing data is an additive, defaulted field in the existing project schema.
Older `.nbcad` files open with an empty drawing document. Saving a project
round-trips drawing intent through the Rust model; generated lines never enter
the archive. Drawing IDs are project-global and validated along with active
sheet references, view bases, positions, body filters, annotations, and scale
values. Dimension anchors retain body ID, edge ID, backend topology key,
endpoint role, and a diagnostic fallback model point. Exact ID resolution is
preferred, with the backend key available across compatible recomputes.

## Next slices

The data and projection boundary is intended to support these without moving
geometry authority into the UI:

1. Section, detail, auxiliary, and projected-view relationships.
2. Standards-aware line weights, fonts, tolerances, and title-block templates.
3. Diameter, radius, angle, ordinate, datum, and geometric-tolerance
   annotations.
4. DXF/PDF writers owned by the native export layer.
5. Topology-healing controls for references that cannot be resolved by exact
   ID or backend key.

Any future annotation must persist semantic references and measurements, not
screen coordinates alone. React may edit and render those annotations, while
the Rust model validates them and OCCT resolves exact geometry.
