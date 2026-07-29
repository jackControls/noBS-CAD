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

## Today (as-built)

| Topic | Current state |
|-------|----------------|
| Transport | **stdio** JSON-RPC (`nbcad-mcp`) — supported local path; logs on **stderr** |
| Tools | Soft focus-scoped disclosure; `tools.listChanged: true` |
| Notification | `notifications/tools/list_changed` (300 ms throttle) |
| Document | One persistent feature history **per MCP process** |
| UI co-link | File bridge: `cad_list_sessions` / `cad_attach` (`NBCAD_SESSION_DIR`) |
| Geometry | Same native OCCT replay path as desktop for solid ops when OCCT is available |
| Export | `solid_export_step` (AP242 base64). No 3MF MCP export yet |

### Soft disclosure (not a jail)

Spine → active pack → soft packs (60 s TTL, LRU 2). Hidden tools stay
**callable**; results include `_disclosure`. Escape hatch: `full_static` or
`cad_list_all_tools`. Prefer `dynamic` for main agents.

### Focus packs

```text
document | sketch | solid | modify | body_ops | datums | history | inspect | print
```

Tags: `mcp-server/src/disclosure.rs` (`tags_for_tool`).

Honest use: headless MCP remains valid for CI goldens without attach. With
`cad_attach`, MCP can load the UI-published session snapshot; without attach,
MCP owns its own document.

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

Stdio is the **current** supported local transport. It is not declared an
irreversible forever architecture choice—local/offline behavior is the
invariant; internal IPC may evolve with engineering evidence.

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
| print | `solid_export_step` |

Spine controls (`cad_get_focus`, mode, catalog, sessions, …) stay advertised in every pack.

### Client compatibility

| Client behavior | Recommended mode |
|-----------------|------------------|
| Honors `notifications/tools/list_changed` | `dynamic` (default) |
| Ignores mid-session list changes | `full_static` or poll `cad_list_all_tools` |
| Planner / subagent needs full catalog once | `cad_list_all_tools` without leaving `dynamic` |

Indexes / OKRs / agent ops: [INDEX.md](INDEX.md), [OKRs.md](OKRs.md), [agentic/INDEX.md](agentic/INDEX.md).

### Install into agent clients

```powershell
cargo run -p xtask -- install-mcp
```

Detects Cursor / VS Code / Claude / OpenCode / Grok user configs and upserts
`nobs-cad`. Guide: [agentic/INSTALL_MCP.md](agentic/INSTALL_MCP.md).

### Headless vs UI

MCP is **headless by default**. Optional spine tools:

| Tool | Role |
|------|------|
| `cad_launch_ui` | Detach-spawn desktop app (needs built `nbcad` / `NBCAD_UI_EXE`) |
| `cad_ui_status` | Tracked UI pid + sessions |
| `cad_ui_window` | focus / show / hide / move / resize via `_ui/control.json` |

Guide: [agentic/UI_LAUNCH.md](agentic/UI_LAUNCH.md). Live multi-window broker is backlog.

## Build

```sh
cargo test --manifest-path mcp-server/Cargo.toml
```

Requires OCCT 7.9.x (`OCCT_ROOT` or `vcpkg_installed/x64-windows`).

## Proposed next (not shipped)

See [proposed-architecture.md](proposed-architecture.md) for detail:

1. **In-process shared document** with the live UI (file bridge v1 ships today).
2. **Multi-window broker** — deferred until use cases justify it (not P0).
3. **3MF + materials/colors** — target with testable scope.

## Rust boundaries (for automation work)

| Crate area | Role |
|------------|------|
| `core`, `sketch`, `solid` | Host-neutral model logic |
| `occt` | Native geometry adapter |
| `wasm` | Browser adapter path |

## Related projects (ideas, check licenses)

| Project | Why it matters |
|---------|----------------|
| [Open CAD Studio](https://github.com/HakanSeven12/OpenCADStudio) | Rust CAD + headless act→observe→act automation (**GPL-3** — ideas, not code copy) |
| [FreeCAD](https://www.freecad.org/) | Mature open parametric CAD |
| [SolveSpace](https://solvespace.com/) | Compact constraint CAD |
| [OpenSCAD](https://openscad.org/) | Code-first solids |
| [Cascade Studio](https://github.com/zalo/CascadeStudio) | Browser OCCT experiments |
| [replicad](https://github.com/sgenoud/replicad) | TypeScript OCCT wrapper |
| [AI-CAD](https://github.com/vespo92/AI-CAD) | Parametric CAD with an MCP server (different stack) |

## Related docs

- [goals.md](goals.md)
- [proposed-architecture.md](proposed-architecture.md)
- [agent-mcp.md](agent-mcp.md)
- [mcp-server/README.md](../mcp-server/README.md)

On Windows, put `vcpkg_installed/x64-windows/bin` on `PATH` so OCCT DLLs load.
