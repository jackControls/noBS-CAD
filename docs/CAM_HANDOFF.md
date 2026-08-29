# CAM branch handoff — 2026-08-28

State of `feature/cam` after twenty working rounds, rebased onto current
`main` (assembly MCP tools included; force-pushed). Everything below is
verified against the working tree and test runs of this date; trust the tree
and the tests, not this document, when they disagree.

## Round 20 (2026-08-28) — bounded CAM stabilization gate

The gate deliberately added no machining operation. It converted the recent
operator-led fixes into one cross-layer baseline before simulator-foundation
work begins.

1. **One golden job now crosses every current authority.**
   `stabilization_tests::golden_job_stays_aligned_across_save_plan_post_and_simulation`
   builds a face + machine-compensated contour + through-drill setup, validates
   it, serializes/reopens/softens it, proves the regenerated neutral program is
   identical, posts native 828D output, and runs volumetric stock simulation.
   It pins section order, Retract → Clearance exits, `G42 NORM`/`G40`, named
   tool calls, no shop macro, no rapid collision, and the requested simulation
   cell size.
2. **The native compensation contract has a primary-source basis.** Siemens'
   SINUMERIK 828D Tools Function Manual (07/2024, A5E48764330B AH, section
   3.5.3.2) defines `G41/G42 NORM` as direct approach/retraction to/from the
   compensated straight line. That matches the simulator state machine and
   removes reliance on an inherited Group-17 mode.
3. **Simulation limits are visible instead of silently discarded.**
   `CamWorkspace` now renders simulation warnings in addition to program
   warnings, deduplicates the shared prefix, and shows the actual maximum cell
   edge as **3D detail** with grid dimensions in its tooltip. The simulator's
   voxel warning includes exact X/Y/Z cell sizes and dimensions. Its chamfer-
   mill warning now accurately says that the conical envelope is not yet
   implemented rather than implying the stored angle is missing.
4. **The roadmap now matches the branch.** `docs/ROADMAP.md` has a real M4 CAM
   section instead of listing the workspace as deferred. `docs/CAM.md` now
   orders simulator confidence, the shared 2D geometry kernel, remaining 2.5D
   work, 3D adaptive clearing, and posted-NC verification by dependency.

Verification: CAM 107 passed, including the new cross-layer gate. Full
workspace/build/package verification is recorded at the end of this handoff.

## Round 19 (2026-08-28) — in-control lead transitions stop gouging

The door-block simulation screenshot exposed a real bug that the earlier
large-tool regression had accidentally avoided: its part probes stayed away
from the compensation activation/cancellation corner, and its own comment
admitted that a Ø63 tool could shave that corner. A new probe at (91,71),
1 mm inside the nominal boss, failed immediately. The previous “large cutter
does not cut the part” conclusion was therefore too broad.

1. **Root cause: the simulator started compensation too early.** It offset
   the uncompensated activation anchor together with the whole programmed
   path, as though full radius compensation already existed there. At G40 it
   then swept diagonally from the compensated endpoint to a lead-out target
   on the nominal wall tangent. The nominal profile was correct, but that
   invented transition crossed the corner with a large cutter.
2. **The planner now generates safe physical centerline leads.** Lead lengths
   and lead arc radius are explicitly physical cutter-center dimensions. For
   an in-control pass, the pre-G41/G42 point and post-G40 point are shifted by
   the nominal tool radius so normal controller activation/cancellation runs
   tangent to the compensated path. A requested lead arc is programmed one
   tool radius larger; after the controller offsets toward its center, the
   physical arc has exactly the requested radius instead of collapsing when
   the tool is larger than the arc. Profile coordinates remain nominal.
3. **The simulator models normal controller response.** The first buffered
   linear is treated as the activation block: sweep from its uncompensated
   anchor to the first compensated point, then offset/sweep the remaining
   contour, then cancel from the final compensated point. Cancellation time
   now also uses the physical move rather than the nominal endpoint pair.
4. **Inside compensation no longer activates at a sharp polygon corner.**
   The planner splits an eligible straight wall only where it can fit the
   physical lead-in, physical lead-out, and one cutter radius at each adjacent
   corner. This keeps the whole transition inside the wall band; when no such
   segment exists it fails closed with shorter-lead, smaller-tool, and software-
   compensation choices.
5. **Native Siemens output pins the same behavior.** G41/G42 activation now
   includes `NORM`, avoiding an inherited KONT/KONTC/KONTT state that would
   make machine motion disagree with the simulator.

Regression coverage now probes the large-tool lead corner with both straight
and 2 mm physical-radius arc leads, checks the programmed arc expansion, and
keeps the existing winding/inside/outside/open-chain compensation matrix.
It also rejects inside-control leads that cannot fit safely on any wall.

Verification: CAM 106 passed, every Rust workspace suite passed, TypeScript
and both production bundles built cleanly, the WASM smoke test passed, and the
fresh 137 MiB macOS app passed deep strict signature verification with all
required license notices present.

## Round 18 (2026-08-28) — feed/retract parity and roughing-kernel decision

The operation-height report was traced against the workspace reference
screenshots before changing behavior. They use one consistent convention:
green entry begins at Feed height, red exit ends at Retract height, and
Clearance remains a separate travel plane. Fresh face, contour, and drill
operations intentionally resolve Feed and Retract to the same default
height; their markers should therefore be level unless the operator edits
one of those rows.

1. **Every section now visits Retract before Clearance.**
   `ProgramBuilder::retract_to_clearance` previously made one rapid directly
   from the cut to Clearance, skipping the configured Retract plane. It now
   emits cut → Retract → Clearance whenever the tool is below Retract. The
   regression covers face, 2D contour, and drill independently and stops at
   each section boundary so a later operation cannot mask a missing move.
2. **The red viewport marker uses the real retract endpoint.** The overlay
   searches backward from the end of the operation for the final actual
   rapid/feed/arc endpoint on `retract_z`, after the last cutting move. This
   selects the first upward rapid for milling/drilling and the feed-out
   endpoint for tapping/reaming, while ignoring the later Clearance move.
3. **Reference-aligned defaults were preserved.** The unfinished attempt to
   move every transport reference to Stock top was not kept: the per-kind
   table already matches the screenshots, including Model top for face and
   drilling and Stock top for contour. A code comment now pins the intended
   Feed = Retract default for those three operation kinds.
