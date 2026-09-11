# Searchable, usable machine-design help

Goal: **one content corpus**, many surfaces (Help UI, MCP agents, Pages).
Humans and agents see the same pages; **one Rust ranker** is authoritative for
MCP + desktop. No search server.

**Product assumptions (2026-09-11):** the help corpus **will grow**. Agents and
humans both need **low-latency** local search. The Help UI must **render**
pages well (not dump raw markdown). Design the crate for that scale now —
even while today’s seed is ~6–50 pages.

No PR while this incubates on `docs/machine-design-kb`.

## Same content for all uses

| Layer | Role |
|-------|------|
| `knowledge/machine-design/**/*.md` | **Only** authored source (OKF + frontmatter) |
| `scripts/build-help-index.mjs` → `search-index.json` | CI freshness + Pages interchange (not the product ranker) |
| **`nbcad-help` (`crates/help`)** | Catalog + search + get; owns ranking |
| MCP | Thin `cad_help` over `nbcad-help` |
| Tauri Help | Same crate via `invoke` + markdown → safe HTML panel |
| Browser / wasm | **No** heavy index in `nbcad-wasm`; desktop Help or JSON approx |
| GitHub Pages | Same markdown (+ optional client search over JSON) |

Do **not** maintain separate agent vs user articles.

## Search technology — growth-ready decision

### Non-negotiables

- Local-first, in-process, **no** Meilisearch/ES daemon
- Same API for agents (MCP) and humans (Help): `search` / `get` / `topics`
- Sub‑tens‑of‑ms search on a warm corpus for typical queries (agent loops
  amplify every miss / every 200 ms)
- Ranking lives in Rust once — Pages JSON is best-effort only
- Pluggable backend so we do not rewrite MCP/UI when the index grows

### Architecture

```text
cad_help / help_search
        │
        ▼
   nbcad_help::HelpStore
        │
        ├── Catalog (id → Page meta + body)
        └── dyn SearchIndex  ◄── BM25 (ship)  /  Tantivy (scale)
```

`HelpStore` API stays stable. Swap the `SearchIndex` impl without changing
tool schemas or the Help panel.

### Ship now (v1) — tiny BM25 over embedded pages

| Layer | Tech | Why |
|-------|------|-----|
| Full-text / fielded | Tiny in-process **BM25** (or weighted TF) over embedded `Page`s | Corpus is still recipes-sized; zero mmap/segment complexity |
| Corpus load | `include_str!` / `include_dir!` like `crates/recipes` | Same rebuild story |
| Quick jump (UI) | **`nucleo-matcher`** (MPL-2.0 — THIRD_PARTY) | Instant title/id palette; separate from full-text |
| Escape | Web after local miss | Never paste ASME/ISO body text |

Consume committed `search-index.json` **or** parse markdown in Rust — **one**
frontmatter contract. Prefer: CI keeps JSON fresh; Rust embeds markdown (or
JSON + bodies) keyed by `id`.

### Scale path (v1.5) — in-process Tantivy

**Assume growth.** When any of these trip, implement Tantivy behind the same
`SearchIndex` trait (do not wait for “1k pages” folklore):

- page count ≳ **~200–500**, or body text ≳ a few MB uncompressed, **or**
- golden-query recall/latency misses after BM25 tuning, **or**
- need phrase / field boosts / incremental rebuild that BM25 cannot keep

Tantivy stays **in-process** (embedded index built at compile time or first
run from the catalog). Still no daemon. Still **not** in wasm.

| Rejected as defaults | Why |
|----------------------|-----|
| Meilisearch / Typesense / ES | Extra process; anti local-first |
| ripgrep shell-out | Bad MCP product path |
| Embeddings / vector DB | Later only if keyword fails on CAD jargon |
| Help inside `nbcad-wasm` | Keep wasm lean |
| Shipping Tantivy on day one for 6 pages | Complexity without payoff — **but** the trait + file layout must make the swap boring |

SQLite FTS5: fine if the app later gains a general local DB; not required for
help alone.

## Help UI rendering (humans)

Search is useless if the page looks like a dump. Desktop Help must:

1. **List / palette** — nucleo over titles + ids; full-text results below with
   title, topics, short snippet, optional recipe chips
2. **Article view** — GFM markdown → **sanitized HTML** (tables, lists, code,
   links). No raw HTML from the corpus. CSP-friendly. Theme tokens match the
   app (light/dark)
3. **Cross-links** — in-corpus links resolve by page `id`; broken ids fail
   closed in CI (`check:help`)
4. **Recipes** — `related_recipes` render as actions that open existing
   recipe/script paths (no second demo runtime)
5. **Stub honesty** — frontmatter/`status` (and stub callouts) visible so thin
   pages are not mistaken for sizing manuals
6. **License footer** — short “distilled from / see SOURCES” line on each page

Suggested stack (decide in implementation, not here): `pulldown-cmark` or
`comrak` + HTML sanitizer in Rust, or render in the webview with a locked-down
markdown pipeline — **same sanitized HTML** whether opened from search or deep
link.

Agents get **markdown** (or capped plain text) from `get` — they do not need
the HTML path. One source file; two presentations.

## Workspace placement

Three Cargo workspaces: **root**, **`mcp-server`**, **`src-tauri`**.

1. `crates/help` as a **root** workspace member (`nbcad-help`)
2. `mcp-server` path-deps it (like `nbcad-recipes`)
3. `src-tauri` path-deps it for search + render helpers
4. **Never** add the index crate to `crates/wasm`

## MCP surface

One spine tool: `cad_help` with `action: search | get | topics`

- search: small `limit`, snippet-first (agents hate floods)
- get: **id-only** allowlist; hard byte cap; optional `truncated`
- never path-based reads
- `cad_help_open_example` → existing recipe/`cad_script` paths

## Security

| Risk | Rule |
|------|------|
| Path traversal | Id-only catalog lookup |
| Markdown in UI | Sanitize / no raw HTML; CSP |
| MCP context flood | Caps + one tool + snippets default |
| NC / SA ingest | Help tools return **in-repo distill only**; NC URLs are citations, never fetched into the corpus |
| Future contrib | Untrusted until reviewed |

## Ranking fields

Boost: `title` > `keywords` / `topics` > `description` > `body`.  
Optional: boost `related_recipes` when the caller passes active recipe context.

## Implementation plan

1. `crates/help` — `Page` catalog, `SearchIndex` trait, BM25 impl, goldens
   (“clearance fit”, “draft angle”), HTML render helper **or** documented
   webview pipeline
2. MCP — `cad_help` + caps + allowlist tests
3. Tauri — `help_search` / `help_get`; Help panel (palette + article); nucleo
4. CI — `build:help-index` freshness; `check:help-sources`; exclude
   SOURCES/taxonomy unless `searchable`
5. When growth bar trips — Tantivy impl of `SearchIndex`; keep API stable
6. This file remains the ADR

## Acceptance sketch

- [ ] One markdown tree for UI, MCP, Pages
- [ ] MCP + Tauri call the same `nbcad_help::search`
- [ ] Help UI: sanitized article render + recipe chips + stub visibility
- [ ] Agent `get` returns markdown/plain, not HTML
- [ ] No index/nucleo in wasm
- [ ] Id-only get; traversal tests fail closed
- [ ] Local hit for “clearance fit” / “draft angle” without network
- [ ] p95 search warm-path target documented in crate (aim ≪ 50 ms on
      laptop-class hardware at v1 size; re-measure at scale)
- [ ] `SearchIndex` trait ready for Tantivy without tool schema churn
- [ ] `related_recipes` ids ⊆ recipe catalog
- [ ] No standards body text in repo
