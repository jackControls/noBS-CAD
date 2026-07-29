# Steerable MCP — agent operating rules

## Invariants (do not break)

1. **Disclosure is guidance, not a jail.** Never reject `tools/call` with “not in focus.”
2. **Hard errors** = missing IDs, invalid sketch state, kernel failure only.
3. **Notification name** must stay exactly `notifications/tools/list_changed`.
4. **Stdout** = JSON-RPC only; logs on **stderr**.
5. **Headless goldens** must work without UI or `cad_attach`.
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

UI mapping lives in `src/sessionBridge.ts` (`focusFromUi`) and
`disclosure::focus_from_ui` — keep them aligned when adding dialogs.

## Co-link honesty

File-bridge v1 ≠ live shared memory. After attach, MCP loads `model.json`;
UI must republish for agents to see UI edits. Deeper #11 sharing is separate work.

## Related reading

- Issues [#10](https://github.com/jackControls/noBS-CAD/issues/10), [#11](https://github.com/jackControls/noBS-CAD/issues/11), epic [#9](https://github.com/jackControls/noBS-CAD/issues/9)
- MCP tools / listChanged: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