4. **Rounded contour roughing is deferred to shared geometry.** The local
   corner-fillet prototype was removed after it failed its own rectangular
   path regression and exposed missing concave-corner/self-intersection
   safeguards. Roughing laps continue to use exact offset polylines. The
   requested rolling, larger-radius motion belongs in the shared 2D path
   kernel together with engagement-aware smoothing, future high-speed paths,
   and later 3D families; it should not become planner-only special-case
   geometry.

Verification: cam 105 passed, full Rust workspace green,
`npx tsc --noEmit`, `npm run build:wasm`, `npm run smoke:wasm`, and
`npm run build` green. A fresh ad-hoc-signed macOS `.app` was bundled with
portable OCCT libraries and passed `codesign --verify --deep --strict`.

## Round 17 (2026-08-28) — per-hole spans, tip-through, uniform markers

Four operator requests from testing the door-block project, all landed end
to end:

1. **Direction cones are one size per model.** The overlay's entry/exit
   cones used to be capped by the shorter host move (`moveCap`), so a
   drill's short plunge shrank its cones next to a facing pass's long rows.
   The cap is gone: `coneLength = clamp(modelExtent * 0.025, 1, 12)` is the
   only sizing rule, so every operation on the same model shows identical
   green/red cones.
2. **Per-kind height defaults + hole references.** Fresh dialogs seed from
   a `HEIGHT_DEFAULTS` table (per-kind plane + offset) instead of one
   generic set: facing starts a skin (0.2 mm) above the stock top and
   targets the model top; contours run stock top → stock bottom − 1 mm;
   pockets stock/model-bracketed with a 0.2 mm floor break-through; drills
   hang clearance/retract/feed off the model top with the bottom at the
   stock bottom; threads default top/bottom to the picked holes' own span.
   `HeightFrom` gained `hole_top`/`hole_bottom` (drill/thread only —
   highest picked top / lowest picked bottom), with an actionable submit
   error when no holes are picked. Editing still re-opens stored absolute
   values.
3. **Picked holes carry their own span.** `CamHoleDto { point, top_z,
   bottom_z, axis, face_key }` rides the drill/thread operation next to
   manual `points`; the pick pipeline (`camHoleFromCylinderFace` +
   `faceVerticesOfRange`) reads the face's triangle vertices so a stepped
   boss or blind bore machines across exactly its own height — the planner
   pecks/feeds per hole (`plan_drill`/`plan_thread` targets are
   (center, top, bottom) tuples; flute checks use the deepest travel).
   Editing re-seeds the viewport pick session from `face_key`, rebuilt
   against the CURRENT model; a hole whose face vanished degrades to a
   manual center line instead of dropping out. The simulator's drill cone
   now reads the tool's stored point angle (the 118° fallback warning only
   fires when the angle is unset).
4. **Drill tip-through.** Drilling-family cycles (drill / chip breaking /
   deep hole) carry `drill_tip_through` (default on) + `breakthrough_depth`
   (default 1 mm): the cut bottom extends past the bottom plane by the
   point length — computed from the tool's stored point angle — plus the
   allowance, so the full diameter clears the hole bottom. Tapping/reaming/
   boring reject tip-through at validation.
5. **Lead lengths decoupled from the tool diameter.** The hard floors
   (in-control lead > radius, arc radius ≥ radius, inside-closed bisector
   floor) are deleted in the engine and the dialog; the 1.5× radius seeding
   stays as a comfortable default. With machine-side compensation the
   control owns its activation travel — a short lead is not a plan-time
   error.

**The "rest stock looks dished" report was verified NOT a bug**: a
diagnostic run on the door-block project (stock 34×19×14, face target 2 mm
above the model top) confirmed removed volume 3681 mm³ matches theory and a
0.5 mm raster of the remaining-stock triangles shows a flat interior at the
face target — the dished look is translucency stacking (face skin + contour
slot + chamfer wedge), not missing material. Making the remaining stock
opaque is a rendering option, not a correctness fix.

Verification: cam 104 passed (new: per-hole peck levels, per-hole thread
spans, tip-through tip lengths at 118°/90°, empty-target/tilted-axis/
negative-breakthrough/wrong-cycle rejections, short-lead acceptance),
workspace suites green, mcp-server 37, `npx tsc --noEmit` clean,
`build:wasm` + `smoke-wasm` + `build` green.

## Round 16 (2026-08-27) — feed plane, contour passes, lead arcs, directions

Four operator requests, all landed end to end:

1. **Feed height is live everywhere.** Every operation carries
   `feed_height_z` (validated: cut top ≤ feed ≤ retract). The planner rapids
   to the feed plane, then feeds down (`ProgramBuilder::feed_plane`); peck
   re-entries rapid only to the last depth + 0.5 mm, capped at the feed
   plane. The dialog's Heights tab resolves five real heights in the fixed
   order bottom → top → feed → retract → clearance, each a reference plane
   plus offset, chain-referencing lower rows. Old documents default to 0
   (their top ≤ 0 keeps validation green); new operations always send it.
2. **Contour: radial multi-pass + finishing + spring pass + direction.**
   `roughing_passes`/`roughing_step_over` step from the outside toward the
   wall leaving `finish_allowance`; `finishing_pass` (with optional
   `finish_feed`) takes the wall to size; `spring_pass` repeats the final
   lap once (closed loops only — if no finishing pass, it repeats the last
   profile lap). In-control mode only the final profile lap carries
   G41/G42; roughing laps are pre-offset by the planner. `direction`
   (climb/conventional) re-winds the stored path around its start point;
   open chains reverse with the physical side preserved. The dialog's
   multiple-depths toggle is gone for contour — Maximum stepdown is always
   on. Switching compensation mode never touches the picked edge chain
   (`chain_ref` persists source/keys/reversed; edit sessions re-select the
   same entities in the viewport).
3. **Arc leads.** `lead_arc_radius` rounds each straight lead into a
   tangential 90° arc swinging in from the non-material side — this is the
   fix for the entry-corner scuff a straight lead's compensation-activation
   slide leaves (a real machine does the same; the arc eliminates it).
   Banned for inside closed profiles (no swing room); the dialog disables
   the field there. In control, the arc radius must be ≥ the tool radius
   (activation rides the arc). The simulator tessellates compensated arcs
   into ~0.5 mm chords at comp-off (`CompMove::Arc`).
4. **Cutting direction on every milling op.** Face: `both_ways` (zigzag,
   default) / `climb` / `conventional` — one-way rows reposition at the
   feed plane above the stock, entering from free air. Pocket/chamfer:
   climb/conventional re-winds the finishing lap / path. Drill is exempt
   (no lateral cut).

