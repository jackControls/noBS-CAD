# ADR 0006 — Focus-scoped dynamic MCP (stdio harness)

- Status: Proposed
- Date: 2026-07-27

## Context

Agentic CAD is a main goal. Today `nbcad-mcp` speaks MCP over **stdio** (good:
local, offline) but advertises `listChanged: false` and returns a large static
tool list (~101 tools). That floods model context and invites wrong calls.

MCP supports dynamic tools: declare `tools.listChanged`, then send
`notifications/tools/list_changed` when the set changes; clients re-fetch
`tools/list` ([spec](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)).
Common use cases include auth and **context-dependent tools** (only show what
the current context allows).

We also want the harness pattern used elsewhere locally: phase/focus gates
where tools **arrive and are removed** as the system focus changes.

## Decision (proposed)

1. **MCP is the primary agent harness.** UI shares the engine; agents prefer MCP.
2. **stdio remains the required local transport.** No cloud gateway required.
3. Introduce an explicit **focus** state (document / sketch / solid / modify /
   history / print — names TBD).
4. `tools/list` returns only tools valid for current focus (+ a tiny always-on spine).
5. On focus change: update the set, set `listChanged: true`, notify clients.
6. Keep granular tools for precision; add goal-level tools in the right focus.
7. Print focus includes **3MF with materials/colors** as a core export path.

## Consequences

- Rewrite tool registry in `mcp-server` around focus.
- Clients that ignore `list_changed` will see stale tools — document the need
  for a client that refreshes (Cursor and compliant MCP clients).
- Tests must cover list snapshots per focus and notification emission.
- Open CAD Studio’s headless act→observe→act loop remains a pattern reference;
  wire format stays MCP.

## Acceptance sketch

- [ ] `initialize` advertises `tools.listChanged: true`
- [ ] Default focus tool count is small (spine + document)
- [ ] Entering sketch focus adds sketch tools and drops unrelated creators
- [ ] Notification fired on each focus change
- [ ] Stdio still works with zero network
- [ ] Docs: `docs/mcp-harness.md`, AGENTS.md, README stay aligned
