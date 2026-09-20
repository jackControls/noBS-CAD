# ADR 0003 — One Bevy application interface

- Status: Accepted direction; implementation and parity validation in progress
- Date: 2026-09-13
- Tracking: [#38](https://github.com/jackControls/noBS-CAD/issues/38)
- Supersedes: the React-shell and native-child-composition ownership decisions in [ADR 0002](0002-bevy-viewport.md)

## Decision

Move the existing application's complete interface to Rust and Bevy. This is
one product and one command system: a person, an MCP client, and a replayed
recipe operate the same document services. OCCT remains the solid-modeling
authority. This decision does not replace B-rep geometry with rendering meshes.

The conversion includes the application shell, editable command forms, sketch
interaction, assemblies, drawings, CAM, scripts, presentation controls,
settings, file handling, and window lifecycle. Moving only the viewport HUD or
putting native buttons over the old web shell does not complete it.

Use Bevy/Winit for the eventual native window, input and accessibility host.
Keep the existing binary and the ordinary desktop versus `--headless` choice;
do not introduce a second application or a permanent alternate-interface flag.
The current embedded viewport is a development integration point while the
replacement is incomplete. It is not a reason to maintain bespoke IME and
accessibility bridges for three window systems.

## Shared behavior

`interface/catalog.json` remains the product grouping authority. Native widgets
and MCP consume it; neither adds a competing operation taxonomy. Rendered
widgets register their actual entity identity, accessible name, computed
bounds, enabled state, input contract and modal ownership. Inspecting controls
must describe what a person can operate in the displayed interface.

Human input and MCP resolve through the same control validation and native
reducer. A queued control is bound to its document incarnation and semantic
binding, not merely a tab name or recycled widget position. Revalidate ownership
under the document's mutation lock. Reuse the existing engine dispatcher and
project-replacement path; do not translate native actions into hidden DOM clicks
or duplicate the modeling command switch.

The host owns presentation and file-dialog effects. Shared Rust services own
model changes, history, file encoding, validation and replay. Interactive
operations retain their draft, selection, preview, Apply/Cancel, error and undo
semantics. A generic JSON editor for API arguments is not a substitute for an
intuitive modeling form.

## Rendering and interaction

Use one composited Bevy surface for shell, floating controls and viewports.
Native layout must clip and hit-test menus, scroll areas and modal backdrops
consistently. Preserve accurate model/paper coordinate transforms in drawings
and viewport coordinates under DPI changes and panel resizing.

Retain widgets and geometry; update changed data rather than rebuild the entire
scene on pointer motion. Keep idle work event-driven. Long geometry and CAM
operations need cancellation, visible progress and owner-checked completion
without blocking navigation or assigning results to another document.

Distinguish accepted commands, completed model changes, published snapshots,
laid-out controls and submitted rendered frames. An action acknowledgement or
an inspected control tree is not proof that its pixels have been presented.
Background/headless operation must not wait indefinitely for a visible frame.

Native text entry must include selection, clipboard, shortcuts, composition
and IME. Focus traversal, modal trapping, keyboard activation and OS screen
reader access are part of the interface, not optional metadata. Winit and Bevy
integration still require real platform validation; their presence in the
dependency graph is not evidence that these behaviors work.

## Parity and retirement

The local baseline inventory and full-window captures establish the working
reference. They are temporary migration material, kept outside the repository
and removed after parity validation. Capture failures are marked as defects to
improve, rather than treated as successful parity. The original user document
and application window remain untouched during capture.

For each migrated area, validate its normal route, invalid-input route,
Cancel/Undo, keyboard and MCP operation, persistence, and actual rendering.
Use existing behavioral contracts and deterministic examples where useful.
Do not add tests that only repeat the catalog or bless a blank screenshot.

Do not remove an implemented old surface until its replacement passes those
checks. Remove inert placeholders deliberately and document them. Keep the
conversion PR in draft until the full interface beats the baseline and the
supported platform checks pass. Dependency/build simplification follows the
retirement of actual consumers; do not remove a dependency merely to improve
the dependency count while its behavior is still needed.

For lossless ribbon comparisons, set `NBCAD_RIBBON_LAB=1` and run
`cargo run --manifest-path src-tauri/Cargo.toml --features dev-ui-lab --bin bevy-ui-lab -- <output.png>`.
This renders the production widgets in normal, selected and disabled states
through Bevy's GPU pipeline, without opening another CAD window. Compare with
the original ribbon at the same display scale; keep the captures outside the
repository. Shared SVG sources prevent geometry drift but do not prove visual
parity: inspect typography, antialiasing, layout and interaction states too.

This ADR records the implementation direction. It is not a statement that the
conversion, screenshot inventory, platform coverage or performance validation
has finished.

The repeatable native sketch check is `cargo xtask test-mcp native-sketch
--server <rebuilt-CAD-binary> --session <blank-native-document-UUID> --out
<absolute-evidence-directory>`. It uses Rust and MCP to operate the rendered
controls and canvas, checks nine modification forms and Undo, driving/reference
dimensions, constraint deletion, Escape cancellation, capture and Save. It
requires an explicitly selected blank document and fresh output filenames;
it does not launch or close a desktop window, discard work or upload evidence.

The corresponding `native-build` suite uses the same arguments and safety
checks. It drives native Revolve, Sweep, Loft and Rib reference selection, creation,
history editing, close/Cancel, Undo/Redo, rendered capture and Save. Each case
is saved before the next blank tab is created. Loft's datum and section geometry
are seeded through the shared MCP contract; the datum is selected through native
Create Sketch and the browser. Kernel-backed form tests also exercise invalid values,
reference ownership, connected paths, ordered sections and coplanar axes.

`native-support` uses the same arguments to check Create Sketch, all three origin
planes, face selection and both coordinate-zero choices, datum selection in the
browser and canvas, Escape/close cancellation, capture and Save. It uses engine
MCP to seed precise support geometry so this suite does not depend on viewport
zoom or duplicate the native drawing-gesture checks.

Native document tabs retain their own cameras. New and newly opened files fit
their model; changing tabs or closing a tab restores that document's view rather
than inheriting the previous model's zoom. AccessKit publishes native radio and
checkbox states and text field values from the same retained control registry.
