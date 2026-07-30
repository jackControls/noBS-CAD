# ADR 0002 — Native Bevy viewport boundary

- Status: Accepted
- Date: 2026-07-30
- Tracking: [#20](https://github.com/jackControls/noBS-CAD/issues/20)

## Context

The desktop viewport needs native GPU rendering, accurate picking, low-latency
camera input, Retina / HiDPI correctness, and a path toward CAM simulation.
Putting those responsibilities in the webview couples the most performance-
sensitive part of the application to browser rendering and native-view
composition.

Bevy must **not** replace OCCT. Solids remain B-rep; Bevy displays tessellated
meshes, handles camera/picking/gizmos/3D-mouse, and hosts selection visualization.

React remains valuable for the document shell, accessibility, browser
automation, and form-heavy workflows. A production boundary therefore needs
to preserve DOM semantics without drawing the same viewport control twice.

## Decision

The desktop application uses four explicit layers:

1. **OCCT and the Rust document model are authoritative.** OCCT creates and
   edits B-rep geometry. Tessellation, topology IDs, sketch geometry, and
   presentation state are passed in-process to the viewport.
2. **Bevy owns the complete viewport surface.** This includes meshes, edges,
   sketches, datum/origin geometry, picking, camera navigation, transient
   previews, selection highlighting, the orientation dial, viewport prompt,
   status/readout cards, and the bottom navigation bar.
3. **React owns the application shell and command forms.** Ribbon, browser,
   project tabs, timeline, menus, and form-heavy feature dialogs remain DOM
   elements. Transparent DOM proxies retain keyboard, pointer, accessibility,
   and browser-test semantics for Bevy-owned viewport controls.
4. **Tauri owns native composition.** The Bevy surface is an opaque native
   child beneath the webview. The platform host clips the webview around the
   viewport while preserving real DOM islands such as menus and dialogs above
   it. CSS transparency is not used as the compositor contract.

Bevy UI is built from the stable core `bevy_ui` flex/grid primitives. The
experimental, unstyled `bevy_ui_widgets` crate is not a production dependency.
`ViewportUiTheme` and the component builders in
`src-tauri/src/native_viewport/ui.rs` are the canonical style implementation
for native viewport UI.

The bridge sends explicit palette, HUD, interaction, camera, and presentation
state. It does not send screenshots or serialized OCCT geometry through
JavaScript.

## Visual regression channel

The `dev-ui-lab` Cargo feature builds a headless, GPU-backed Bevy render target
using the same production UI builders as the embedded viewport. The capture is
served by a development-only Vite route beside a React reference surface:

```text
npm run dev:bevy-ui:capture
npm run dev
http://127.0.0.1:5173/?bevy-ui-lab=compare
```

The lab may include a representative feature dialog to validate that the Bevy
style system can reproduce the shared visual language. It is a visual contract,
not a second command-form implementation.

## Consequences

- Clear boundary: OCCT = truth, Bevy = presentation/interaction.
- Viewport-local pixels no longer depend on webview/native-view overlap.
- React keeps the DOM surfaces that benefit most from accessibility and agent
  inspection.
- Native controls and transparent DOM proxies require stable control IDs.
- The Rust desktop binary is larger; Bevy features remain explicitly selected.
- The visual lab is feature-gated and excluded from production binaries.
- License audit into `THIRD_PARTY_NOTICES.md` before merge.
- 3Dconnexion / 6DoF input can move closer to Rust HID paths already in Tauri.

## Non-goals

- Rewriting the ribbon, browser, timeline, menus, or command forms in Bevy
- Mesh-only modeling
- Maintaining a second browser renderer for the desktop viewport
- Using the visual regression image as the production renderer
