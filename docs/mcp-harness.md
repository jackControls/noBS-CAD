# MCP harness notes

How agents and tests can drive noBS CAD **locally** through MCP.
This page separates **what exists today** from **proposed** architecture.
Proposals: [proposed-architecture.md](proposed-architecture.md).
Product directions: [goals.md](goals.md).

## Why MCP
MCP gives coding agents a tool API without turning noBS CAD into a cloud
service. The goal is a **strong local automation** surface for testing and
agent-driven modeling.
**Invariant:** no required cloud control plane. Automation stays on the user's
machine (or CI runner).

## Today (as-built on this branch)
| Topic | Current state |
|-------|----------------|
| Transport | **stdio** JSON-RPC (`nbcad-mcp`) — logs on **stderr** |
| Tools | **105** modeling tools + control/export helpers |
| Disclosure | Soft focus-scoped; `tools.listChanged: true`; ~300 ms throttle |
| Notify worker | Stdin reader thread + timed wake — `list_changed` / soft-TTL flush **without** a later client ping |
| Document | One persistent feature history **per MCP process** |
| Sessions | Read-only snapshot dirs: `cad_list_sessions` / `cad_attach` / `cad_refresh` / `cad_detach` |
| Geometry | Same native OCCT replay path as desktop when OCCT is available |
| Export | STEP + STL + **3MF** (`solid_export_*`, `material_catalog`); 3MF preferred for slicers |

### Soft disclosure (not a jail)
Spine → active pack → soft packs (60 s TTL, LRU 2). Hidden tools stay
**callable**; results include `_disclosure`. Escape hatch: `full_static` or
`cad_list_all_tools`. Prefer `dynamic` for main agents.

### Focus packs
```text
document | sketch | solid | modify | body_ops | datums | history | inspect | print
```
Tags: `mcp-server/src/disclosure.rs` (`tags_for_tool`).

### Read-only snapshot bridge (not live UI co-link)
Headless goldens work **without** attach.
Desktop UI (Tauri) publishes:
`<NBCAD_SESSION_DIR>/<uuid>/{model.json,focus.json,heartbeat.json}`
(atomic writes, generation-guarded). Session ids are **UUID v4**, not document names.
With attach:
1. `cad_list_sessions` — UUID dirs only (skips `_*-prefixed` control dirs); includes heartbeat `age_ms` / `stale`.
2. `cad_attach` — **requires** UUID v4 + valid `model.json`; loads into this MCP process; optional `focus.json`. **Never writes back.**
3. `cad_refresh` — explicit re-read of the attached session from disk.
4. `cad_detach` — clears the attached session id.
Revisioned MCP→UI sync remains future work. Installer / UI launch: [#32](https://github.com/jackControls/noBS-CAD/pull/32).
Build and tool flow: [mcp-server/README.md](../mcp-server/README.md).
Day-to-day playbook: [agent-mcp.md](agent-mcp.md).

### Stdio (current supported path)
Agents and CI spawn `nbcad-mcp` as an MCP stdio server. One process owns one
document. Prefer `solid_export_3mf` for slicer handoff; STEP for CAD interchange.

### Disclosure notify behavior
Focus / mode / soft-TTL changes schedule `notifications/tools/list_changed`.
The server wakes on that deadline even if the client is idle — it does **not**
require a later `ping` or tool call to flush the notification.

## Proposed (not shipped here)
- Live UI ↔ MCP in-process co-link / writer lock
- MCP client installer (`install-mcp`) and UI launch/window control
- Multi-window broker
See [proposed-architecture.md](proposed-architecture.md).
