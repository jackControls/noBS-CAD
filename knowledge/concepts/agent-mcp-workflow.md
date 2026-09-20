---
type: Concept
title: Agent MCP workflow
description: Tenacity and local help-first doctrine for MCP agents driving noBS CAD.
status: draft
updated: 2026-09-19
topics: mcp, agents, workflow, help
keywords: cad_help, tenacity, soft focus, list_all_tools, inspect, blank document, recipes, examples
related_recipes: fillet-basics, mounting-plate, angle-bracket
---

# Agent MCP workflow

Agents share the **same** help corpus as humans. Start with `cad_help`
`search`, then `get` one or two returned ids. Use `resources/read` only after
selecting a page, when the full markdown is needed; resources are a full-page
read, not the first search surface. Web search remains the escape hatch.

Caps are locked (2026-09-19): search default 5 / max 10, snippet ~280 chars,
get 12 KiB, and topics page 50. Retry with a sharper query rather than
dumping pages.

## Tenacity

1. Failures are usually missing IDs, wrong focus, or an unfinished sketch — not
   “the tool is gone.”
2. Out-of-focus tools stay **callable**. Soft disclosure is guidance.
3. If a tools list looks thin, call `cad_list_all_tools` (or set focus) instead
   of inventing APIs.
4. After a miss, **search again** with synonyms / CAD jargon (`clearance fit`,
   `draft angle`) then `get` one or two ids.

## Local help before the web

- `cad_help` action `search` → snippet hits (default limit 5, max 10).
- `cad_help` action `get` with a returned **id only** (never a filesystem path).
- `resources/read` on the selected `nbcad://knowledge/...` URI when the full
  page is needed; do not use it as a substitute for `cad_help` search.
- `cad_help` action `topics` to browse the topic map.
- NC / standards URLs in pages are **citations**; do not paste standards body
  text into the session.

## Soft focus and inspection

- Default disclosure is **dynamic**; soft packs expire.
- Inspect between mutates: `solid_scene` / `cad_document` / sketch status before
  the next write.
- Prefer blank-document scripts (`cad_interface` action `script` with a recipe
  id or JSONC source) over hand-rolling every call for known lessons.

## Recipes and presentation deep-links

Help pages list `related_recipes`. Those ids are the same catalog as
`cad_interface` action `recipes`.

| Audience | How to open a recipe |
|----------|----------------------|
| **Agent** | `cad_interface` `{ "action": "script", "recipe": "<id>", "mode": "fast" }` on a **blank** document |
| **Human (Help UI)** | Recipe chip → deep-link **Scripts / presentation** for the same `.nbcad.jsonc` |

There is **no** Bevy viewport inside Help. Presentation playback uses the
existing desktop Scripts path; agents use the same recipe sources headlessly.

## Quick loop

1. `cad_help` search for the design concept, then `get` one returned id.
2. If full markdown is needed, `resources/read` the selected knowledge URI;
   note `related_recipes`.
3. Inspect scene → mutate → inspect again.
4. Run a recipe on a blank doc when the lesson matches.
