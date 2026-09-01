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
| Tools | Modeling tools + control/export helpers (includes `cad_await_apply`) |
| Disclosure | Soft focus-scoped; `tools.listChanged: true`; ~300 ms throttle |
| Notify worker | Stdin reader thread + timed wake — `list_changed` / soft-TTL flush **without** a later client ping |
| Document | One persistent feature history **per MCP process** |
| Sessions | Snapshot attach + **UI-owned apply**: `cad_submit` writes `inbox/<seq>.json`; UI/engine applies via `host::handle`; MCP `cad_await_apply` waits for apply receipt + publisher snapshot (optional refresh). Still **not** in-process shared memory. Live `model.json` writeback remains forbidden |
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
with **identity-bound** fields `session_id` (UUID), `window_id` (Tauri label),
and `document_id` / `project_session_id` (native project tab). Publish write
still requires the reserved identity — a delayed write from tab/window A cannot
land in B's session.
MCP `cad_submit` (attached only) writes `inbox/<seq>.json` with
`{ name, arguments, base_generation }` plus optional identity stamps
`session_id` / `window_id` / `document_id` taken from the attached published
session. A stale `base_generation` is `generation_conflict`; a stamped op whose
`session_id` / `window_id` does not match the destination apply binding is
`session_identity_mismatch` and is dead-lettered (`writeback: false`,
`session_mode: ui_owned_apply`) so later seqs stay unwedged. Unstamped ops keep
compat apply behavior. Attach+submit is isolated per published window/session
(tested); this is still **not** a live multi-window broker. The desktop polls
that inbox, applies via the same `host::handle` / solid-replay path as Tauri
IPC, then the existing publisher writes a new snapshot. MCP never writes
`model.json` (Jack removed last-writer-wins; do not bring it back).

