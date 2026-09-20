---
type: Concept
title: AM clamshell retainer
description: Slide-fit first, then optional detents — clamp faces carry strength; detents only retain the clip.
status: draft
updated: 2026-09-20
topics: dfam, am, snap-fit, joints, fdm
keywords: clamshell retainer, slide fit, detent, clamp face, retainer clip, C-clip, frame retainer, removable slide, retention bump
related_recipes: turbine-fit-coupons
sources: nwtc-guns-dfm, doe-3d
---

# AM clamshell retainer (slide first, detent second)

Use when an FDM/AM **retainer** holds two clamshell halves together. Never invent
snap geometry without this order.

## Print orientation

- Print the retainer **on its side** so layer lines run with the clamp load
  (stronger against the halves separating) — see
  [AM thin walls / anisotropy](am-thin-walls.md).
- Prefer a simple **rectangle with a center cutout** (channel / frame), not a
  decorative C or ornamental hooks, until the slide fit is proven.

## Function split (do not merge)

1. **Clamp / strength** — faces that keep the two halves from separating. Sized
   for a clean removable **slide-in**.
2. **Retention** — small **detents on the inserted faces** only, added *after*
   the sliding fit is confirmed. Detents keep the clip from falling out; they
   are **not** the load path.

The surface that carries strength is not the surface that provides snap retention.
Friction detents without a distinct hook still belong in the retention role —
see [AM snap-fits](am-snap-fit.md) mechanism classes.

## Order of work

1. Model a perfect removable **sliding** shape against the real pockets (dims,
   clearances, tolerances, mating surfaces).
2. Validate: slide in / slide out by hand intent, no overlap on the clamp
   faces, printable without supports in the side orientation.
3. Only then add **tiny detent** details on the insert faces.
4. Do not invent complex barbs, I-beams, or load-bearing snaps while iterating
   the slide fit.

## Engineering checklist

- [ ] Nominal + clearance / press **roles** called out (radial vs diametral)
      — [fits & clearances](fits-clearances.md)
- [ ] Mating surface finish / print orientation noted
- [ ] Lifetime: abrasion and plastic set on **detents**, not on the clamp faces
- [ ] Kid-removable when required: soft detent force; clamp still structural
- [ ] Locators separate from retainer — [alignment nubs vs pins](alignment-nubs-pins.md)
- [ ] Shot pack includes section through clamp + detent
      ([validate before show](../../concepts/validate-before-show.md))

## CAD / knowledge

Prefer local `cad_help` / `nbcad://knowledge/...` before inventing geometry
([research before commit](../../concepts/research-before-commit.md)). Prove the
joint with section/inner shots and
[adversarial mesh audit](../../concepts/adversarial-mesh-audit.md) before export.
Inspect between mutates with `solid_scene`
([MCP workflow](../../concepts/agent-mcp-workflow.md)).
