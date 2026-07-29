# Agentic guidance index

Committed operating docs for humans and coding agents working on noBS CAD.
**Do not** add root `AGENTS.md` / `.cursor/rules` to git (project policy).

| Doc | Purpose |
|-----|---------|
| [INSTALL_MCP.md](INSTALL_MCP.md) | Install `nbcad-mcp` into Cursor / VS Code / Claude / OpenCode / Grok |
| [UI_LAUNCH.md](UI_LAUNCH.md) | Headless vs UI launch, window commands, backlog |
| [STEERABLE_MCP.md](STEERABLE_MCP.md) | Invariants for soft disclosure + co-link |
| [MAINTENANCE.md](MAINTENANCE.md) | Build, OCCT, test, PR checklist |
| [COMPLETION.md](COMPLETION.md) | Plan vs achieved for steerable MCP |
| [../OKRs.md](../OKRs.md) | Measurable objectives |
| [../mcp-harness.md](../mcp-harness.md) | Public as-built MCP notes |

## Code truth

| Path | Owns |
|------|------|
| `mcp-server/src/disclosure.rs` | Focus packs, soft TTL, tags |
| `mcp-server/src/session.rs` | File-bridge sessions |
| `mcp-server/src/main.rs` | Tool registry, RPC, goldens |
| `src/sessionBridge.ts` | UI → session publisher |
| `src-tauri/src/lib.rs` `mcp_session_bridge_write` | Native write path |
| `xtask/src/install_mcp.rs` | Client detect + upsert installer |
