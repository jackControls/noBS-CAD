# Agentic entry — `nbcad-bevy-viewport`

**Start here for humans and agents:**  
[`docs/bevy-viewport/README.md`](../../docs/bevy-viewport/README.md)

That guide is the curated source. This file is only the crate-local edit map.

## Touch map

| Goal | File |
|------|------|
| Session / CadMode States | `src/session.rs` |
| Feathers chrome | `src/chrome_ui.rs` |
| Hotkeys | `src/input_map.rs` |
| Solid mesh / grid | `src/viewport_mesh.rs` |
| Orbit / zoom | `src/camera_ctrl.rs` |
| Picking → session | `src/picking_bridge.rs` |
| Sim Virtual/Fixed | `src/sim/` |
| Plugin list | `src/app.rs` |
| Window / DefaultPlugins | `src/shell.rs` |
| Tessellation fixture | `src/soup.rs` |
| Trait boundary | `src/backend.rs` |

## Must pass

```bash
cargo test -p nbcad-bevy-viewport --lib
```

## Must not

- Add `nbcad_occt` here  
- Commit generated wasm/js under `web/`  
- Port the whole ribbon in this spike  

Also: [INDEX.md](INDEX.md) · [OKRS.md](OKRS.md) · [SPIKE.md](SPIKE.md)
