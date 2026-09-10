# MCP harness notes

How agents and tests can drive noBS CAD **locally** through MCP.
This page separates **what exists today** from **proposed** architecture.
Proposals: [proposed-architecture.md](proposed-architecture.md).
Product directions: [goals.md](goals.md).

An unattached MCP process owns a headless document. To drive the document in
an open desktop window, use `cad_list_sessions` and `cad_attach`, or launch
through `cad_interface`. Attached modeling operations automatically route to
the desktop engine through the shared interface. The desktop owns live edits
and publishes completed-model snapshots for MCP inspection and export; MCP
never writes those `model.json` files back.

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
| Tools | Modeling tools + control/export helpers (includes `cad_await_apply`, `cad_session_status`) |
| Disclosure | Soft focus-scoped; `tools.listChanged: true`; ~300 ms throttle |
| Notify worker | Stdin reader thread + timed wake — `list_changed` / soft-TTL flush **without** a later client ping |
| Document | One persistent feature history **per MCP process** |
| Sessions | Attached modeling operations use the live engine automatically. `cad_session_status` observes the loaded completed-model generation, current publisher generation, heartbeat and inbox receipts. `cad_submit` / `cad_await_apply` expose the same apply protocol for explicit queue control. Active-sketch reads use the live engine; completed-model reads use the last loaded snapshot |
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

### Live operations and completed-model snapshots
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
(tested). The desktop polls that inbox, applies via the same `host::handle` / solid-replay path as Tauri
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
3. Call a modeling operation directly, or use `cad_interface` with `action: execute` and its catalog group. On a current attached desktop, both routes submit to the live engine, wait for the receipt and publication, and return the engine result. A desktop without interface version 1 is rejected before submission. For explicit queue control, `cad_submit` queues one operation from the shared `nbcad-mcp-mutate` map without changing the MCP read snapshot.
4. UI/engine applies the inbox op against an **authoritative backend `engine_revision`** (advanced atomically with live apply / UI mutation notes — not heartbeat-debounce alone), then publishes a new snapshot. Failed applies are dead-lettered to `inbox/failed/` so the queue cannot wedge. Successful applies archive to `inbox/applied/<seq>.json`.
5. `cad_await_apply` — poll until the submit seq has an applied/failed receipt; for applied, also require an explicit `published_generation` equal to the current engine generation. Keepalives preserve that fence and cannot masquerade as a publish. If `model_generation` matches, optional `refresh` (default true) reloads the completed model. While a sketch transaction is active, the publisher advances `active_sketch_generation` but intentionally retains the previous completed `model.json`; await returns `model_published:false`, `active_sketch_published:true`, and `refreshed:false`. `timeout_ms: 0` is a single status probe. This closes the manual `cad_refresh` race for agents; it is still **not** in-process shared memory.
6. `cad_session_status` - a read-only diagnostic in `document/session`. Compare `attached_generation` (the completed model actually loaded) with live heartbeat `generation`. `stale` is true when they differ or either is unknown. `model_generation`, `published_generation`, and `active_sketch_generation` distinguish completed models from active sketch edits; an explicit null model fence stays unknown. Heartbeat age/staleness, identity, and generation come from one heartbeat snapshot. Pending inbox sequences and the latest applied/failed receipt are separate observations. Headless returns `attached:false` / `code:not_attached`, without an error. The status call does not refresh the model or add replay operations.
7. `cad_refresh` - explicitly reload the attached completed model. Attach, refresh, successful completed-model await, and acknowledged document transitions all update the loaded fence only after a successful read/load. UI acknowledgements of identical model text update its publication fence without recomputing the geometry. An active-sketch-only publication retains the older completed-model fence.
8. `cad_detach` - clear the attachment and its generation; the loaded model remains available for headless work.

The interface grouping comes from `interface/catalog.json`; the diagnostic uses the same `document/session` group as attach, refresh, and other session controls.

Build and tool flow: [mcp-server/README.md](../mcp-server/README.md).
Day-to-day playbook: [agent-mcp.md](agent-mcp.md).

### Targeting windows and documents

A stdio server operates on one headless document or one attached session at a
time. `cad_list_sessions` reports live processes, windows and document tabs.
`cad_attach` intersects the supplied session/window/document selectors, and
attached operations retain that identity. Acknowledged file and tab actions
follow the returned active session so subsequent operations target the newly
active document. Publication and inbox identities prevent an operation for one
window from landing in another window's document.

