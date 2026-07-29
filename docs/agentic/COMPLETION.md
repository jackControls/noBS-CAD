# Steerable MCP — plan vs achieved

Updated against plan “Steerable MCP Surface (Dynamic Disclosure + Soft Focus)” and PR #24.

## Visionary notes (related systems)

- **MCP progressive disclosure** — industry pattern is small advertised sets + `listChanged`; clients that ignore notifies need `full_static` (we document this).
- **FreeCAD MCP** servers often expose 100–150 flat tools — high context cost; our soft focus packs are a deliberate differentiator.
- **Catalog-first** — `cad_list_all_tools` matches “search then bind schema” without permanently flooding `tools/list`.
- **Security** — dynamic `listChanged` expands capability surface; we keep tools local/offline and never auto-enable cloud transport.

## Checklist

| Plan item | Status |
|-----------|--------|
| Soft disclosure state machine | Done |
| Spine ≤15 + 9 packs + 101 tags | Done |
| `listChanged` + throttled notify | Done |
| Escape hatch + catalog | Done |
| Soft side-call + re-promote | Done |
| File-bridge co-link (#11 v1) | Done |
| Live in-process co-link | Deferred (honest; not P0 for file-bridge milestone) |
| Per-pack list goldens | Done (`every_focus_pack_lists_representative_tools`) |
| `full_static` == full registry | Done |
| UI↔Rust focus dialog key parity | Done (`construction_plane`) |
| Session bridge on geometry edits | Done |
| MCP control → rewrite attached `focus.json` | Done |
| Docs + OKRs + indexes + agentic guides | Done |
| Root README honesty | Done |
| Live in-process co-link / writer lock | Deferred (file-bridge milestone complete) |
| Multi-window / Bevy / public AGENTS.md | Non-goals — not done (correct) |

## Validation evidence

```text
cargo test --manifest-path mcp-server/Cargo.toml
# 2026-07-28 local: 22 passed; 0 failed (OCCT_ROOT + bin on PATH)
```

CI job `mcp-tests` on PR #24 is the remote source of truth.
