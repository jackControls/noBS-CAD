# Interface conversion baseline

Source inventory: `eccdc9402f10c76ec91392b135b4a2d12eecfb6d`, inspected on 2026-09-13. This is the starting interface for the full Bevy conversion, including the integrated CAM and local stdio work. It describes the current source, not a claim that every feature has passed a live test.

The canonical grouping remains [interface/catalog.json](../../interface/catalog.json), documented in [the interface contract](../interface.md). This document inventories visible surfaces and behavior; it must not become another command registry. Unsupported placeholders are identified below so they do not accidentally become migration requirements or advertised working features.

The [live baseline gallery](ui-baseline/2026-09-13/README.md) contains reviewed screenshots, corresponding MCP control inspections, and two saved native project fixtures. Every main workspace and dialog family has visual evidence. The checkboxes below are broader **behavioral acceptance requirements**, including alternate states and platform checks; they remain pending until those complete routes pass in the converted interface. A screenshot does not certify the behavior of every control it contains.

## Evidence and acceptance

For each capture, record the binary build revision and modified status, source revision, platform, client dimensions, display scale, theme, locale, document or recipe, camera, and the route used to reach the state. Keep a full-window image for context and an optional detail image for small controls. Retain the corresponding interface inspection when available, plus the action result for interactive checks.

Use the rebuilt desktop program and normal UI/MCP commands. A browser-only mock, an injected store state, a test-rendered component, a static recipe thumbnail, or the offscreen Bevy HUD lab is useful supplementary evidence, not a substitute for the actual running application's baseline. Record native dialogs separately: they are not controls in the webview inspection tree.

Capture the existing state before replacing a surface, then repeat the same route against the converted interface. Compare meaning, reachability, and results rather than requiring identical spacing. A screenshot cannot prove keyboard ownership, undo, persistence, geometry validity, or hidden-window progress; pair it with a short behavioral assertion.

- [ ] Record a clean startup, a populated document, and multiple dirty project tabs; preserve the user's existing work.
- [ ] Repeat representative menu, dialog, tree, editor, and canvas routes in windowed and maximized/fullscreen states, at narrow width and increased display scale.
- [ ] Check light/dark/system themes, long labels, a non-English locale, visible keyboard focus, and reduced motion.
- [ ] Exercise foreground, background, minimized/hidden, restoration, and graceful exit without creating extra unmanaged windows.
- [ ] Review each capture against its source state and record any failure honestly; do not mark a placeholder as implemented.

## Architecture that crosses surface boundaries

[App.tsx](../../src/App.tsx) owns the current shell, project initialization, global dialogs, workspace selection, keyboard routing, and guarded exit. [appStore.ts](../../src/store/appStore.ts) separates workspace, model mode, selection, feature editing, drawing tools, and CAM dialogs. A workspace switch is not equivalent to leaving a sketch or cancelling an edit.

The model view already includes a native Bevy surface. The surrounding React interface, the drawing SVG workspace, and many input controllers are still outside that renderer. [Viewport.tsx](../../src/components/viewport/Viewport.tsx) contains substantial modeling interaction, not just a canvas wrapper. [nativeViewportBridge.ts](../../src/components/viewport/nativeViewportBridge.ts), [cadInteraction.ts](../../src/components/viewport/cadInteraction.ts), and [native viewport code](../../src-tauri/src/native_viewport/mod.rs) coordinate pointer ownership, picking, scale, camera, rendering, and overlays.

Current overlays above the opaque native viewport require clipping/cutout and input coordination. Preserve the guarantees in [UI_OVERLAYS.md](../agentic/UI_OVERLAYS.md): an overlay must paint and receive an interior click, not merely exist in a DOM query. Resize, scrolling, DPI changes, fullscreen transitions, dimming, and overlapping dialogs all change those boundaries. The new renderer may remove that implementation mechanism, but must retain its behavior.

[uiControl.ts](../../src/uiControl.ts), [liveUiBridge.ts](../../src/liveUiBridge.ts), [sessionBridge.ts](../../src/sessionBridge.ts), and [operationPlayback.ts](../../src/operationPlayback.ts) currently connect rendered controls, operation execution, document snapshots, and presentation acknowledgements. The new interface must provide equivalent semantic inspection and action routing from the same catalog. DOM selectors are an implementation detail, not a permanent API. Disabled state, labels, modal guards, fresh target identity, and stale-target rejection remain obligations.

