---
type: Concept
title: Inspection / metrology bridge (CAD-time)
description: Thin bridge from GD&T / drawing-vs-MBD packs to what inspection must receive — roles and VERIFY gates, not gage recipes or CMM programs.
status: draft
updated: 2026-09-20
topics: gdt, inspection, metrology, mbd, pmi, drawings, dfm
keywords: inspection, metrology, CMM, gage, functional gage, first article, FAIR, balloon, characteristic, datum scheme, as-built, MBD to shop
related_recipes: mounting-plate, turbine-fit-coupons, d-screw-vise-fit
sources: nist-gdt-2, nist-pmi, doe-3d
---

# Inspection / metrology bridge (CAD-time)

CAD decides **what must be true**; inspection decides **how to prove it**. This
page is a thin bridge from [GD&T intro](gdt-intro.md) and
[drawing vs MBD / PMI](drawing-vs-mbd-pmi.md) to the handoff pack — not a CMM
program, gage design guide, or FAIR template dump.

**Attribution:** inspection/implementation teaching spine from NIST / Berez
GD&T Part II (`nist-gdt-2`, CC BY 4.0); PMI examples pattern from NIST MBE PMI
(`nist-pmi`, public domain). Prefer cited methods over inventing tolerance
or probe recipes in Help.

## Golden path (CAD-time)

1. **Name the characteristic set** — which dimensions / FCFs / notes are
   product-critical vs reference. Prefer fewer, functional characteristics.
2. **Datum scheme matches manufacture and check** — same primary/secondary
   story on the model, drawing, and fixture intent
   ([locating schemes](locating-scheme-dof.md), [GD&T intro](gdt-intro.md)).
3. **Pack choice** — 2D drawing balloons, MBD PMI, or dual. Whatever you ship
   must be readable by the shop/metrology path you actually have
   ([drawing vs MBD / PMI](drawing-vs-mbd-pmi.md)).
4. **Method class, not gadget list** — attribute gage, variable gage, CMM,
   optical, or functional check — name the **class** and cite the method; do
   not invent probe paths or GR&R numbers in Help.
5. **As-built loop** — fit coupons and first articles feed allowances back into
   CAD ([fit coupons map](fit-coupons-recipes-map.md),
   [fits](fits-clearances.md)).
6. **VERIFY** — inspection claims need a cited procedure or shop standard;
   Help stays roles + checklist
   ([research before commit](../../concepts/research-before-commit.md)).

## Prefer these patterns

| Need | Prefer |
|------|--------|
| Clear shop handoff | One pack (drawing or MBD) with named critical characteristics |
| Functional fit | Coupon + fit class before tightening every FCF |
| Datum fight between model and fixture | Reconcile locate scheme before more PMI |
| Deep CMM / GR&R / gage design | Outside Help — shop procedure or cited standard |

## Related

- [GD&T intro](gdt-intro.md)
- [Drawing vs MBD / PMI](drawing-vs-mbd-pmi.md)
- [Tolerance stack-up intro](tolerance-stackup-intro.md)
- [Fits & clearances](fits-clearances.md)
- [SOURCES](../SOURCES.md) (`nist-gdt-2`, `nist-pmi`)

Related: [taxonomy](../taxonomy.md).
