---
type: Concept
title: Validate before show
description: Review shot pack that proves a looks-good claim — outer, rear, cavity, section, joint detail.
status: draft
updated: 2026-09-20
topics: review, viewport, validation, mcp
keywords: shot pack, review PNG, isometric, section cutaway, cavity view
related_recipes: turbine-fit-coupons, fillet-basics
---

# Validate before show

A **looks-good** claim rides on a review **shot pack** that shows the geometry
from the outside, the rear, the cavity, a section through the critical wall,
and a detail of the joint under discussion.

## Shot pack (golden path)

Capture and attach (or MCP viewport equivalents) before sign-off:

1. **Outer isometric** — whole part visible, lit, silhouette readable
2. **Behind / rear** — opposite of the primary cosmetic face
3. **Inner / cavity** — pockets, seats, wire windows
4. **Section or cutaway** — through critical wall, seat, or bearing bore
5. **Detail of critical joint** — snap, pin, bearing, fastener boss

Useful extras: bottom/bed face, exploded mates, fit coupon beside the part.

Each frame earns its place when a reviewer can check the claim from the image
(silhouette present, camera outside the solid bbox, right body, enough of the
feature in frame). Interior views use a **section plane** or intentional
cutaway rather than placing the camera origin inside the volume.

## Procedure

1. After a geometry write: `solid_scene` / document inspect — bodies and
   feature fields match intent ([MCP workflow](agent-mcp-workflow.md)).
2. Place cameras outside the bbox; for cavities use section/cutaway.
3. Confirm silhouette + recognizable features in each PNG before attaching.
4. Send the pack with a **one-line claim** tied to what the images show.

Prefer the product visual surface for ship claims when browser viewport and
packaged Bevy differ.

## Pair with

- [Adversarial mesh audit](adversarial-mesh-audit.md) before export
- [Research before commit](research-before-commit.md) for cited dims
- [AM snap-fits](../machine-design/concepts/am-snap-fit.md) section shot when clips/seats matter
- [Assembly interference check](assembly-interference.md) for multi-body poses

Related: [export and print](export-print.md), [MCP harness](mcp-harness.md).
