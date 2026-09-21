# Bevy 0.20 code reduction experiment

- Branch: `codex/pr124-bevy-020-code-savings`
- Baseline: `ad01489d2bade99d41941d7def5495abced66fb4` (the Bevy 0.19.1 upgrade in PR #153)
- Investigated: 2026-09-21

## Result

The application ports to **0.20.0-rc.1** with small changes to text scrolling,
clipping and render receipts. This experiment removes **31 net lines** across
the changed production Rust files. It does not justify upgrading for code size
alone. Keep the 0.19.1 migration separate while evaluating the remaining widget
integration and platform behavior here.

The dependency versions are pinned to the exact release candidate. This is
still a [prerelease](https://github.com/bevyengine/bevy/releases/tag/v0.20.0-rc.1).
Bevy itself declares Rust 1.96.0, but the resolved WESL 0.4.4 dependencies require
1.97.1. This branch pins Rust 1.97.1 locally in `rust-toolchain.toml`; it does not
change the machine's default toolchain. The renderer dependency moves to wgpu 30.

## Implemented reductions

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

`bevy_ui_widgets` is a **test-only dependency**. The production event router
continues to use `EditableText`; enabling a second global text-input handler
would not be a safe code reduction. Passing the probes records the candidate's
current behavior; it does not establish UI parity.

## Validation

On macOS arm64 with OCCT 7.9.3:

- Native library: 291 passed, 2 existing ignored tests.
- Native startup: 2 passed.
- Candidate widget probes: 3 passed.
- Default desktop library: 177 passed, 2 existing ignored tests.
- Default desktop startup: 2 passed.
- Native application build passed; all targets with native-host and UI-lab
  features passed `cargo check`.

The six added production regressions cover read-only selection, provisional
IME history, scrolled pointer/IME coordinates, fully clipped controls, nested
clips at changed DPI, and rotated clipping for controls and panel occlusion.
Existing ownership, file lifecycle and modeling tests remain in the native run.

Reproduce from this worktree, with `OCCT_ROOT` set for the local installation:

```sh
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0
cargo test --locked --manifest-path src-tauri/Cargo.toml --features dev-bevy-host --tests --target-dir target/bevy-020
cargo test --locked --manifest-path src-tauri/Cargo.toml --tests --target-dir target/bevy-020
```

Live window, accessibility, system clipboard, OS IME, rendered submission and
visual parity have not been validated for this branch. These runs make no
performance claim. Windows and Linux have not been compiled or exercised here.

The local native executable is retained at `target/bevy-020-preview/nbcad` for
the deferred live check. Temporary build intermediates were removed to recover
disk space; they are recreated by the commands above. The executable is a local
artifact, not a tracked file or a distributable app bundle.

## Next experiments, in order

1. Validate rendering and actual text input on an unlocked Mac before treating
   this branch as an upgrade candidate; then run Windows and Linux checks.
2. Trial the new
   [`FeathersNumberInput`](https://github.com/bevyengine/bevy/blob/v0.20.0-rc.1/_release-content/release-notes/number_input.md)
   on one numeric control. It supports `f64` and scrubbing, but CAD unit/formula
   parsing and owned draft commits must remain intact. Measure the adapter and
   styling cost before converting more fields.
3. Only replace the text-input router after an adapter passes ordered typing /
   Tab / typing, IME / submit, stale-document, read-only, clipboard, undo and MCP
   tests without duplicate event delivery. Measure the final net deletion.
4. Revisit the upgrade decision after those results and a stable 0.20 release.