Also: the exit cone marker now parks at the retract target pointing up when
the section closes with an upward rapid (the only safe rapid level) instead
of pointing down into a hole bottom; entry cone is unchanged. Tool library
gained `default_step_down`/`default_step_over` (validated: positive,
step-over ≤ diameter) which seed new operations' passes tabs.

**The "overcut" report was verified NOT a bug**: the regression test
`in_control_large_tool_clears_a_diameter_wide_band_not_the_part` probes the
voxels — the compensated band is exactly one tool diameter wide (edge
hugging the wall, outer edge at 2r), so a Ø63 face mill on a small part
correctly clears most of the stock while the part interior stays intact.

Verification: cam 94 passed, workspace all suites green, mcp-server 37,
`npx tsc --noEmit` clean, `build:wasm` + `smoke-wasm` + `build` green.

## Round 16b (2026-08-27, late) — projects never refuse to open

A project saved before round 16 (`doorBlock.nbcad`) failed to open at all:
`decode_project` ran `CamDocumentDto::validate` hard, and the new
`feed_height_z` field deserialized as 0.0 — below the stored cut top — so
the whole file load aborted with a validation dialog. Fixed as a load-time
softening pipeline; opening a project can no longer be blocked by CAM
content:

1. **`CamDocumentDto::soften_for_load`** (called from `decode_project`)
   runs `migrate_legacy` first — legacy feed heights clamp into
   `[top, retract]` (NaN → top), so pre-feed-plane documents open with a
   sane feed plane and no warning at all. It then repairs a stale
   `active_setup_id` (falls back to the first setup) and pushes the id
   counters past any stored ids.
2. **Invalid operations are parked, not rejected.** Whatever still fails
   validation is force-disabled and recorded in the new
   `CamDocumentDto::load_warnings` (`CamLoadWarningDto` with optional
   setup/operation ids). `CamSetupDto::validate` was split into
   `validate_structure` + per-operation checks that skip disabled
   operations (planner and post already skip them, so the semantics match).
   Re-enabling a parked operation re-validates and reports the concrete
   reason; fixing and saving clears the badge via `refresh_load_warnings`
   in `set_cam_document`.
3. **Browser badges.** Amber warning triangles on parked operations and
   damaged setups (tooltip carries the message), plus a document-level
   banner for tool/reference warnings.

`validate_project` no longer validates CAM at all (the loader softens).
Drawings and assembly still hard-fail there — they gained no new fields
this round so no existing file trips them, but softening them is the
follow-up if their schema evolves.

Verification: cam 97 passed (new: legacy-without-feed-height opens clean,
invalid ops parked + warnings cleared after repair, stale-id repair),
sketch end-to-end `legacy_cam_document_without_feed_height_opens_clean`
(exports a project, strips every `feed_height_z` key, reloads through the
real decode path, asserts the operation survived enabled with the feed
clamped to the cut top), workspace suites green, mcp-server 37,
`npx tsc --noEmit` clean, `build:wasm` + `smoke-wasm` + `build` green.

## Round 15b (2026-08-26) — compensation field fixes

Operator testing of round 15 surfaced three real defects, all fixed with
regression tests:

1. **Inside-compensated closed loops gouged on entry.** Tangent leads extend
   the first/last segments straight — correct for outside compensation and
   open chains, but on an inside ring (pocket/slot wall finish) the lead
   tangent runs along the wall past the corner, so the entry plunge and the
   compensation-activation move cut through the material OUTSIDE the ring.
   A new simulation matrix test (winding × inside/outside × open-chain
   left/right × both modes, voxel-probed) caught it; the planner now sends
   inside-closed leads along the start corner's interior angle bisector into
   the already-cleared pocket interior (`plan_contour`), and both modes
   enforce lead > tool radius there so the bisector plunge clears the walls
   (`model.rs` validation + dialog submit check). The matrix suite also
   pins that in-control and in-software remove the identical band.
2. **The dialog silently snapped an open chain's tool side to "On path".**
   On path rides the tool CENTER on the contour — cutting a radius into
   both sides — which is how an operator expecting the tool to hug the edge
   destroyed a part; it also disabled the compensation-mode select, which
   read as a stuck dropdown. The snap now lands on Left of travel (a real
   edge-hugging side), an amber hint under Tool side spells out the choice
   on open chains (pick the material side; Reverse flips travel), and the
   mode select is always enabled (On path simply applies no offset either
   way).
3. **Facing rows hugged the near stock edge.** Rows were anchored at
   `bounds.min.y`; a face narrower than one cutter band put its single pass
   ON the edge instead of through the middle. Rows are now centered on the
   face with the minimal count that spans it (`plan_face`): one covering
   band = one pass through the middle; multi-row layouts stay symmetric
   (e.g. 30 mm face / 10 mm tool / 8 mm stepover → rows at 3/11/19/27).

Verification: cam 84 passed (5 new matrix tests + rebuilt face layout
tests), workspace 26 suites green, `npx tsc --noEmit` clean,
`build:wasm` + `smoke:wasm` + `build` green.

## Round 15 (2026-08-26) — machine-side cutter compensation, tangent leads, cone markers

Three operator-reported issues, all about the contour model being wrong:

1. **Contour compensation was planned tool-center-only.** The planner offset
   the contour by the tool radius and posted plain coordinates — the CNC had
   no say. Real shops run contours with machine-side cutter radius
   compensation so size can be tuned and cutters swapped at the machine.
   Fixed end to end:
   - `CompensationMode` on contour operations: `in_control` (default) or
     `in_software` (`model.rs`). In control, the programmed path IS the part
     contour; two new neutral IR commands, `CutterCompensationOn { left }` /
     `CutterCompensationOff`, bracket the compensated region
     (`planner.rs`). Side resolution: closed CCW loops compensate inside→
     G41 (left of travel), outside→G42; open chains map left/right directly.
   - ISO posts (Fanuc-style, LinuxCNC) emit `G41`/`G42 D<tool number>`
     prepended to the activation linear move and `G40` on the cancellation
     move; the Siemens profile emits the same words without a `D` (the 828D
     takes the cutting-edge number from the tool call). GRBL has no radius
     compensation vocabulary: its post REFUSES in-control programs with an
     actionable error — fail closed, never emit unoffset motion.
   - The simulator runs a small compensation state machine: linear moves are
     buffered while compensation is active, offset as one polyline by the
     nominal tool radius at `CutterCompensationOff` (mitered corners), then
     swept; the first move after cancellation sweeps from the compensated
     endpoint back to the programmed point. Rapids, arcs, Z changes, or an
     uncancelled section inside the compensated region fail closed. Result:
     in-control programs simulate cutting exactly TO the contour, verified
     by a voxel-probe test (material inside the band removed, wall
     preserved).
