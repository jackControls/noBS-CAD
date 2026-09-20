# Agentic JSONC workflow (short)

**Source of truth** for rebuildable designs is version-1 `.nbcad.jsonc`, not the
live MCP call stream and not `cad_script`.

## Rebuild loop

1. Edit the root `.nbcad.jsonc` (and optional `collections/*.collection.jsonc`).
2. Replay on a **blank** document:

```json
{
  "action": "script",
  "path": "/absolute/path/design.nbcad.jsonc",
  "mode": "fast",
  "validate": true
}
```

3. Use live MCP `execute` only for tiny exploratory tweaks.
4. Fold durable changes back into JSONC. Prefer hand-authored `$select` /
   `$project` over literal entity IDs.

`mode: "fast"` (the default) skips `note` / `view` presentation while keeping
every modeling call and check — including steps contributed by collections.

## Collections

Root scripts may declare `includes` so each part lives in its own fragment:

```jsonc
"includes": ["collections/base.collection.jsonc", "collections/lid.collection.jsonc"]
```

Fragments supply `steps` (and optional `checks`). Ids share one namespace — prefix
them per part. Includes require a **path**-loaded root (so the host can resolve
relative files). Nested includes are allowed with cycle detection.

## Export vs `cad_script`

| Tool / action | Output | Use |
|---------------|--------|-----|
| `cad_interface` → `export_script` | Version-1 `.nbcad.jsonc` `source` string | Scratch round-trip / retain last authored script |
| `cad_script` | `{ calls: [{ name, arguments }] }` | Debug the forward MCP mutate stream |

`export_script` fidelity:

- **`lossless_authored`** — last successful `action: script` source in this process
  (commands/refs preserved; comments may be missing if includes were flattened).
- **`lossy_session_trace`** — rebuilt from `tool_trace` with literal arguments; no
  `$select`, no teaching notes; not for published recipes.

UI-only edits and attach baselines (`cad_load_project_model`) are **not** turned
into faithful JSONC in this MVP. Document gaps rather than inventing history.

## Do not

- Treat `cad_script` as a recipe.
- Run scripts over a non-empty document.
- Rely on presentation mode for agent CI rebuilds.
