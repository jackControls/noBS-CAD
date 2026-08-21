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
6. Optional UI snapshot: `cad_list_sessions` → `cad_attach` → inspect.
   Mutates while attached go through `cad_submit` (inbox; UI applies).
   `cad_refresh` after the UI publishes. Goldens do not require attach.
   Do not write `model.json` from MCP.

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
| Cam bolt | `demo_export_pip_3mf` `{kind:"cam_bolt"}` — 4-body print-in-place (`tutor_quest_pip_cam_bolt`) |
| Drawer clip | `{kind:"clip"}` — 3-body captive clip (`tutor_quest_pip_clip`) |
| Slicer variants | same cam bolt for bambu / orca / prusa / cura / standard (`tutor_quest_pip_slicer_variants`) |

CI scores those three as headless goldens (see
[mcp-harness.md](mcp-harness.md#tutor-quests-ci-goldens)).
`demo_export_pip_3mf` does not mutate the document. Prefer
`solid_export_3mf` for your own bodies; `solid_export_step` for CAD interchange.

## Failures

Include in issues: tool name, args, last success, error text, OS, and whether
you used UI attach (`cad_attach`) or a headless-only session.
