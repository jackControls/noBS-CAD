# Bevy 0.20 UI and code reduction experiment

- Branch: `feat/bevy-020-code-savings`
- Baseline: `ad01489d2bade99d41941d7def5495abced66fb4` (the Bevy 0.19.1 upgrade in PR #153)
- Investigated: 2026-09-21

## Result

The application runs on **0.20.0-rc.1** with a working native UI experiment:
grouped modeling tools, clearer feature forms, compact view controls and a
scrubbable Feathers numeric input controlling viewport lighting. The native
sketch, extrusion, editing, undo/redo and save/reopen workflow passes on macOS.

The initial compatibility port removed **31 net lines** across its changed
production Rust files. This subsequent UI experiment adds presentation and
integration code; it is not a further code reduction. BSN and Feathers are useful
building blocks, but upgrading alone does not improve the design or remove the
CAD input adapter. Keep this experiment separate from the 0.19.1 migration.

The dependency versions are pinned to the exact release candidate. This is
still a [prerelease](https://github.com/bevyengine/bevy/releases/tag/v0.20.0-rc.1).
Bevy itself declares Rust 1.96.0, but the resolved WESL 0.4.4 dependencies require
1.97.1. This branch pins Rust 1.97.1 locally in `rust-toolchain.toml`; it does not
change the machine's default toolchain. The renderer dependency moves to wgpu 30.

## Native UI experiment

- **BSN scene composition:** retained Create, Modify, Construct, Pattern and
  Assemble groups distribute existing command entities using flex layout.
  Their semantic control identities and controller bindings remain intact.
- **Presentation:** larger toolbar captions, slate surfaces with a blue accent,
  clearer feature headings and fields, an explicit primary Apply action, and a
  compact floating navigation bar. These are application design changes, not
  automatic benefits of the engine upgrade.
- **FeathersNumberInput:** the view-only Light control uses the real 0.20 scene
  component, `f64` values, soft/hard limits, precision, scrubbing and typed entry.
  Its `ValueChange` observer resolves and enqueues an owned controller action;
  the reducer validates the current document and binding before accepting a
  finite value in 0.25–2.00. MCP and accessibility expose the same accepted value.
- **Viewport lighting:** a camera-relative directional key and softer fill make
  adjacent model faces distinguishable. The Light control scales the studio rig
  without changing the camera, CAD model or saved file.
- **Input coexistence:** Feathers receives its pointer/text events while the
  CAD router excludes them. Publishing the existing accessibility proxies now
  preserves a focused Bevy text widget; native IME placement leaves that widget
  to Bevy. A regression covers this focus conflict found during live testing.

The native host enables BSN, Feathers, UI picking and custom cursors. The explicit
custom-cursor feature is needed for this release candidate's winit feature
combination. Only Feathers' core plugin is installed: global tab navigation
remains with the existing controller. CAD dimensions retain units, formulas and
ordered draft commits through the existing `EditableText` adapter.

The two new UI modules contain 427 lines including comments and tests. This is
an experiment in capabilities and presentation, not evidence that Feathers
reduces the current application's total code size.

## Initial port reductions (commit 23fe206)

| Production area | Baseline lines | Experiment lines | Net change |
| --- | ---: | ---: | ---: |
| `interface_shell/fields.rs` | 818 | 777 | -41 |
| `interface_shell.rs` plus new `interface_shell/geometry.rs` | 1,743 | 1,749 | +6 |
| `winit_host/submission.rs` | 51 | 55 | +4 |
| Total | 2,612 | 2,581 | **-31** |

Counts include comments and blank lines in these files. Tests, documentation,
manifests and lockfiles are excluded. Some field savings are ordinary cleanup
of duplicated checks, rather than capabilities unique to 0.20.

- Fields use `TextEdit::is_destructive()` for mutation classification and a
  single read-only gate. IME preedit remains provisional; committing it records
  the draft's undo boundary.
- `EditableText.viewport.offset` replaces the removed `TextScroll` component
  in pointer selection and IME positioning. Native fields explicitly require
  the UI layout components that `TextInputPlugin` would otherwise supply.
- Controls and painted panels share `HitArea`, which uses the renderer's
  public `clip_polygon` function and `CalculatedClip::contains_point`.
  Inspection publishes the clipped polygon's enclosing rectangle; pointer
  input checks the actual shape. Nested transforms, fully clipped nodes and
  unbounded overflow axes use the same clipping rules as Bevy's renderer.
- Render receipts query the primary `ExtractedWindow` component after the
  removal of the `ExtractedWindows` resource. They still require both swapchain
  texture and view; semantic layout alone cannot certify submission.

## Why the full text adapter remains

The new [`TextInput`](https://github.com/bevyengine/bevy/blob/v0.20.0-rc.1/crates/bevy_ui_widgets/src/text_input.rs)
does not replace our document ownership, commit validation, rejected-draft
handling, draft undo/redo, MCP equivalence or event ordering. The three executable
probes in `src-tauri/tests/bevy_020_widgets.rs` confirm these integration limits:

1. Ordinary typing queues an edit without immediately changing the buffer.
   An owned submit still needs an explicit flush before reading the value.
2. With AltGr represented by Control/Alt/AltGraph, or Option represented by Alt,
   the candidate does not insert the supplied character text. Our adapter needs
   to preserve those input paths. This is a synthetic event probe, not a claim
   of validation with every operating system's keyboard event sequence.
3. Batched IME delivery uses the focus present when the Bevy system runs.
   Changing focus after queuing a commit delivers it to the later field.
   The controller must preserve the original document/control owner and process
   typing, focus changes and model actions in their original order.

The direct `bevy_ui_widgets` dependency supports the probes; the native host now
also enables those widgets through Feathers for the isolated lighting control.
The CAD event router continues to use `EditableText`. Existing CAD fields do not
carry `TextInput`, so Bevy's widget handler does not also edit those fields.
Passing the probes records the candidate's current behavior; it does not
establish general input parity.

## Validation

On macOS arm64 with OCCT 7.9.3:

- Native library: 293 passed, 2 existing ignored tests.
- Native startup: 2 passed.
- Candidate widget probes: 3 passed.
- Default desktop library: 177 passed, 2 existing ignored tests.
- Default desktop startup: 2 passed.
- Native application build passed. The initial port also passed `cargo check`
  for all targets with native-host and UI-lab features.
- Native macOS window, dark appearance, 1360 × 860 logical pixels: inspected
  the feature preview, finished model, grouped toolbar and lighting control.
- The 14-step native lifecycle passed: New, rectangle sketch, invalid distance,
  preview, Apply, edit preview, Cancel, edit Apply, Undo, Redo, Save, close, open,
  and independent cold archive recomputation. The final solid was 35 mm high.
- Real pointer-selected text entry committed Light = 1.35. Real mouse scrubbing
  changed it to 2.00; before/after camera values and the exported model hash were
  identical. MCP restored the default value of 1.00.

The six added production regressions cover read-only selection, provisional
IME history, scrolled pointer/IME coordinates, fully clipped controls, nested
clips at changed DPI, and rotated clipping for controls and panel occlusion.
Existing ownership, file lifecycle and modeling tests remain in the native run.
The UI phase adds finite/range validation and native/Feathers focus regressions.

Reproduce from this worktree, with `OCCT_ROOT` set for the local installation:

```sh
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0
cargo test --locked --manifest-path src-tauri/Cargo.toml --features dev-bevy-host --tests --target-dir target/bevy-020
cargo test --locked --manifest-path src-tauri/Cargo.toml --tests --target-dir target/bevy-020
cargo run --locked --manifest-path src-tauri/Cargo.toml --features dev-bevy-host --bin nbcad --target-dir target/bevy-020
```

Live evidence was collected from an isolated native macOS app bundle using the
built `nbcad` executable and a private session directory, not browser rendering.
The lifecycle fixture is `xtask test-mcp native-lifecycle`; its JSON report and
screenshots are local artifacts, not tracked product assets.

One immediate capture after reopening omitted several group-caption glyphs and
part of the numeric text. The subsequent live window and a settled native
capture rendered them correctly. The cause is not established; capture/text
invalidation through document transitions remains an upgrade gate.

This is not full accessibility, system clipboard, modifier-key or OS IME
certification for Feathers. These runs make no performance claim. The new UI
has not been exercised on Windows or Linux, and minimum-size/DPI coverage is
still pending.

## Next experiments, in order

1. Resolve the transient glyph/capture discrepancy through document transitions;
   check the supported minimum window size and changed DPI, then Windows/Linux.
2. Extend the Feathers numeric trial only after keyboard shortcuts, clipboard,
   assistive technology and OS IME work with the existing event ordering. Keep
   CAD unit/formula parsing and owned draft commits intact; measure integration
   cost before converting dimension fields.
3. Only replace the text-input router after an adapter passes ordered typing /
   Tab / typing, IME / submit, stale-document, read-only, clipboard, undo and MCP
   tests without duplicate event delivery. Measure the final net deletion.
4. Revisit the upgrade decision after those results and a stable 0.20 release.
