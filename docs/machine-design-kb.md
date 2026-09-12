# Machine-design knowledge base

Open, license-safe help for **design-time** mechanical decisions (GD&T,
machine elements, mechanisms, materials, DFM). It sits beside the product
OKF concepts, not inside them.

## Who it is for

- **Humans** — browse `knowledge/machine-design/` in git or the [knowledge
  site](https://jackcontrols.github.io/noBS-CAD/) once this branch reaches
  `main`.
- **Agents** — read the Markdown. Do not scrape the HTML page. Search this
  tree **when the taxonomy marks the topic seeded**. For **planned** gaps,
  use linked further-reading / web. Web search is always the escape hatch.

## Source of truth

| Path | Role |
|------|------|
| [`knowledge/index.md`](../knowledge/index.md) | OKF index (product + domain) |
| [`knowledge/machine-design/taxonomy.md`](../knowledge/machine-design/taxonomy.md) | Topic map |
| [`knowledge/machine-design/SOURCES.md`](../knowledge/machine-design/SOURCES.md) | Provenance and licenses |
| [`knowledge/machine-design/concepts/`](../knowledge/machine-design/concepts/) | Thin concept pages |
| [`docs/knowledge-wiki.md`](knowledge-wiki.md) | Bundle conventions |

Validate:

```sh
npm run check:knowledge
```

Keep concepts **thin**. Do not paste ASME/ISO standard body text. Distill
public-domain and CC BY teaching materials; treat CC BY-NC / NC-SA as
link-only unless maintainers record an exception.

## Relationship to recipes

On this stack, [native scripts](native-scripts.md) are the construction and
presentation source (`note` / `view` in `.nbcad.jsonc`). Machine-design
pages name recipe ids (`turbine-fit-coupons`, `d-screw-vise`, …) instead of
shipping a second demo runtime.

Later milestones may add `kb-*` recipes for datum frames, four-bars, and
fastener stacks, still using the same interpreter and Scripts / MCP
`present`|`fast` modes.

## Proposed MCP help surface (not in this PR)

Illustrative names:

- `cad_help_search(query, topics?, limit?)`
- `cad_help_get(id)`
- `cad_help_list_topics()`
- optional `cad_help_open_example(recipe_id)` to start recipe playback

Put help tools in a dynamic-disclosure soft pack when they exist. Until then,
agents should glob `knowledge/machine-design/**/*.md`.

## Distill vs link

See [machine-design-distill-vs-link.md](machine-design-distill-vs-link.md) for the
locked policy: distill PD / CC BY / Apache / US-gov teaching materials into
thin OKF pages; link NC courses and proprietary standards without copying.

## Milestones

1. **A (this branch)** — OKF scaffold, license table, **six** seed concepts,
   SOURCES ids, class-only fits (no preferred-fit designation table),
   search plan (BM25 now, Tantivy behind a `SearchIndex` trait as the
   corpus grows; Help UI markdown render), adversarial pass.
2. **B** — Fill taxonomy thin concepts; cross-link remaining recipes.
3. **C** — Live `kb-*` recipes + help UI mini-viewport.
4. **D** — MCP search tools and an evaluation set of design-time questions.

Physical load, wear, and print qualification stay out of scope for help
pages, matching flagship example policy.

## Searchable help

See [`machine-design-help-search.md`](machine-design-help-search.md) for the
index, MCP tools, and Help UI plan.

## Adversarial review

See [`machine-design-adversarial-review.md`](machine-design-adversarial-review.md)
for the 2026-09-11 pass (blockers: SOURCES ids, preferred-fit fence).