While a sketch transaction is active, project export intentionally keeps the
last completed `model.json`; `active-sketch.json` carries the current
read-only entity/constraint snapshot so a desktop failure can still be
inspected without admitting half-finished history into the project format.
(atomic writes, generation-guarded). Session ids are **UUID v4**, not document names.
With attach:
1. `cad_list_sessions` — UUID dirs only (skips `_*-prefixed` control dirs); includes heartbeat `age_ms` / `stale`, plus `window_id` / `document_id` when published. `windows[]` is **one entry per live process/window pair** with `documents[]` plus an authoritative `active_document_id` recorded by the native tab transition (never inferred from heartbeat order). Desktop processes renew independent leases under `_ui/processes/`; a process/window disappears after the lease expires or is removed at shutdown. Inactive tabs stay listed regardless of their own heartbeat age while their owning process lease is fresh; prior-run and closed tabs do not. Multiple concurrently running desktop processes remain independently visible.
2. `cad_attach` — target by `session_id` and/or `window_id` and/or `document_id` (UUID `document_id` remains a session alias). All provided selectors are **intersected** before ambiguity is reported. Requires valid `model.json`; loads a **copy** into this MCP process; optional `focus.json`. **Never writes `model.json` back.**
3. `cad_submit` — queues one modeling mutate in `inbox/<seq>.json`. Does not mutate the MCP in-memory document. Direct mutates while attached return structured `session_read_only`; inspect/export/control stay callable. Only names in the shared `nbcad-mcp-mutate` map are accepted.
4. UI/engine applies the inbox op against an **authoritative backend `engine_revision`** (advanced atomically with live apply / UI mutation notes — not heartbeat-debounce alone), then publishes a new snapshot. Failed applies are dead-lettered to `inbox/failed/` so the queue cannot wedge. Successful applies archive to `inbox/applied/<seq>.json`.
5. `cad_await_apply` — poll until the submit seq has an applied/failed receipt; for applied, also wait until the publisher heartbeat is past `kind: engine_revision` (so `model.json` is ready). Optional `refresh` (default true) then reloads the attached snapshot. `timeout_ms: 0` is a single status probe. This closes the manual `cad_refresh` race for agents; it is still **not** in-process shared memory.
6. `cad_refresh` — explicit re-read of the attached session from disk (still available; prefer `cad_await_apply` after submit).
7. `cad_detach` — clears the attached session id.
This is **UI-owned apply**, not in-process shared memory. [#11](https://github.com/jackControls/noBS-CAD/issues/11) stays open. Installer / UI launch: [#32](https://github.com/jackControls/noBS-CAD/pull/32).
Build and tool flow: [mcp-server/README.md](../mcp-server/README.md).
Day-to-day playbook: [agent-mcp.md](agent-mcp.md).

### Stdio vs broker matrix ([#12](https://github.com/jackControls/noBS-CAD/issues/12) second slice)
| Mode | Transport | Document scope | How to target |
|------|-----------|----------------|---------------|
| **Stdio headless (CI/goldens)** | one `nbcad-mcp` process | one in-memory document | no attach; call modeling tools directly |
| **Stdio + snapshot attach** | one `nbcad-mcp` process | one attached snapshot at a time | `cad_list_sessions` → `cad_attach` by `session_id` / `window_id` / `document_id`; `cad_submit` stamps identity and cannot clobber another published window's inbox/model |
| **Broker (not shipped)** | future router over windows | many live windows | Option B product lean; still TBD |

Stdio remains the supported offline path. List/target plus operate-without-clobber
are tested on the snapshot bridge; this is still **not** a live multi-window
broker and does not require UI changes beyond the existing identity-bound
publisher. [#11](https://github.com/jackControls/noBS-CAD/issues/11) in-process
co-link remains open.

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
`tools/call` entries). `cad_script` is **portable modeling ops only**:
session-control reads (`cad_attach` / `cad_refresh` / `cad_detach`) are not
recorded. Successful attach/refresh **clear and seed** the forward trace with
`cad_load_project_model` carrying the loaded `model_json` (refresh replaces
that baseline the same way), so a dumped script replays on a fresh CadServer
without ephemeral session UUIDs or external snapshot files. Inspect/export
helpers and failed calls are also skipped. We do **not** reverse-engineer sketch/extrude feature
history from STEP B-rep. After modeling (or after importing a reference),
`cad_compare_solids` summarizes `solid_scene` mesh bbox + vertex/triangle
counts so a rebuilt history can be checked against the imported solid.

## Today vs target

| Capability | Today | Target | Issue |
|------------|-------|--------|-------|
| Agents and UI share one live document | **Not yet.** Submit/apply is UI-owned (`cad_submit` → inbox → engine `host::handle` → publisher). `cad_await_apply` waits for apply receipt + publish before refresh. Still a snapshot copy, not in-process shared memory. Live `model.json` writeback remains forbidden | In-process co-link + writer lock | [#11](https://github.com/jackControls/noBS-CAD/issues/11) |
| Focus-scoped tools + `listChanged` | Soft disclosure + `tools.listChanged: true` (not a jail) | Same, plus contract tests | [#10](https://github.com/jackControls/noBS-CAD/issues/10) |
| Multi-window agent control | **Partial.** List/attach by `session_id` / `window_id` / `document_id`; attach+submit isolated per published window (identity-stamped inbox; mismatch dead-letters). Stdio still one doc per process; **not** a live broker | Broker / live `window_id` routing | [#12](https://github.com/jackControls/noBS-CAD/issues/12) |
| In-the-loop browser UI + MCP on the same doc | **No.** Blocked on co-link | Shared document in CI | [#15](https://github.com/jackControls/noBS-CAD/issues/15) |

## Slice note (`cad_await_apply`)
Agents used to `cad_submit` then race a manual `cad_refresh`. `cad_await_apply`
polls `inbox/applied/<seq>.json` / `inbox/failed/<seq>.json` and, on success,
waits until the publisher heartbeat is past the native `kind: engine_revision`
bump so refresh loads the new `model.json`. Still UI-owned file protocol —
[#11](https://github.com/jackControls/noBS-CAD/issues/11) remains open until
true in-process shared memory.

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
