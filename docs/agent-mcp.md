# MCP playbook (day to day)

Practical notes for driving the **as-built** headless MCP server.

Design / proposals: [mcp-harness.md](mcp-harness.md),
[proposed-architecture.md](proposed-architecture.md).

## Setup (stdio, local)

```sh
cargo build --release --manifest-path mcp-server/Cargo.toml
```

Point the MCP client at:

```text
…/mcp-server/target/release/nbcad-mcp
```

Needs native OCCT (`OCCT_ROOT` when not in a default install). Logs stay on
**stderr**.

## Honest session habit

1. Keep **one** MCP process for a headless golden or experiment.
2. Read `cad_document` / `solid_scene` before editing.
3. Use stable IDs from scene/status for later ops.
4. Do **not** assume the desktop/browser UI shows the same document — today it
   does not.

Focus-scoped tool lists and UI attach are **proposed**, not shipped.

## Basic modeling loop

1. `sketch_begin` on a plane
2. Add geometry + constraints
3. `sketch_finish` → `sketch_profiles`
4. `solid_extrude` / other `solid_*` tools
5. Inspect with `solid_scene` / `cad_document`

## Small recipes

| Name | Idea |
|------|------|
| Box | rectangle → extrude → one body |
| Hole | box → hole on a face |

Print-ready **3MF** with materials/colors is a **target**, not available via MCP
yet.

## Failures

Include in issues: tool name, args, last success, error text, OS, and whether
you expected UI co-link (not supported yet).
