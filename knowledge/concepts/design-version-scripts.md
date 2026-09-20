---
type: Concept
title: Design VERSION and generator script naming
description: One authoritative VERSION string drives gen_vM_N.py filenames, embedded metadata, and cut/prune of obsolete generators.
status: draft
updated: 2026-09-20
topics: workflow, modeling, mcp, export, sessions
keywords: VERSION, DESIGN_VERSION, gen_v, gen_meta, design version, script naming, generator, blank document, cad_interface, recipe id, AGENTIC.md
---

# Design VERSION and generator script naming

CAD design packages keep **one** version string as the source of truth. That
string names the live generator file, appears inside the script and companion
metadata, and is what you prune against when cutting the next revision.

## Authoritative home (one source of truth)

Prefer a single module-level constant in the design’s generator package:

| Form | Example |
|------|---------|
| `VERSION = "M.N"` | `VERSION = "16.31"` |
| `DESIGN_VERSION = "M.N"` | same role |

Put the same string in the design’s `AGENTIC.md` **Version** / versioning block
as documentation of that constant — not a second typed value that can drift.

Generators **import or read** the constant. Do not re-type divergent version
strings across files.

## Filename convention

| `VERSION` | Live generator filename |
|-----------|-------------------------|
| `"M.N"` | `gen_vM_N.py` (dot → underscore) |
| `"M.N.P"` (optional patch) | `gen_vM_N_P.py` |

Examples: `"16.31"` → `gen_v16_31.py`; `"11.2"` → `gen_v11_2.py`.

Keep the stable recipe / JSONC path unversioned when the design already uses
one (version lives **inside** the file and in the generator name).

## Embed the same string

Wherever the design records version, use the **identical** `VERSION` value:

| Surface | Where |
|---------|--------|
| Python generator | Module `VERSION` / `DESIGN_VERSION` **and** docstring |
| Status / meta JSON | `gen_meta` (or equivalent) field `version` |
| JSONC recipe | Header comment and/or `"version"` metadata if present |

Filename alone is not enough — search, MCP, and handoff all need the embedded
string.

## Cut rule (working tree)

After a new `gen_v*.py` is committed and proven (regenerated JSONC / meta as
needed):

1. Delete prior `gen_v*.py` files (and stale companion stubs that only served
   the old generator) from the **working tree** in the **same** change set.
2. Git history keeps old scripts — do **not** pile `gen_v16_23`…`30` on disk.
3. Never keep a stack of obsolete generators next to the live one.

## Export / MCP

- Blank-document script rule still applies: recipe / `cad_interface` /
  `cad_script` demos start from a blank doc (or intentional wipe) — see
  [MCP workflow](agent-mcp-workflow.md).
- When publishing scripts via `cad_interface` / recipes, prefer **versioned
  recipe ids or filenames that match `VERSION`**.
- Print / interchange packages may include `VERSION` in export names when the
  human asks; keep history in `.nbcad` and use 3MF for print packages when
  available ([export and print](export-print.md)).

## Golden path checklist

1. Set or bump one `VERSION` / `DESIGN_VERSION` constant.
2. Name the generator `gen_v…` from that string (dot → underscore).
3. Embed the same string in docstring, `gen_meta.version`, and JSONC metadata.
4. Prove the new generator (blank-doc replay / checks).
5. Delete prior `gen_v*.py` (and stale companions) in the same commit.
6. Point `AGENTIC.md` versioning prose at the constant (do not fork a second
   number).

Related: [MCP workflow](agent-mcp-workflow.md) (blank-document scripts),
[export and print](export-print.md), Design Ops skill
`mcp-vs-script-replay` (one-step MCP vs blank-doc script replay).
