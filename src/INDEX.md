# src/ (UI) index

| Path | Role |
|------|------|
| [main.tsx](main.tsx) | React app bootstrap + snapshot bridge start |
| [sessionBridge.ts](sessionBridge.ts) | Read-only MCP snapshot publisher (UUID) |
| [store/](store/) | App state (mode, tool, document, solids, mcpSessionId) |
| [engine/](engine/) | Host-neutral CAD core (TS) |

Focus mapping for steerable MCP: `sessionBridge.focusFromUi` ↔ `mcp-server/src/disclosure.rs`.
See [../docs/agentic/STEERABLE_MCP.md](../docs/agentic/STEERABLE_MCP.md).
