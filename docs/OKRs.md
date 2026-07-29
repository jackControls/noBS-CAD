# OKRs — noBS CAD (agentic local CAD)

Horizon: epic [#9](https://github.com/jackControls/noBS-CAD/issues/9) and children.

## Objective O1 — Steerable local MCP surface

Agents see a small, focus-aligned tool set without a hard jail; headless CI stays green.

| KR | Target | Status |
|----|--------|--------|
| KR1.1 Soft disclosure shipped | `listChanged: true`, soft TTL, spine ≤15, 101/101 tags | **Met** (PR #24) |
| KR1.2 Escape hatch | `full_static` + `cad_list_all_tools`; docs warn main agents off | **Met** |
| KR1.3 Pack goldens | List snapshot + one op per focus pack in CI | **Met** |
| KR1.4 Exact notification | `notifications/tools/list_changed` throttled ~300ms | **Met** |

## Objective O2 — Co-linked UI session (#11)

One document visible in UI and controllable via MCP.

| KR | Target | Status |
|----|--------|--------|
| KR2.1 File-bridge v1 | `cad_list_sessions` / `cad_attach` + UI publisher | **Met** (file bridge) |
| KR2.2 Model freshness | Bridge republishes on geometry/document edits; MCP rewrites focus on control | **Met** (file-bridge freshness) |
| KR2.3 Live shared session | In-process or watched reload; writer lock | Open (honest deferral; not this milestone) |

## Objective O3 — Maintainability / agent ops

| KR | Target | Status |
|----|--------|--------|
| KR3.1 Indexes | `INDEX.md` at repo, docs, mcp-server, src, crates, src-tauri, agentic | **Met** |
| KR3.2 Agentic guides | `docs/agentic/*` committed (not root `AGENTS.md`) | **Met** |
| KR3.3 CI | `mcp-server.yml` required path for MCP changes | **Met** (workflow) |

## Related systems (design inspiration)

- MCP progressive disclosure / `listChanged` — keep advertised set small; refresh on notify ([spec](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)).
- FreeCAD MCP servers — often 100+ flat tools; we intentionally avoid that flood via soft focus.
- Catalog-first clients — `cad_list_all_tools` mirrors “search then load schema” patterns without flooding `tools/list`.
