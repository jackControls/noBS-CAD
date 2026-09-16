# LOCAL-NOTES — parametric primitives primer (MCP surfacing)

## Landed in this commit

- `docs/agentic/PARAMETRIC_PRIMITIVES.md` — operational primer
- `docs/agentic/INDEX.md` — link added
- `knowledge/concepts/parametric-primitives.md` — OKF concept (MCP resource after rebuild)
- `knowledge/index.md` — Concepts list entry
- `examples/scripts/parametric-primitives-primer.nbcad.jsonc` — hello script (**not** in `crates/recipes` catalog)

## MCP knowledge wiring (cheap — already automatic)

`mcp-server/build.rs` walks `knowledge/**/*.md` into `OUT_DIR/knowledge_bundle.rs`.
`mcp-server/src/knowledge.rs` serves them as `nbcad://knowledge/<relative-path>`.

After this tree is built into `nbcad-mcp` / packaged `--mcp`:

1. `resources/list` → find title **Parametric primitives primer**
2. `resources/read` → `nbcad://knowledge/concepts/parametric-primitives.md`

**Rebuild required** for a running binary to see the new page. No extra Rust
registration file is needed for knowledge.

## Recipe / `cad_interface` recipes entry (optional, heavier)

To advertise the hello script in `{"action":"recipes"}`:

1. Keep `examples/scripts/parametric-primitives-primer.nbcad.jsonc`
2. Add a `Recipe { id: "parametric-primitives-primer", … }` in `crates/recipes/src/lib.rs`
3. One-line mention in `examples/scripts/README.md`
4. Prefer a focused check in `mcp-server/tests/recipes.rs` (geometry/history), not an all-tools gate

Until then, run via absolute `path` (or `source`) on `cad_interface` action `script`.

## Out of scope here

- Steerable disclosure / `tags_for_tool` changes
- Push / PR to `jackControls/noBS-CAD`
