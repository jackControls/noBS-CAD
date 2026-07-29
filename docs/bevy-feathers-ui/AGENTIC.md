# Feathers on native Bevy — agent notes

**Docs:** [README.md](README.md) · **Issue:** #29 · **Base:** `Bevy-test`

| Task | Path |
|------|------|
| Bevy mesh / pick / HUD | `src-tauri/src/native_viewport/platform.rs` |
| DTOs / facade | `src-tauri/src/native_viewport/mod.rs` |
| Bevy features | `src-tauri/Cargo.toml` |
| React bridge / holes | `src/components/viewport/nativeViewportBridge.ts` |

Rules: branch from `Bevy-test`; do not copy spike crates; one Feathers pane before a full port; keep OCCT + picks green.
