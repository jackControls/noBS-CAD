---
type: Concept
title: Manufacturing process checks
description: Questions to resolve about tool access, mold release, print orientation and qualification before detailing a part.
status: stable
updated: 2026-09-13
topics: dfm, cnc, sheet-metal, casting, injection-molding, welding, edm, additive
keywords: draft angle, wall thickness, bend radius, tool access, fillet, pocket depth, print orientation
related_recipes: mounting-plate, angle-bracket, fillet-basics, turbine-fit-coupons, d-screw-vise-fit
sources: nwtc-guns-processes
---

# Manufacturing process checks

Use these questions to choose geometry your intended process can produce. Obtain
actual limits from the material, equipment and shop; a generic wall thickness or
draft angle cannot qualify every process.

- **Milling:** Can the cutter and holder reach each surface? Internal corners
  need a realizable tool radius. Check pocket depth, workholding and each setup.
- **Injection molding:** Can the part leave the mold? Identify pull directions,
  draft, parting lines and undercuts. Prefer reasonably uniform walls and
  supported ribs/bosses over isolated thick sections.
- **Casting:** Check draft, section transitions, parting and shrinkage. Identify
  the surfaces that require machining allowance and later access.
- **Sheet metal:** Use the shop's material, thickness, tooling and bend rules.
  Check flange lengths, reliefs and the distance of holes from bends.
- **Welding:** Provide fixture and torch access; allow for distortion. Confirm
  joint preparation and the order in which the assembly can be welded.
- **EDM:** The material must be electrically conductive. Account for wire or
  electrode access and the resulting internal corner limits.

Adapted and condensed from Bryan Guns, NWTC,
[DFM Guidelines for Specific Manufacturing Processes](https://eng.libretexts.org/Courses/Northeast_Wisconsin_Technical_College/Design_for_Various_Manufacturing_Methods/02%3A_DFM_Guidelines_for_Specific_Manufacturing_Processes),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Numerical heuristics,
figures and cost examples from the source are not reproduced.

## Additive manufacturing in the examples

For the vise and turbine, use [export and print guidance](../../concepts/export-print.md)
and [additive workholding](../../concepts/additive-workholding.md) to review the
actual print orientation, supported regions, bridge spans and mating clearances.
A clean CAD body or watertight export does not prove that a slicer will produce
supported toolpaths.

Review the exported part layout and the resulting sliced paths. Print the
`turbine-fit-coupons` or `d-screw-vise-fit` specimens with the intended settings;
record fit measurements before printing the complete assembly. Preserve the
chosen settings with the evidence, then update the editable dimensions when the
results require a change.

A drawing should make the selected process and critical relationships clear.
Use [GD&T](gdt-intro.md) where geometric controls serve function and inspection,
and [fit limits](fits-clearances.md) for mating sizes.
