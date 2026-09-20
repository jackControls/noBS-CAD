---
type: Concept
title: Research before commit
description: Local help-first gate — VERIFY table, datasheets, and mechanism class before freezing mating geometry.
status: draft
updated: 2026-09-19
topics: agents, workflow, research, help
keywords: research before commit, VERIFY table, datasheet, freeze geometry, hardware envelope, mechanism class, citation
related_recipes: turbine-fit-coupons, d-screw-vise-fit
---

# Research before commit

Late research is how wrong envelope dims and wrong mechanism classes get baked
into history. Gate **commits** that freeze mating geometry, hardware pockets,
snap class, or fit numbers.

## Hard gate

Do not freeze pocket dims, fastener patterns, bearing seats, or snap class
until this checklist is green (or explicitly waived with reason).

## Order of retrieval

1. **Local MCP help first** — `cad_help` `search`, then `get` on returned ids.
   Caps: search default 5 / max 10, snippet ~280 chars, get 12 KiB, topics
   page 50.
2. **Full page only after selection** — `resources/read` on the selected
   `nbcad://knowledge/...` URI when complete markdown is needed; resources are
   not the first search surface.
3. **Product docs / recipes** — fit coupons (`turbine-fit-coupons`,
   `d-screw-vise-fit`), agent workflow ([agent MCP workflow](agent-mcp-workflow.md)).
   Agents replay recipes on a **blank** document.
4. **Primary datasheets / catalogs** for purchased parts (bearing, fastener,
   motor) — record nominal + tolerance **source**.
5. **Web search** only as escape hatch; cite URL + date. Never paste closed
   standards tables (ASME/ISO body text) into model notes as if they were yours.

## Capture a VERIFY table before modeling

Write a short design brief (chat or doc):

| Item | CAD default / guess | Measured or datasheet | Source | Status |
|------|---------------------|------------------------|--------|--------|
| Critical envelope dim | … | … | URL / KB id | OK / WAIVE |
| Fit role (radial vs diametral) | … | … | … | … |
| Mechanism class | … | … | … | … |
| Purchased part id | … | … | catalog | … |

Also record: function + constraints, print process, open questions.

## Commit rule

- Changing a VERIFY row by more than process tolerance ⇒ regenerate affected
  features; do not “nudge” unrelated faces.
- If research flips mechanism class (tabs vs clips, press vs slip), scrap the
  wrong embodiment — do not patch.

## Anti-patterns

- Modeling from memory of a similar part
- Trusting a single blog dimension for hardware
- One global slicer hole compensation instead of role-based CAD fits
- Skipping [fits & clearances](../machine-design/concepts/fits-clearances.md)
  / [AM snap-fits](../machine-design/concepts/am-snap-fit.md) when those are
  the decision

Related: [agent MCP workflow](agent-mcp-workflow.md),
[bearing stacks](bearing-stacks.md).
