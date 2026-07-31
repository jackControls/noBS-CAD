# mcp-server index

| Path | Role |
|------|------|
| [README.md](README.md) | Build / run / Cursor config |
| [OKRs.md](OKRs.md) | MCP-specific OKRs |
| [Cargo.toml](Cargo.toml) | Crate deps |
| [src/main.rs](src/main.rs) | Tool registry, RPC, goldens |
| [src/disclosure.rs](src/disclosure.rs) | Soft focus packs + tags |
| [src/session.rs](src/session.rs) | UUID snapshot dirs + heartbeat list metadata |
| [src/ffi.rs](src/ffi.rs) | OCCT FFI glue |
| [build.rs](build.rs) | Link / OCCT discovery |

Upstream product docs: [../docs/mcp-harness.md](../docs/mcp-harness.md), [../docs/agentic/STEERABLE_MCP.md](../docs/agentic/STEERABLE_MCP.md).

Client installer / UI launch are follow-ups (#32). Revisioned MCP→UI sync is future work.
