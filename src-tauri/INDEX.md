# src-tauri index

| Path | Role |
|------|------|
| [src/lib.rs](src/lib.rs) | Tauri IPC + engine dispatch |
| [src/session_bridge.rs](src/session_bridge.rs) | Per-window UUID + reload-safe atomic snapshot publish for MCP |
| [Cargo.toml](Cargo.toml) | Native shell crate |

Session layout: `<NBCAD_SESSION_DIR>/<uuid>/{model,focus,heartbeat}.json`.
See [../docs/agentic/MAINTENANCE.md](../docs/agentic/MAINTENANCE.md).

Offscreen HUD lab (not the product GTK embed):

```sh
npm run dev:bevy-ui:capture
```

On Linux without a GPU this uses Mesa llvmpipe (CPU Vulkan) when `/usr/share/vulkan/icd.d/lvp_icd.json` is present. Output: `public/__bevy_ui__/native.png` (gitignored). Product Linux viewport is issue 48.
