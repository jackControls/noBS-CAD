---
type: Concept
title: Soft disclosure, focus packs, and cad_list_all_tools
description: Soft focus packs guide tool lists without jail; use cad_set_focus for the phase and cad_list_all_tools when planning — out-of-focus tools stay callable.
status: draft
updated: 2026-09-20
topics: mcp, agents, workflow, disclosure, focus
keywords: soft disclosure, focus packs, cad_set_focus, cad_list_all_tools, cad_list_focus_areas, listChanged, dynamic disclosure, full_static, out of focus callable, steerable MCP
related_recipes: fillet-basics, mounting-plate, angle-bracket
---

# Soft disclosure, focus packs, and cad_list_all_tools

Soft disclosure **narrows the advertised tool list** for the phase you are in.
It is **guidance, not a jail**: out-of-focus tools stay **callable**. Hard errors
are missing ids, invalid sketch state, or kernel failure — never “not in focus.”

## Modes

| Mode | Who | Behavior |
|------|-----|----------|
| **`dynamic`** (default) | Main agent / human | Spine ∪ active ∪ soft packs |
| **`full_static`** | Broken clients / some subagents | Advertise everything |

Prefer `cad_list_all_tools` for planning over leaving the session in
`full_static` forever.

## Focus packs (set with `cad_set_focus`)

Call `cad_list_focus_areas` for the live list. Typical packs:

| Pack | Phase |
|------|--------|
| `document` | Name, project load/export, session metadata |
| `sketch` | Sketch create / constraints / dimensions |
| `solid` | Extrude, revolve, sweep, loft, rib |
| `modify` | Fillet, chamfer, hole |
| `body_ops` | Shell, patterns, combine, split, STEP import |
| `datums` | Construction planes / datum features |
| `history` | Rollback, delete, reorder |
| `inspect` | Read-only solid/sketch catalogs |
| `print` | 3MF/STL/STEP export, materials |
| `cam` | Tool library, toolpaths, post, sim |
| `assembly` | Components, joints, interference |

Soft packs **expire** (TTL / LRU). Re-set focus when the phase changes.

## Teaching loop

1. `cad_list_focus_areas` — know the vocabulary.
2. `cad_set_focus` to the phase (`sketch` → `solid` → `modify` → `inspect`).
3. If the short list looks thin or you need a name: **`cad_list_all_tools`**
   (schemas + focus tags) — do **not** invent tool names.
4. Mutate → [inspect between mutates](inspect-between-mutates.md).
5. Out-of-focus call still OK; expect it may re-promote packs (`listChanged`).

## Checklist

- [ ] Focus matches the next write (sketch vs solid vs modify)
- [ ] Planner used `cad_list_all_tools` instead of guessing APIs
- [ ] No “tool missing” conclusion without listing all tools / setting focus
- [ ] Headless goldens still pass without depending on a UI focus state

## Anti-patterns

- Treating soft disclosure as authorization
- Staying in `full_static` because “search is hard”
- Inventing `solid_fancy_fillet` when `cad_list_all_tools` already names the op
- Skipping inspect because the focus pack looked confident

Related: [agent MCP workflow](agent-mcp-workflow.md),
[attach vs headless](attach-vs-headless-sessions.md),
[MCP harness](mcp-harness.md),
[STEERABLE_MCP](../../docs/agentic/STEERABLE_MCP.md).
