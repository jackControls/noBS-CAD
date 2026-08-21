# MCP harness notes

How agents and tests can drive noBS CAD **locally** through MCP.
This page separates **what exists today** from **proposed** architecture.
Proposals: [proposed-architecture.md](proposed-architecture.md).
Product directions: [goals.md](goals.md).

**Warning:** an MCP process without a live attach is a **fork of truth**.
It does **not** share the document the user is looking at. Snapshot attach
(`cad_list_sessions` / `cad_attach`) is read-only and still a copy, not
in-process co-link ([#11](https://github.com/jackControls/noBS-CAD/issues/11)).

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
| Tools | **107** modeling tools + control/export helpers |
| Disclosure | Soft focus-scoped; `tools.listChanged: true`; ~300 ms throttle |
| Notify worker | Stdin reader thread + timed wake — `list_changed` / soft-TTL flush **without** a later client ping |
| Document | One persistent feature history **per MCP process** |
| Sessions | Read-only snapshot dirs: `cad_list_sessions` / `cad_attach` / `cad_refresh` / `cad_detach` |
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

### Read-only snapshot bridge (not live UI co-link)
Headless goldens work **without** attach.
Desktop UI (Tauri) publishes:
`<NBCAD_SESSION_DIR>/<uuid>/{model.json,active-sketch.json?,focus.json,heartbeat.json}`

While a sketch transaction is active, project export intentionally keeps the
last completed `model.json`; `active-sketch.json` carries the current
read-only entity/constraint snapshot so a desktop failure can still be
inspected without admitting half-finished history into the project format.
(atomic writes, generation-guarded). Session ids are **UUID v4**, not document names.
With attach:
1. `cad_list_sessions` — UUID dirs only (skips `_*-prefixed` control dirs); includes heartbeat `age_ms` / `stale`.
2. `cad_attach` — **requires** UUID v4 + valid `model.json`; loads into this MCP process; optional `focus.json`. **Never writes back.**
3. `cad_refresh` — explicit re-read of the attached session from disk.
4. `cad_detach` — clears the attached session id.
Revisioned MCP→UI sync remains future work. Installer / UI launch: [#32](https://github.com/jackControls/noBS-CAD/pull/32).
Build and tool flow: [mcp-server/README.md](../mcp-server/README.md).
Day-to-day playbook: [agent-mcp.md](agent-mcp.md).

### Stdio (current supported path)
Agents and CI spawn `nbcad-mcp` as an MCP stdio server. One process owns one
document. Prefer `solid_export_3mf` for slicer handoff; STEP for CAD interchange.

### Disclosure notify behavior
Focus / mode / soft-TTL changes schedule `notifications/tools/list_changed`.
The server wakes on that deadline even if the client is idle — it does **not**
require a later `ping` or tool call to flush the notification.

### STEP import and forward scripts
`solid_import_step` (and `solid_edit_import_step`) load a licensed STEP/STP
file as a **reference solid**: the kernel stores the source bytes and
tessellates a dumb body. Scripts are **recorded forward** via `cad_script`
(`{ "calls": [ { "name", "arguments" } ] }` of successful mutating
`tools/call` entries). We do **not** reverse-engineer sketch/extrude feature
history from STEP B-rep. After modeling (or after importing a reference),
`cad_compare_solids` summarizes `solid_scene` mesh bbox + vertex/triangle
counts so a rebuilt history can be checked against the imported solid.

## Today vs target

| Capability | Today | Target | Issue |
|------------|-------|--------|-------|
| Agents and UI share one live document | **No.** MCP is a fork of truth (optional read-only snapshot attach, never writes back) | In-process co-link + writer lock | [#11](https://github.com/jackControls/noBS-CAD/issues/11) |
| Focus-scoped tools + `listChanged` | Soft disclosure + `tools.listChanged: true` (not a jail) | Same, plus contract tests | [#10](https://github.com/jackControls/noBS-CAD/issues/10) |
| Multi-window agent control | **No.** One MCP process, one document | Broker / `window_id` routing | [#12](https://github.com/jackControls/noBS-CAD/issues/12) |
| In-the-loop browser UI + MCP on the same doc | **No.** Blocked on co-link | Shared document in CI | [#15](https://github.com/jackControls/noBS-CAD/issues/15) |

## Proposed (not shipped here)
- Live UI ↔ MCP in-process co-link / writer lock ([#11](https://github.com/jackControls/noBS-CAD/issues/11))
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