[Project tabs](../../src/files/projectTabs.ts) share one hydrated CAD engine. [Project ownership](../../src/files/projectOwnership.ts), [CAM mutation ownership](../../src/cam/documentMutation.ts), and [script workspace ownership](../../src/scripts/workspace.ts) prevent delayed work from modifying whichever tab happens to be active later. Open, Save, tab switching, script playback, CAM calculation, and Quit must await the correct publication boundary. Do not replace these with an unscoped global event handler.

Native wake events and bounded presentation waits matter for always-on local MCP. [CAM presentation scheduling](../../src/cam/simulationUi.ts) must complete even when browser animation frames stop; hidden mode may skip painting but must still finish mutations and exit barriers. A response indicating no frame was presented is not screenshot evidence. Maximum-speed execution and presentation must produce the same model, with rendering optional rather than a second modeling implementation.

The production native HUD lives in [native_viewport/ui.rs](../../src-tauri/src/native_viewport/ui.rs). The [Bevy UI parity lab](../../src/dev/BevyUiParityLab.tsx) and [offscreen capture runner](../../src-tauri/src/native_viewport/ui_lab.rs) exercise those HUD builders. They do not represent the full desktop interface and cannot replace this baseline.

## Shared input and accessibility obligations

These are migration acceptance requirements; their inclusion does not assert the current interface satisfies each one perfectly.

- Named controls expose role, enabled/disabled state, value, checked/selected/expanded state, and meaningful group ownership to accessibility and MCP inspection. Icon-only controls need names; color alone must not communicate failure or selection.
- Pointer, keyboard, and MCP operate the same commands. Selection modifiers, hover/preselection, double-click, context menu, drag thresholds, pointer capture, release outside the window, and cancellation must not diverge between surfaces.
- Text fields own typing, selection, clipboard, IME composition, caret navigation, numeric editing, and undo while focused. Global model shortcuts must not delete geometry while a field is being edited. Native macOS menu accelerators must not execute twice.
- Modal dialogs have an accessible name, a deliberate initial focus, bounded Tab/Shift-Tab navigation, an effective cancel/close route, and focus restoration. Modal errors and unsaved-change prompts take precedence over the underlying editor. Nonmodal panels must not trap focus as if modal.
- Menus support keyboard entry, navigation, activation, Escape, outside dismissal, focus restoration, and viewport clamping. Content hidden behind an overflow menu remains reachable at narrow widths.
- Invalid numbers, expressions, units, selection types, missing references, unavailable commands, loading, failure, and busy states remain visible and understandable. Pending operations cannot leave a misleading enabled Apply button or silently discard work.
- Screen-space geometry, text, dimensions, symbols, and focus indicators remain legible at high DPI and zoom. Camera motion, operation highlights, captions, and live announcements remain calm; honor reduced motion without losing progress information.

## File, project tabs, window, and settings

Sources: [TopBar.tsx](../../src/components/TopBar.tsx), [native File menu](../../src/nativeFileMenu.ts), [native Edit menu](../../src/nativeEditMenu.ts), [file operations](../../src/files/projectFiles.ts), [file I/O](../../src/files/fileIO.ts), [application exit](../../src/files/applicationExit.ts), [exit settlement](../../src/files/exitSettlement.ts).

The compact NB menu and the plus/new-design button share the top row with project tabs. The File menu contains Open, Open Script, Save, Save As, Rename, STEP import, STEP/3MF/STL export for all or selected bodies, conditional drawing outputs, conditional CAM NC output, Settings, and desktop Exit. New design and tab close are separate chrome controls; do not infer that every native-menu item is also a popup item. Tabs retain their own workspace and dirty state.

- [ ] `File → Open`, plus/New, Save, Save As, Rename, active/inactive/dirty tabs, tab switching and close; empty and long-name/overflow states.
- [ ] File popup with no body, with selected body, in Drawing, and in CAM; disabled exports and context-specific entries.
- [ ] Open/import/export native pickers, cancellation, unsupported/corrupt file errors, successful save, and reopen of a multi-workspace `.nbcad` document.
- [ ] [MeshExportDialog](../../src/components/MeshExportDialog.tsx): assembly placement versus definition scope before the native 3MF/STL save dialog; Cancel, Escape, keyboard radios, Continue, selected-body scope, and geometry/export failure.
- [ ] [UnsavedChangesDialog](../../src/components/UnsavedChangesDialog.tsx): Save, Don't Save, Cancel for project and edited script; nested error/save cancellation and restoration of the originating surface.
- [ ] Exit through titlebar close, File Exit, native Quit/Alt-F4 as applicable, and MCP window close; pending CAM/script/edit publication, unsaved multiple tabs, and save failure must settle correctly before termination.
- [ ] Startup recovery notification/error and recovery content without silently replacing the active design; already-running launch/file handoff and invalid handoff path.

