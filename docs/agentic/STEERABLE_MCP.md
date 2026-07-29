# Steerable MCP — agent operating rules

## Invariants (do not break)

1. **Disclosure is guidance, not a jail.** Never reject `tools/call` with “not in focus.”
2. **Hard errors** = missing IDs, invalid sketch state, kernel failure only.
3. **Notification name** must stay exactly `notifications/tools/list_changed`.
4. **Stdout** = JSON-RPC only; logs on **stderr**.
5. **Headless goldens** must work without `cad_attach`.
6. **Offline/local** invariant; stdio is current transport, not forever law.
7. When adding a modeling tool: update `tags_for_tool` in `disclosure.rs` **and** the pack matrix test.

## Modes

| Mode | Who | Behavior |
|------|-----|----------|
| `dynamic` (default) | Main agent / human | Spine ∪ active ∪ soft packs |
| `full_static` | Subagents / broken clients | Advertise all tools |

Prefer `cad_list_all_tools` for planners over leaving the main session in `full_static`.

## Focus packs

`document | sketch | solid | modify | body_ops | datums | history | inspect | print`

Keep `disclosure::tags_for_tool` aligned when adding dialogs or export tools.

## Headless sessions (honest scope)

`cad_list_sessions` / `cad_attach` load a **read-only** snapshot from
`NBCAD_SESSION_DIR`. They do not co-link a live UI document. MCP and the
visible app still own separate documents unless/until in-process co-link ships.

## Print export

Prefer `solid_export_3mf` for slicers. Metadata targets (Bambu/Orca/Prusa/Cura)
are compatible hints — not a full pre-sliced project. STL is geometry-only.

## Related reading

- [mcp-harness.md](../mcp-harness.md)
- Issues [#10](https://github.com/jackControls/noBS-CAD/issues/10), [#11](https://github.com/jackControls/noBS-CAD/issues/11)
- MCP tools / listChanged: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
