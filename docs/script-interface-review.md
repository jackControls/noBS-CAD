# Script interface: validation and remaining work

PR [#99](https://github.com/jackControls/noBS-CAD/pull/99) contains the native
Scripts workspace, MCP adapter and presentation controls. The Rust interpreter
is a separate lower layer; bundled recipe sources, their catalog and
example-dependent acceptance checks are a separate upper layer. Review readiness
of these capabilities does not qualify the flagship designs for manufacture or
complete the broader learning product in issue #16.

## Validated implementation

One Rust interpreter executes the commented command files through the shared
operation catalog. MCP and the native Scripts workspace use it directly. There is
no JavaScript modeling script or native sidecar interpreter. The native main
viewport renders through Bevy. The workspace loads, edits, saves and runs sources;
playback supports captions, speed, pause, step, stop and close/show.

The 2026-09-10 recording used rebuilt commit `59a27f4`. The complete live bench
passed all 595 construction steps and 47 final checks, then matched independent
reference model, sketch, assembly and geometry exports exactly. It contains 27
fully constrained sketches, 34 solved occurrences, 95 history features and 33
joints. Its saved native project matches that reference. This is repeatability
evidence for the tested binary/kernel build, not across different kernel versions.

The local recording was retimed to 26 seconds of chronological construction and
a four-second actual isometric capture. Hiding 27 sketches and one datum plane for
that closing shot changed visibility only. The separate recording window closed
through MCP, and both original user documents were preserved byte-for-byte.

The two manufacturing candidates also completed full live runs at `6f7e5e6`:
692 vise steps with 55 final checks in 237 seconds, and 1,622 turbine steps with
11 final checks in 959 seconds. Both exactly matched the independent headless
model, scene, sketches and solved assembly. The corresponding headless first
runs were 70 and 184 seconds. These are measured presentation runs on this
machine, not a maximum-rate benchmark or a profiler attribution.

PR112 makes material resolution identical through live and headless dispatch,
retains completed output before Save, and waits for the actual viewport and
camera after leaving Drawings. PR113 supplies the shared Show refs operation;
saved clean copies hide all 43/24 vise sketches/datums and 105/105 turbine
sketches/datums without changing any geometry or body visibility. PR114 corrects
the stale final step count and prevents a later Save from overwriting the final
camera feedback. PR108 owns export recovery after a proven unchanged Open
rejection, guarded STEP/mesh export and Save ownership, while retaining guards
after uncertain native replacement. The original PR115 recovery fix is now in
that owning layer. PR115 addresses document/session ownership during script
startup, inbox work, publication and delayed presentation controls.

## Presentation corrections

Feature previews now render immutable Rust-generated snapshots in a separate,
windowless Bevy world using the production scene systems. The Canvas2D projection
and its geometry helper have been removed. Preview state has no access to the
active document, session, selection or main camera. Native view/document caches,
image dimensions and geometry are bounded; requests coalesce, time out and retire
on close. Rendering waits for actual shader pipeline readiness. GPU resources are
released when the final preview closes. The frontend displays native pixels and
provides one-shot playback, reduced motion, orbit, Home/Fit, Previous/Next and
Replay controls.

Loading a source does not run it. Run in new design preserves existing tabs.
During a run the Scripts dock reflects the owned live mode and speed; afterward
it restores the launch preferences for the next run. Fast-mode progress travels
with existing successful mutation receipts, without an extra status roundtrip
per step. The final count is published after the final checks.

Keyboard handling is shared with ordinary modeling controls. A focused companion
handles its own keys before the viewport's capture listener. Escape dismisses the
focused companion and restores focus; opening a source from a feature preview
transfers focus immediately into Scripts. Cold catalog loading retains the
opener's intent, while departure and Escape cancel it. Interactive preview
controls use the existing semantic interface registry and product grouping.

See the [presentation validation](presentation-readiness-2026-09-11.md) for the
rebuilt binary, focused regressions, live checks and remaining platform gates.

## Remaining learning and release work

- **Review the teaching layout.** File → Open Script, the dock, ribbon previews
  and playback bar now have live interaction checks. Presentation and design
  review should still assess readability, chapter pacing and how clearly the
  current part is explained. Functional validation does not settle aesthetics.
- **Stage construction for teaching.** The grouped closing-view operation now
  exists. During long builds, retained sketches/datums and overlapping part
  definitions can still obscure the current sketch before assembly placement.
  Review chapter-level visibility and camera framing without discarding the
  parametric references or silently hiding an unfinished sketch. Keep the final
  geometry and checks independent of presentation choices.
- **Consolidate presentation ownership.** Modeling and ordering are Rust;
  presentation timing and camera interpolation currently include frontend code in
  `operationPlayback.ts` and the viewport adapter. Move behavior into Rust/Bevy
  where the native renderer can own it, while keeping one ordered command path
  and equivalent maximum-rate results. Avoid adding parallel animation state.
  Profile attached maximum-rate and presented runs separately; do not infer that
  increasing presentation speed removes native publication and viewport work.
- **Complete the learning and manufacturing scope.** The short fillet lesson is
  not comprehensive feature coverage. Preserve #89's unique analytic/round-trip
  checks: its four small examples now have native JSONC sources and Rust stdio
  validation in the recipe-library layer. The bench remains a design
  candidate; selected-occurrence editing is #94 and complete drafting is #93.
  The printable windmill, bench and screw vise are iteration targets in
  [flagship-examples.md](flagship-examples.md), not released models.

Use focused regressions and live demonstrations to validate these changes.
Do not add a new CI matrix or tool-coverage percentage gate. Keep already reviewed
export, drawing, exit and bench fixes in their existing PRs. Native chrome remains
#29 and full web-shell retirement remains #38; an isolated native preview does
not close either issue.