[AppearanceDialog.tsx](../../src/components/AppearanceDialog.tsx) is the Settings dialog. Its name must not hide the nonappearance functions from the migration inventory.

- [ ] `File → Settings`: system/light/dark theme, locale, 6DoF speed, CAM library settings, and About build information, including failed build-info retrieval.
- [ ] Settings keyboard focus cycle, close button, Escape/backdrop behavior, nested error precedence, small-height scrolling, and focus return to File.
- [ ] Native app menu, titlebar/window buttons, fullscreen, focus loss/restoration, locale title updates, and platform shortcut labels. Record platform-specific routes as untested when hardware is unavailable.

## Ribbon, workspace switching, menus, and tool lessons

Sources: [Ribbon.tsx](../../src/components/Ribbon.tsx), [RibbonMenu.tsx](../../src/components/RibbonMenu.tsx), [ContextMenu.tsx](../../src/components/ContextMenu.tsx), and the canonical catalog.

The top-level switcher exposes Solid Modeling, Drawing, and CAM. Sketch editing changes the modeling ribbon and constrains workspace transitions. Assembly is a Solid sidebar mode even though the command catalog also has an assembly grouping. CAM has Program, Simulate, and Output sections; these must not become disconnected duplicate command surfaces.

- [ ] Each workspace's wide ribbon, active/disabled controls, split-button menus, secondary options, hover/focus tooltips, and Finish Sketch affordance.
- [ ] Narrow ribbon collapse and re-expansion: keep primary actions reachable, account for chrome and Finish Sketch width, and preserve operation grouping in overflow menus.
- [ ] Menus near window edges, nested/long menu contents, menu actions beyond the ribbon's original bounds, resize while open, and cancellation/focus restoration.
- [ ] [FeatureScriptPreview](../../src/components/FeatureScriptPreview.tsx): delayed hover card, keyboard ArrowDown entry, moving pointer into the card, native preview loading/error, lesson action, Escape/outside dismissal, and no accidental tool execution.
- [ ] Tool lesson visibility for an unavailable modeling action where the catalog supplies an example; disabled modeling remains disabled.

## Solid Modeling: browser, scene, history, and appearance

Sources: [BrowserTree.tsx](../../src/components/BrowserTree.tsx), [Timeline.tsx](../../src/components/Timeline.tsx), [Viewport.tsx](../../src/components/viewport/Viewport.tsx), [BodyAppearancePanel.tsx](../../src/components/BodyAppearancePanel.tsx).

The browser has the document/unit root, settings, named views, origin planes/point, bodies, sketches, and construction geometry. Node presence does not imply a working editor for every node kind. Body/sketch/reference operations, local visibility, and selection are distinct from assembly occurrence visibility.

- [ ] Blank model and populated parametric model with expanded/collapsed browser nodes, hidden items, selected body/sketch/plane, and reference geometry visible.
- [ ] Browser context menus by node kind, rename, copy/paste body, STEP export, edit sketch/feature, grounding or assembly controls where exposed, and delete with dependency confirmation.
- [ ] Timeline latest state, rolled-back build cursor, selected/hovered feature, horizontal overflow, double-click edit, context menu, and [dependent deletion dialog](../../src/components/DeleteFeatureDialog.tsx).
- [ ] Undo/redo in sketch versus solid history, cancelling an edited historical feature, failed recompute/reference state, and restoration of downstream geometry.
- [ ] Scene body/face/edge/profile hover and selection, multiselection, box selection, visibility changes, transparent operation preview, ambiguous profile picking, and invalid pick feedback.
- [ ] [SelectionReadout](../../src/components/viewport/SelectionReadout.tsx): entity identities and geometric measurements for the supported selection combinations; clear/no selection state.
- [ ] [OrientationDial](../../src/components/viewport/OrientationDial.tsx) and [NavBar](../../src/components/viewport/NavBar.tsx): orbit, pan, zoom, zoom window, fit, axis/isometric orientation, keyboard navigation, sketch Look At, and navigation cancellation.
- [ ] Verify orientation and framing separately: a correctly oriented but cropped model is not a passing isometric capture. Exercise repeated fit after document load, panel resize, and large/small geometry.
- [ ] 6DoF disconnected, connecting, connected, unavailable/error, intentional connection/disconnection, speed setting and fit hardware button; mark device-dependent tests pending when no device is available.
- [ ] Selected-body appearance: slicer target, brand/preset, filament type, color/color name, material name, custom values, save-on-change/blur, failure, deselection, and metadata persistence through 3MF export.