2. **Lead-in/out is real now (straight tangent v1).** Contour operations
   carry `lead_in`/`lead_out` lengths (default 5 mm; the dialog seeds 1.5x
   the tool radius and re-seeds on tool picks until touched). Every depth
   pass approaches at the lead start, activates compensation on the lead-in
   move, cuts the contour, cancels, and exits along the lead-out. Rule the
   engine AND the dialog both enforce: in control with compensation active,
   each lead must EXCEED the tool radius — controls alarm when compensation
   activates over a shorter move. Closed loops lead out along the closing
   edge's tangent. Arc/sweep lead shapes and lead corner-clearance checks
   need robust 2D offset/clip machinery; they are now roadmap item 8 in
   `CAM.md` ("2D geometry kernel module") together with miter/arc joins and
   self-intersection cleanup.
3. **Endpoint markers are identical pure cones.** The shaft-and-head arrows
   are gone from toolpath display (WCS axes keep theirs). Green cone at the
   exact start of the first feed move, red cone at the exact end of the last
   feed move, both oriented along the exact motion tangent, both the SAME
   size, scaled to the model extent (`clamp(extent*0.025, 1, 12)` mm, base
   radius 0.35x length, 12 sides), capped by the shorter host move. Built as
   triangle meshes with `xray: true` (`overlay.ts::pushCone`,
   `pushSelectedTool`).

Dialog (`CamOperationDialog.tsx` + `opShared.tsx`): the Passes tab gains a
**Compensation mode** select (In control — G41/G42, default / In software —
pre-offset path), disabled while tool side is On path (no offset to apply);
the Linking tab turns the dead lead checkboxes into live lead-in/lead-out
length fields for contour (`OP_PAGES.contour2d.leads`), everything wired
through the shared tab scaffold so other kinds can opt in with one flag.
Legacy documents deserialize with in-control + 5 mm leads via serde
defaults.

Verification: `cargo test -p nbcad-cam` 78 passed (8 new: comp planning for
both modes, lead geometry open/closed, Fanuc/Siemens posting with and
without D, GRBL refusal, voxel-probe simulation); `cargo test --workspace`
and mcp-server 37 green; `npx tsc --noEmit` clean; `npm run build:wasm` +
`npm run smoke:wasm` green; `npm run build` green.

Accepted simplifications (documented, not bugs): closed loops simulate the
compensated region as an open polyline offset (no corner miter at the
closure point; sub-voxel error); leads are straight tangent moves only;
in-control compensation is contour-only (other kinds plan tool-center as
before).

## Round 14 (2026-08-25) — display scale, X-ray toggle, open-chain contours

- **Entry/exit arrows are direction cues, not scale drawings**: length is
  capped (`min(max(diameter*0.4, 2), 8)` mm — a 63 mm face mill no longer
  paints 57 mm arrows), and pure-Z plunge segments are skipped when a
  lateral cut exists, so the arrows read as feed direction instead of
  pointing down the spindle (`overlay.ts::pushSelectedTool`).
- **Model ghost is an explicit X-Ray toggle**: the automatic wireframe ghost
  from round 12 is off by default; the CAM header gains an `X-Ray` button
  (`camXrayModel` store flag) that gates `ghostedBodyIds` in
  `nativeViewportBridge.ts`. The ideal reveal-only-where-cut display is not
  implemented (per-body alpha cannot express it); the toggle is the accepted
  intermediate.
- **Flat end mills have no corner radius** (`CORNER_RADIUS_KINDS` drops
  `flat_end_mill`; bull nose and face/shell mills keep it — high-feed
  effective-diameter math unchanged).
- **2D contour picks edges, not loops**: `ContourCompensation` gains
  `Left`/`Right`; `CamOperationDto::Contour2d` gains `closed` (serde-default
  true — old documents keep closing). Validation: closed paths need ≥3
  points + area and inside/outside; open chains need ≥2 points and
  left/right/on (cross-combinations fail closed, chamfer wall_side rejects
  left/right). Planner: open chains never emit the closing cut, and
  `offset_polyline_open` miters one-sided offsets (endpoints shift along
  their single segment normal). Tests: `open_contour_chain_never_closes`,
  `open_contour_chain_offsets_left_and_right_of_travel`,
  `open_chain_with_inside_compensation_fails_closed` (cam crate now 70).
  UI: `camChainPick` store session + `listSketchCurveCandidates` /
  `resolvePickedChain` in `cam/geometry.ts` (click order anchors travel
  direction; chaining grows from the first pick's far end then prepends,
  reversing segments; circles are complete loops alone; broken picks fail
  with an actionable message). Viewport hit-tests nearest segment within
  10 px; overlay draws candidates/hover/selected as line layers. The dialog
  shows the chain readout (N edges · open/closed) with a Reverse button;
  compensation options follow the resolved openness; manual entry detects
  closure by a repeated first point. Pocket/chamfer keep closed-loop picking.
- **Gray-out pass**: placeholder fields now dim the whole label block, not
  just the input (`camFields.tsx::DraftNumber`, `DeadSelect`) — the old
  input-only opacity-45 read as live on the dark theme, which is why the
  dialogs looked un-grayed; Siemens post SUPA Z / Tool edge D gray out when
  positioning is controller-managed.

## Round 13 (2026-08-25) — cumulative simulation, viewport loop picking

- **Simulation is cumulative through the selection**: `CamSimulationRequestDto.through_operation_id`
  truncates the planned program at the end of the last section whose
  operation sorts at or before the target in the setup's operation list
  (`simulation.rs::truncate_program_through`; first work-offset copy bounds
  the scan — duplicated offsets repeat identical motion against
  already-removed material). Disabled targets contribute nothing themselves;
  unknown ids fail closed. The result echoes the target
  (`through_operation_id`) so the overlay and the ghost-body gate can drop
  stale results when the selection moves mid-simulation. `CamWorkspace`
  passes the selected operation id and re-simulates on selection change;
  with no selection the request still covers the whole setup (collisions,
  3D Sim button), but nothing renders until an operation is selected.
  Tests: `simulation_through_first_operation_excludes_later_removal`,
  `simulation_through_unknown_operation_fails_closed` (cam crate now 67).
