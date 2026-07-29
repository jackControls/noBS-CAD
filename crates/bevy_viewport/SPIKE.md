# Bevy viewport spike (#20)

**Status:** exploratory spike on Bevy **0.19.0**  
**ADR:** [0002 Bevy as viewport / ECS subsystem](https://github.com/jackControls/noBS-CAD/pull/5) (proposed; deferred behind MCP co-link)  
**Non-goals (honored):** no ribbon rewrite, no mesh-only CAD, no Tauri embed yet, OCCT remains B-rep truth.

## What this crate is

`nbcad-bevy-viewport` implements a small `ViewportBackend` trait and a Bevy app that:

1. Accepts a host-neutral `TessellatedTriangleSoup` (fixture unit cube today).
2. Draws it with PBR/unlit materials plus a sanity-check built-in cuboid and ground plane.
3. Orbits with **RMB drag**, zooms with **scroll**, reports mesh **picks** on click.
4. Shares one binary (`bevy_desktop`) for native desktop and `wasm32-unknown-unknown`.

`nbcad-bevy-launcher` chooses the target:

```bash
cargo run -p nbcad-bevy-launcher -- --target desktop
cargo run -p nbcad-bevy-launcher -- --target wasm
```

Wasm path: `cargo build --target wasm32-unknown-unknown` → `wasm-bindgen --target web` into [`web/`](web/) → local HTTP serve (`py -3 -m http.server`).

## Validation evidence (2026-07-28)

| Path | Result |
|------|--------|
| Unit tests | `cargo test -p nbcad-bevy-viewport --lib` — 3 passed |
| Desktop | `bevy_desktop` release binary launched and stayed alive (window process healthy for 8s before intentional stop) |
| Wasm build | `cargo build -p nbcad-bevy-viewport --bin bevy_desktop --target wasm32-unknown-unknown` succeeded |
| Wasm in browser | Served `crates/bevy_viewport/web`; init completed; after camera orbit fix, ground/mesh visible in Cursor browser WebGL/WebGPU |

### Bugs found and fixed during spike

- **Orbit camera sign error:** placing the camera with `rotation * +Z` looked away from the fixture. Fixed to `target - transform.forward() * distance` (matches Bevy’s `camera_orbit` example). Without this fix the clear color and UI could appear while the mesh sat behind the camera.

### Limits / risks

- **Debug wasm is huge (~380 MB).** Release builds are required for practical web use; document size in any future product path.
- **`wasm-server-runner` install failed on this Windows host** (aws-lc needs cmake/NASM). Launcher uses `wasm-bindgen-cli` + Python HTTP instead.
- **Shadows off on the spike** for backend portability; CAD viewport will want controlled lighting later.
- **Not wired into Tauri / Three.js replacement.** ADR phase 2+.
- **Picking is mesh-entity level**, not stable OCCT face IDs. Face/edge identity must stay in the Rust kernel.

## Kill / continue criteria (for ADR 0002)

**Continue** if: Bevy can stay a pure display/ECS shell fed by OCCT tessellation, picking can map back to kernel IDs, and binary/feature flags stay manageable for desktop.

**Kill or narrow** if: Bevy pressure pushes mesh-only modeling, forces a ribbon rewrite, or wasm/desktop parity costs more than keeping Three.js on web + a thinner native renderer.

## License note

Bevy is MIT OR Apache-2.0. See root [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) for the spike entry. Full crate inventory remains in `Cargo.lock`.