### Feature dialogs and manipulators

Open through the Solid ribbon or the corresponding historical feature, with a real profile/body suitable for the operation. Capture each different dialog layout, a valid preview, an invalid input/selection, and Apply/Cancel. A successful direct MCP operation alone does not prove its visible editor survived conversion.

- [ ] [Extrude](../../src/components/ExtrudeDialog.tsx): profile/face selection, direction and distance/extent, taper, new/join/cut/intersect operation and target where available; [distance manipulator](../../src/components/viewport/ExtrudeManipulator.tsx).
- [ ] [Revolve](../../src/components/RevolveDialog.tsx): profile, axis selection, angle/extent and operation; ambiguous/ineligible axis rejection.
- [ ] [Sweep](../../src/components/SweepDialog.tsx), [Loft](../../src/components/LoftDialog.tsx), and [Rib](../../src/components/RibDialog.tsx): profile/path, ordered sections, and direction/thickness respectively, including selection replacement and preview cancellation.
- [ ] [Solid fillet and chamfer](../../src/components/SolidEdgeDialogs.tsx): edge sets, numeric parameters, failed geometry, and historical edit.
- [ ] [Hole](../../src/components/HoleDialog.tsx): face/point placement, multiple positions, bore/counterbore/countersink choices, depth, thread fields, and invalid target/depth.
- [ ] [ConstructionPlaneDialog](../../src/components/ConstructionPlaneDialog.tsx): offset, midplane, at-angle, origin/face/datum references, edge picking, and [offset manipulator](../../src/components/viewport/OffsetPlaneManipulator.tsx).
- [ ] [BodyFeatureDialog](../../src/components/BodyFeatureDialog.tsx): Move/Copy, external thread, shell, mirror, rectangular pattern, circular pattern, combine, and split body. Capture each kind, not only the shared dialog frame.
- [ ] Move/Copy translation/rotation/point-to-point and body/occurrence options actually exposed; [manipulator](../../src/components/viewport/MoveCopyManipulator.tsx), copies, Cancel, and history restore.
- [ ] Thread preset/custom and representation settings, rounded thread/D-flat parameters where exposed; values must remain editable rather than reduced to an opaque mesh.
- [ ] Shared [DimensionInput](../../src/components/DimensionInput.tsx), [ViewportSelectionField](../../src/components/ViewportSelectionField.tsx), [SolidOperationFields](../../src/components/SolidOperationFields.tsx), and [RoundedThreadFields](../../src/components/RoundedThreadFields.tsx): expression/unit entry, invalid values, Enter/Escape, focus/pick mode, and scroll to hidden required fields.
- [ ] [ConstraintDialogHost](../../src/components/ConstraintDialogHost.tsx): generic operation/file error and structured rejected/conflicting/redundant constraint details; effective dismissal and return to the underlying editor.

## Sketch: tools, constraints, and on-canvas input

Sources: [SketchPlaneOriginDialog](../../src/components/SketchPlaneOriginDialog.tsx), [SketchPalette](../../src/components/SketchPalette.tsx), [SketchPatternDialog](../../src/components/SketchPatternDialog.tsx), [DynamicInputOverlay](../../src/components/viewport/DynamicInputOverlay.tsx), [DimensionEditor](../../src/components/viewport/DimensionEditor.tsx), and modeling viewport interaction.

Route: start a fresh design, Create Sketch, pick a real origin/reference/face plane, and use the live tools. Include one face-attached or datum-attached sketch so the baseline does not only exercise XY origin geometry. Existing feature lessons can establish repeatable states, but capture while the actual editor/tool is visible.