### Stdio (current supported path)
Agents and CI spawn `nbcad-mcp` as an MCP stdio server. One process owns one
headless document until attached. Prefer `solid_export_3mf` for slicer handoff; STEP for CAD interchange.

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

## Diagnostic boundaries

`cad_session_status` reports completed-model freshness separately from live
sketch availability. During an active sketch, `stale:true` can be expected:
the live engine has newer sketch edits while completed `model.json` remains
unchanged. Use the sketch operations for current sketch state; finishing the
sketch and awaiting publication makes a new completed model available.

Heartbeat age indicates publisher liveness, while `stale` compares model
revisions. A matching revision does not prove a recently responsive desktop;
check `heartbeat_stale` too. Pending sequences and receipt files are read after
the heartbeat and can change during the probe. This is a diagnostic observation,
not a transaction or a lock on the live document.

A failed model refresh retains the prior loaded generation. If attach recovered
a model without a usable heartbeat fence, freshness remains unknown until a
later successful refresh. Reading a heartbeat after loading geometry must never
stamp a newer publication onto an older model.

The original session design discussion is in
[#11](https://github.com/jackControls/noBS-CAD/issues/11), and transport proposals
are in [proposed-architecture.md](proposed-architecture.md). This diagnostic does
not claim to complete every item in those broader discussions.

## Tutor quests (CI goldens)

Three headless MCP quests score the first education path from
[#16](https://github.com/jackControls/noBS-CAD/issues/16).
They wrap the built-in print-in-place parts (`demo_export_pip_3mf`) —
the **cam bolt** and **drawer clip** — not a cube. Tests:
`tutor_quest_pip_*` in `cargo test --manifest-path mcp-server/Cargo.toml`
(Windows + Ubuntu CI: `mcp-server.yml`). No `cad_attach`. The UI tutor that narrates
the same steps is still open on that issue.

| Quest | What you do | How CI scores it |
|-------|-------------|------------------|
| **Cam bolt** | `demo_export_pip_3mf` with `kind: cam_bolt` | 4 named bodies, 0.4 mm AABB clearance, ZIP/`PK` 3MF |
| **Drawer clip** | same tool with `kind: clip` | 3 named bodies, 0.4 mm clearance, ZIP/`PK` 3MF |
| **Slicer variants** | same cam bolt for each `slicer_target` | Bambu / Orca / Prusa / Cura / standard packages carry the right Metadata |

These are regression tests, not badges or streaks. The demo tool does not
mutate the headless document.

### Desktop camera and joint controls

`cad_interface` with `action: view` targets an explicit `session_id` (or the currently attached session).
Choose `current`, `isometric`, `top`, `bottom`, `front`, `back`, `left`, or `right`;
set `fit: true` to frame visible geometry. It returns an acknowledged camera
pose only after the desktop renderer finishes its animation. It does not modify
geometry, change the engine generation, or add a modeling script operation.
A live desktop supporting this tool and an active target tab are required.
Stale sessions are rejected; missing acknowledgement returns `status: timeout`.
An applied camera pose verifies navigation state, not pixel-level rendering.

The assembly pack also exposes `assembly_delete_joint`,
`assembly_set_joint_enabled`, and `assembly_set_joint_motion`. The latter two
preserve the rest of the joint definition, avoiding replacement of connectors
or limits merely to suppress a joint or move its primary coordinate. Motion
uses degrees and millimetres; inspect `assembly_solution` for solver diagnostics.
Attached clients call these operations through the automatic live route;
explicit `cad_submit` / `cad_await_apply` remains available. Headless clients
call the same operations against their local model. The desktop and MCP binary must both include
the shared mutation mappings for live use.

Run the native control regression against a disposable active assembly document:

```sh
cargo xtask test-mcp controls --server /path/to/nbcad-mcp --session UUID --out controls.json
```

The test changes the camera, checks that neither the model nor engine generation
changes, suppresses a joint, temporarily makes it revolute to exercise motion,
deletes it, and restores the starting model in a `finally` block. An optional
`--model model.json` loads a fixture into the target document first. It requires
a working live snapshot publisher. See [the live UI guide](interface.md)
for the single UI surface, browser contracts, and executable bench workshop.