- **2D contour/pocket/chamfer geometry is picked in the viewport**: the
  sketch-loop dropdown is gone. Path-geometry dialogs (source = sketch) open
  a `camLoopPick` store session listing every closed sketch loop with
  model-space outlines; the viewport hit-tests screen-space (inside the
  projected polygon counts as a hit, else nearest segment within 14 px),
  hover highlights amber, the committed loop draws green, and a click
  selects it as the operation's path (`Viewport.tsx::pickCamLoop`, overlay
  renders candidates/hover/selected as through-geometry line layers). The
  dialog shows the picked loop's label as a readout; nothing pre-selected —
  submit fails closed until the operator clicks. The 'Selection' height
  reference now requires an actually picked loop. Manual X,Y entry remains
  as the alternative source.

## Round 12 (2026-08-24, late) — toolpath display, model ghost, heights refs

Supersedes two round-11 decisions (see below): hole picking is LOCKED to
setup Z again, and the tool ghost parks at ONE position.

- **Static toolpath display** (`overlay.ts::pushSelectedTool`, reworked): the
  tool ghost parks at the operation's START position (the first approach
  target, above the entry point — the reference workflow's convention; the
  XY offset from the stock boundary still reads as radius + facing safe
  distance). The round-11 second ghost at the last cutting position is gone.
  Green/red endpoint arrows (`NativeViewportArrow`, already rendered by the
  native side) mark where the cutting feed starts and leaves, oriented along
  the first/last cutting segments, sized from the tool diameter.
- **Stock-vs-model inspection**: while a simulated operation is selected and
  no dialog is open, the setup's part bodies ghost to a faint translucent
  shell (alpha 0.1) with their full wireframe drawn through geometry, so the
  machined stock surface shows through the model — the display the reference
  workflow uses when a cut finishes on a model surface. Plumbing:
  `ViewportPresentation.ghosted_body_ids` (serde-defaulted) →
  `apply_native_presentation_styles` (blend alpha, restored to opaque when
  un-ghosted) and the edge gizmo pass (ghosted bodies force all edges via
  the through-geometry highlight group); collected in
  `nativeViewportBridge.ts::collectNativeViewportPresentation`, gated
  exactly like the overlay's simulation display.
- **Hole picking re-locked to setup Z**: `camHoleFromCylinderFace` returns
  null for tilted faces again (round 11's any-cylinder picking confused more
  than it helped before per-operation tool orientation exists). The setup-
  space axis computation stays on the pick type, projected with the
  dot-product convention — relaxing that ONE check is the whole future
  multi-axis change in the picking pipeline; the dialog's tilted submit
  guard and the overlay's amber bucket stay as dormant defense.
- **Heights From-reference system extended** (dialog-side; stored values
  remain absolute setup Z): a height row may reference a plane (model/stock
  top/bottom, origin), a LOWER height of the same operation (fixed
  resolution order bottom → top → retract → clearance — cycles impossible
  by construction, rows only offer lower members, and only when the bottom
  row exists for the kind), or 'Selection' (the picked sketch loop's plane
  Z; path kinds with a sketch-loop source only, auto-falls-back to model
  top when the source changes). Edit-mode seeding (`heightDraftFrom`) now
  also offers the stored lower heights as chain candidates; planes win
  ties. Feed height / fixture planes / highest-of / lowest-of stay
  placeholders.
- Verified: `npx tsc --noEmit`, `cargo check` (src-tauri, native viewport),
  `cargo test --workspace` (464), mcp-server (37), `npm run build`,
  `npm run smoke:wasm` — all green.

## Round 11 (2026-08-24) — one dialog per entity, context menus, tilted holes

(Round 12 partially supersedes: hole picking is setup-Z-locked again with
the axis kept as the multi-axis seam; the tool ghost parks at the start
position only.)

- **Create and edit share ONE dialog per entity.** The `setupEdit` /
  `operationEdit` dialog states and every inspector component
  (`SetupInspector`, `OperationInspector`, the per-kind `*Fields`, the
  `Field`/`LengthField`/`CommitPoints` helper family) are DELETED from
  `CamWorkspace.tsx`. The store's `CamDialogState` is now
  `{ type:'setup'; editId?: number } | { type:'operation'; kind; editId? } |
  tool | post`; `CamSetupDialog` and `CamOperationDialog` take an optional
  `editing` prop, seed every draft from the stored setup/operation (heights
  re-expressed as nearest reference plane + signed offset via
  `heightDraftFrom`; paths/points re-open as manual X,Y lines; the WCS
  orientation is reverse-solved by replaying all 8 dialog orientations
  against the stored axes; the thread designation keeps the stored
  pitch/diameters until the operator deliberately changes it via
  `threadPresetTouched`; `feedsTouched` starts true so picking another tool
  never silently rewrites cutting data), and submit through
  `replaceCamSetup` / `replaceCamOperation` (new in `document.ts` — wholesale
  replace keeping id/enabled/operations, re-resolving stock+WCS against the
  live scene, fail-closed on kind change / self-referencing rest stock).
  The dialog host keys dialogs by edit target so switching edits re-seeds.
- **Context menus on every browser row** (`CamBrowser.tsx`): setup rows (edit
  / delete), Stock&WCS rows (edit), operation rows (suppress/resume, edit,
  delete — as before). All carry `data-native-viewport-overlay`.
- **Hole picking unlocked from setup Z.** `camHoleFromCylinderFace` accepts
  ANY cylindrical face and records the hole axis in setup coordinates
  (`axis: [x,y,z]` on `CamHolePickHole`, rotated with the same dot-product
  convention as `modelPointToSetup` — setup[i] = dot(model, axis[i]); the
  transposed variant computed the right Z for today's 8 axis-aligned
  orientations but wrong X/Y for tilted holes, which is exactly what future
  indexed/5-axis work consumes). Overlay markers: green at the stock-top
  plane for setup-Z holes, AMBER at the face's axis origin for tilted ones
  (`HOLE_POINT_TILTED`), hovered enlarged. The dialog lists tilted holes with
  a ∠ badge and `resolveDrillPoints` fails closed at submit (fixed-axis
  planning drills along setup Z only). The hover cursor is `crosshair` off
  holes instead of `not-allowed`.
- **Facing safe-distance verified against the user's live document.** The
  engine, overlay, and numbers were proven correct to the pixel (entry X =
  stock min − radius − safe distance; a Ø63 face mill on a 34 mm stock makes
  a 36.5 mm approach that LOOKS wrong but is exactly right; the large grey
  slab in the feedback screenshot was the tool ghost parked at the last
  cutting position). To make the 5 mm edge gap readable, `pushSelectedTool`
  in `overlay.ts` now draws the tool ghost at BOTH the entry plunge point
  (first same-XY descending linear) and the last cutting position.
