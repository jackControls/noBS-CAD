# Presentation integration validation — September 11, 2026

This pass finishes the staged script interface corrections and keeps their
dependencies in the existing native GitHub stack. It does not mark the broader
learning product or manufacturing candidates as released. See the
[stack order](development-stack.md) and [remaining interface scope](script-interface-review.md).

## Changes and review boundaries

- PR99 replaces the Canvas2D feature preview with bounded native Bevy rendering
  of immutable Rust snapshots. The windowless preview reuses production CAD scene
  systems without access to the active model, session, selection or main camera.
  It waits for actual pipeline readiness, coalesces rendering, rejects stale
  captures and releases the GPU world after its final view closes. Orbit reuses
  meshes. Autoplay holds each matching rendered frame before advancing.
- PR99 also fixes load/run/inspect focus and keyboard handling. The Scripts dock
  reflects live speed and mode while preserving next-run preferences. Loading is
  observational; running explicitly creates a new design. Closing companions
  releases their viewport space. Focused preview navigation retains the card
  when a boundary button becomes disabled. Escape and source handoff restore
  focus without delayed callbacks stealing it.
- PR115 retains document/session ownership through startup, publication, queued
  mutations, controls and completion. Fast progress uses existing successful
  mutation receipts; it adds no per-step status request or wait. The final count
  is published after the final checks. Failure stops the sequence.
- Formatting-only native changes are included in the code layer. PR116 contains
  documentation only. Previous published and intermediate stack heads remain
  recoverable under local backup refs. Descendants were replayed against their
  immediate parent; reviewed lower layers were retained unchanged.

## Tested source

The combined Windows desktop, MCP and Rust xtask were built at `e0e8cec`.
The final frontend-only preview boundary correction is `c458509`; the desktop
was rebuilt again to embed it. It changes focus handling and its browser tests,
not modeling, native rendering or script execution. Restacked sources are
compared against this integrated source before publication; test fixture catalog
metadata is a compatible superset so PR99 also compiles independently.

The Windows build is an unoptimized validation build, not a release performance
benchmark. Results apply to this source, platform and OpenCASCADE build; exact
geometry equality across different kernel versions is not claimed.

The final local executable SHA-256 values are retained for matching a validation
session to its binaries:

```text
nbcad.exe     17aa7aeb6a0e8bdabc27b1e2a1f3218c1232205ac8b4a307bceb8930341a15f9
nbcad-mcp.exe b2af4e049e9b1b2bcd1e3dfcaf6c5432eee86b2e63b4127193e560a35180061a
xtask.exe     73da1d1332c7c3239d238c87a02da733fddacd7f071cdd4a68909d79bf77067f
```

## Automated and live evidence

- 527 Rust workspace tests passed; two ignored tests generate fixtures.
- 162 MCP library tests and nine native recipe integration tests passed. The
  recipe tests exercise editable geometry, mechanisms, restore, fit coupons and
  printable exports.
- 78 Windows desktop library tests passed. The opt-in GPU test was additionally
  run explicitly with four focused preview tests: all five passed. It renders
  real kernel geometry, changes extrusion height, orbits, and tests deferred
  pipeline readiness. Native deadlines, bounded inputs and retired ownership
  have focused failure-path tests.
- Frontend tests, TypeScript, production browser contracts, formatting and the
  desktop frontend build passed. The browser tests use real companion components
  and the actual model keyboard registrations. They cover cold catalogs,
  dismissal, source handoff, stale replies, reduced motion and preview navigation
  using pointer, keyboard and the semantic MCP adapter. The boundary-focus
  regression failed before the fix and passed after it.
- Standalone PR99 passed TypeScript, browser contracts and native library
  compilation without depending on later layers. The complete restacked source
  also passed TypeScript and browser contracts.
- In the rebuilt desktop, Rust `xtask test-mcp scripts-workspace` passed source
  path loading, retained original tabs, editable sketch/extrusion creation,
  paused speed changes, Maximum mode, restored launch preferences and Close/Show
  layout. `xtask test-mcp playback` passed captions, pause, exactly-one-operation
  Step, Resume, queued Stop and Maximum skipping authored delays.
- The final rebuilt desktop passed MCP preview orbit, Home, Previous, Next and
  Replay; the card remained open after either boundary. Escape restored its
  opener, Open this script transferred focus into Scripts, and workspace Escape
  closed the dock. Before/after native models, active session and selection were
  unchanged. Screenshots confirmed shaded native pixels and an unchanged main
  view. Background, foreground and guarded close succeeded; the owned process
  exited. No user window was closed or source uploaded.

Each flagship was built twice independently through the native MCP server. Both
runs matched each other and the saved reference model, sketches, solved assembly
and geometry exactly:

- Garden bench: 595 operations and 47 final checks in each run.
- D-screw vise: 692 operations and 55 final checks in each run.
- Vertical-axis turbine: 1,622 operations and 11 final checks in each run.

The full bench was additionally built in the actual desktop at 16× presentation
speed: 595 operations and 47 checks passed in 175,760 ms, with the same exact
reference comparison. Its native project was saved; a separate isometric copy
hides retained construction references without changing geometry. The owned
validation window exited through MCP and its process termination was confirmed.
The earlier full live vise/turbine and saved-file tests remain recorded in the
[September 10 evidence](review-corrections-2026-09-10.md).

## Remaining gates

GitHub checks and approvals must be read from each current head before merging.
A local Windows result does not certify Linux/macOS packages. The earlier PR100
macOS run compiled and signed the app, then failed inside `bundle_dmg.sh` without
subprocess detail. PR117 enables the existing Tauri CLI verbosity for that bundle
step; it is diagnostic, not a claimed packaging fix. Preserve the actual output
and resolve the demonstrated failure before treating that package as ready.

Issues #9, #12, #14, #16, #93 and #94 retain distinct acceptance. Multi-document
broker routing, required-check policy, comprehensive lessons, specialized drawing
workflows and selected-occurrence editing are not delivered by this pass. The
three reference designs still require physical fit/load/wear qualification, and
the turbine needs generator-output measurements. No blanket issue closure or
approval bypass substitutes for those results.
