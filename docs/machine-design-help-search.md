# Searchable, usable machine-design help

Goal: humans and agents find the right design-time page in seconds, then
optionally open a **recipe** that drives the viewport — same pattern as the
Scripts / presentation stack.

No PR while this incubates on `docs/machine-design-kb`.

## Layers

```
knowledge/machine-design/**/*.md     # source of truth (OKF concepts)
        │
        ▼
scripts/build-help-index.mjs         # CI / local
        │
        ▼
knowledge/machine-design/search-index.json
        │
        ├─► MCP  cad_help_search / cad_help_get   (agents; always-on spine)
        ├─► UI   Help panel search                 (humans)
        └─► Pages site                             (browse + future client search)
```

Web search stays the **escape hatch** after local miss.

## 1. Content contract (usable pages)

Every machine-design concept should carry frontmatter:

| Field | Purpose |
|-------|---------|
| `type`, `title`, `description`, `status` | OKF + `check:knowledge` |
| `topics` | Facets: `gdt`, `dfm`, `fits`, … |
| `keywords` | Free tokens for search |
| `related_recipes` | Recipe ids from `crates/recipes` |
| `sources` | Keys into SOURCES / distill provenance |

Body stays **thin**, actionable, with **Further reading** links for NC/proprietary.

## 2. Search index (now)

```sh
node scripts/build-help-index.mjs
```

Emits `knowledge/machine-design/search-index.json`: flat `{ id, path, title,
description, topics, keywords, related_recipes, snippet }`.

Ranking v1 (good enough):

1. Exact title / id match
2. Keyword / topic token hit
3. Snippet / description substring
4. Boost if `related_recipes` intersects the active recipe or document context

Commit the generated JSON so agents can read it without a build step offline;
re-run the script when pages change (optional CI check that the file is fresh).

## 3. MCP (next implementation slice)

Add **always-on** tools (not focus-gated — help is valid in any modeling focus):

| Tool | Behavior |
|------|----------|
| `cad_help_search` | `query`, optional `topics`, `limit` → ranked hits from the index |
| `cad_help_get` | `id` → full markdown path + frontmatter + related recipes |
| `cad_help_list_topics` | taxonomy facets |
| `cad_help_open_example` (optional) | `recipe_id` → same path as Scripts `present` / MCP script action |

Disclosure: put these on the **spine** next to session/document helpers so
dynamic focus never hides help. Do not break existing MCP contracts; follow
`docs/mcp-harness.md` / disclosure packs.

Agent policy (document in `docs/agent-mcp.md` when wiring):

1. `cad_help_search` before inventing advice
2. Cite page id in the reply
3. Offer `related_recipes` when present
4. Web search only on miss — still no ASME paste into the repo

## 4. Human UI (usable help)

Minimum viable Help:

1. **Search box** over `search-index.json` (same ranker as MCP).
2. **Article view** rendered from markdown (or open in Pages).
3. **“Run example”** when `related_recipes` is non-empty → Scripts playback
   (`present` mode) so the viewport *is* the demo.
4. Entry points: Help menu, `?` on drawing/GD&T/fit UI, and empty-state links
   from Scripts.

Do not invent a second demo runtime — recipes remain the screen source.

## 5. Hosted Pages

Existing `pages-knowledge.yml` copies `knowledge/` to GitHub Pages. After
merge to `main`, the index and articles are browsable. Optional later: tiny
client-side search over `search-index.json` on the Pages site.

## 6. Implementation order on this branch

1. **Done / in progress** — grow OKF pages + `build-help-index.mjs` + committed index.
2. **Next** — wire `cad_help_search` / `cad_help_get` in `mcp-server` (spine).
3. **Then** — Help panel UI + Run example → recipe.
4. **Later** — embeddings only if keyword search proves weak; keep markdown source of truth.

## Acceptance sketch

- [ ] Index lists every machine-design markdown page with topics/keywords
- [ ] `npm run check:knowledge` still green
- [ ] Agent can answer “what is a clearance fit?” from local help without web
- [ ] “Show me” opens `turbine-fit-coupons` or similar via existing script path
- [ ] No standards body text in repo
