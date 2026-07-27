# ADR 0006 — Focus-scoped dynamic MCP, co-link, multi-window

- Status: Proposed
- Date: 2026-07-27
- Tracking: [#10](https://github.com/jackControls/noBS-CAD/issues/10) focus ·
  [#11](https://github.com/jackControls/noBS-CAD/issues/11) co-link ·
  [#12](https://github.com/jackControls/noBS-CAD/issues/12) multi-window
- Working design: `docs/mcp-harness.md` (do not fork long prose into this ADR)

## Context

Agentic CAD is a main goal. Today `nbcad-mcp` speaks MCP over **stdio** (good:
local, offline) but:

1. Advertises `listChanged: false` with a large static tool list (~100 tools).
2. Owns an **independent** document from the UI (fork of truth).
3. Has no `window_id` / multi-document routing story (Tauri is a single
   `main` window today).

MCP supports dynamic tools via `tools.listChanged` and
`notifications/tools/list_changed`
([spec](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)).

## Decision (proposed)

### A. Focus-scoped tools (#10)

1. MCP is the primary agent harness; agents prefer it over UI clicking.
2. **stdio** remains the required local transport. No cloud gateway required.
3. Explicit **focus** state: document / sketch / solid / modify / history / print.
4. `tools/list` returns only tools valid for current focus (+ tiny always-on spine).
5. On focus change: update set, `listChanged: true`, notify clients.
6. Keep granular tools; add goal-level tools in the right focus.
7. Print focus includes **3MF with materials/colors** as a core export path.

### B. Co-link MCP ↔ UI (#11)

1. Product path: MCP attaches to a live engine/UI session (`cad_list_sessions`,
   `cad_attach` with `document_id`, optional `window_id`).
2. v1: explicit attach + writer lock / clear conflict errors (no silent merge).
3. Headless MCP (no UI) remains valid for CI goldens — one process, one doc.

### C. Multi-window (#12)

1. Multiple open windows/documents are a **central** requirement.
2. **Product default:** one stdio **broker** routes by `window_id` / `document_id`.
3. **CI/headless:** one MCP process per document remains OK.
4. Shell must grow beyond a single Tauri `main` capability/window.

## Consequences

- Rewrite tool registry in `mcp-server/` around focus; add session/attach APIs.
- Shared session store (or IPC into Tauri `AppState`) — same `SketchManager`,
  not a second copy.
- Clients that ignore `list_changed` see stale tools — document refresh need.
- Tests: focus list snapshots + notification; later attach/isolation tests.
- Open CAD Studio act→observe→act is a **pattern** reference only (**GPL-3** —
  no code copy; [#19](https://github.com/jackControls/noBS-CAD/issues/19)).

## Acceptance sketch

### Focus (#10)

- [ ] `initialize` → `tools.listChanged: true`
- [ ] Default focus tool count is small (spine + document)
- [ ] Sketch focus adds sketch tools; unrelated creators hidden
- [ ] Notification on each focus change
- [ ] Stdio works with zero network

### Co-link (#11)

- [ ] Attach to running UI session from MCP
- [ ] MCP solid op → body visible in UI
- [ ] Conflict behavior documented and tested

### Multi-window (#12)

- [ ] Two windows listed via MCP
- [ ] Ops on A do not mutate B
- [ ] Docs describe broker vs per-window matrix

### Docs

- [ ] `docs/mcp-harness.md`, AGENTS.md, README stay aligned (no duplicate ADR prose)
