# ADR 0006 — Focus-scoped MCP and UI co-link (proposed)

- Status: Proposed
- Date: 2026-07-27
- Related: [docs/proposed-architecture.md](../proposed-architecture.md),
  [docs/mcp-harness.md](../mcp-harness.md)
- Tracking (discussion): focus [#10](https://github.com/jackControls/noBS-CAD/issues/10),
  co-link [#11](https://github.com/jackControls/noBS-CAD/issues/11);
  multi-window [#12](https://github.com/jackControls/noBS-CAD/issues/12) is
  **deferred** (not P0)

## Context

Today `nbcad-mcp` speaks MCP over **stdio** (good: local, offline) but:

1. Advertises `tools.listChanged: false` with a large static tool list (~100 tools).
2. Owns an **independent** document from the UI (fork of truth).

MCP supports dynamic tools via `tools.listChanged` and
`notifications/tools/list_changed`
([spec](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)).

## Decision (proposed)

### A. Focus-scoped tools

1. MCP is a serious local automation surface; agents prefer it for automation/tests.
2. **stdio** is the **current** supported local transport. Offline/local is the
   invariant; internal IPC may evolve with evidence.
3. Explicit **focus** state: document / sketch / solid / modify / history / print.
4. `tools/list` returns only tools valid for current focus (+ tiny always-on spine).
5. On focus change: update set, `listChanged: true`, send
   `notifications/tools/list_changed`.
6. Keep granular tools; optional goal-level tools in the right focus.
7. Print focus eventually includes **3MF** with useful materials/colors (target).

### B. Co-link MCP ↔ one active UI document

1. First useful milestone: attach MCP to one live UI/engine session.
2. v1: explicit attach + writer lock / clear conflict errors.
3. Headless MCP without UI remains valid for CI goldens.

### C. Multi-window broker — deferred

Not a P0 product requirement. Revisit if real use cases justify routing by
`window_id` / `document_id`.

## Consequences

- Prototype focus tools and co-link before treating them as required product behavior.
- Long design prose stays in `docs/proposed-architecture.md` / `docs/mcp-harness.md`.
- Tests should cover focus list snapshots and, later, attach behavior.

## Acceptance sketch

- [ ] `initialize` → `tools.listChanged: true`
- [ ] Notification name is exactly `notifications/tools/list_changed`
- [ ] Default focus tool count is small
- [ ] Attach to one UI session; MCP op visible in UI (prototype)
- [ ] Stdio still works offline; docs do not claim irreversible IPC forever
- [ ] Multi-window not required for the first co-link milestone
