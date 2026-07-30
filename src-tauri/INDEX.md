# src-tauri index

| Path | Role |
|------|------|
| [src/lib.rs](src/lib.rs) | Tauri IPC + engine dispatch |
| [src/session_bridge.rs](src/session_bridge.rs) | Atomic UUID snapshot publish for MCP |
| [Cargo.toml](Cargo.toml) | Native shell crate |

Session layout: `<NBCAD_SESSION_DIR>/<uuid>/{model,focus,heartbeat}.json`.
See [../docs/agentic/MAINTENANCE.md](../docs/agentic/MAINTENANCE.md).