- **`.nbpost` inspection moved** from the retired setup inspector into the
  Post NC dialog (`CamPostDialog`), unchanged otherwise.
- Verified: `npx tsc --noEmit`, `cargo test --workspace` (464),
  mcp-server (37), `npm run build`, `npm run smoke:wasm` — all green.

## What exists now

**Core (`crates/cam/`)**

- `model.rs` — document model + all validation. Tool identity is three-layer:
  `id` (internal uid, the only key operations reference), `number:
  Option<u32>` (machine-facing, optional), `name` (required, also the call
  identifier on name-capable controls). Tool kinds: flat/ball/bull-nose end
  mill, face (shell) mill, drill, chamfer mill, tap, reamer, boring bar,
  thread mill; `turning_general` is reserved for the planned turning
  workspace (no milling operation accepts it). Flat/bull-nose/face mills
  carry `corner_radius` (validated: positive, ≤ D/2, required on bull
  nose). Cutting data is a default profile (`cutting`) plus named extra
  profiles (`cutting_presets`, names unique/non-empty, each validated);
  operations copy one profile's values at creation.
  `CamToolDto::label()` renders
  `T<n>` or the name for diagnostics. Drill operations carry `cycle:
  DrillCycle` (drill / chip_breaking / deep_hole / tapping_right /
  tapping_left / reaming / boring) with `peck_depth`, `peck_retract`,
  `thread_pitch`, `feed_out`, all validated fail-closed per cycle. Thread
  operations (internal thread milling) store an explicit `pitch`,
  `major_diameter`, `minor_diameter` (the host resolves the designation via
  `src/lib/threadStandards.ts`; the planner never derives thread geometry),
  plus `hand`, `direction`, `radial_passes`, and `step_over`, all validated
  fail-closed (tool must be a thread mill smaller than the minor diameter;
  depth + one pitch of overtravel must fit the flute length; multi-pass
  stepovers must leave a finishing orbit). Every operation carries
  `feed_height_z` (cut top ≤ feed ≤ retract). Facing carries `direction`
  (both_ways/climb/conventional) and `safe_distance`; contour carries
  `direction`, `lead_arc_radius`, radial multi-pass fields
  (`roughing_passes`/`roughing_step_over`/`finishing_pass`/
  `finish_allowance`/`finish_feed`/`spring_pass`), and `chain_ref`
  (picked-chain provenance for edit re-selection); pocket/chamfer carry
  `direction`. Tools carry optional `default_step_down`/`default_step_over`
  seeding new operations' passes.
- `planner.rs` — controller-neutral motion. Every drill cycle is expanded to
  longhand moves (no canned-cycle dialects). Tapping emits pitch-synchronised
  feeds (pitch x rpm) with spindle reversal via the builder's deduped
  `spindle()` helper, restoring CW after every hole. Thread milling emits a
  helical orbit: one pitch of Z travel per revolution, split into
  semicircular `CamCommandDto::Circular` arcs via the builder's `circular()`
  helper (arc length including Z feeds distance/time estimates); straight
  line leads in/out from the hole center (helical leads are roadmap). With a
  CW spindle, climb = CW orbit and the thread hand fixes the Z sense (RH
  descends going CW); conventional reverses the orbit. Radial passes open up
  from the smallest orbit, finishing pass last. `CamProgramDto.per_operation`
  carries per-operation rapid/cutting distance and time for the status
  readout (first work-offset copy only). Work offsets repeat the
  whole program per consecutive G54+ code. Rapids have no programmable feed;
  the 8 m/min constant feeds only the time estimate.
- `post.rs` — GRBL / LinuxCNC / Fanuc-style / native Siemens 828D. Numeric
  posts fail closed when a tool has no number. The 828D calls tools by name
  (`T="NAME"`, sanitized, 31-char cap) with the number as fallback;
  next-tool preload compares call words, not numbers. Post config is chosen
  at export time (`CamPostRequestDto.post`), document `post_defaults` only
  prefill the dialog. Helical arcs (Z advances through the turn, i.e. thread
  milling) post as plain G2/G3 blocks carrying a Z word in every dialect.
- `simulation.rs` — voxel stock removal + rapid-collision reports. Tap /
  reamer / boring bar / thread mill sweep as plain cylinders (no
  tip-approximation note).
- `post_events.rs` — neutral callback-event stream for future post adapters.

**Frontend (`src/cam/`, `src/components/cam/`)**

- Manufacturing and modeling share one viewport outright: `CamWorkspace`
  mounts the same `Viewport` component as the modeling tab, so navigation,
  grid, ViewCube, and model presentation are identical by construction. CAM
  overlays are collected by `src/cam/overlay.ts` and merged into the
  viewport's native transient preview channel inside
  `collectNativeViewportTransient`: translucent stock ghost + envelope edges,
  RGB WCS axes at the setup origin, the selected operation's toolpath
  (dotted amber rapids / solid green cuts, width >= 2 so they render through
  geometry via the highlight gizmo group), green remaining-stock mesh from
  the voxel simulator with red rapid-collision markers, and point-pick
  candidates. All planner/simulator output is setup-space; `overlay.ts` is
  the single place that transforms it back to model coordinates
  (`geometry.ts::setupPointToModel`). The planned program and simulation
  result live in the store (`camProgram` / `camSimulation`) so the collector
  can read them; every store change already marks the transient channel
  dirty, so no extra invalidation plumbing exists. The old hand-rolled 2D
  canvas (`CamSimulationViewport`) is deleted. Selecting an operation also
  draws a translucent ghost of its tool (fluted section brighter, shank
  fainter) parked at the operation's START position (the first approach
  target), plus green/red pure-cone markers at the feed start and at the
  exit — the exit cone lifts to the retract target pointing up when the
  section closes with an upward rapid (round 16).
- A machining-time chip sits at the viewport's lower right: the selected
  operation's `h:mm:ss` from `program.per_operation`, or the setup total when
  nothing is selected.
- Viewport point picking works in the shared viewport: `onPointerDown`
  intercepts left clicks during a `camPointPick` session and projects
  candidates with the live camera (16 px nearest-wins); Escape cancels via a
  `CamWorkspace` listener, and the prompt shows as a DOM banner.
- Viewport hole picking works the same way for drill/thread dialogs (round
  10; unlocked from setup Z in round 11): the dialog opens a `camHolePick`
  session in the store for its lifetime, pointermove highlights ANY
  cylindrical face (`camHoleFromCylinderFace` in `geometry.ts` converts a
  face to a setup-space center + radius + axis, marker parked at stock-top
  height for setup-Z holes and at the face axis origin for tilted ones), a
  click toggles the hole into the dialog's list, and the overlay draws
  selected holes as green markers (amber for tilted, hovered enlarged).
  Tilted holes fail closed at submit. Manual X,Y entry remains as a
  fallback. The old sketch-point checkbox menu is gone.
