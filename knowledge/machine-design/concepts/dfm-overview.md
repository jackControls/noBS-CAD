---
type: Concept
title: DFM overview
description: Process families and design-for-manufacturing heuristics at CAD time.
status: draft
updated: 2026-09-11
---

# DFM overview

**Design for manufacturing (DFM)** means choosing geometry that a real
process can make repeatably. **DFA** is the assembly counterpart (access,
fastener count, error-proofing). Decide the process early; it changes
minimum radii, wall thickness, draft, splits, and tolerances.

Process families (v1 map):

- **CNC (subtractive)** — tool access, workholding, inside corner radius,
  thin walls, tolerance versus cycle time
- **Sheet** — bend radius, reliefs, grain, hardware inserts
- **Casting / molding** — draft, uniform walls, fillets, parting line,
  machining stock
- **Injection molding** — draft, sink, knit lines, shutoffs, ejection
- **Additive** — orientation, supports, anisotropy, hole shrinkage, fit
  coupons
- **Joining** — weld access, distortion, fastener stacks

Tighter tolerance is not free. Match the control to the function; use
[GD&T](gdt-intro.md) when the relationship matters, not on every edge.

Open textbooks with strong DFM chapters (UArk Jensen; some LibreTexts)
are **link-only** when the license is NC or unverified — see
[SOURCES](../SOURCES.md).

## In this product

Flagship recipes are manufacturing **candidates**. Replay and drawings are
software evidence. Fit coupons (`turbine-fit-coupons`, `d-screw-vise-fit`)
are the intended bridge to a specific printer and material.

Related: [Fits & clearances](fits-clearances.md), [taxonomy](../taxonomy.md).
