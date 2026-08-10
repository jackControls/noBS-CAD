# Assemblies and joints

## Production boundary

Assembly intent is a peer model layer. It does not live in the solid feature
history and it does not store Bevy entities, OCCT handles, tessellation, camera
state, or display transforms.

- `nbcad-solid` owns part geometry and stable body/face topology.
- `nbcad-assembly` owns joint definitions and connector frames.
- OCCT remains the source of exact topology used to resolve connectors.
- `nbcad-assembly` solves deterministic per-body poses and kinematics.
- Bevy consumes resolved poses for display, picking, and animation.

This keeps joints available to native desktop, browser development, CAM, file
export, and headless tests without making any of those hosts authoritative.

## Current production slice

The initial Assembly workspace creates rigid, revolute, and slider joint intent
between two planar faces on different bodies. Each connector stores:

- stable `BodyId` and `FaceId` values;
- the exact topology key captured with that face;
- a model-space origin and orthogonal primary/secondary axes.

Creation validates the live solid scene and rejects missing, non-planar, or
retargeted faces. Saved projects structurally validate joint ids, counters,
frames, offsets, and limits. An older project without an `assembly` member opens
with an empty assembly document because the field is additive to schema v2.

## Solved behavior

1. one solved pose per live `BodyId`, rooted at the selected grounded body;
2. connector re-resolution and explicit broken-reference diagnostics after
   model recompute;
3. a deterministic constraint graph propagates rigid poses from the grounded
   body through rigid, revolute, and slider joints;
4. closed loops are checked for pose consistency instead of silently choosing
   one path, and disconnected components are identified as free;
5. Bevy and the browser renderer apply the same solved GPU pose to model
   pixels, highlights, orbit framing, and ray picking;
6. motion values and optional limits persist in the project and can be driven
   live from the Assembly workspace.

The solver re-resolves every connector against its exact live `BodyId`,
`FaceId`, and topology key. Geometry is never retargeted by ordinal position.

## Deliberately not implemented yet

This is rigid-body forward kinematics, not a physics engine. Drag-to-solve,
inverse kinematics, contact, collision/interference analysis, flexible bodies,
motors, time-based motion studies, and CAM handoff remain later slices. The
pose representation is host-neutral so those systems can extend it without
moving assembly authority into rendering code.
