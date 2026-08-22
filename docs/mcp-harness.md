# MCP harness notes

How agents and tests can drive noBS CAD **locally** through MCP.
This page separates **what exists today** from **proposed** architecture.
Proposals: [proposed-architecture.md](proposed-architecture.md).
Product directions: [goals.md](goals.md).

**Warning:** an MCP process without a live attach is a **fork of truth**.
It does **not** share the document the user is looking at. Snapshot attach
(`cad_list_sessions` / `cad_attach`) loads a **copy**. `cad_submit` queues a
UI-owned apply (`inbox/<seq>.json`); the desktop/engine is the only writer of
the live document. This is still **not** in-process shared memory, and MCP
must **not** write `model.json` back ([#11](https://github.com/jackControls/noBS-CAD/issues/11) remains open).

## Why MCP
MCP gives coding agents a tool API without turning noBS CAD into a cloud
service. The goal is a **strong local automation** surface for testing and
agent-driven modeling.
**Invariant:** no required cloud control plane. Automation stays on the user's
machine (or CI runner).

## Today (as-built on this branch)
| Topic | Current state |
|-------|----------------|
| Transport | **stdio** JSON-RPC (`nbcad-mcp`) — logs on **stderr** |
| Tools | **105** modeling tools + control/export helpers |
| Disclosure | Soft focus-scoped; `tools.listChanged: true`; ~300 ms throttle |
| Notify worker | Stdin reader thread + timed wake — `list_changed` / soft-TTL flush **without** a later client ping |
| Document | One persistent feature history **per MCP process** |
| Sessions | Snapshot attach + **UI-owned apply**: `cad_submit` writes `inbox/<seq>.json`; UI/engine applies via `host::handle`; MCP `cad_refresh` re-reads. Still **not** in-process shared memory. Live `model.json` writeback remains forbidden |
| Geometry | Same native OCCT replay path as desktop when OCCT is available |
| Export | STEP + STL + **3MF** (`solid_export_*`, `material_catalog`); 3MF preferred for slicers |

### Soft disclosure (not a jail)
Spine → active pack → soft packs (60 s TTL, LRU 2). Hidden tools stay
**callable**; results include `_disclosure`. Escape hatch: `full_static` or
`cad_list_all_tools`. Prefer `dynamic` for main agents.

### Focus packs
```text
document | sketch | solid | modify | body_ops | datums | history | inspect | print
```
Tags: `mcp-server/src/disclosure.rs` (`tags_for_tool`).

### Snapshot bridge + UI-owned apply (not in-process co-link)
Headless goldens work **without** attach (they still mutate the MCP process directly).
Desktop UI (Tauri) publishes:
`<NBCAD_SESSION_DIR>/<uuid>/{model.json,active-sketch.json?,focus.json,heartbeat.json}`
MCP `cad_submit` (attached only) writes `inbox/<seq>.json` with
`{ name, arguments, base_generation }`. A stale `base_generation` is
`generation_conflict` (`writeback: false`, `session_mode: ui_owned_apply`).
The desktop polls that inbox, applies via the same `host::handle` / solid-replay
path as Tauri IPC, then the existing publisher writes a new snapshot. MCP never
writes `model.json` (Jack removed last-writer-wins; do not bring it back).

While a sketch transaction is active, project export intentionally keeps the
last completed `model.json`; `active-sketch.json` carries the current
read-only entity/constraint snapshot so a desktop failure can still be
inspected without admitting half-finished history into the project format.
(atomic writes, generation-guarded). Session ids are **UUID v4**, not document names.
With attach:
1. `cad_list_sessions` — UUID dirs only (skips `_*-prefixed` control dirs); includes heartbeat `age_ms` / `stale`.
2. `cad_attach` — **requires** UUID v4 + valid `model.json`; loads a **copy** into this MCP process; optional `focus.json`. **Never writes `model.json` back.**
3. `cad_submit` — queues one modeling mutate in `inbox/<seq>.json`. Does not mutate the MCP in-memory document. Direct mutates while attached return structured `session_read_only`; inspect/export/control stay callable. Only names in the shared `nbcad-mcp-mutate` map are accepted.
4. UI/engine applies the inbox op against an **authoritative backend `engine_revision`** (advanced atomically with live apply / UI mutation notes — not heartbeat-debounce alone), then publishes a new snapshot. Failed applies are dead-lettered to `inbox/failed/` so the queue cannot wedge.
5. `cad_refresh` — explicit re-read of the attached session from disk (needed after apply+publish).
6. `cad_detach` — clears the attached session id.
This is **UI-owned apply**, not in-process shared memory. [#11](https://github.com/jackControls/noBS-CAD/issues/11) stays open. Installer / UI launch: [#32](https://github.com/jackControls/noBS-CAD/pull/32).
Build and tool flow: [mcp-server/README.md](../mcp-server/README.md).
Day-to-day playbook: [agent-mcp.md](agent-mcp.md).

### Stdio (current supported path)
Agents and CI spawn `nbcad-mcp` as an MCP stdio server. One process owns one
document. Prefer `solid_export_3mf` for slicer handoff; STEP for CAD interchange.

### Disclosure notify behavior
Focus / mode / soft-TTL changes schedule `notifications/tools/list_changed`.
The server wakes on that deadline even if the client is idle — it does **not**
require a later `ping` or tool call to flush the notification.

## Today vs target

| Capability | Today | Target | Issue |
|------------|-------|--------|-------|
| Agents and UI share one live document | **Not yet.** Submit/apply is UI-owned (`cad_submit` → inbox → engine `host::handle` → publisher). Still a snapshot copy, not in-process shared memory. Live `model.json` writeback remains forbidden | In-process co-link + writer lock | [#11](https://github.com/jackControls/noBS-CAD/issues/11) |
| Focus-scoped tools + `listChanged` | Soft disclosure + `tools.listChanged: true` (not a jail) | Same, plus contract tests | [#10](https://github.com/jackControls/noBS-CAD/issues/10) |
| Multi-window agent control | **No.** One MCP process, one document | Broker / `window_id` routing | [#12](https://github.com/jackControls/noBS-CAD/issues/12) |
| In-the-loop browser UI + MCP on the same doc | **No.** Blocked on co-link | Shared document in CI | [#15](https://github.com/jackControls/noBS-CAD/issues/15) |

## Proposed (not shipped here)
- In-process UI ↔ MCP co-link (same memory). UI-owned inbox apply is a file protocol, not that ([#11](https://github.com/jackControls/noBS-CAD/issues/11) still open)
- Multi-window broker ([#12](https://github.com/jackControls/noBS-CAD/issues/12))
- In-the-loop browser+MCP validation ([#15](https://github.com/jackControls/noBS-CAD/issues/15))
See [proposed-architecture.md](proposed-architecture.md).

## Tutor quests (CI goldens)

Three headless MCP quests score the first education path from
[#16](https://github.com/jackControls/noBS-CAD/issues/16).
They wrap the built-in print-in-place parts (`demo_export_pip_3mf`) —
the **cam bolt** and **drawer clip** — not a cube. Tests:
`tutor_quest_pip_*` in `cargo test --manifest-path mcp-server/Cargo.toml`
(Windows CI: `mcp-server.yml`). No `cad_attach`. The UI tutor that narrates
the same steps is still open on that issue.

| Quest | What you do | How CI scores it |
|-------|-------------|------------------|
| **Cam bolt** | `demo_export_pip_3mf` with `kind: cam_bolt` | 4 named bodies, 0.4 mm AABB clearance, ZIP/`PK` 3MF |
| **Drawer clip** | same tool with `kind: clip` | 3 named bodies, 0.4 mm clearance, ZIP/`PK` 3MF |
| **Slicer variants** | same cam bolt for each `slicer_target` | Bambu / Orca / Prusa / Cura / standard packages carry the right Metadata |

These are regression tests, not badges or streaks. The demo tool does not
mutate the headless document.
