# Knowledge bundle (OKF)

The `knowledge/` directory is an
[Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundle: Markdown concepts with YAML frontmatter for humans and agents.

- Browse in-repo: start at [`knowledge/index.md`](../knowledge/index.md)
- Hosted: [knowledge site](https://jackcontrols.github.io/noBS-CAD/) via `.github/workflows/pages-knowledge.yml`
- Agents: prefer reading the markdown files over scraping the HTML page
- MCP: use `resources/list` and `resources/read` for the same Markdown bundled
  into the native server. Start at `nbcad://knowledge/index.md`; use listed titles
  and descriptions to find gear and workholding guidance before designing.
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

The MCP inventory is derived from `knowledge/**/*.md` during compilation, including
the index and update log. Reads return the compiled Markdown unchanged, without
network requests, arbitrary file access, document mutation or an additional tool
surface. The immutable bundle does not advertise subscriptions or list changes;
rebuild the server when updating it. Links outside `knowledge/` point to supporting
repository documents and are not separately served as MCP resources.
