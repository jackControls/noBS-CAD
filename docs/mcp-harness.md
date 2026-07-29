# MCP harness notes

How agents and tests can drive noBS CAD **locally** through MCP.

This page separates **what exists today** from **proposed** architecture.
Proposals: [proposed-architecture.md](proposed-architecture.md).
Product directions: [goals.md](goals.md).

## Why MCP

MCP gives coding agents a tool API without turning noBS CAD into a cloud
service. The goal is a **strong local automation** surface for testing and
agent-driven modeling.

**Invariant:** no required cloud control plane. Automation stays on the user’s
machine (or CI runner).

## Today (as-built)

| Topic | Current state |
|-------|----------------|
| Transport | **stdio** JSON-RPC (`nbcad-mcp`) — supported local path |
| Tools | Large static list covering most sketch/solid ops; `tools.listChanged: false` |
| Document | One persistent feature history **per MCP process** |
| UI relationship | MCP and the visible UI own **separate documents** (same planner crates, different instances) |
| Geometry | Same native OCCT replay path as desktop for solid ops when OCCT is available |
| Print/export via MCP | Model JSON load/export tools exist; **no** 3MF MCP export yet |

Honest use today: treat headless MCP as an **engine / automation probe**, not as
proof that the open UI document changed.

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

## Proposed next (not shipped)

See [proposed-architecture.md](proposed-architecture.md) for detail:

1. **Focus-scoped tools** — `tools.listChanged: true` and
   `notifications/tools/list_changed` when focus changes.
2. **Co-link** MCP to **one** active UI document (first useful milestone).
3. **Multi-window broker** — deferred until use cases justify it (not P0).
4. **3MF + materials/colors** — target with testable scope.

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
