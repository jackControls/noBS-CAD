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
.../mcp-server/target/release/nbcad-mcp
```

Needs native OCCT (`OCCT_ROOT` when not in a default install). Logs stay on
**stderr**.

## Session habits

1. Keep **one** MCP process for a headless golden or experiment.
2. Read `cad_document` / `solid_scene` before editing.
3. Use stable IDs from scene/status for later ops.
4. Default **`dynamic`** disclosure; call `cad_set_focus` as you model.
5. Subagents: `full_static` or `cad_list_all_tools`.
6. Tutor / UI snapshot path: `cad_list_sessions` → `cad_attach` → inspect →
   `cad_refresh`. Attach is inspect-only (mutations rejected). `cad_detach`
   to fork and edit in memory. No writeback. Goldens do not require attach.

Soft disclosure: out-of-focus tools stay **callable**; results may include
`_disclosure`.

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
yet. **STEP:** `solid_export_step` (AP242 base64).

## Failures

Include in issues: tool name, args, last success, error text, OS, and whether
you used UI attach (`cad_attach`) or a headless-only session.
