# Proposed architecture notes

This document collects **aspirational / proposed** implementation ideas and
records what has **shipped**. Factual MCP as-built notes live in
[mcp-harness.md](mcp-harness.md). Product directions: [goals.md](goals.md).

Doc index: [INDEX.md](INDEX.md).

## Status key

| Status | Meaning |
|--------|---------|
| Shipped | On `main` / this branch; see linked docs for as-built detail |
| Proposed | Open for prototyping; may change |
| Deferred | Interesting later; not near-term P0 |

---

## 1. Focus-scoped MCP tools — Shipped

Soft focus-scoped disclosure is live: `tools.listChanged: true`, throttled
`notifications/tools/list_changed`, spine + active pack + soft packs (60 s TTL,
LRU 2). Hidden tools remain callable; escape hatch: `full_static` or
`cad_list_all_tools`.

See [mcp-harness.md](mcp-harness.md) and `mcp-server/src/disclosure.rs`.

Spec reference: [MCP tools / listChanged](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).

---

## 2. Co-link MCP ↔ one active UI document — Shipped (file bridge v1)

File-bridge co-link ships today: `cad_list_sessions` / `cad_attach`
(`NBCAD_SESSION_DIR`). Optional UI launch: `cad_launch_ui`, `cad_ui_status`,
`cad_ui_window` (see [agentic/UI_LAUNCH.md](agentic/UI_LAUNCH.md)).

Headless MCP without attach remains valid for CI goldens. In-process shared
document with the live UI is a **proposed** next step (not shipped).

---

## 3. Multi-window / multi-document MCP broker — Deferred

Multiple open windows may matter later. A stdio **broker** that routes by
`window_id` / `document_id` is one option; one MCP process per document is
another (especially for CI).

**Not a P0 product requirement** until real use cases justify it.

---

## 4. Manufacturing export — Shipped

| Format | Role |
|--------|------|
| **STEP AP242** | Engineering interchange (B-rep). No invented STEP colors. |
| **3MF** | Additive manufacturing. Unit millimetre. Consortium `basematerials` + optional slicer Metadata (`bambu_studio` default, also Orca / Prusa / Cura). |
| **STL** | Mesh fallback. Geometry only; appearance omitted (UI warns). |

Shared path: OCCT tessellation → `nbcad_export::ExportFacade`. Desktop File menu
and MCP (`solid_export_3mf` / `solid_export_stl` / `solid_export_step`,
`material_catalog`) share requests.

Per-body `BodyAppearance` (color, filament type, brand, vendor id, density,
diameter, preset) lives in `.nbcad` `body_appearances`, tints three.js, and
feeds 3MF. Catalog: `crates/export/presets/catalog.json`.

Face paints, 3MF import, and full sliced G-code.3mf projects are non-goals for
this cycle — see [manufacturing/OKRs.md](manufacturing/OKRs.md).

---

## 5. Rust crate roles (factual guidance for proposals)

When proposing engine work, keep these boundaries clear:

| Crate | Role |
|-------|------|
| `nbcad-core`, `nbcad-sketch`, `nbcad-solid` | Host-neutral model logic (document, sketches, features, history, planning) |
| `nbcad-occt` | Native geometry adapter (OCCT) |
| `nbcad-export` | Print/export (3MF, STL, material catalog) |
| `nbcad-wasm` | Browser adapter path (WASM host + OpenCascade.js for solids in the browser build) |

UI (React/Three.js/Tauri) displays and commands; geometry truth stays in the
Rust model + kernel adapters.

---

## 6. Shared agent / editor guidance files — Policy (open to revisit)

**Current project policy:** editor- and agent-specific steering files stay
**internal**. Root and nested `AGENTS.md`, plus `.cursor/` content, remain
gitignored. Public documentation of MCP tools and architecture is welcome in
`docs/` and `mcp-server/README.md`.

**Later option:** maintainers may revisit a short shared cross-tool guidance
file (commonly named `AGENTS.md`) for build/test commands and contribution
norms. Relevant references if that discussion reopens:

- [AGENTS.md open format](https://github.com/agentsmd/agents.md)
- [Cursor Docs — Rules / AGENTS.md](https://cursor.com/docs/rules)
- [GitHub Copilot — repository / agent instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions)
- [Microsoft ISE — AGENTS.md and skills](https://devblogs.microsoft.com/ise/ai-assisted-development-agents-skills-copilot-cli/)

---

## 7. Education / quests — Deferred product layer

Tutor-style loops that reuse golden MCP scenarios are attractive later. Keep
them out of the top-level committed goals until the CAD foundation and local
automation path are stronger.