- [ ] Plane picking, hovered candidate, sketch origin dialog, active plane orientation, cancellation, and re-entering an existing sketch.
- [ ] Draw families: line/midpoint line/point, two-point/center rectangle, center/two-point circle, three-point/center arc, polygon, slot, and fit spline. Capture menu variants and the distinct construction previews/handles.
- [ ] Modify families: move/copy, trim, extend, break, offset, sketch fillet/chamfer, mirror and scale; source selection, previews, chained application, and Escape termination.
- [ ] Rectangular/circular sketch pattern dialogs: axes/direction, counts/distances/angle, selection, preview, invalid values, Apply/Cancel.
- [ ] Dynamic input length/angle/width/height/diameter as applicable: live values, locked values, focus cycling, selected text, pending preview, and typed expressions. No global shortcut should consume input mid-tool.
- [ ] Dimension creation/placement/editing: driving/reference dimensions, aligned/ISO style, dimension text dragging, angular/radius/diameter cases, invalid/conflicting value, and delete/undo.
- [ ] Constraint menu variants and glyphs: coincident, horizontal/vertical, tangent, parallel, perpendicular, equal, fix/unfix, and additional supported constraints from the catalog; selection eligibility and rejection explanation.
- [ ] Underconstrained, fully constrained, redundant/conflicting, selected, and hovered geometry/constraint/dimension states; readable text and glyph anchors under pan/zoom.
- [ ] Palette expanded/collapsed/scrolling, Look At, grid, snap, points, dimensions, constraints, ISO dimension style, Finish Sketch, and visible disabled options.
- [ ] Sketch tool shortcuts, chain continuation, endpoint snapping, multi-selection, selection clear, sketch undo/redo, and Finish Sketch while focus is in a control.

## Assembly sidebar and motion

Sources: [AssemblyBrowser.tsx](../../src/components/assembly/AssemblyBrowser.tsx), including `OccurrenceTree`, `OccurrenceInspector`, `TransformEditor`, `MotionStudioPanel`, `MotionDriverEditor`, `InterferencePanel`, and [JointDialog.tsx](../../src/components/assembly/JointDialog.tsx).

Route: Solid → Assembly Browser using a saved multi-component example. Keep definitions, instances/occurrences, and raw bodies visibly distinct. A flat list of positioned bodies is not evidence of reusable component behavior.

- [ ] Definitions and occurrences, expanded hierarchy, reusable-definition selection, add/rename/delete controls, visibility/suppression, grounding, selected body versus selected occurrence, and empty assembly state.
- [ ] Occurrence inspector: name, parent/reparent, translation/rotation, local versus world/definition context actually exposed, invalid/cyclic parenting rejection, and persistence after reopen.
- [ ] Joint create and edit: rigid, revolute, slider, cylindrical, planar, ball, pin-slot, screw, and universal choices; connector/body/occurrence picks, frames/axis, offsets, advanced fields, limits, and preview/cancel.
- [ ] Joint list selected, suppressed and broken-reference states, solver feedback, coordinate controls, limit feedback, mechanism dragging, and deletion/undo behavior actually available.
- [ ] Saved positions: capture, name, apply/update/delete and missing-reference behavior.
- [ ] Motion study creation/selection, duration, drivers, joint/coordinate selection, motor initial value/velocity/acceleration, keyframes with step/linear/smooth interpolation, time scrub, play/pause and playback speed.
- [ ] Static interference/clearance results, swept motion study sampling and stop-at-first, contact pair selection, enabled/stop-motion/clearance controls, empty and failing results.
- [ ] Save/reopen preserves the same assembly and motion definition; model and drawing views use the intended instance transforms. Treat unresolved occurrence editing limits as recorded gaps, not silently converted success.

## Drawing workspace, sheet, and inspectors

Sources: [DrawingBrowser](../../src/components/drawing/DrawingBrowser.tsx), [DrawingSheetSetup](../../src/components/drawing/DrawingSheetSetup.tsx), [DrawingWorkspace](../../src/components/drawing/DrawingWorkspace.tsx), [projection](../../src/drawing/projection.ts), [projection presentation](../../src/drawing/projectionPresentation.ts), [title block](../../src/drawing/titleBlock.ts), and [export](../../src/drawing/export.ts).

This is an interactive 2D SVG workspace today, with a sheet canvas, a drawing browser, tool-specific placement states, and a right inspector. Converting the modeling HUD does not cover it. Preserve geometric references and paper/model scale distinctions, not merely the visual appearance of a PDF.

