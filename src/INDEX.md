# src/ (UI) index

| Path | Role for steerable MCP |
|------|------------------------|
| [sessionBridge.ts](sessionBridge.ts) | Publishes UI session → `NBCAD_SESSION_DIR` |
| [main.tsx](main.tsx) | Calls `startSessionBridge()` |
| [store/](store/) | App state (mode, tool, document, solids) |
| [engine/](engine/) | Host-neutral CAD core (TS) |

Focus mapping must stay aligned with `mcp-server/src/disclosure.rs` (`focus_from_ui`).
See [../docs/agentic/STEERABLE_MCP.md](../docs/agentic/STEERABLE_MCP.md).
