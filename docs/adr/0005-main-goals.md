# ADR 0005 — High-level product directions

- Status: Proposed
- Date: 2026-07-27
- Detail: `docs/goals.md` (mission / harness docs PR)

## Context

The project needs a short shared north star. Long prose belongs in
`docs/goals.md`; proposed implementation ideas belong in
`docs/proposed-architecture.md`.

## Decision (proposed)

Track these as accepted **high-level directions** (mechanical CAD first):

1. Reliable mechanical CAD foundation
2. CAM (careful 3-axis path)
3. Additive manufacturing (3MF with useful color/material metadata; keep STEP)
4. Strong local automation (MCP)
5. Simulation / analysis in **stages** (fit → motion → strength later)

Education-style tutorials/quests may come later; they are not a top-level
committed goal today.

## Consequences

- New features should map to at least one direction in the PR or issue.
- Do not treat proposed architecture (focus tools, co-link, multi-window) as
  already shipped.
- Docs stay plain language.