- [ ] First entry to Drawing and New Sheet setup: ISO versus ANSI/ASME, paper format/orientation, projection convention, general tolerance preset/custom, title/number/revision/author, preview, Create/Cancel.
- [ ] Empty and populated sheet, multiple sheets, active sheet navigation/browser, zoom/fit/pan, mouse versus trackpad wheel, page bounds, and selected view/annotation.
- [ ] Base/projected/isometric view placement, alignment, scale, rotation, repositioning and auto-layout; model change followed by projection refresh, loading, and failed projection.
- [ ] Section, detail, auxiliary, broken and removed-section views, including source view geometry, placement indicators, cutting/break lines, labels, and derived-view inspector.
- [ ] Dimensions: linear, diameter, radius, angle, chain, baseline, continued, ordinate, arc length, jogged radius, and chamfer/hole notes where wired; source picking, label placement, precision, tolerance, units and formatting inspectors.
- [ ] Center mark, center line, symmetry axis and bolt circle; datum, GD&T, surface texture, edge requirement and weld symbols; placement and their distinct annotation fields.
- [ ] Notes, balloons, revision clouds, title block, BOM/revision content where exposed, text editing and table/block dragging with bounds and pointer release.
- [ ] Sheet inspector, view placement inspector, derived-view inspector, chamfer placement inspector, annotation inspector and note inspector. Capture scrolled fields, disabled states, invalid entries and deletion.
- [ ] Lost-reference/reassociate tool, invalid source feedback, and updated model instances. A crosshair or missing linework is a recorded failure, not a substitute for the projected drawing.
- [ ] Drawing DXF, Print/Save as PDF, and the internal `ManufacturingProfileExportDialog` reached by File → Export 1:1 manufacturing profile: region selection, exact local sketch-plane millimetres, holes, validation, and Cancel.

## CAM Program, Simulate, and Output

Sources: [CamWorkspace](../../src/components/cam/CamWorkspace.tsx), [CamBrowser](../../src/components/cam/CamBrowser.tsx), [CAM view state](../../src/cam/view.ts), and [CAM document](../../src/cam/document.ts). The CAM sidebar combines the embedded modeling browser and setup/operation tree; capture both sections.

- [ ] Enter CAM from a real solid, empty setup state, populated Program ribbon, Simulate/Output sections, Return Model, selected/disabled/stale/failed operation states.
- [ ] Setup/operation browser expand/collapse, context menus, double-click editing, rename, selection, enable/disable, duplicate, insertion position, drag reordering and busy guards.
- [ ] [CamSetupDialog](../../src/components/cam/CamSetupDialog.tsx): workpiece selection, WCS orientation/origin and point picking, stock shape/extents, machine/work-offset settings, preview, invalid references and Cancel.
- [ ] [CamOperationDialog](../../src/components/cam/CamOperationDialog.tsx): Face, Contour, Pocket, Chamfer, Drill and Thread; each kind's geometry, tool, cutting, heights, passes and linking fields as exposed.
- [ ] [CamAdaptiveDialog](../../src/components/cam/CamAdaptiveDialog.tsx): Adaptive operation geometry, boundaries, stock/cutting/passes/linking options, calculate/recalculate, valid preview and failed calculation.
- [ ] Associative chain selection, modeled chamfer selection, hole/face source picking, stock/bounds, point-pick overlay transition, and switching documents while an asynchronous result is pending.
- [ ] [CamToolDialog](../../src/components/cam/CamToolDialog.tsx): library browsing/filtering, compatible tool selection, tool kinds and geometry, cutting presets, create/edit, import/publish/delete, and nested picker over an operation. Cancel must restore the underlying operation draft.
- [ ] [CamLibrarySettings](../../src/components/cam/CamLibrarySettings.tsx): default/custom folder, use existing/copy current library, missing/corrupt data, path failure, concurrent revision change, and return to Settings.
- [ ] [CamMachineFields](../../src/components/cam/CamMachineFields.tsx) and [CamPostSettings](../../src/components/cam/CamPostSettings.tsx): machine/post selection and profile-specific fields, unavailable configuration and persisted assignment.
- [ ] [CamPostDialog](../../src/components/cam/CamPostDialog.tsx): program/post settings, custom post, warnings/preview, export path, NC generation failure and successful output.
- [ ] [CamGcodeSimulationDialog](../../src/components/cam/CamGcodeSimulationDialog.tsx): load/paste NC, dialect/configuration, invalid program, Cancel, and transition into NC simulation.
- [ ] Toolpath and stock simulation: operation/full setup selection, incoming/remaining stock, tool and holder, target comparison, collision warnings, accuracy/detail/budget choices, load/busy/error/no-result states.
- [ ] Simulation transport: play/pause/reset, previous/next step, timeline scrub, speed, current tool pose, camera motion and selection while calculating, returning to Program and refreshing a changed operation.
- [ ] [CamBusyIndicator](../../src/components/cam/CamBusyIndicator.tsx): status announcement, delayed pointer indicator, navigation responsiveness, cleanup after success/failure/cancel, and no stale indicator after switching tabs.
- [ ] Background/minimized calculation and queued edit followed by Save/Open/Exit: correct document receives the result, busy/presentation resources clear, no indefinite animation-frame barrier, and invalidated stock buffers are released.

