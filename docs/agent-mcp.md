# Agent MCP playbook

`nbcad-mcp` is the **direct AI harness** for this CAD. Use it for automation, golden scenarios, and bug reproduction.

## Setup

Build (needs native OCCT 7.9.x / `OCCT_ROOT`):

```sh
cargo build --release --manifest-path mcp-server/Cargo.toml
```

Point your MCP client at the release binary (see `mcp-server/README.md`).

## Modeling rhythm

1. `sketch_begin` with an explicit `plane`
2. `sketch_add_*` + constraints
3. `sketch_finish` → `sketch_profiles`
4. Solid op (`solid_extrude`, `solid_revolve`, …)
5. Inspect with `solid_scene` / `cad_document`
6. Secondary ops with **stable IDs** from the scene

Keep one MCP process for the whole part so history stays coherent.

## Golden scenarios (seed)

Agents should leave a short note in the PR when they add a scenario:

| ID | Goal | Outline |
|----|------|---------|
| G1 | Box | rectangle sketch → extrude → scene body count 1 |
| G2 | Hole | box → planar face hole → scene shows void |
| G3 | Revolve | line+axis profile → revolve → solid |

Expand these into scripted fixtures under `mcp-server` or `scripts/` in follow-up PRs.

## Goal-level tools (roadmap)

Today tools are granular (good for fidelity). Prefer adding **goal** tools next (`make_box`, `export_3mf`, `quest_*`) that compose granular ops and return before/after telemetry — without removing the granular surface.

## Failure reporting

When MCP fails, include in the issue:

- tool name + args
- last successful tool
- `cad_document` / error payload
- OS and `nbcad-mcp` build identity
