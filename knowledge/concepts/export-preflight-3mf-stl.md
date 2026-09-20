---
type: Concept
title: Export preflight — 3MF vs STL for AM
description: Choose 3MF over STL for print packages when available; run mesh preflight and keep qualification boundaries clear.
status: draft
updated: 2026-09-20
topics: export, print, am, dfam, validation, mesh
keywords: export preflight, 3MF vs STL, 3MF, STL, print export, mesh preflight, AM export, slicer package, manifold mesh, appearance metadata
related_recipes: turbine-fit-coupons, fillet-basics
---

# Export preflight — 3MF vs STL for AM

Agents often export **STL by habit**. Prefer **3MF** for additive packages when
the build supports it, then run **mesh preflight** before claiming printable.

Product overview also lives on [export and print](export-print.md). This page is
the **searchable agent checklist** for format choice + preflight. Manifold /
wall-probe deep dives stay on
[adversarial mesh audit](adversarial-mesh-audit.md).

## 3MF vs STL (practical)

| | **3MF** | **STL** |
|--|---------|---------|
| Role | Preferred **print package** | Fallback mesh |
| Appearance / body metadata | Often preserved (product-dependent) | Typically none |
| Units / multi-body story | Better package semantics | Easy to mis-scale in slicers |
| When to use | Default AM export when available | Legacy slicer or explicit request |

Keep **`.nbcad`** for editable history and **STEP** for CAD interchange. Mesh
export is not a substitute for either.

## Preflight checklist (before Jeff-facing “printable”)

1. **Body selection** — export the intended bodies only; no leftover coupons
   unless intentional.
2. **Units** — mm project → mm mesh; confirm slicer import scale
   ([unit systems](unit-systems-mm-default.md)).
3. **Manifold / watertight** — run mesh preflight; fix non-manifold edges.
4. **Wall probe** — thin walls and seats
   ([adversarial mesh audit](adversarial-mesh-audit.md)).
5. **Orientation** — note bed face; supports policy separate from mesh truth.
6. **Format** — 3MF first; STL only as fallback with the same preflight.
7. **Hash / identity** — keep export identifiable against the native document.
8. **Qualification boundary** — manifold ≠ strength ≠ fit. Coupon mates
   ([fits](../machine-design/concepts/fits-clearances.md)).

## Agent search disambiguation

- Query **3MF vs STL** / **export preflight** → this page
- Query **manifold / wall probe / shard** → [adversarial mesh audit](adversarial-mesh-audit.md)
- Query **slicer bridging / G-code evidence** → [export and print](export-print.md)

## Anti-patterns

- Shipping STL “because everyone does” without trying 3MF
- Claiming printable from a green preflight alone
- Silently enabling slicer geometry-changing simplifies on critical fits
- Exporting without `solid_scene` / mesh audit after the last mutate
  ([inspect between mutates](inspect-between-mutates.md))

Related: [AM supports / overhangs](../machine-design/concepts/am-supports-overhangs.md),
[validate before show](validate-before-show.md).
