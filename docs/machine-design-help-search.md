# Searchable, usable machine-design help

Goal: **one content corpus**, many surfaces (Help UI, MCP agents, Pages).
Humans and agents see the same pages; **one Rust ranker** is authoritative for
MCP + desktop. No search server.

**Product assumptions:** the help corpus **will grow**. Agents and humans both
need **low-latency** local search. The Help UI must **render** pages well.
**Product code is Rust** — Node is not the help runtime.

No merge to `main` until review; this incubates as a draft PR.

## Same content for all uses

| Layer | Role |
|-------|------|
| `knowledge/machine-design/**/*.md` | **Only** authored source (OKF + frontmatter) |
| **`nbcad-help` (`crates/help`)** | Parse, validate, Tantivy search, get, safe HTML render |
| MCP | Thin `cad_help` over `nbcad-help` |
| Tauri Help | Same crate via `invoke` + article panel |
| `nbcad-help check \| export-index` | CI validation + optional Pages JSON **export** |
| Browser / wasm | **No** Tantivy/nucleo in `nbcad-wasm` |
| GitHub Pages | Same markdown (+ optional client over exported JSON) |

Do **not** maintain separate agent vs user articles.
Do **not** grow Node help indexers — transitional `scripts/*help*.mjs` are
deprecated once `nbcad-help check` lands.

## Search technology (Rust)

### Non-negotiables

- Local-first, in-process, **no** Meilisearch/ES daemon
- Same API for agents and humans: `search` / `get` / `topics`
- Sub‑tens‑of‑ms warm search for typical agent loops
- Ranking lives in **Rust once** — exported JSON is never a second product ranker
- Title quick-jump is separate from full-text

### Decision: Tantivy from day one

| Layer | Tech |
|-------|------|
| Full-text / fielded | **Tantivy** in-process (build from catalog at startup or via build script) |
| Title / id palette (UI) | **`nucleo-matcher`** (MPL-2.0 — THIRD_PARTY) |
| Corpus load | Prefer **runtime/resources** (Tauri resource dir) as the corpus grows; optional embed for MCP smoke |
| Escape | Web after local miss; never paste ASME/ISO body text |

**Rejected:** hand-rolled BM25 as a product interim (two ranking stacks),
Node `search-index.json` as authority, ripgrep shell-out, embeddings for v1,
help inside wasm, search daemons.

```text
cad_help / help_search
        │
        ▼
   nbcad_help::HelpStore
        ├── Catalog (id → Page meta + body)
        └── Tantivy index
```

## Help UI rendering (humans)

1. **Palette** — nucleo over titles + ids; full-text hits with snippet + recipe chips
2. **Article** — GFM → **sanitized HTML** in Rust (`pulldown-cmark` or `comrak` + sanitizer). No raw HTML from corpus. CSP-friendly. App theme tokens.
3. **Cross-links** — resolve by page `id`; broken ids fail in `nbcad-help check`
4. **Recipes** — `related_recipes` open existing recipe/script paths
5. **Stub honesty** — status / stub callouts visible
6. **License footer** — short distill / SOURCES line

Agents get **markdown** (or capped plain text) from `get` — not HTML.
One source file; two presentations.

## Workspace placement

1. `crates/help` as a **root** workspace member (`nbcad-help`)
2. `mcp-server` path-deps it (like `nbcad-recipes`)
3. `src-tauri` path-deps it for search + render
4. **Never** add the index to `crates/wasm`

## MCP surface

One spine tool: `cad_help` with `action: search | get | topics`

- search: small `limit`, snippet-first
- get: **id-only** allowlist; hard byte cap
- never path-based reads
- NC/SA URLs are citations only — never ingested into the corpus by tools

## Security

| Risk | Rule |
|------|------|
| Path traversal | Id-only catalog lookup |
| Markdown in UI | Sanitize / no raw HTML; CSP |
| MCP context flood | Caps + snippets default |
| Dual ranker | Product never ranks via Node JSON |

## Ranking fields

Boost: `title` > `keywords` / `topics` > `description` > `body`.  
Optional: boost `related_recipes` when caller passes active recipe context.

## Implementation plan

1. Amend done (this ADR) — Tantivy + Rust ownership
2. Scaffold `crates/help` — catalog, Tantivy, goldens, `check` + `export-index`
3. MCP `cad_help`
4. Tauri Help panel (nucleo + sanitized article)
5. CI: `cargo run -p nbcad-help -- check` replaces npm help scripts
6. Delete transitional `scripts/build-help-index.mjs` / `check-help-sources.mjs`

## Acceptance sketch

- [ ] One markdown tree for UI, MCP, Pages
- [ ] MCP + Tauri call the same `nbcad_help::search`
- [ ] Help UI: sanitized article render + recipe chips + stub visibility
- [ ] Agent `get` returns markdown/plain, not HTML
- [ ] Tantivy + nucleo not in wasm
- [ ] Id-only get; traversal tests fail closed
- [ ] Local hit for “clearance fit” / “draft angle” without network
- [ ] `nbcad-help check` validates SOURCES ids, recipe ids, internal links
- [ ] No standards body text in repo
