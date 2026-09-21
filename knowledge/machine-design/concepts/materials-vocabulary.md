---
type: Concept
title: Materials vocabulary
description: CAD-time property vocabulary — E, Sy, Sut, hardness, anisotropy, print vs isotropic, CTE — roles and golden path; not certified allowables or MatWeb scrapes.
status: draft
updated: 2026-09-20
topics: materials, dfm, manufacturing, print, anisotropy
keywords: modulus, E, yield, Sy, Sut, hardness, fatigue, endurance, CTE, density, alloy, polymer, anisotropy, isotropic, print vs isotropic, orthotropic, corrosion, allowables, filament, temper, grade, educational range, datasheet
related_recipes: turbine-fit-coupons, garden-bench
sources: kittycad-materials, doe-3d, nwtc-guns-dfm, materials-project
---

# Materials vocabulary

CAD-time **E / Sy / Sut / hardness / CTE / anisotropy** vocabulary — **roles
only**, not certified allowables. Do **not** invent Sy/Sut/E charts or scrape
MatWeb / MakeItFrom into Help — selection/allowables tables stay **planned**.
Prefer a named **process + grade/condition** over viewport metal color or
filament appearance.

**Attribution:** process-first / buy-before-invent habits from DOE Module 3D
(`doe-3d`, public domain) and NWTC Guns DFM distill (`nwtc-guns-dfm`,
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Open datasets
(`kittycad-materials`, `materials-project`) are **patterns or computed props**,
not drawing allowables. Materials Project is crystalline DFT data, not shop
steel charts; KittyCAD JSON is a *schema pattern* only.

## Vocabulary (roles for discovery)

| Symbol / word | CAD-time meaning | Habit |
|---------------|------------------|-------|
| **E** | Elastic modulus (stiffness) | Stiff vs flexible / deflection talk — not “how strong” |
| **Sy** | Yield strength (onset of permanent set) | Prefer datasheet / grade sheet over hardness or color |
| **Sut** | Ultimate tensile strength | Separate from Sy; do not swap labels |
| **Hardness** | Process / wear / machinability proxy | **Not** a substitute for Sy on the drawing |
| **Fatigue / endurance** | Repeated-load story | Geometry + surface + orientation dominate; no invented S–N charts |
| **CTE** | Thermal expansion | Mixed-material stacks move; name the mismatch |
| **Density** | Mass and print-time feel | After envelope is real; density does not fix a bad load path |
| **Corrosion / chemical** | Environment class | Coatings, stainless vs plated, solvent/UV/food-adjacent |
| **Isotropic** | Same props in all directions (CAD assumption for many stock metals/plastics) | State the assumption; VERIFY when process breaks it |
| **Anisotropy / orthotropy** | Direction-dependent props (FDM layers, rolled plate, composites) | Name load vs layer / grain before freezing |
| **Print vs isotropic** | AM part ≠ isotropic bar of the same polymer name | Orient for load; coupon; see [FDM load / layers](am-fdm-load-layers-infill.md) |
| **Grade / temper / condition** | Heat treat, cold work, moisture, print settings | Call out with the alloy — “6061” alone is incomplete |
| **Educational range** | Teaching / notebook number | Mark educational; **≠** shipping allowable |

## Golden path (CAD-time)

1. **Name the process first** — CNC bar, sheet, weldment, injection resin, FDM
   filament, mold, cast? Class without process is incomplete
   ([DFM process guidelines](dfm-process-guidelines.md),
   [DFM overview](dfm-overview.md)).
2. **Name the property roles you need** — stiffness (**E**), onset of set
   (**Sy**), ultimate (**Sut**), wear/process proxy (**hardness**), cyclic story
   (**fatigue**), stack motion (**CTE**), mass (**density**), environment
   (**corrosion / chemical**). Prefer the few roles that drive the CAD decision.
3. **Isotropic stock vs anisotropic print** — treat many metals and molded
   plastics as **isotropic** only when the process supports it; treat FDM /
   composites / heavily rolled plate as **anisotropic**. Primary tension with
   layers when the part allows
   ([FDM load / layers / infill](am-fdm-load-layers-infill.md),
   [AM thin walls](am-thin-walls.md)).
4. **Couple material ↔ process on the callout** — FDM PETG ≠ injection PET;
   6061-T6 bar ≠ cast “aluminum”; filament brand color ≠ grade sheet.
5. **Prefer cited datasheet / licensed pattern over scrapes** — vendor grade
   sheet, ASTM/ISO designation, or open JSON *pattern*
   (`kittycad-materials`). Keep MatWeb / MakeItFrom **out** of the repo and
   title block ([SOURCES](../SOURCES.md)).
6. **Say educational ≠ allowable** — any Help or notebook number is teaching
   range until the responsible engineer cites an approved source. Selection /
   allowables tables stay **planned** (taxonomy D).
7. **VERIFY before freeze** — process, environment, load story, mating
   materials / CTE / galvanic, and no untitled strength number on the drawing
   ([research before commit](../../concepts/research-before-commit.md),
   [requirements → BOM](design-hygiene-requirements-bom.md)).

## CAD owns vs datasheet owns

| CAD owns (lock in the model / notes) | Datasheet / coupon owns (VERIFY out-of-band) |
|--------------------------------------|-----------------------------------------------|
| Process family and print/machine orientation intent | Certified **E / Sy / Sut** (and allowables) |
| Class + grade/temper/condition **name** | Heat-treat / moisture / strain-rate conditions |
| Isotropic vs anisotropic **assumption** | Orientation-matched coupon results for AM |
| CTE / galvanic / chemical callouts for mixed stacks | Coatings and finish specs |
| Density for envelope / mass goals (order-of-magnitude) | Shipping mass from measured or catalog density |
| “Educational range ≠ allowable” marking | Drawing allowables from approved source only |

Changing grade, temper, filament lot, or bed face past process tolerance ⇒
reopen VERIFY; do not patch Sy from hardness or blog charts.

## Prefer these patterns

| Need | Prefer |
|------|--------|
| Stiffness / deflection | Talk **E** and geometry; do not say “stronger plastic” |
| Permanent set / proof | Named **Sy** from grade sheet or coupon |
| Wear / machinability feel | **Hardness** as proxy — still VERIFY Sy when load-critical |
| FDM bracket / strap | Anisotropic plan: bed face + shells; coupon load path; note anisotropy when load-critical |
| Filament / resin pick | Name process notes (nozzle, temp, orientation) before locking ABS vs PETG |
| Alloy / grade callout | Stock or datasheet text — viewport metal color is display only |
| Mixed metal + plastic stack | Name **CTE** and clamp/locate so stacks can move |
| Mystery “strong filament” | Buy the machine element; print the mount |
| Untitled MPa on a drawing | Stop — cite datasheet or mark educational and remove from title block |
| Allowables / selection chart | Leave planned — do not invent or scrape MatWeb into Help |
| Open dataset / KittyCAD JSON | Use as a **pattern** only — not certified allowables |
| Teaching / notebook number | Mark **educational**; keep drawing allowables on a cited datasheet |

## Classes you will specify (coupled to process)

Carbon steels, alloy steels, stainless, aluminum, copper alloys, engineering
plastics, composites, elastomers. Each class **couples to a process** (weld,
machine, mold, print). Naming a class without a process is incomplete.

When the class is plastic/AM, open [AM thin walls](am-thin-walls.md),
[FDM load / layers](am-fdm-load-layers-infill.md), and
[warpage / flatness](am-warpage-cooling-flatness.md). When metal stock, open
[DFM process guidelines](dfm-process-guidelines.md) for the cut/form family
before inventing exotic alloys.

## Allowables honesty (before quoting a number)

Materials **vocabulary** is not an allowables table:

1. **Name the dataset** — vendor datasheet, ASTM/ISO grade sheet, or KittyCAD JSON *pattern* (not “someone said 70 MPa”).
2. **Say the condition** — heat treat, print orientation, moisture, temperature, strain rate.
3. **Separate E / Sy / Sut / fatigue** — prefer tensile data over hardness-as-Sy.
4. **Keep MatWeb / MakeItFrom out** of the repo and title block; link-out datasheets only ([SOURCES](../SOURCES.md)).
5. **Mark educational ranges**; shipping allowables come from an approved source.
6. **Couple material ↔ process** — FDM PETG ≠ injection PET; 6061-T6 bar ≠ cast “aluminum.”
7. **CTE / galvanic / chemical** when mixed stacks exist; isotropic vs anisotropic assumption stated for AM / composites.

## Freeze gate

- [ ] Process named (stock / print / mold / fab)
- [ ] Property roles named (E / Sy / Sut / … as needed) — not untitled MPa
- [ ] Isotropic vs anisotropic assumption stated
- [ ] Environment and load story named
- [ ] Mating materials / CTE / coatings noted
- [ ] No untitled strength number on the drawing
- [ ] Filament strength claims backed by a datasheet or coupon, not appearance
- [ ] Educational ranges marked; allowables left to cited source (tables still planned)

## Further reading (link only)

- KittyCAD material-properties JSON pattern (`kittycad-materials`) — schema only
- Materials Project (`materials-project`) — computed crystalline props; not shop allowables
- NWTC / Guns DFM process chapters (`nwtc-guns-dfm`) — process couples to material
- DOE Module 3D (`doe-3d`) — buy-before-invent / standardize habits

Related: [DFM overview](dfm-overview.md), [Fasteners & joints](fasteners-joints.md),
[FDM load / layers](am-fdm-load-layers-infill.md), [AM thin walls](am-thin-walls.md),
[requirements → BOM](design-hygiene-requirements-bom.md),
[SOURCES](../SOURCES.md), [taxonomy](../taxonomy.md).
