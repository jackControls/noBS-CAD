# Knowledge bundle (OKF)

The `knowledge/` directory is an
[Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundle: Markdown concepts with YAML frontmatter for humans and agents.

- Browse in-repo: start at [`knowledge/index.md`](../knowledge/index.md)
- Hosted: GitHub Pages workflow `.github/workflows/pages-knowledge.yml` (enable Pages in repo settings after merge)
- Agents: prefer reading the markdown files over scraping the HTML page
- Keep concepts **thin**; longer factual and proposed design stays in
  [`mcp-harness.md`](mcp-harness.md) and
  [`proposed-architecture.md`](proposed-architecture.md)
- Tracking epic: [#9](https://github.com/jackControls/noBS-CAD/issues/9)

Validate the bundle locally with:

```sh
npm run check:knowledge
```

The Pages site is intentionally a thin landing page over the source bundle.
A richer viewer can be added later without changing `knowledge/` as the source
of truth.
