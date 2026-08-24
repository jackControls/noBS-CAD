# CAM branch handoff — 2026-08-23

State of `feature/cam` after eight working rounds, rebased onto current
`main` (assembly MCP tools included; force-pushed). Everything below is
verified against the working tree and test runs of this date; trust the tree
and the tests, not this document, when they disagree.

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
  stepovers must leave a finishing orbit).
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
  fainter) parked at the operation's last cutting position.
- A machining-time chip sits at the viewport's lower right: the selected
  operation's `h:mm:ss` from `program.per_operation`, or the setup total when
  nothing is selected.
- Viewport point picking works in the shared viewport: `onPointerDown`
  intercepts left clicks during a `camPointPick` session and projects
  candidates with the live camera (16 px nearest-wins); Escape cancels via a
  `CamWorkspace` listener, and the prompt shows as a DOM banner.
- The browser stays shared too: App renders `BrowserTree` (embedded mode)
  with `CamSetupsPanel` docked below. Operation rows show `[T<n>]`/`[name]`
  tool tags. There is no right sidebar: double-clicking a setup row, the
  "Stock & WCS" row, or an operation row floats that configuration in a
  modal (`setupEdit` / `operationEdit` dialog states, reusing the former
  inspector components inside a feature-dialog shell). The tool library is
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
  `face_kind_gate_admits_flat_bottom_mills_only`; the inspector edits the
  safe distance like any other face field.
- Operation dialogs share one scaffold (`opShared.tsx`): the tool picker is
  a single two-scope component (defaults to the project; switching to the
  central library lists compatible tools and copies the pick into the
  project — no more inline import list that would drown under a 100-tool
  library), speeds & feeds is one component, and `OP_PAGES` declares per
  kind which pages/fields render. New tools and new operations default to
  flood coolant.
- Face operations target the model's top surface: dialogs and the inspector
  enter a depth below model top (0 = model top), converted to absolute
  setup Z via `geometry.ts::modelTopZInSetup` (probe transform through the
  orthonormal WCS). The stored value stays absolute; editing the model
  afterwards does not re-resolve (the full From-reference height system is
  the roadmap item).
- `CamOperationDialog` — per-operation programming incl. per-op
  clearance/retract; drill cycle picker filters compatible tools per cycle
  and scrubs inapplicable fields on cycle change (the inspector's DrillFields
  does the same). The thread operation picker resolves the chosen designation
  to pitch/major/minor through `src/lib/threadStandards.ts` and stores the
  resolved numbers on the operation; the designation string never persists.
  A cutting-profile dropdown appears when the chosen library tool carries
  named profiles and copies the picked profile into the drafts.
- `geometry.ts` resolves stock specs (box/cylinder/hex/model body; fixed /
  from-model allowances / rest-from-setup) and WCS origins; `pointPick.ts`
  owns the shared viewport point-pick session (27-lattice box points, sketch
  points) reused by setup and will be reused wherever features are picked.
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

`cargo test --workspace` (cam 64, 463 total), mcp-server 37,
`npx tsc --noEmit`, `npm run build`, `node scripts/smoke-wasm.mjs`,
`node scripts/bundle-macos.mjs`.

## Not done yet (rough priority)

1. Bore milling (circular interpolation of holes with an end mill).
2. 3D adaptive clearing — the largest outstanding algorithmic piece.
3. Fine boring with shift (G76 semantics), back-boring, gun drilling;
   canned-cycle output variants behind per-control validation, if ever.
4. Thread milling round 2: helical lead-in/out arcs (line leads today),
   external threads, multi-start, tool-pitch matching against the operation.
5. Tool library: holders/shafts, central-library file import/export.
   (The central/project two-scope model, named cutting-data profiles, and
   the Vc/fz calculator are landed.)
6. Heights "From"-references (model top / stock bottom + offset) like the
   reference workflow, applied to every height of every operation — face
   depth already entered relative to model top, but stored absolute.
7. Geometry picking upgrades: viewport chain selection for
   contour/pocket/chamfer (sketch loops already supported), hole-face
   selection for drilling and thread milling.
8. Passes-tab depth from the reference review: stock-to-leave
   (radial/axial), finishing passes with separate feed, tolerance/smoothing
   fields, drill break-through depth + tip-through-bottom, contour lead
   in/out geometry.
9. Ramp/helical entries for pocket and contour — the blocker for
   non-center-cutting tools there (facing is already exempt).

## Process note

One earlier progress report claimed round-3 UI changes (shared browser,
centered setup dialog, tool uid) that were not actually in the working tree.
They are landed and tested now. When resuming, verify claims with
`git status`/`git diff` and a test run before building on them.
