---
type: Concept
title: Alignment nubs vs pins
description: Choose locator class — short AM nubs/socks vs slender pins/dowels — to avoid overconstraint and print failure.
status: draft
updated: 2026-09-20
topics: dfam, am, locators, joints, fdm
keywords: alignment nubs, locating pin, dowel pin, locator, sock, wedding-cake nub, lofted cap, overconstraint, pilot feature, mate alignment
related_recipes: turbine-fit-coupons, repeated-bracket-assembly
sources: nwtc-guns-dfm, doe-3d
---

# Alignment nubs vs pins

Wrong **locator class** causes overconstraint, broken prints, or assemblies that
only close on the CAD screen. Name the class before modeling mating bumps.

## Classes (pick one primary)

| Class | Intent | Typical AM shape |
|-------|--------|------------------|
| **Alignment nub + sock** | Short locate / anti-slide on a split face; shear-strong, low height | Wide vs tall aspect; lofted/domed tip; closed sock pocket |
| **Printed pin / peg** | Longer engagement, often removable or through-hole | Slender cylinder; needs buckling/print-orientation plan |
| **Purchased dowel / pin** | Precision locate between machined or printed halves | Catalog envelope + press/slip roles — see [fits](fits-clearances.md) |
| **Pilot / tongue** | Continuous rail or tongue-and-groove along a seam | Not discrete nubs; different stack-up |

Prefer naming the locate class first: short AM locators vs pins — match geometry to the class.

## AM nubs (preferred for FDM clamshells)

- Keep **aspect ratio short**: diameter larger than engage height when possible —
  nubs are locators, not miniature shafts.
- Prefer **smooth lofted / spherical-cap** tips over stacked “wedding-cake”
  cylinders (hard to print, catch on entry, look featured while failing).
- **Closed socks** (blind pockets with a floor) beat open through-holes that
  weaken the shell and leave crescent walls.
- Alternate nub/sock corners across mates so halves cannot be flipped wrong-way
  when that matters; keep nubs **inboard** of outer walls and clear of clip
  channels.
- Print orientation: prefer nub axis ≈ build Z (split on bed) for shear strength
  when the part allows — see [AM thin walls](am-thin-walls.md).

## Pins and dowels

- Treat length, diameter, and fit **role** (clearance / locate / press) explicitly.
- Printed slender pins buckle and delaminate; coupon first or switch to purchased
  hardware.
- Multiple long pins can **overconstrain** two plates — prefer two pins + a
  float direction, or one pin + a slot, unless process capability justifies more.

## Overconstraint checklist

1. How many **independent** locate degrees of freedom does this pattern freeze?
2. Is one feature a **primary** locate and others **secondary** (slots, clearance)?
3. Do socks leave remaining wall ≥ process min after depth
   ([adversarial mesh audit](../../concepts/adversarial-mesh-audit.md))?
4. Are locator faces distinct from **retention** (snaps/detents) and **clamp**
   faces ([clamshell retainer](am-clamshell-retainer.md))?
