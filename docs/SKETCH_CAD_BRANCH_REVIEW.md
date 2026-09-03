# Sketch CAD branch review — 2026-09-02

## Scope and disposition

Reviewed `fix/sketch-cad` at `8b949d03c84afaed88ac6a7f4c76b11f1c7327d8`,
including its uncommitted changes, against the local fork point `8d46b18`.
This is a local review, not a review of newly fetched upstream changes.

The work includes constraint validation and operation-local solver preferences,
selective automatic constraints, driving/reference dimensions, constraint
indicators and command selection, coplanar Revolve axes, shared modeling
pickers, and the browser/native interaction presentation.

**The three findings are now addressed in the follow-up fix pass below.**
The original review only retired the temporary picker recorder and its logging
plumbing; it did not silently fix these findings. The original reproductions
are retained here as historical evidence. This follow-up is not a blanket
visual certification of every modeling command or desktop platform.

## Original findings

### R1 — P1: Version files whose dimensions have reference semantics

Location: `crates/sketch/src/sketch.rs`, `SketchSnapshot::dim_modes` (line 75),
and the unchanged schema version in `crates/sketch/src/project.rs`.

Reference annotations are serialized as ordinary dimensional constraints with
an additional `dim_modes` map and no driving parameter. The file still claims
project schema 2. The earlier schema-2 reader ignores the unknown mode map,
accepts the file, and treats the measurement as a solver equation. Because it
has no parameter binding, the older dimension renderer also omits its label.
This introduces an invisible driving constraint into an otherwise accepted
project; this is not safe forward compatibility.

Reproduced with actual engine code, not a simulated legacy reader:

1. In the current branch, draw one unconstrained 40 mm line with automatic
   constraints bypassed, add a length dimension, and convert it to Reference.
2. Finish the sketch and export the authoritative project model.
3. Load that model using an isolated copy of the engine at `8d46b18`, commit
   its empty solid replay, and re-enter Sketch1.
4. Current branch: **4 DOF, 1 annotation, Reference**.
5. Earlier engine: **file accepted, 3 DOF, 0 annotations**. The assertion that
   an accepted reference-only annotation must preserve 4 DOF fails.

Recommended correction: introduce a new schema/minimum-reader boundary that
existing schema-2 builds already reject. Migrate older projects into the new
representation on read, and keep the outer project metadata and engine schema
in agreement. An unknown optional field alone cannot protect old readers.

Required regression coverage: current reference project round-trip; legacy
driving-only project migration; and an older reader rejecting a newly written
reference-dimension project instead of silently reinterpreting it.

### R2 — P1: Keep Extrude source and terminating-face selections independent

Location: `src/components/ExtrudeDialog.tsx`, lines 222–250; particularly the
new `extrude_to_face` selection consumer at lines 248–251.

The new target-face picker writes the global `selectedFace`. The existing
`sourceFace` computation and source-saving effect consume that same value
without checking which field owns the pick. For a face-based Extrude,
selecting a terminating face therefore replaces the starting face as well.
Both request fields then reference the target, producing a zero-span or
otherwise incorrect operation. Returning to the source field cannot recover
the original face because `savedSourceFace` was overwritten too.

Reproduced in the packaged macOS Bevy app, in dark appearance:

1. Create a rectangular extrusion and start another Extrude from its top face.
   The source field reports **Body1 · Face 3 selected**.
2. Set Extent to **To Face**. The source remains Face 3 and the target field
   asks for a face.
3. Pick another visible planar face while the target field is active.
4. Both fields now report **Body1 · Face 6 selected**, although only the
   terminating-face field was being edited.

This reproduction checks ownership before submission; it does not claim that
those particular two adjacent fixture faces define a valid termination.
The unguarded overwrite also applies to valid parallel-face selections.

Recommended correction: retain a distinct accepted source reference and basis,
and update them only on source-role picks. Target-face picks must only update
the terminating reference. The shared picker should carry role-owned values,
not make dialogs infer independent values from one global face slot.

Required regression coverage: source A → target B; target B → source A;
reactivating either field; and editing/reopening a face-based To Face feature.
Assert both identities in the submitted engine request, not just picker mode.

### R3 — P2: Restore the accepted Revolve axis when switching back to Sketch line

Location: `src/components/RevolveDialog.tsx`, `chooseAxis`, lines 213–220.

Switching to X/Y/custom clears `revolveAxisSelection`, which drives shared
viewport feedback. Switching back to Sketch line restores only the picker
role, not that reference. The dialog's local axis ID survives, so its status
still says a straight line is selected and OK remains enabled, while the
native viewport no longer highlights the axis that submission will use.

Reproduced in the packaged macOS Bevy app, in dark appearance:

