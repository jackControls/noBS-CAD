---
type: Concept
title: Design VERSION and JSONC script naming
description: Authoritative design artifact is a versioned .nbcad.jsonc recipe script — one VERSION constant, filename + embedded metadata, prune prior revisions, prefer small editable chunks over Python generators.
status: draft
updated: 2026-09-20
topics: workflow, modeling, mcp, export, sessions
keywords: VERSION, DESIGN_VERSION, design_v, nbcad.jsonc, JSONC, design version, script naming, recipe, blank document, cad_interface, AGENTIC.md, chunking, hand-authored
---

# Design VERSION and JSONC script naming

CAD design packages treat a **versioned (or VERSION-embedded) `.nbcad.jsonc`
recipe script** as the authoritative artifact — not a Python generator.
Agents and humans edit JSONC with normal file-edit tools.

## Authoritative artifact

| Role | What |
|------|------|
| **Source of truth** | The live `.nbcad.jsonc` script (and any companion status/meta JSON) |
| **Not required** | A `gen_*.py` / `gen_v*.py` tooling path for design packages |

Prefer **hand-authored / edit-tool JSONC** over Python generators for design
packages. If a leftover `gen_v*.py` exists from an older workflow, prune it
when cutting the next revision (git keeps history).

## One VERSION constant

Keep a single `VERSION` / `DESIGN_VERSION` string as the typed source of truth:

| Form | Example |
|------|---------|
| `VERSION = "M.N"` | `"16.31"` |
| `DESIGN_VERSION = "M.N"` | same role |

Document that constant in the design’s `AGENTIC.md` **Version** / versioning
block — prose that points at the constant, not a second typed value that can
drift.

Embed the **identical** string in:

| Surface | Where |
|---------|--------|
| JSONC recipe | `"version"` metadata field and/or header comment |
| Companion status / meta JSON | `version` (e.g. former `gen_meta`) |
| `AGENTIC.md` | Version block documents the constant |

Filename alone is not enough — search, MCP, and handoff need the embedded
string.

## Filename convention (pick one path by package kind)

### Working designs that cut revisions (INJS / product design packages)

**Preferred golden path: version in the filename AND inside the JSONC.**

| `VERSION` | Live script filename |
|-----------|----------------------|
| `"M.N"` | `design_vM_N.nbcad.jsonc` (dot → underscore) |
| `"M.N.P"` (optional patch) | `design_vM_N_P.nbcad.jsonc` |

Examples: `"16.31"` → `design/design_v16_31.nbcad.jsonc` (path under the design
package as the repo already uses); `"11.2"` → `design_v11_2.nbcad.jsonc`.

Do **not** rely on VERSION-only-inside with a stable unversioned name when you
are cutting INJS / working-package revisions — the versioned filename is part
of the golden path so agents and humans can see which revision is live on disk.

### Product catalog demos / bundled recipes

Stable unversioned recipe ids (chip / `cad_interface` recipe name) may stay
unversioned, with **VERSION only inside** metadata. Those are catalog demos,
not revision-cut working packages.

## Cut rule (working tree)

After a new `design_v*.nbcad.jsonc` is committed and proven (blank-doc replay /
checks as needed):

1. Delete prior `design_v*.nbcad.jsonc` files from the **working tree** in the
   **same** change set.
2. Also delete any leftover `gen_v*.py` (or other generator stubs) that only
   served an obsolete path.
3. Git history keeps old scripts — do **not** pile `design_v16_23`…`30` on disk.

Never keep a stack of obsolete revision files next to the live one.

## Chunking (small editable hunks)

Prefer splitting large scripts into **smaller JSONC chapters / included files /
focused scripts** (setup, body, fasteners, …) so agents edit with normal
file-edit tools in small chunks — not one megabyte generated blob.

If the product only supports a **single** script file today:

- Structure commands into clear **commented sections**
- Keep `VERSION` + section headers for locateability
- Treat **chaptered includes** as the preferred shape when/if the product
  supports them

## Export / MCP

- Blank-document script rule still applies: recipe / `cad_interface` /
  `cad_script` demos start from a blank doc (or intentional wipe) — see
  [MCP workflow](agent-mcp-workflow.md).
- When publishing working-design scripts via `cad_interface` / path, prefer the
  **versioned** `design_vM_N.nbcad.jsonc` filename that matches `VERSION`.
- Print / interchange packages may include `VERSION` in export names when the
  human asks; keep history in `.nbcad` and use 3MF for print packages when
  available ([export and print](export-print.md)).

## Golden path checklist

1. Set or bump one `VERSION` / `DESIGN_VERSION` (document in `AGENTIC.md`).
2. For working designs (INJS): name the live script `design_vM_N.nbcad.jsonc`
   from that string (dot → underscore) **and** embed the same string in JSONC
   `"version"` / meta.
3. For catalog demos: stable recipe id OK; still embed `VERSION` in metadata.
4. Prefer small JSONC chapters / clear section headers — hand-edit, not a
   Python generator.
5. Prove the new script (blank-doc replay / checks).
6. Prune prior `design_v*.nbcad.jsonc` (and any leftover `gen_v*.py`) in the
   same commit.

Related: [MCP workflow](agent-mcp-workflow.md) (blank-document scripts),
[export and print](export-print.md), Design Ops skill
`mcp-vs-script-replay` (one-step MCP vs blank-doc script replay).
