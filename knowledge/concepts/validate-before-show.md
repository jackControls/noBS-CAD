---
type: Concept
title: Validate before show
description: Mandatory review shot pack before any looks-good claim — reject blank frames and cameras inside solids.
status: draft
updated: 2026-09-20
topics: review, viewport, validation, agents, mcp
keywords: validate before show, shot pack, review PNG, blank frame, camera inside solid, section cutaway, inner cavity, behind rear, isometric review, opaque solid
related_recipes: turbine-fit-coupons, fillet-basics
---

# Validate before show

Passing numeric gates while shipping bad geometry happened when review cameras
sat **inside solids** or frames were **blank**. Do not claim “looks good” without
a valid **shot pack**.

## Mandatory shot pack

Capture and attach (or MCP viewport equivalents) before human/agent sign-off:

1. **Outer isometric** — whole part visible, lit, not clipped
2. **Behind / rear** — opposite of the primary cosmetic face
3. **Inner / cavity** — look into pockets, seats, wire windows
4. **Section or cutaway** — through critical wall, seat, or bearing bore
5. **Detail of critical joint** — snap, pin, bearing, fastener boss

Optional but recommended: bottom/bed face, exploded mates, fit coupon beside part.

## Automatic reject (do not present)

Reject and recapture if any frame shows:

- **Blank / near-blank** (empty background, no silhouette)
- **Camera inside solid** (cavity flood, back-face soup, silhouette is interior blob)
- **Wrong body / empty doc**
- **Clipped so the claim cannot be checked** (e.g. wall-thickness claim with no section)
- **All-translucent “ghost”** as the only Jeff-facing evidence when opacity≪1 hides walls

## Procedure

1. After geometry mutate: `solid_scene` / document inspect — confirm bodies exist.
2. Place cameras **outside** the bbox. For inner shots use a **section plane** or
   intentional cutaway — not a camera origin inside volume.
3. For each shot: verify silhouette + recognizable features in the PNG before attaching.
4. Adversarial pass: would a hostile reviewer say “this image proves nothing”? If yes, reshoot.
5. Only then send the pack with a **one-line claim** tied to what the images show.

Browser viewport may not equal packaged Bevy truth — prefer the product visual
surface for ship claims ([agent MCP workflow](agent-mcp-workflow.md)).

## Pair with

- [Adversarial mesh audit](adversarial-mesh-audit.md) before export
- [Research before commit](research-before-commit.md) for cited dims
- [AM snap-fits](../machine-design/concepts/am-snap-fit.md) section shot when clips/seats are involved
- [Assembly interference check](assembly-interference.md) when multi-body poses matter

Related: [export and print](export-print.md), [MCP harness](mcp-harness.md).
