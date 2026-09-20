---
title: How humans find help today
status: draft
updated: 2026-09-20
---

# How humans find help today

Short operating note for Design Ops and contributors. **No full Tauri Help
panel yet** — humans and agents share one Markdown corpus; doors differ.

## Doors (same corpus)

| Door | What a human does | Same crate / data |
|------|-------------------|-------------------|
| **OKF index** | Open [`knowledge/index.md`](../../knowledge/index.md) — topic list → page titles | Source of truth |
| **Taxonomy** | Open [`knowledge/machine-design/taxonomy.md`](../../knowledge/machine-design/taxonomy.md) — seeded vs planned map with links | Source of truth |
| **MCP `cad_help`** | In an MCP client: `topics` → labels; `search` → snippets; `get` by id | `nbcad-help` |
| **MCP resources** | `resources/list` / `resources/read` on `nbcad://knowledge/...` (start at `nbcad://knowledge/index.md`) | Embedded at MCP build |
| **GitHub Pages** | Browse hosted knowledge HTML (when published) | Same markdown; prefer MCP for agents |
| **Checkout** | Read files under `knowledge/**` in a clone | Same files |

Future **desktop Help** should call the **same** `nbcad-help` crate (search /
get / topics) and render the same pages — not a second corpus. Until that UI
lands, the index + taxonomy + MCP/Pages are the human browse path.

## Scripts / demos (unchanged)

Recipe chips and presentation deep-links still open **Scripts** /
`.nbcad.jsonc` demos. Help does **not** embed a Bevy viewport. Agents and
humans use the same recipe ids from page frontmatter (`related_recipes`).

## Agent vs human

- **Humans:** start at index or taxonomy; follow links; optional Pages.
- **Agents:** prefer `cad_help` `search` → `get` (id-only); use `topics` to
  discover labels; `resources/read` only for the chosen full page.
- Do **not** maintain separate agent-only articles.

## MCP prompts (gap)

As of 2026-09-20, `nbcad-mcp` `initialize` advertises `tools` + `resources`
only — **no** `prompts` capability / `prompts/list`. Validate-before-show and
research-before-commit remain **knowledge pages + Cursor skills**, not MCP
prompt templates. See Design Ops `cad-design-ops` notes (prompts gap). When
prompts land, point them at the same `cad_help` ids.

## Rebuild reminder

Knowledge embeds at MCP **build** time. After corpus changes on this machine:
run `cad-design-ops/scripts/install-nbcad-mcp.sh`, then Cursor **Uninstall +
Add** with **bash + `launch.sh`** (pkill/Restart alone can leave a stale
server).
