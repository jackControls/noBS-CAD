# Knowledge wiki (OKF)

The `knowledge/` directory is an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) bundle: markdown concepts with YAML frontmatter for humans and agents.

- Browse in-repo: start at [`knowledge/index.md`](../knowledge/index.md)
- Hosted: GitHub Pages workflow `.github/workflows/pages-knowledge.yml` (enable Pages in repo settings after merge)
- Agents: prefer reading the markdown files over scraping the HTML page
- Keep concepts **thin**; long design stays in `docs/mcp-harness.md` / `docs/adr/` — sync after those PRs merge ([#17](https://github.com/jackControls/noBS-CAD/issues/17))
- Tracking epic: [#9](https://github.com/jackControls/noBS-CAD/issues/9)

Future: richer OKF viewer HTML or MkDocs/Quartz theme while keeping `knowledge/` as the source of truth.
