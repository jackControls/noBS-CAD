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

## Mechanical-design guidance

The [four introductory articles](../knowledge/index.md#mechanical-design-guidance)
cover datums, fits, manufacturing and assembly decisions. They link to the existing
gear, workholding, bearing and printing guidance and to committed recipes.

An agent can list resources, choose a title/description, then read an article such
as `nbcad://knowledge/machine-design/concepts/fits-clearances.md`. Follow related
resource links for context. Use `cad_interface` with `action: recipes` to inspect
the current recipe catalog before selecting a referenced example. The articles
do not run commands or replace the current document.

## Maintaining the content

Write guidance that helps a reader make a concrete design decision. Include an
example or check where useful. Keep assumptions, units and the boundary between
digital validation and physical evidence explicit. Remove empty topic pages;
the index should describe content a reader can use now.

For the mechanical-design articles, `sources` and `related_recipes` are
comma-separated stable IDs (`[]` means no related recipes). Source IDs resolve
through [SOURCES.md](../knowledge/machine-design/SOURCES.md); recipe IDs resolve
through the committed recipe catalog. Cite primary references beside the material
they support, with author, title, link, license and an adaptation notice where
applicable. Record only references the articles actually use.

Check each source's reuse terms before adapting it. Keep required credit and
license notices; the repository license does not erase a source's attribution
requirements. Link to proprietary standards and material with incompatible or
unclear reuse terms rather than copying it. Do not reproduce standards tables,
vendor datasets or third-party figures without the necessary permission.

`npm run check:knowledge` validates structure, source metadata, recipe paths and
case-sensitive local links. Its fixture tests run in the existing Pages job;
native MCP tests check that every Markdown file is served unchanged and recipe
references name published recipes. These checks do not establish factual accuracy,
license compatibility or physical fitness; review the article and cited source.

The Markdown and MCP resource URIs are the foundation for future native Help and
lessons. A later Bevy surface can consume this same content; this scope adds no
search engine, duplicate help API or browser Help panel.
