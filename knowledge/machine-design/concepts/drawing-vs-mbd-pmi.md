---
type: Concept
title: Drawing vs MBD / PMI (CAD-time)
description: When to prefer 2D drawing notes vs model-based definition / PMI; datum packs on sheet vs 3D; VERIFY PMI against the manufacturing process.
status: draft
updated: 2026-09-20
topics: gdt, drawings, mbd, pmi, inspection, manufacturing, datums
keywords: drawing, 2D drawing, MBD, model-based definition, PMI, product manufacturing information, annotation, feature control frame, datum, title block, ASME Y14.41, Y14.5, digital product definition, balloon, note
related_recipes: mounting-plate, angle-bracket, turbine-fit-coupons, d-screw-vise-fit
sources: nist-pmi, nist-gdt-1, asme-y14
---

# Drawing vs MBD / PMI (CAD-time)

**Product definition** can live on a **2D drawing**, in the **3D model** as
**PMI** (product manufacturing information / annotations), or both. CAD-time
work is choosing **which carrier owns each requirement** and keeping datums,
notes, and process intent aligned — not dumping a vendor PMI tutorial into Help.

**Attribution:** vocabulary aligned with public NIST MBE / PMI example sets
(`nist-pmi`) and the NIST GD&T teaching spine. Legal syntax lives in
[ASME Y14.5](https://www.asme.org/codes-standards) (tolerancing) and
**Y14.41** (digital product definition data practices) — link-out only; no
standard tables here.

Geometric language itself: [GD&T intro](gdt-intro.md). Modeling planes ≠
drawing datums: [datum / sketch plane](datum-sketch-plane-choice.md).

## Vocabulary

| Term | Meaning |
|------|---------|
| **2D drawing** | Sheet views, dimensions, notes, title block, revision — human-readable contract |
| **MBD** | Model-based definition — authoritative product definition primarily in the 3D model |
| **PMI** | Annotations / presentation data on the model (FCFs, datums, dims, notes) |
| **Dual definition** | Drawing + model both carry requirements — must name which wins |
| **Presentation vs semantic** | Display-only PMI vs machine-readable (STEP AP242-class) intent |

## Prefer these packs

| Situation | Prefer |
|-----------|--------|
| Shop / vendor still quotes from sheets | **Drawing-primary** — views + title-block notes; model is geometry source |
| Internal digital thread, CMM / CAM consumers of annotations | **MBD-primary** with **semantic PMI**; keep a drawing only if contract requires |
| Mixed supply chain | **Dual** with an explicit **authority note** (model or drawing wins) |
| Early concept / fit coupons | Sparse notes on the recipe plate; defer full PMI until process is named |
| Fastener callouts, finish, marking | Prefer **drawing notes / BOM** unless the MBD scheme already owns them ([fasteners](fasteners-joints.md)) |

## Datums — sheet vs 3D

1. **Same DRF story** — primary / secondary / tertiary faces should match how
   the part **locates in assembly and inspection**
   ([locating schemes](locating-scheme-dof.md), [GD&T intro](gdt-intro.md)).
2. **Drawing pack** — show datum features on the views that make the setup
   obvious; order in the FCF must match the intended fixture / CMM sequence.
3. **3D PMI pack** — attach datum and FCF annotations to the **same faces**
   the shop will touch; avoid orphan annotations on construction faces.
4. **Hole patterns** — position to the DRF; prefer hole features that survive
   export ([hole feature vs modeled](hole-wizard-vs-modeled.md)).
5. **Do not invent a second DRF** between sheet and model “for clarity” —
   one functional scheme, two presentations at most.

## CAD-time checklist

1. **Name the authority** — drawing, model, or dual (and which wins on
   conflict). Put it in the title block or MBD release note.
2. **Name the process** — CNC, sheet, mold, AM, purchased finish — before dense
   PMI ([DFM overview](dfm-overview.md)).
3. **Only annotate what will be inspected or built** — skip decorative
   dimensions that fight the DRF.
4. **Keep notes process-honest** — surface finish, heat treat, threads, and
   “typical” callouts must match how the part is actually made
   ([cosmetic threads](cosmetic-threads-vs-clearance.md)).
5. **Export path** — if MBD leaves the authoring tool, VERIFY the receiver
   gets **semantic** PMI (or accept drawing-primary). NIST example models are
   reference geometry, not a how-to course (`nist-pmi`).
6. **Revision** — bump drawing revision **and** model annotation set together
   when dual; never leave stale balloons on an old sheet.

## VERIFY — PMI matches manufacturing

Before freezing PMI or a drawing pack:

| Check | Why |
|-------|-----|
| Can the shop **measure** each FCF with the named process? | Uninspectable PMI is theater |
| Do datum features match **fixturing / print bed / mold split** reality? | Wrong DRF → scrap or endless MRB |
| Are hole / thread / insert callouts consistent with **how holes are made**? | ([hole wizard](hole-wizard-vs-modeled.md), [fasteners](fasteners-joints.md)) |
| Does AM anisotropy / warpage change which faces are stable datums? | ([warpage / flatness](am-warpage-cooling-flatness.md)) |
| Dual pack: conflict rule written? | Model vs sheet fights at the vendor |

Prefer leave a planned metrology bridge empty rather than invent gage designs
here (taxonomy: Inspection / metrology still planned).

## Live examples

- `mounting-plate` / `angle-bracket` — clean plane → feature chains before dense
  annotation
- `turbine-fit-coupons` / `d-screw-vise-fit` — qualify fits before locking
  drawing or PMI denseness

Related: [GD&T intro](gdt-intro.md),
[datum / sketch plane](datum-sketch-plane-choice.md),
[hole feature vs modeled](hole-wizard-vs-modeled.md),
[locating schemes](locating-scheme-dof.md),
[fasteners & joints](fasteners-joints.md),
[DFM overview](dfm-overview.md),
[taxonomy](../taxonomy.md).