- Round-10 overlay fixes: the filled-disc rasterizer
  (`platform.rs::draw_filled_disc`) takes an adaptive half-step count derived
  from the world-per-pixel size, so pick markers render as solid dots at any
  zoom instead of striped bands; marker radii shrank to ~0.6% of the model
  extent. Toolpaths and the green simulated stock only render while an
  operation is selected and no operation dialog is open (`camDialogOpen` in
  the overlay state); clicking empty space clears the CAM selection. The
  operation context menu carries `data-native-viewport-overlay` so the
  native viewport cuts out for it instead of drawing over it.
- The browser stays shared too: App renders `BrowserTree` (embedded mode)
  with `CamSetupsPanel` docked below. Operation rows show `[T<n>]`/`[name]`
  tool tags. There is no right sidebar: double-clicking a setup row, the
  "Stock & WCS" row, or an operation row re-opens the SAME dialog that
  created it, seeded from the stored values (`editId` on the `setup` /
  `operation` dialog states; the inspector components were deleted in round
  11). Right-click menus cover all three row kinds. The tool library is
  a separate full-size dialog: tool table on the left; the editor is tabbed
  (General / Cutter / Cutting data) and brand-new tools start on a grouped
  type-picker page (Milling / Hole making, plus a disabled Turning tile for
  the planned workspace). Cutting data supports named profiles (default
  preset + extras) and a two-way chip-load calculator: each linked pair
  (rpm↔Vc, feed↔fz, plunge↔fpr) follows an edit on either side without
  oscillation (the side touched last is the driver and wins at submit);
  the speed pair resolves through the *effective* cutting diameter, which
  for corner-radius tools engaged shallower than R follows the vendor
  button-cutter formula De = D − 2R + 2√(2R·ap − ap²)
  (`src/cam/units.ts` owns the conversions). The setup dialog is a centered
  modal;
  during a viewport pick it steps aside. The ribbon's manufacturing tab
  mirrors the reference hierarchy: WORKSPACE (return to model), SETUP (new
  setup), TOOLPATHS (face/contour/pocket/chamfer/drill/thread), MANAGE (tool
  library), OUTPUT (post/events).
- The tool library is two-scope (round 8 rework; the write-through/merge
  model was reverted after it shipped a real regression — a centrally
  absorbed tool with `center_cutting: false` became unusable for facing,
  and the merge rewrote projects on open). The CENTRAL library is a
  per-user collection (`cam-tool-library.json` in the platform config dir;
  Tauri commands `cam_library_load`/`cam_library_save`; `src/cam/library.ts`)
  that owns tool-id allocation. The PROJECT library is the document's
  `tools` array: full-data snapshots of the tools this project uses, saved
  inside the .nbcad, referenced by operations — self-contained and
  portable. NO automatic merge happens anywhere. Sync is explicit:
  `importCamToolFromCentral` (pull/refresh same-id snapshot),
  `publishCamToolToCentral` (push/overwrite same-id central entry).
  `addCamTool` allocates the id through the central library and also
  registers the tool there; `updateCamTool`/`deleteCamTool` touch the
  project only. Off the Tauri runtime the central calls no-op and the
  project library stands alone. The Tool Library dialog defaults to the
  central scope with a header switch to "This project"; the project scope
  has an import strip (central tools not yet snapshotted) and per-tool
  sync actions in the editor footer (Add to central / Update central copy /
  Reset to central copy, driven by a JSON content diff). The operation
  dialog lists project tools and offers one-click import of compatible
  central tools inline (selects and prefills from the imported copy). The
  operation inspector's inline tool-geometry edits write the project
  snapshot only, and say so.
- Facing no longer demands a center-cutting tool (the round-8 regression's
  root cause): the planner's entry plunge sits outside the stock boundary —
  one radius plus the operation's `safe_distance` (mandatory, 5 mm default,
  serde-defaulted for older documents) off the min-X edge — so indexable
  face/shell mills, which are rarely center-cutting, are valid, and the
  entry can never degrade into plunge-milling. The kind gate admits
  flat-bottom mills only: flat end mills, bull-nose end mills, and face
  mills (ball noses scallop the surface, chamfer mills cut on an angled
  edge, thread mills cannot side-mill at all, hole-making and turning
  tools are out). Engine validation and `camToolCompatible` were relaxed
  for `face` only; pocket/contour entries still plunge into material and
  keep the center-cutting requirement until ramp/helical/lead-in entries
  exist. Engine tests: `face_accepts_a_non_center_cutting_face_mill`,
  `face_kind_gate_admits_flat_bottom_mills_only`, and
  `face_entry_moves_outward_with_safe_distance` (round 10, pins that the
  entry X moves outward by exactly the safe distance); the safe distance
  edits on the dialog's Linking tab like any other face field.
- Operation dialogs share one five-tab scaffold (Tool / Geometry / Heights /
  Passes / Linking) for every kind — round 10 deleted the old flat layout
  along with `OpToolPicker`/`OpSpeedsFeeds`; `opShared.tsx` now carries only
  `OP_PAGES` (per-kind geometry shape + which fields go live), the library
  picker plumbing, and the pick-result hook. New tools and new operations
  default to flood coolant.
- Face operations target the model's top surface: the dialog enters the
  bottom as a From-reference height (default model top + 0), resolved to
  absolute setup Z at submit; `geometry.ts::modelTopZInSetup` provides the
  model-top plane (probe transform through the orthonormal WCS). The stored
  value stays absolute; editing the model afterwards does not re-resolve
  (the full From-reference height system is the roadmap item).
