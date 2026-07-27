# Agent guide — noBS CAD

This repository is a **local-first mechanical CAD** with a **Rust geometry kernel**, a **Tauri/React desktop UI**, and a **stateful MCP server** (`mcp-server/`) meant as the direct AI harness.

Read this file first. Then open the linked playbooks. Prefer MCP + tests over guessing UI clicks.

## Product stance

- No cloud backend, no accounts, no telemetry requirement.
- Geometry truth lives in Rust + OCCT; the UI and MCP are clients of the same planner/history.
- Agents should model through MCP when automating; humans use the app; both share feature history semantics.
- Prefer cross-platform Rust for new engine, export, and MCP surfaces.

## Where to look

| Need | Location |
|------|----------|
| Build / run app | `README.md` |
| Contribution loop | `CONTRIBUTING.md` (process PR) / `docs/process.md` |
| MCP tools + modeling flow | `mcp-server/README.md` |
| Agent MCP playbook | `docs/agent-mcp.md` |
| Engine crates | `crates/core`, `sketch`, `solid`, `occt`, `wasm` |
| Desktop shell | `src-tauri/`, `src/` |
| Knowledge wiki (OKF) | `knowledge/` when present |

## Hard invariants

1. **Stable IDs** — edge/face/sketch IDs returned by MCP/scene must remain valid inputs for later ops in the same history.
2. **One history per MCP process** — do not spawn a new MCP server per tool call when composing a part.
3. **OCCT boundary** — B-rep kernels stay behind `crates/occt`; do not reimplement solids in TypeScript.
4. **Local-first** — no new cloud service dependencies.
5. **Issue-first** — every non-trivial change tracks a GitHub issue; dedupe before coding.

## Default agent workflow

1. Find or open an issue; search for duplicates.
2. `git worktree add` a branch named `issue/<n>-slug`.
3. For modeling bugs: reproduce via MCP if possible; capture `cad_document` / `solid_scene`.
4. Implement in Rust planner/adapter first when semantics change; wire UI/MCP second.
5. Add regression coverage (Rust test or e2e/MCP scenario).
6. Open PR linking the issue; babysit comments + CI to merge-ready.

## Do not

- Force-push `main` or disable required checks to go green.
- Commit secrets, absolute `OCCT_ROOT` machine paths, or large binaries.
- Replace the B-rep kernel with a mesh-only pipeline for “CAD” features.
- Treat Bevy/Three.js as the source of solid truth (display only).
