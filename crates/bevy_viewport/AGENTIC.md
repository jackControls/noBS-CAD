# Agentic guidance — Bevy viewport spike

Root `AGENTS.md` / `CLAUDE.md` are **gitignored** in this repo. This file is the committed agent entry for `nbcad-bevy-viewport` + `nbcad-bevy-launcher`.

## Before you edit

1. Read [INDEX.md](INDEX.md) and [OKRS.md](OKRS.md).
2. Re-skim [SPIKE.md](SPIKE.md) kill criteria — do not turn this into mesh-only CAD.
3. Geometry truth stays in OCCT / `nbcad_solid`. This crate only consumes `TessellatedTriangleSoup`.

## How to change code safely

| Goal | Touch |
|------|--------|
| Soup schema / fixture | `src/soup.rs` + lib tests |
| Trait / backend name | `src/backend.rs` |
| Plugins / window / wasm backends | `src/app.rs` |
| Spawned entities / materials | `src/scene.rs` |
| Orbit / zoom | `src/camera.rs` (+ keep look-at unit test green) |
| Pick UX | `src/picking.rs` |
| Launcher flags / serve | `../bevy_launcher/` |

Keep modules small. Prefer adding a file over growing `lib.rs`.

## Validation required on every PR touching these crates

```bash
cargo test -p nbcad-bevy-viewport --lib
cargo check -p nbcad-bevy-launcher
# Smoke (manual or short process):
cargo run -p nbcad-bevy-viewport --bin bevy_desktop
# Optional wasm (release preferred):
cargo run -p nbcad-bevy-launcher -- --target wasm --release
```

Update SPIKE.md validation table when evidence changes. Update OKRS.md KR status when objectives move.

## Do not

- Depend on `nbcad_occt` from this crate (keeps spike buildable without vcpkg).
- Rewrite ribbon UI in Bevy.
- Commit generated `web/bevy_desktop*.wasm` / `.js`.
- Claim face-stable picking until kernel IDs are plumbed.

## Related systems (vision)

- Later: feed real `KernelBodyDto` positions/indices from OCCT tessellation.
- Later: orthographic projection for CAD accuracy.
- Later: map `Pointer` hits → face/edge IDs via triangle→topology tables owned by the kernel.
- Parallel: MCP co-link (#11/#12) remains higher priority than productizing Bevy.
