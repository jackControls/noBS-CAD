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

Fragments supply `steps` (and optional `checks`). An included `.nbcad.jsonc`
contributes the same steps and checks; its version, starting state, verification,
and exports are ignored. Ids share one namespace — prefix them per part.

Include paths are relative to the file that contains the `includes` entry. A
fragment in `collections/` that includes `b.collection.jsonc` loads
`collections/b.collection.jsonc`. Paths cannot contain `..`. Loading still
requires a **path**-loaded root, or inline `source` with an absolute
`include_base`. Nested includes are allowed with cycle detection.

## Export vs `cad_script`

| Tool / action | Output | Use |
|---------------|--------|-----|
| `cad_interface` → `export_script` | Version-1 `.nbcad.jsonc` `source` string | Scratch round-trip / retain last authored script |
| `cad_script` | `{ calls: [{ name, arguments }] }` | Debug the forward MCP mutate stream |

`export_script` fidelity:

- **`lossless_authored`** — last successful `action: script` source in this process
  (commands/refs preserved; comments may be missing if includes were flattened).
  Pretty-printed. `stale: true` means later tools ran; the text is still that script.
- **`lossy_session_trace`** — rebuilt from `tool_trace` with literal arguments; no
  `$select`, no teaching notes; not for published recipes.

`from: auto` returns the authored script only while no modeling tool has
succeeded since that run; live desktop edits count as well. After later tools
(for example `solid_box`), `auto` exports the session trace instead.
`from: last_script` still returns the authored source, with `stale: true`.

UI-only edits and attach baselines (`cad_load_project_model`) are **not** turned
into faithful JSONC in this MVP. Document gaps rather than inventing history.

## Do not

- Treat `cad_script` as a recipe.
- Run scripts over a non-empty document.
- Rely on presentation mode for agent CI rebuilds.
- Treat a stale `lossless_authored` export as the current model. Use `from: auto`
  after further tool calls.
