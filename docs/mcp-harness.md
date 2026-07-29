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

## Today (as-built on `feat/3mf-print-export`)

| Topic | Current state |
|-------|----------------|
| Transport | **stdio** JSON-RPC (`nbcad-mcp`) — logs on **stderr** |
| Tools | **105** modeling tools + control/export helpers |
| Disclosure | Soft focus-scoped; `tools.listChanged: true`; 300 ms throttle |
| Document | One persistent feature history **per MCP process** |
| Sessions | `cad_list_sessions` / `cad_attach` — read-only load from `NBCAD_SESSION_DIR` |
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

Headless MCP remains valid for CI goldens without attach. With `cad_attach`, MCP
loads a snapshot from a session directory — not a live UI document.

Build and tool flow: [mcp-server/README.md](../mcp-server/README.md).
Day-to-day playbook: [agent-mcp.md](agent-mcp.md).

### Stdio (current supported path)

```text
Client spawns nbcad-mcp
  → JSON-RPC on stdin
  → JSON-RPC on stdout
  → logs on stderr only
```

```json
{
  "mcpServers": {
    "nbcad": {
      "command": "/absolute/path/to/nbcad-mcp"
    }
  }
}
```

Stdio is the **current** supported local transport. Offline/local behavior is
the invariant; internal IPC may evolve with engineering evidence.

### Pack → representative tools (CI-guarded)

| Pack | Must advertise (active) |
|------|-------------------------|
| document | `cad_project_model` |
| sketch | `sketch_begin` |
| solid | `solid_extrude` |
| modify | `solid_fillet` |
| body_ops | `solid_shell` |
| datums | `construction_plane_offset` |
| history | `solid_delete_feature` |
| inspect | `solid_scene` |
| print | `solid_export_3mf` (also STL / STEP / `material_catalog`) |

Spine controls (`cad_get_focus`, mode, catalog, sessions, …) stay advertised in every pack.

### Client compatibility

| Client behavior | Recommended mode |
|-----------------|------------------|
| Honors `notifications/tools/list_changed` | `dynamic` (default) |
| Ignores mid-session list changes | `full_static` or poll `cad_list_all_tools` |
| Planner / subagent needs full catalog once | `cad_list_all_tools` without leaving `dynamic` |

Agent ops: [agentic/INDEX.md](agentic/INDEX.md), [mcp-server/OKRs.md](../mcp-server/OKRs.md).

### 3MF / slicer Metadata (honest scope)

3MF carries tessellated geometry (mm), per-body color/material, and optional
slicer Metadata (Bambu/Orca/Prusa/Cura). These are **compatible hints** for
import — not a full pre-sliced G-code project or guaranteed vendor filament match.

## Build

```sh
cargo test --manifest-path mcp-server/Cargo.toml
```

Requires OCCT 7.9.x (`OCCT_ROOT` or `vcpkg_installed/x64-windows`).

## Proposed next (not shipped)

See [proposed-architecture.md](proposed-architecture.md):

1. **In-process shared document** with the live UI.
2. **Multi-window broker** — deferred until use cases justify it.

## Rust boundaries (for automation work)

| Crate area | Role |
|------------|------|
| `core`, `sketch`, `solid` | Host-neutral model logic |
| `occt` | Native geometry adapter |
| `export` | 3MF/STL writers, material catalog |
| `wasm` | Browser adapter path |

## Related docs

- [goals.md](goals.md)
- [proposed-architecture.md](proposed-architecture.md)
- [agent-mcp.md](agent-mcp.md)
- [mcp-server/README.md](../mcp-server/README.md)

On Windows, put `vcpkg_installed/x64-windows/bin` on `PATH` so OCCT DLLs load.
