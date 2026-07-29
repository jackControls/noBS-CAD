# Agentic entry — Feathers on native Bevy

**Start:** [README.md](README.md) · **Issue:** #29 · **Baseline branch:** `Bevy-test`

## Touch map

| Goal | Where |
|------|--------|
| Native Bevy app / mesh / pick | `src-tauri/src/native_viewport/platform.rs` |
| Public DTOs / facade | `src-tauri/src/native_viewport/mod.rs` |
| Bevy features | `src-tauri/Cargo.toml` (`bevy_feathers` when added) |
| React bridge / overlay holes | `src/components/viewport/nativeViewportBridge.ts` |
| This plan | `docs/bevy-feathers-ui/` |

## Rules

1. Branch from **`Bevy-test`**, not from the #20 spike crates.  
2. Do not copy `nbcad-bevy-viewport` wholesale.  
3. Prefer one live Feathers surface before a full port.  
4. Keep OCCT + pick path green; Feathers is chrome only.  
5. Do not commit generated wasm/binaries.

## Prove

```bash
# from repo root / this worktree
cargo check -p nbcad   # or the src-tauri package name used on Bevy-test
# then run the desktop app and confirm mesh + one Feathers pane
```
