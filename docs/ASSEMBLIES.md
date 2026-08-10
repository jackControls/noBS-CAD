# Assemblies and joints

## Production boundary

Assembly intent is a peer model layer. It does not live in the solid feature
history and it does not store Bevy entities, OCCT handles, tessellation, camera
state, or display transforms.

- `nbcad-solid` owns part geometry and stable body/face topology.
- `nbcad-assembly` owns joint definitions and connector frames.
- OCCT remains the source of exact topology used to resolve connectors.
- A future assembly solver owns per-instance poses and kinematics.
- Bevy consumes resolved poses for display, picking, and animation.

This keeps joints available to native desktop, browser development, CAM, file
export, and headless tests without making any of those hosts authoritative.

## First production slice

The initial Assembly workspace creates rigid, revolute, and slider joint intent
between two planar faces on different bodies. Each connector stores:

- stable `BodyId` and `FaceId` values;
- the exact topology key captured with that face;
- a model-space origin and orthogonal primary/secondary axes.

Creation validates the live solid scene and rejects missing, non-planar, or
retargeted faces. Saved projects structurally validate joint ids, counters,
frames, offsets, and limits. An older project without an `assembly` member opens
with an empty assembly document because the field is additive to schema v2.

## Deliberately not implemented yet

This slice does not move bodies. A display-only transform would hide the hard
part and put assembly meaning in the wrong layer. The next stages are:

1. part-instance identity and grounded components;
2. connector re-resolution and explicit broken-reference diagnostics after
   model recompute;
3. a deterministic constraint graph and pose solver;
4. interactive joint previews, limits, drag solving, and motion studies;
5. collision/interference queries and CAM handoff.

Those stages can build on the persisted joint records without migrating a
prototype representation out of rendering code.
