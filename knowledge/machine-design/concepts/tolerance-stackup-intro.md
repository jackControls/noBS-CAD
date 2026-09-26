---
type: Concept
title: Tolerance stack-up intro
description: Citation-only intro to dimensional loops — identify the stack, worst-case vs statistical mindsets, and when to open standards — no closed fit tables.
status: draft
updated: 2026-09-20
topics: gdt, fits, manufacturing, inspection
keywords: tolerance stack-up, dimensional loop, worst case, RSS, gap analysis
related_recipes: turbine-fit-coupons, d-screw-vise-fit
sources: nist-gdt-1, nist-gdt-2, iso-286, asme-y14
---

# Tolerance stack-up intro

A **tolerance stack-up** asks whether the **gap, flush, or interference** you
care about still works after every contributor in the **dimensional loop**
moves to its allowed extreme (or to a stated statistical model).

This page is **citation / method only**. It does **not** ship ISO/ASME fit
charts, bilateral tables, or closed numeric stacks you can copy into a drawing.

## Method (do this in order)

1. **Name the requirement** — minimum clearance, maximum step, bearing float,
   screw engagement, etc.
2. **Draw the loop** — which faces, thicknesses, and purchased envelopes add or
   subtract along that requirement.
3. **Classify each contributor** — machined, printed, purchased (use vendor
   tolerance), temperature, coating.
4. **Pick an analysis mindset**
   - **Worst-case** — every contributor at the adverse limit (conservative;
     good for safety-critical gaps and one-off AM).
   - **Statistical / RSS-style** — assumes distributions and partial cancellation
     (needs process data; easy to misuse).
5. **Decide** — open a tolerance, change the locate scheme, add adjustment, or
   coupon the critical joint.

## Checklist

1. Write the **functional requirement** in one sentence before any math.
2. List contributors in a VERIFY table
   ([research before commit](../../concepts/research-before-commit.md)).
3. Mark each as **radial vs diametral** when sizes are involved
   ([fits & clearances](fits-clearances.md)).
4. Check for **fighting locators**
   ([locating schemes](locating-scheme-dof.md)).
5. Prefer a **coupon** over a hand-wavy closed stack for AM mates.
6. Prefer link-out citations for proprietary handbook stack tables; keep body text outside the KB and drawing notes.

## Where teaching sources help

- NIST / Berez GD&T Part I–II (**CC BY 4.0**) — datum and limits-and-fits
  teaching companions: [Zenodo Part I](https://zenodo.org/records/7647256),
  [Part II](https://zenodo.org/records/8237278).
- Contractual GPS / Y14 practices — purchase [ASME Y14.5](https://www.asme.org/codes-standards)
  / [ISO GPS](https://www.iso.org/committee/54924.html); prefer cite + distill over pasting standard
  body text into this KB.
- Preferred-fit designations — link-out only via [fits & clearances](fits-clearances.md).

## AM-specific warnings

Printed shrink and anisotropy are **process contributors**, not CAD decoration.
Qualify mating features with coupons before treating a stack as closed
(`turbine-fit-coupons`). Pair with [locating schemes](locating-scheme-dof.md)
so you are not stacking six fighting locators.