1. Select a rectangular Revolve profile and its upper edge as the line axis.
   The upper edge is visibly purple; the other profile edges are gold.
2. Choose **Sketch X axis**, then **Sketch line**.
3. The upper edge remains gold, but the axis field says **Straight line
   selected · Sketch1** and OK is enabled.

Recommended correction: when returning to line mode, either restore the saved
valid axis into the shared selection state or clear both representations and
require a fresh pick. Do not keep an invisible accepted reference.

Required regression coverage: line → X/Y/custom → line, including editing a
persisted Revolve. Check dialog validity, submitted axis, shared identity, and
the actual native selected-line pixels.

## Fix follow-up — 2026-09-02

### R1 resolved: explicit reader boundary and backwards migration

New saves use engine project schema **3**. Schema-1 and schema-2 files still
load, with omitted dimension modes defaulting to Driving. Explicit Reference
modes from earlier schema-2 test builds are preserved when loading and
resaving. The ZIP container remains version 1; its manifest now also records
the engine schema, and the archive reader rejects conflicting metadata.

An isolated, unchanged engine at `8d46b18` rejects the newly written reference
fixture with `project schema 3 is not supported by this build (latest: 2)`.
The current reader preserves **4 DOF, 1 annotation, Reference**, including a
fixture carrying the earlier schema-2 header. A separate legacy driving-only
test preserves the dimension's parameter identity, solver effect, and editing.
Archive tests cover new metadata, round-trip, legacy missing metadata, and
inconsistent metadata rejection.

This boundary protects newly saved files. Already distributed schema-2 test
files must be opened and resaved by the new build before older apps can safely
reject them; the new code cannot change files that have not been resaved.

### R2 resolved: separate accepted source, basis, and stop face

Extrude derives its source from the accepted source reference, not from the
global face currently being picked. Only source-role picks update that
reference and its basis; only stop-face-role picks update the termination.
Reactivating the source, including switching to Create Body, restores the
accepted source before making the source role active.

The new modeling-picker regression uses actual OCCT bodies with distinct
parallel source and target faces. It checks both picking orders, reactivation,
operation/extent transitions, preview basis/span, the submitted and persisted
references, and reopening/editing the resulting face-based To Face feature.

In the packaged macOS Bevy app, selecting Face 6 as the stop face now leaves
the source at Face 3. Switching between the two fields preserves both values;
reactivating the source visibly restores its top-face selection. This repeats
the original adjacent-face ownership reproduction without submitting that
fixture as a valid termination. The valid parallel-face operation and history
edit are covered by the engine-backed regression above.

### R3 resolved: restore the validated line-axis identity

Returning to Sketch line restores the same validated sketch/line identity
used by submission into shared viewport feedback. Invalid saved references
are not highlighted or silently replaced. The regression checks X, Y, and
custom round-trips, dialog validity, shared feedback, actual submission, and
persisted feature editing after project reload.

In the packaged macOS Bevy app, the rectangle's upper axis edge visibly returns
to purple after each X/Y/custom → Sketch line transition. The other profile
edges remain gold. The X → line transition was also checked while editing the
created Revolve in its history. These are actual desktop observations, not
browser screenshot assertions. No line colors, widths, or hover keepalives
were changed in this fix pass.

### Follow-up verification

- **312** sketch, **45** solid-engine, and **65** desktop-shell tests pass
  (**422** Rust tests total).
- TypeScript checking and the constraint-glyph, Revolve-axis, modeling-picker,
  screen-picker, viewport-theme, and new project-archive tests pass.
- `npm run e2e:modeling-picker-state` passes. It validates state and actual
  engine requests, not native pixels, and is included in the release suite.
- Reference-dimension and M2 end-to-end regressions pass, including the
  versioned `.nbcad` Save/Open round-trip and legacy-file migration.
- The unchanged older-reader compatibility probe rejects schema 3 as intended.
- A debug macOS `noBS CAD Sketch Fixes.app` is built without a DMG or the
  temporary picker recorder.

## Recorder retirement

Removed the temporary recorder panel, pointer/event sampling, picker trace
callbacks, presentation trace counters, trace-file export command and command
registration, recorder test/script entry, and recorder-specific documentation.
No matching recorder/trace symbols remain in the source or built frontend
assets. Previously recorded JSON files were left untouched.

Preserved normal startup/CI diagnostics, presentation coalescing and retry,
hit testing, colors and widths, and all native gizmo-residency keepalives.
Those keepalives are rendering behavior, not logging.

## Original review verification

Passing checks after cleanup:

- TypeScript checking and desktop frontend asset verification.
- Constraint-glyph, Revolve-axis, shared modeling-picker, screen-space picker,
  and viewport-theme tests.