CAM rendering and post previews must not imply machine execution safety has been validated. This baseline establishes interface and document behavior, not machine-specific post certification.

## Scripts, presentations, and guidance

Sources: [ScriptPanel](../../src/components/ScriptPanel.tsx), [ScriptPreview](../../src/components/ScriptPreview.tsx), [FeatureScriptPreview](../../src/components/FeatureScriptPreview.tsx), [PresentationControls](../../src/components/PresentationControls.tsx), [script workspace](../../src/scripts/workspace.ts), [recipe links](../../src/scripts/recipeLinks.ts), and [Rust script implementation](../../crates/script/src/lib.rs).

Route: File → Open Script, the Scripts/library entry, or a lesson card. `open_recipe` selects and opens the recipe; it does not implicitly execute it. Running a recipe starts a new design and must preserve the existing project and unsaved source.

- [ ] Scripts panel closed/open, library groups Start Here/Complete Designs/Feature Lessons/Assembly Lessons/Print and Fit Coupons, selected example, loading/error/no-selection state, and close/focus return.
- [ ] Open Script native picker and Load from file path details/input/Enter/Load, unsupported path, and opening a second source with dirty edits.
- [ ] Overview tab: native rendered preview, caption/description, chapter list/details, preview loading/failure and keyboard inspection/camera reset.
- [ ] Source tab: chapter selection, long editable source, selection/caret/clipboard/IME, validation success/error, Save As and dirty-source discard/save/cancel prompt.
- [ ] Run in new design at presentation and maximum speed, selected speed, Stop, script failure with useful step/context, final checks and completed status.
- [ ] Docked presentation bar: chapter, notes/caption, current operation, step/progress, Pause/Resume, Step, speed presets/custom speed and Maximum, Stop, finished/failed/stopped states.
- [ ] Close presentation controls without losing the run, reopen from chrome, keyboard focus, long captions, narrow/short windows, reduced motion and background execution.
- [ ] Sketch draw-in, extrusion/feature transition, assembly placement, camera change and caption synchronization in the actual model viewport. Validate the final model separately from the visible animation.
- [ ] Per-document playback/source ownership, queued control cancellation, close/reopen while running, and no source edits applied to an unrelated tab.

There is **no separate implemented Help/search panel in this baseline**. Existing offline guidance is embedded and exposed by [native MCP knowledge resources](../../mcp-server/src/knowledge.rs). Preserve that resource access and recipe/source links; a localized Help string or a future design note is not a rendered Help surface. A future Bevy guidance UI is new work and needs its own behavior and captures when implemented.

## Known placeholders and distinctions to preserve honestly

