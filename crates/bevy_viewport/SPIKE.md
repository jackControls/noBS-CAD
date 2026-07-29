# Bevy viewport spike (#20)

**Status:** engine-grade shell rebuild on Bevy **0.19.0** (plugins / States / Virtual+Fixed)  
**ADR:** [0002 Bevy as viewport / ECS subsystem](https://github.com/jackControls/noBS-CAD/pull/5) (proposed; deferred behind MCP co-link)  
**Non-goals (honored):** no ribbon rewrite, no mesh-only CAD, no Tauri embed yet, OCCT remains B-rep truth.

## What this crate is

`nbcad-bevy-viewport` implements a small `ViewportBackend` trait and a Bevy app that:

1. Accepts a host-neutral `TessellatedTriangleSoup` (fixture unit cube today).
2. Draws it with PBR materials, a reference grid, and a Solid-mode fixture.
3. Orbits with **RMB drag**, zooms with **scroll**, reports mesh **picks** on click (Solid).
4. Runs a **game-time** structural mock in Simulate (`Time<Virtual>` + `FixedUpdate` @ 64 Hz).
5. Shares one binary (`bevy_desktop`) for native desktop and `wasm32-unknown-unknown`.

`nbcad-bevy-launcher` chooses the target (interactive menu or `--target`):

```bash
cargo run -p nbcad-bevy-launcher
cargo run -p nbcad-bevy-launcher -- --target desktop
cargo run -p nbcad-bevy-launcher -- --target experimental --release
```

Wasm path: `cargo build --target wasm32-unknown-unknown --profile wasm-release` → `wasm-bindgen --target web` → optional `wasm-opt -Os` → local HTTP serve. Writes `web/LAUNCH_URL.txt`.

## Architecture

```text
ShellPlugin
  ├─ SessionPlugin     CadMode States + CadSession + messages
  ├─ ViewportMeshPlugin soup mesh + solid layer + grid
  ├─ CameraPlugin      orbit + mode bookmarks (scroll = zoom)
  ├─ PickingBridgePlugin
  ├─ ChromeUiPlugin    Feathers product chrome
  ├─ InputMapPlugin
  └─ SimPlugin         Virtual clock + Fixed bend + present
```

Invariant unchanged: **OCCT = B-rep truth**. Bevy is display/ECS/sim visualization only.

## Validation evidence (2026-07-29 rebuild)

| Path | Result |
|------|--------|
| Unit tests | `cargo test -p nbcad-bevy-viewport --lib` — cube, backend, empty reject, orbit look-at, **fixed dt**, **pause freezes bend**, load response |
| Desktop smoke | `bevy_desktop` launched and stayed alive (Simulate default) |
| Wasm build | `wasm32-unknown-unknown` **wasm-release** succeeded |
| Feature prune | `default-features = false` + `3d` + `ui` + `bevy_feathers` (no audio) |
| Wasm size | See measured table below |

### Measured wasm size (release)

| Artifact | Size | Notes |
|----------|------|-------|
| Prior default-features release `.wasm` | ~**115–123 MB** | Pre-rebuild baseline |
| `wasm-release` `bevy_desktop.wasm` | **37.8 MB** | LTO + `codegen-units=1` + `opt-level=s` |
| After `wasm-bindgen` `bevy_desktop_bg.wasm` | **34.7 MB** | Served to browser |
| `wasm-opt -Os` | optional | Not on PATH on the measurement host; launcher runs it when available |

Target band from the rebuild plan: ~15–40 MB. **34.7 MB** is inside that band.

### Limits / risks

- **Still large for a “tiny” web demo** — further cuts need dropping glTF/post-process/LUTs deliberately (custom feature set beyond the `3d` profile).
- **Sim is a mock**, not FEA / OCCT stress.
- **Shadows off** on the spike for backend portability.
- **Not wired into Tauri / Three.js replacement.** ADR phase 2+.
- **Picking is mesh-entity level**, not stable OCCT face IDs.

## Kill / continue criteria (for ADR 0002)

**Continue** if: Bevy can stay a pure display/ECS shell fed by OCCT tessellation, picking can map back to kernel IDs, and binary/feature flags stay manageable for desktop (+ acceptable experimental wasm).

**Kill or narrow** if: Bevy pressure pushes mesh-only modeling, forces a ribbon rewrite, or wasm/desktop parity costs more than keeping Three.js on web + a thinner native renderer.

## License note

Bevy is MIT OR Apache-2.0. See root [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) for the spike entry. Full crate inventory remains in `Cargo.lock`.
