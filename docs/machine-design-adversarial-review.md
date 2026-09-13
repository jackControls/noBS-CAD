# Adversarial findings — docs/machine-design-help (self-audit draft)

Branch tip at start of review: `1e28368`
Scope: help corpus + distill/link policy + Tantivy/search plan
Status: self-audit complete; external adversarial executors + Perf Hawk pending merge

## Blockers

### B1. Provenance keys are fiction
Concept frontmatter uses `sources: nist-gdt-1, nist-gdt-2, nwtc-guns-dfm, …` but `SOURCES.md` has **no id column** and no matching keys. Agents/CI cannot verify attribution. **Fix:** add stable `id` column to SOURCES; validate frontmatter `sources` ⊆ known ids in `check-knowledge` or a new check.

### B2. SOURCES contradicts distill-vs-link on ShareAlike
`SOURCES.md` lists Baughman, Mechanics Map, Wikipedia under **Distill with SA**.
`docs/machine-design-distill-vs-link.md` parks them as **link-only** until SA policy.
**Fix:** one policy wins — prefer link-only for SA until Jack/Jeff decide; change SOURCES use column.

## High

### H1. Taxonomy is a wish list, not coverage
Mechanisms, strength-of-materials, drawings/PMI, design hygiene called out; only GD&T/fits/DFM/fasteners/materials stubs exist. Readers/agents will search and miss. **Fix:** mark taxonomy sections `status: planned` vs `seeded`, or add stub “not written yet” pages that don’t pretend authority.

### H2. Fasteners & materials pages overclaim distill
~40-line pages cite NASA RP-1228 / Materials Project but barely teach. MP is **computed crystalline** data — dangerous if treated as engineering allowables (disclaimer exists but weak). **Fix:** deepen fasteners from NASA PDF, or demote sources until content exists; emphasize KittyCAD/generic vocab over MP for mechanical CAD.

### H3. Preferred-fit table looks like a standards excerpt
`fits-clearances.md` lists `H11/c11` … `H7/n6` with purpose lines. Even attributed to NIST CC BY, this is the highest IP-risk teaching surface (readers confuse with ISO 286). **Fix:** fewer examples, stronger “not the standard table” banner, or replace with class intent only (clearance/transition/interference) + link.

### H4. Tantivy recommendation was not implementation-grade
`machine-design-help-search.md` did not address:
- `mcp-server` is a **separate Cargo workspace**; `src-tauri` depends on `nbcad-mcp` by path — where does `nbcad-help` live so both link it without workspace pain?
- Binary size / RSS / mmap cold start for stdio MCP
- WASM/browser build path (engine has wasm; help probably desktop/MCP only — say so)
- Whether Tantivy is overkill for &lt;500 short pages vs in-memory BM25 over embedded docs
- Index invalidation when markdown changes
**Fix:** revise ADR-style section with hybrid: **v0 in-memory ranker over embedded markdown**, promote Tantivy when corpus/query needs justify deps.

### H5. Dual search stacks already started
Node `search-index.json` + future Tantivy = two rankers. Violates “same content / same search” unless JSON is declared CI-only artifact for Pages, not a second runtime. **Fix:** document JSON as non-runtime; Rust is sole runtime search.

## Medium

### M1. DFM numeric heuristics may track Guns too closely
Wall 1–3 mm, draft 1–2°, rib ~50–60%, bend radius ≈ thickness, etc. CC BY allows adapt with attribution — attribution is light (one line). **Fix:** stronger citation block; “starting guidance, confirm with shop”; vary wording.

### M2. Rule #1 teaching is simplified
Envelope/MMC form control is edition-sensitive; we disclaimer but still sound definitive. **Fix:** “teaching idea from NIST Part I; verify against the Y14.5 edition you use.”

### M3. search-index noise
Indexes `SOURCES.md` and `taxonomy.md` with empty topics — clutters search. **Fix:** exclude non-article paths or require `type: Concept` + `searchable: true`.

### M4. No CC BY attribution block on each distilled page
Zenodo CC BY needs visible attribution / license link beyond a Zenodo URL buried mid-page. **Fix:** standard footer: title, authors, license, link, “adaptations marked.”

### M5. gdt-intro `related_recipes: []`
Missed chance to point at drawing/fit recipes; empty array still indexed oddly depending on parser.

### M6. Product concepts still stale
`knowledge/concepts/architecture.md` still says Three.js viewport / 3MF target — unrelated to machine-design but same OKF bundle agents read. **Fix:** separate issue; don’t pretend machine-design branch refreshed product OKF.

## Low

### L1. home.html improved (relative links) — OK
### L2. Recipe ids checked against catalog — match
### L3. No ASME body text found in pages — OK so far

## Preliminary verdict (self)

Content is a **scaffold with a few real pages**, not a thorough KB. Search recommendation **directionally fine** (embedded Rust FTS, no server) but **sold Tantivy too hard** without repo-specific integration or size analysis. Do not implement Tantivy until H4 is resolved; fix B1/B2 before more distill.

---

## Architecture adversarial review (executor) — merged

**Verdict: demote Tantivy for v1.** Hybrid = embed corpus like recipes + tiny
BM25; nucleo-matcher for UI title jump only; Tantivy behind a graduation bar.

Additional high findings from that review:

### H7. Three workspaces ignored
Root / mcp-server / src-tauri — `nbcad-help` must follow `nbcad-recipes` path-dep pattern.

### H8. WASM
Tantivy/mmap inappropriate for `nbcad-wasm`; Help must be desktop/MCP-only or JSON fallback.

### H9. Spine tool flood
Four always-on help tools fight disclosure; prefer one `cad_help` with actions + caps.

### H10. Security gaps in original plan
Path-based get, unbounded markdown into MCP context, unsanitized HTML — must-fix.

### H11. nucleo is MPL-2.0
Mention in third-party notes; prefer `nucleo-matcher` if only scoring is needed.

### H12. Dual rankers
Node JSON already exists — either Rust consumes it as contract or JSON is CI/Pages-only with documented best-effort ranking.

---

## Perf Hawk (footprint) — merged

**Verdict: DEMOTE Tantivy.** Corpus on branch: 8 pages, ~24 KiB text, 7 KiB
search-index.json. Ceiling 500 pages still not Lucene-scale.

- Tantivy: multi-MiB .text risk; mmap packaging; IndexWriter min heap ~15 MiB
  since 0.22 — never runtime writer in mcp/Tauri.
- Tiny BM25 / embed JSON: low single-digit MiB RSS worst case; instant cold start.
- Keep architecture (shared crate, nucleo, no server); swap the engine.
- Acceptance: RSS delta &lt;5 MiB after first query; report `cargo bloat --crates`
  on PR when implementing.

## Ranked fix order (do these)

1. **B1** Add SOURCES `id` column; validate frontmatter `sources`
2. **B2** Align SA rows to link-only in SOURCES
3. **H4/H7–H12** Land revised help-search.md (demote Tantivy) on branch
4. **H5** Declare search-index JSON = CI/Pages; Rust BM25 = runtime
5. **H3** Soften preferred-fit table / banner
6. **H1** Taxonomy planned vs seeded
7. **H2** Deepen or demote fasteners/materials claims
8. **M3** Exclude SOURCES/taxonomy from searchable index
9. **M4** CC BY attribution footers on distilled pages
10. Then implement `crates/help` BM25 — not Tantivy