- `CamOperationDialog` — every kind now runs the five-tab scaffold (round
  10). The Tool tab is shared verbatim (current tool + Select… opening the
  library picker, presets, feed & speed grid with derived surface speed /
  feed per tooth / feed per rev); for drills it hides the lateral-feed pair
  and relabels plunge feed as drilling feed. Heights are From-reference
  (model/stock top or bottom, origin) plus signed offset for every kind,
  resolved to absolute setup Z at submit; the bottom row only exists for
  kinds that cut to a depth, and defaults aim at the obvious target (top:
  stock top for facing, model top otherwise; bottom: model top for facing,
  model bottom otherwise). The Passes tab switches live fields per kind
  (face/pocket: stepover + multiple depths; contour: tool-side compensation
  + multiple depths; chamfer: width/tip/material side; drill: cycle plus its
  conditional peck/pitch/feed-out/dwell fields; thread: hand/direction/
  radial passes) and renders the rest of the reference option set disabled
  (`NOT_APPLIED_YET` in `camFields.tsx`). The thread designation select plus
  its resolved readout lives on the Geometry tab. Drill cycle changes still
  filter compatible tools per cycle; inapplicable fields are scrubbed at
  submit because each cycle only writes the fields it consumes. The thread
  designation resolves to pitch/major/minor through
  `src/lib/threadStandards.ts`; the resolved numbers persist on the
  operation, the designation string never does.
  A cutting-profile dropdown appears when the chosen library tool carries
  named profiles and copies the picked profile into the drafts. A live
  "Multiple depths" toggle switches stepdown between the entered maximum and
  a single full-depth pass (face/contour/pocket).
- Tool picking goes through the Tool Library dialog itself: the store keeps
  a one-deep dialog stack (`camDialogBelow` + `pushCamDialog`/`popCamDialog`),
  the library mounts in picker mode (`pickFor`) over the operation dialog
  (which stays mounted, drafts intact), compatible rows highlight and the
  rest grey out, and a double-click or the Select button confirms into
  `camToolPick`, which the waiting dialog consumes (`useCamToolPickResult`
  in `opShared.tsx`); central-scope picks are imported into the project on
  confirm. The library table gained a free-text filter (name/number/type)
  in both modes. The picker opens on the project scope but switches to the
  central library on its own when the project holds no compatible tool and
  the central library does (round 10; the empty-state copy says so).
- `geometry.ts` resolves stock specs (box/cylinder/hex/model body; fixed /
  from-model allowances / rest-from-setup) and WCS origins; `pointPick.ts`
  owns the shared viewport point-pick session (27-lattice box points, sketch
  points) reused by setup and will be reused wherever features are picked.
  Pick markers are solid discs with pointer hover highlighting
  (`camPickCandidateKey` + `setCamPointPickHover`; the viewport's pointermove
  does a 16 px projected nearest-candidate hit test and swaps the cursor).
- `CamBrowser` rows carry right-click context menus (round 11 generalized):
  operation rows get suppress/resume (planner + post skip disabled
  operations, so suppress is just the `enabled` flag), edit, delete; setup
  rows get edit/delete; Stock&WCS rows get edit; suppressed rows show a tag.
- `units.ts` — canonical mm inside, display/commit conversion at the edges;
  the document unit switch flips any time, posts emit G21/G20 / G710/G70.
- All CAM dialogs carry `data-native-viewport-dim` on the backdrop and the
  `feature-dialog` class on the panel: the native viewport is a platform
  child view, and without those hooks it draws over DOM dialogs
  (`nativeViewportBridge.ts` collects dim opacity and overlay cutout rects).

**MCP (`mcp-server/`)** — `cam_get_document` / `cam_set_document` /
`cam_plan_setup` / `cam_post_setup` / `cam_simulate_setup`, same validation
as the UI. Descriptions document tool identity, cutting-data profiles, and
drill cycles.

## Invariants worth keeping

- Nothing is created automatically: no setup, tool, or operation appears
  without explicit operator input; incomplete input fails closed with a
  readable error.
- Project tool libraries are self-contained snapshots; the central library
  syncs only through explicit operator actions (import/publish), never
  through a background merge on open.
- Planned motion is controller-neutral and post-agnostic; any post must be
  able to render any program. New behavior belongs in the planner IR, not in
  a post.
- Comments and docs never name third-party CAD/CAM products or vendors by
  name (reference screenshots live in the gitignored `reference/` folder).
- `G0` is full rapid; there is no configurable "rapid feed".

## Verification (all green at handoff)

`cargo test --workspace` (CAM 107),
`cargo test --manifest-path mcp-server/Cargo.toml` (102),
`cargo clippy -p nbcad-cam --all-targets --no-deps -- -D warnings`,
`npx tsc --noEmit`, `npm run build:wasm`, `npm run smoke:wasm`, and
`npm run build`. A fresh 137 MiB arm64 macOS `.app` was built without a DMG,
passed deep strict code-signature verification, contains the required license
notices, and has no Homebrew library paths. A live open of `doorBlock.nbcad`
also confirmed the Manufacture workspace exposes the actual 0.472 mm 3D
detail and the simulator's voxel/collision-scope warnings.

## Not done yet (rough priority)

1. **Simulator confidence foundation:** accurate cutter envelopes; target
   gouge detection; shaft/holder, fixture, and machine-envelope collisions;
   explicit quality/tolerance control; smoother remaining-stock extraction;
   and command-level playback. Tool holders/shafts enter the library as part
   of this work; central-library import/export can follow independently.
2. **Shared robust 2D geometry kernel:** safe miter/arc offsets, clipping and
   Boolean cleanup, concave/self-intersection handling, tangent-arc fitting,
   and engagement-aware smoothing. Rounded/rolling contour roughing remains
   here so the same kernel serves high-speed and future 3D paths.
3. **Remaining 2.5D linking and operations:** ramp/helical pocket and contour
   entry (the blocker for non-center-cutting tools), keep-tool-down linking,
   stock-to-leave, tolerance/smoothing, pass extensions, vertical lead radii,
   tabs, bore milling, and ramp/lead/transition feed rates.
4. **Hole/thread follow-ups:** fine boring with shift (G76 semantics),
   back-boring, gun drilling, and thread-milling helical leads, external
   threads, multi-start, and tool-pitch matching. Canned-cycle output stays
   behind per-control validation, if added at all.
5. **Selection/reference follow-ups:** fixture planes, selected contours,
   highest/lowest-of height references, direct exact-BRep chain selection,
   and central-library file import/export. Picked cylindrical-hole spans and
   setup-space axes are already persisted; indexed/5-axis planning remains a
   separate future workspace.
6. **3D adaptive clearing:** the largest path-planning piece, intentionally
   after simulator confidence and the shared geometry kernel can verify rest
   stock, engagement, gouging, and collision behavior.
7. **Posted-NC verification and machine safety:** parse/replay final controller
   text, compare it with neutral motion, then add tool-length compensation,
   limits, safe home/tool-change policies, and controller golden suites.

## Process note

One earlier progress report claimed round-3 UI changes (shared browser,
centered setup dialog, tool uid) that were not actually in the working tree.
They are landed and tested now. When resuming, verify claims with
`git status`/`git diff` and a test run before building on them.
