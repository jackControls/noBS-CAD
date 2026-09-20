---
type: Concept
title: Attach vs headless sessions
description: When to stay headless vs cad_list_sessions / cad_attach / cad_refresh / cad_detach — snapshot bridge rules; never write model.json by hand.
status: draft
updated: 2026-09-20
topics: mcp, agents, sessions, workflow, desktop
keywords: cad_attach, cad_detach, cad_refresh, cad_list_sessions, headless, live document, snapshot bridge, NBCAD_SESSION_DIR, window_id, UUID session, model.json
related_recipes: fillet-basics, mounting-plate, angle-bracket
---

# Attach vs headless sessions

An unattached MCP process owns a **headless** document (shared Rust planner +
OCCT). It does **not** silently edit the visible desktop document. Live control
is an **explicit** attach to a published session.

## Choose a mode

| Goal | Mode |
|------|------|
| Goldens, coupons, recipes, CI | **Headless** — no `cad_attach` |
| Drive the user's open window | **Attach** after `cad_list_sessions` |
| Read latest UI export into MCP | `cad_refresh` on an attached session |
| Stop live binding | `cad_detach` — next edits need a new explicit selection |

## Snapshot bridge (honest scope)

`cad_list_sessions` / `cad_attach` / `cad_refresh` / `cad_detach` implement a
**read-only snapshot bridge** under `NBCAD_SESSION_DIR`:

1. Session ids are **UUID v4** (document display names are rejected).
2. The desktop publishes `<uuid>/{model.json,active-sketch.json?,focus.json,heartbeat.json}`.
3. Attach **fails** if `model.json` is missing or invalid.
4. MCP **never** writes those session files back after editing in memory.
5. Refresh is **explicit** (no filesystem watcher).
6. This is **not** a live UI co-link / last-writer-wins writeback.

## Agent checklist

- [ ] Headless path chosen for recipes and goldens
- [ ] Live path: list sessions → attach UUID → submit via owning UI inbox / await apply
- [ ] Never hand-edit `model.json` or reuse a retired session id as a new owner
- [ ] After detach, do not assume the previous document is still selected
- [ ] Blank-doc scripts still run on a **new** project — see
      [agent MCP workflow](agent-mcp-workflow.md)

## Anti-patterns

- Attaching because “headless feels scarier” for a coupon that should be hermetic
- Treating attach success as permission to clobber the user's reviewed solid with a recipe
- Polling session files instead of `cad_refresh`
- Inventing session ids from window titles

Related: [MCP harness](mcp-harness.md),
[soft disclosure](soft-disclosure-focus-packs.md),
[STEERABLE_MCP](../../docs/agentic/STEERABLE_MCP.md),
[install / sessions notes](../../docs/agentic/MAINTENANCE.md).
