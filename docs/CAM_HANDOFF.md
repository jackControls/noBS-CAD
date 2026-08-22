# CAM branch handoff — 2026-08-22

State of `feature/cam` after four working rounds. Everything below is
verified against the working tree and test runs of this date; trust the tree
and the tests, not this document, when they disagree.

## What exists now

**Core (`crates/cam/`)**

- `model.rs` — document model + all validation. Tool identity is three-layer:
  `id` (internal uid, the only key operations reference), `number:
  Option<u32>` (machine-facing, optional), `name` (required, also the call
  identifier on name-capable controls). Tool kinds: flat/ball end mill,
  drill, chamfer mill, tap, reamer, boring bar. `CamToolDto::label()` renders
  `T<n>` or the name for diagnostics. Drill operations carry `cycle:
  DrillCycle` (drill / chip_breaking / deep_hole / tapping_right /
  tapping_left / reaming / boring) with `peck_depth`, `peck_retract`,
  `thread_pitch`, `feed_out`, all validated fail-closed per cycle.
- `planner.rs` — controller-neutral motion. Every drill cycle is expanded to
  longhand moves (no canned-cycle dialects). Tapping emits pitch-synchronised
  feeds (pitch x rpm) with spindle reversal via the builder's deduped
  `spindle()` helper, restoring CW after every hole. Work offsets repeat the
  whole program per consecutive G54+ code. Rapids have no programmable feed;
  the 8 m/min constant feeds only the time estimate.
- `post.rs` — GRBL / LinuxCNC / Fanuc-style / native Siemens 828D. Numeric
  posts fail closed when a tool has no number. The 828D calls tools by name
  (`T="NAME"`, sanitized, 31-char cap) with the number as fallback;
  next-tool preload compares call words, not numbers. Post config is chosen
  at export time (`CamPostRequestDto.post`), document `post_defaults` only
  prefill the dialog.
- `simulation.rs` — voxel stock removal + rapid-collision reports. Tap /
  reamer / boring bar sweep as plain cylinders (no tip-approximation note).
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
  canvas (`CamSimulationViewport`) is deleted.
- Viewport point picking works in the shared viewport: `onPointerDown`
  intercepts left clicks during a `camPointPick` session and projects
  candidates with the live camera (16 px nearest-wins); Escape cancels via a
  `CamWorkspace` listener, and the prompt shows as a DOM banner.
- The browser stays shared too: App renders `BrowserTree` (embedded mode)
  with `CamSetupsPanel` docked below. Operation rows show `[T<n>]`/`[name]`
  tool tags. The tool library is a separate full-size dialog (table + editor
  + duplicate), never a browser node. The setup dialog is a centered modal;
  during a viewport pick it steps aside.
- `geometry.ts` resolves stock specs (box/cylinder/hex/model body; fixed /
  from-model allowances / rest-from-setup) and WCS origins; `pointPick.ts`
  owns the shared viewport point-pick session (27-lattice box points, sketch
  points) reused by setup and will be reused wherever features are picked.
- `units.ts` — canonical mm inside, display/commit conversion at the edges;
  the document unit switch flips any time, posts emit G21/G20 / G710/G70.
- `CamOperationDialog` — per-operation programming incl. per-op
  clearance/retract; drill cycle picker filters compatible tools per cycle
  and scrubs inapplicable fields on cycle change (the inspector's DrillFields
  does the same).

**MCP (`mcp-server/`)** — `cam_get_document` / `cam_set_document` /
`cam_plan_setup` / `cam_post_setup` / `cam_simulate_setup`, same validation
as the UI. Descriptions document tool identity and drill cycles.

## Invariants worth keeping

- Nothing is created automatically: no setup, tool, or operation appears
  without explicit operator input; incomplete input fails closed with a
  readable error.
- Planned motion is controller-neutral and post-agnostic; any post must be
  able to render any program. New behavior belongs in the planner IR, not in
  a post.
- Comments and docs never name third-party CAD/CAM products or vendors by
  name (reference screenshots live in the gitignored `reference/` folder).
- `G0` is full rapid; there is no configurable "rapid feed".

## Verification (all green at handoff)

`cargo test --workspace` (cam 51, sketch 101, others green), mcp-server 28,
`npx tsc --noEmit`, `npm run build`, `node scripts/smoke-wasm.mjs`,
`node scripts/bundle-macos.mjs`.

## Not done yet (rough priority)

1. Thread milling (reuse `src/lib/threadStandards.ts`; helical entry +
   climb/conventional), then bore milling (circular interpolation of holes).
2. 3D adaptive clearing — the largest outstanding algorithmic piece.
3. Fine boring with shift (G76 semantics), back-boring, gun drilling;
   canned-cycle output variants behind per-control validation, if ever.
4. Tool library: holders/shafts, cutting-data presets per material,
   import/export of the library.
5. Heights "From"-references (model top / stock bottom + offset) like the
   reference workflow, instead of absolute Z fields only.
6. Geometry picking upgrades: viewport chain selection for
   contour/pocket/chamfer (sketch loops already supported), hole-face
   selection for drilling.
7. Translucent tool model at the toolpath cursor (the reference workflow
   shows it during path review); the overlay channel already supports the
   triangle layer it would need.

## Process note

One earlier progress report claimed round-3 UI changes (shared browser,
centered setup dialog, tool uid) that were not actually in the working tree.
They are landed and tested now. When resuming, verify claims with
`git status`/`git diff` and a test run before building on them.