- The drawing Auto Layout capture (`57`) places a view over the title block. Keep the reserved sheet regions out of automatic view placement; copying these positions would preserve a defect.
- The CAM tool picker (`112`) renders selectable table rows that are missing from the MCP control inspection. Table/list items need the same semantic identity, selection and keyboard behavior as ordinary buttons.
- The default Face operation top offset of +0.2 mm fails its own depth-range validation in the captured setup (`113`). Changing only that offset to zero produces the toolpath (`113b`). Resolve the default/validation mismatch; do not turn off stock-bound checks. The error title also incorrectly calls this a file-operation failure.
- Adaptive CAM forms (`109`–`111`) and the long script source panel (`151`) allow their fixed footer to overlap lower fields. Scrolling, focus visibility and reserved footer space must work together in the replacement.
- Project Rename uses a blocking WebView prompt (`128`); Save As (`129`) and Print (`155`) also keep the current MCP request waiting for external input. The replacement must expose the pending user-input state and preserve cancellation. A timeout is not an accepted completed operation, and must not be described as script replay.
- Assembly motion playback and several driver controls are unnamed in MCP (`134`–`136`). Capture, play, pause, stop, scrub, driver binding and keyframe editing need meaningful labels.
- The repeated-bracket example finishes its scripted checks but the separate exact interference inspection reports a plate/spacer overlap of 1178.097 mm³ (`139`). It is useful as a diagnostic fixture, not a collision-free reference assembly. Recipe completion and collision validation are different claims.
- Recipe completion with the Scripts panel open leaves the model cropped (`130`). Reframing after layout changes must use the actually available viewport and preserve the user's deliberate camera choices.
- Live baseline capture found that an MCP click can acknowledge before a feature form's lazy contents mount: the immediate inspection for Revolve, Sweep, and Rib contained only Cancel/OK, while a later rendered capture showed the complete form. Capture owners must inspect again after the frame settles. The native conversion should make the distinction between accepted action and settled, inspectable presentation explicit; this timing gap must not become the new contract.
- Live capture also found unnamed close-X controls in Sweep, Loft, Rib, and Hole dialogs. Give them accessible names during conversion and retain a working Escape/Cancel route. Do not reproduce the missing labels as visual parity.
- The live body-appearance capture (`39-body-appearance`) exposes seven material controls in inspection but no visible panel in the image. Source confirms that `BodyAppearancePanel` is positioned over the native child without `data-native-viewport-overlay`. This is a native composition failure, not successful material-editor coverage; the converted panel must both paint and receive input.
- Live nested sketch-menu captures (`46` through `51`) similarly expose submenu items in inspection while showing only the highlighted parent in the images. `RibbonMenu` renders the flyout as an absolute `group-hover`/`group-focus-within` descendant without its own native overlay registration. The converted menu must render and hit-test its full visible flyout, including overflow beyond the parent. These captures document failure, not passing submenu parity.
- [CommentsPanel](../../src/components/CommentsPanel.tsx) is an inert collapsed placeholder with no implemented expansion/add-comment behavior. Capture it if visible; do not claim comment authoring exists. Removing it is a deliberate cleanup, not an accidental parity loss.
- Sketch Palette currently wires grid, snap, points, dimensions and constraints, plus separate Look At and ISO dimension style. Other listed options are intentionally disabled. Keep the distinction visible until a feature is actually implemented.
- NavBar display/grid settings buttons have no action; the catalog also contains disabled modeling tools, including Measure and Section Analysis. Consult live enabled state and catalog entries rather than interpreting every icon as a functioning command.
- A browser node, DTO variant, native command, or translation key does not by itself prove a reachable UI editor. When capture cannot reach a source state through the normal interface, record the reachability gap instead of fabricating a screen.
- Assembly occurrence context, exact drawing projection/reassociation, and manufacturing export are separate concerns. A successful rendered model does not establish their correctness.
- The native HUD lab and browser tests cover important components, but neither proves the complete live desktop, native pickers, real focus routing, or always-on MCP lifecycle.

## Validation to carry forward

Use the existing test organization and strengthen meaningful behavioral checks as each surface moves. Avoid a second exhaustive list of tool names or tests that merely duplicate catalog entries. Preserve failure, cancellation, ownership, persistence, and semantic inspection contracts even when DOM-based fixtures must be replaced.

- Existing [MCP contracts](../../xtask/mcp/contracts.mjs) and Rust/script checks remain the operation, resource, publication, replay and final-model boundary. Pair them with visible interaction tests; direct API success is not UI parity.
- [Settings](../../src/components/AppearanceDialog.browser.test.tsx), [Sketch Palette](../../src/components/SketchPalette.browser.test.tsx), [script surfaces](../../src/scripts/surfaces.browser.test.tsx), and [script ownership](../../src/scripts/documentOwnership.browser.test.ts) cover focused control and lifetime behavior.
- [Application exit](../../src/files/applicationExit.browser.test.ts), [save on exit](../../src/files/saveOnExit.browser.test.ts), [project save](../../src/files/projectSave.browser.test.ts), [open framing](../../src/files/openProjectFraming.browser.test.tsx), and [CAM ownership](../../src/cam/documentOwnership.browser.test.ts) cover document lifecycle boundaries that a renderer migration must not weaken.
- [Drawing fit](../../src/drawing/sheetFit.browser.test.tsx), [title block](../../src/drawing/titleBlock.browser.test.tsx), [projection presentation](../../src/drawing/projectionPresentation.browser.test.tsx), and drawing export/instance tests protect scale, transforms and drawing state.
- Existing [responsive ribbon](../../scripts/e2e-ribbon-responsive.mjs), [CAM editing](../../scripts/e2e-cam-browser-editing.mjs), [drawing](../../scripts/e2e-drawing.mjs), [joints](../../scripts/e2e-joints.mjs), and [project lifecycle](../../scripts/e2e-project-lifecycle.mjs) routes are starting points for live regression scenarios. Port the behavior, not an obligation to retain React selectors.

A surface is ready to retire from the old shell only after its normal route, error/cancel route, keyboard route, MCP semantics, persistence effects, and actual rendered evidence have been reviewed. Any intentionally removed placeholder must be listed as removed; any remaining functional gap must stay visible in the conversion review.