- All **310** sketch tests, including the ordered constraint-pair matrix.
- All **45** solid-engine tests, including cross-sketch Revolve-axis tests.
- All **65** desktop-shell tests, including **37** native-viewport tests.
- `git diff --check`.
- A fresh macOS `.app` build with no picker recorder flag or recorder code.

The schema-compatibility probe intentionally fails on the older reader and is
evidence for R1; it is separate from the passing existing suites above. Its
writer, unchanged older engine sources, reader, and generated fixture were
kept in an isolated temporary review directory, not a Git worktree or a user
project.

Actual desktop observations in `noBS CAD Sketch Review.app`: no recorder UI;
RGB origin-plane presentation; a finished rectangle; thin selected-profile
border and purple selected axis before the R3 toggle; successful native solid
creation; and the R2/R3 reproductions above. No browser run was used as proof
of desktop rendering.

This was not an exhaustive visual matrix: hover-only re-entry, light-mode
appearance, every modeling command, and Windows/Linux desktop behavior were
not reverified in this cleanup pass. Earlier user-confirmed hover behavior
and its residency mechanism were preserved, not re-certified from unit tests.

## Subsequent user report — floating yellow face-pick marker

The native app displayed a large yellow point next to a partial-Revolve body
with no point-picking command active. Before the correction, clicking empty
space above the part in Top view retained a selected curved face (the readout
reported approximately 2,446.233 mm²), reproducing the false hit in Bevy.

Two shared-picker issues were corrected:

1. Ordinary face selection stores `selectedFacePoint`, but feedback treated
   that raw hit as an explicit point selection. Surface-point markers now
   require an active surface-point role. The stored position and normal face
   selection are not erased, and Hole sketch-point feedback is unchanged.
2. Native face picking also searched full cylinder-end disks and analytic
   connector rings intended for Joint placement. The native request now
   defaults to physical geometry, with explicit `jointConnector` opt-in only
   at Joint's hover/click call sites. Virtual candidates are excluded before
   closest-hit resolution so they cannot hide a valid face behind them.

The shared picker-role tests and all **67 desktop-shell tests** pass, including
a real OCCT 80-degree Revolve, empty sectors, a real target behind the virtual
disk, physical cap/wall picks, and preserved joint-opening/rim targets. No
line widths, colors, render layers, or hover-residency mechanisms were changed.
TypeScript checking and the surface-point, face-sketch profile-picking, and
solid-edge mouse regressions also pass. These browser checks exercise state
and engine behavior, not native rendering acceptance.

Actual macOS Bevy verification used the packaged `noBS CAD Surface Picker Fix.app`
with the saved diagnostic copy of the user's model in dark appearance:

- Top view / Fit, clicking the same curved face selected it visibly and showed
  the same approximately 2,446.233 mm² readout, without a yellow point marker.
- Clicking the previously failing empty area above the part cleared both the
  face highlight and selection readout instead of selecting an invisible disk.
- In Joint mode only, that area still resolved as `Body1 · Face 5`, a circular
  opening connector, with the connector overlay visible. Cancel removed it.
- Move/Copy's explicit rotation-pivot picker accepted a new point on the real
  face: the pivot coordinates and visible manipulator moved to that point.
  Cancel left the ordinary face selected without a stray point or manipulator.

No test operation was committed to the model or saved over the user's file.
The corrected app was left open. This native check did not re-certify every
tool, light appearance, hover-only re-entry, or other operating systems.

## Remaining broader verification

R1–R3 are addressed. Run the broader modeling-command transition matrix and
desktop checks in both themes before merging the combined branch. The
dark-mode native checks above do not certify hover-only re-entry, light-mode
appearance, every command, or Windows/Linux rendering.

## Subsequent user report — coplanar face-sketch profile selection

The user could not select an inset rectangle on a partial Revolve's starting
face. Native reproduction selected the older, larger Sketch1 instead of the
visible rectangle in Sketch2. The saved model confirmed identical geometric
planes with opposite normals. Profile picking took the first ray hit from
two display-offset proxies, leaving coplanar profiles to floating-point and
catalog-order tie breaking.

The correction uses one exact-plane CPU proxy and a shared, stateless profile
hit resolver: nearest depth, smaller bounded region at coincident depth, then
stable feature/profile identity. Rendering, line widths, and accepted picker
references are unchanged. The 13 profile-ordering checks and the new
four-command, three-view mouse regression pass, as do the existing picker-state,
Revolve, and M2 regressions. The new regression is part of the release suite.

Actual macOS Bevy verification used a saved copy of the user's model, not a
browser image: Sketch2 was visibly selected, a real rectangular Add extrusion
was created and inspected after orbiting, and Undo restored the original
geometry. The corrected test app was left open with Sketch2 selected for
Extrude. See `MODELING_VIEWPORT_SELECTION_AUDIT.md` for the shared priority rule.
