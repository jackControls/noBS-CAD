# Searchable, usable machine-design help

Goal: **one content corpus**, many surfaces (Help UI, MCP agents, Pages).
Humans and agents see the same pages; search is a shared Rust library, not a
second copy of the text.

No PR while this incubates on `docs/machine-design-kb`.

## Same content for all uses

| Layer | Role |
|-------|------|
| `knowledge/machine-design/**/*.md` | **Only** authored source (OKF concepts + frontmatter) |
| `scripts/build-help-index.mjs` | Optional Node helper to emit `search-index.json` for CI/Pages |
| **`nbcad-help` Rust crate** (to add) | Loads/embeds the same markdown; owns `search` + `get` |
| MCP `cad_help_*` | Thin tools over `nbcad-help` |
| Tauri Help panel | Same `nbcad-help` via `invoke` — not a parallel TS corpus |
| GitHub Pages | Renders the same markdown files |

Do **not** maintain separate “agent help” vs “user help” articles. Optional
`audience` frontmatter may *rank* results, never fork the text.

Recipes stay the live viewport demos (`related_recipes` → Scripts/`present`).

## Recommended search technology (Rust)

### Decision

**Use [Tantivy](https://github.com/quickwit-oss/tantivy) in-process** as the
full-text engine inside a small `nbcad-help` crate.

Why Tantivy for noBS CAD:

- **Embedded library**, not a search *server* — fits local-first / offline
- Pure **Rust**, ships inside `nbcad-mcp` and the Tauri host
- **BM25**, fielded queries (title / topics / keywords / body), phrase + prefix
- Tiny corpus (tens→hundreds of pages) → trivial index size and startup
- No network daemon (reject Meilisearch / Typesense / Elasticsearch as the
  default path)

### Layered matching (practical)

| Layer | Tech | Use |
|-------|------|-----|
| 1. Full-text | **Tantivy** | Body + title + keywords (“clearance fit”, “draft angle”) |
| 2. Quick jump | **nucleo** (or equivalent fuzzy) | Command-palette / title-as-you-type |
| 3. Escape | Web search | Only after local miss; still no ASME paste into repo |
| Later (optional) | Local embeddings | Only if keyword miss-rate hurts; not v1 |

Do **not** start with a vector DB. Help queries are short, technical, and
well served by BM25 + good frontmatter.

### What we are *not* recommending for v1

| Option | Why not (for this app) |
|--------|-------------------------|
| Meilisearch / Typesense / ES | Extra process; fights local-first |
| SQLite FTS5 | Fine technically, but adds a DB just for help; Tantivy stays in-memory/on-disk without SQL surface |
| Node-only search in the UI | Diverges from MCP; breaks “same content / same ranker” |
| Cloud search APIs | Offline + privacy |

SQLite FTS5 remains a **reasonable alternate** if the app later grows a general
local DB; prefer one store. Until then Tantivy is the clearer CAD-help fit.

## Architecture

```
knowledge/machine-design/**/*.md
        │
        ▼  build.rs / include_dir / install data dir
   crates/help  (nbcad-help)
        │  search(query) -> Hits
        │  get(id) -> Page
        ├─► mcp-server   cad_help_search / cad_help_get  (always-on spine)
        └─► src-tauri    help_search / help_get commands → React Help UI
```

Index build options (pick one in implementation):

1. **Compile-time**: `build.rs` walks `knowledge/machine-design` and embeds a
   Tantivy index or the raw docs (simplest for releases).
2. **Load-time**: read markdown from the installed app data / repo checkout
   (better for docs-only updates without rebuild).

Start with (1) for the MCP binary and desktop; revisit (2) if help ships as
loose files next to the app.

## Ranking fields (Tantivy schema sketch)

Boost roughly:

1. `title` (high)
2. `keywords` / `topics` (high)
3. `description` (medium)
4. `body` (baseline)
5. Slight boost when `related_recipes` intersects active context

Return: `id`, `title`, `path`, `snippet`, `score`, `related_recipes`.

## MCP tools (always-on spine)

| Tool | Behavior |
|------|----------|
| `cad_help_search` | Tantivy query → ranked hits |
| `cad_help_get` | Full markdown + frontmatter |
| `cad_help_list_topics` | Facets from taxonomy / index |
| `cad_help_open_example` | Optional → existing recipe `present`/`fast` |

Help must **not** be focus-gated: valid in any modeling focus.

Agent policy: local search → cite page id → offer recipe → web only on miss.

## Current branch status

- Markdown corpus + `search-index.json` + Node `build:help-index` (scaffold /
  Pages / CI convenience).
- Next Rust slice: add `nbcad-help` with Tantivy; point MCP at it; delete any
  temptation to reimplement rankers in TypeScript.

## Acceptance sketch

- [ ] One markdown tree is what UI, MCP, and Pages show
- [ ] MCP and Tauri call the same `nbcad-help::search`
- [ ] Tantivy answers “clearance fit” / “draft angle” without network
- [ ] `related_recipes` can launch existing script playback
- [ ] No standards body text in repo
