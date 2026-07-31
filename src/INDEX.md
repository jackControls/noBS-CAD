# src/ (UI) index

| Path | Role |
|------|------|
| [main.tsx](main.tsx) | React app bootstrap + snapshot bridge start |
| [sessionBridge.ts](sessionBridge.ts) | Read-only MCP snapshot publisher (Tauri-owned window session) |
| [store/](store/) | App state (mode, tool, document, solids) |
| [engine/](engine/) | Host-neutral CAD core (TS) |
| [files/projectFiles.ts](files/projectFiles.ts) | Project open/save/import/export and crash recovery |
| [files/projectTabs.ts](files/projectTabs.ts) | Multi-document tab sessions over one hydrated OCCT/Bevy engine |

Focus mapping for steerable MCP: `sessionBridge.focusFromUi` ↔ `mcp-server/src/disclosure.rs`.
See [../docs/agentic/STEERABLE_MCP.md](../docs/agentic/STEERABLE_MCP.md).
