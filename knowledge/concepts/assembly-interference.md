---
type: Concept
title: Assembly interference check
description: Geometric overlap and clearance at solved occurrence poses — distinct from hole/shaft fit classes.
status: draft
updated: 2026-09-19
topics: assembly, mcp, clearance, validation
keywords: interference check, assembly clearance, overlap volume, assembly_interference_check, touching faces, volumetric interference, occurrence pose, near miss
related_recipes: repeated-bracket-assembly, garden-bench, vertical-axis-turbine
---

# Assembly interference check

Use **`assembly_interference_check`** to ask whether retained solids **collide or clear**
at their **solved occurrence poses**. That is a **geometry probe**, not a fit-class
selection.

Fit **classes** (clearance / transition / interference as design intent for mating
features of size) live on
[fits & clearances](../machine-design/concepts/fits-clearances.md). Do not treat a
fit chart as a substitute for an assembly check, or vice versa.

## What the tool reports

| Signal | Meaning |
|--------|---------|
| **Overlap / interference volume** | Exact volumetric intersection between solids after broad-phase culling. Non-zero ⇒ bodies occupy the same space at the solved pose. |
| **Clearance** | Closest gap between non-overlapping pairs (when reported). Compare to your functional gap, not to a preferred-fit letter. |
| **Scope** | Empty `occurrence_ids` ⇒ all **visible** occurrences; otherwise the listed ids only. Optional `clearance_threshold_mm` surfaces near-misses above zero gap. |

Bodies are evaluated as **retained native solids** at the assembly solver’s current
poses. Ungrounded / unsolved motion is not a substitute for a physical stack-up study.

## Check vs fit class (false friends)

| Concept | Role |
|---------|------|
| **Fit class** | Design **intent** for a hole/shaft (or similar) pair — always-gap, locate, or press. Chosen from function and process; standards are citation-only. |
| **Assembly interference check** | **Measured geometry** after joints and placements: do these instances overlap *now*? |

An intentional **interference fit** (press) will often report overlap in CAD if both
solids are modeled at nominal — that can be expected. Accidental clash between
unrelated parts is not. Read the report against **intent**, then decide whether to
move occurrences, change joints, or change solid geometry.

## When to run

1. After creating or editing **joints / grounding / occurrence poses**.
2. Before **export / print / submit** on a multi-body assembly.
3. When stacking **purchased envelopes** (bearings, motors) whose pockets you just
   resized — see [bearing stacks](bearing-stacks.md) and
   [research before commit](research-before-commit.md).
4. After recipe replay on a blank doc when the lesson is multi-part placement
   (`repeated-bracket-assembly`, `garden-bench`, `vertical-axis-turbine`).

Soft focus pack **`assembly`** surfaces related tools; out-of-focus tools stay
callable ([agent MCP workflow](agent-mcp-workflow.md)).

## Touching faces are not volumetric interference

**Coincident / touching faces** (zero gap, no penetration) are **not** reported as
volumetric interference. Flush mates, planar contacts, and intentional face-on-face
seating can therefore look “clean” in the check while still being kinematically
tight.

- Need a minimum air gap? Set `clearance_threshold_mm` and treat near-zero clearance
  as a miss, or model an explicit clearance feature.
- Need a press? Expect overlap at nominals; qualify with fit coupons / process
  evidence ([fits & clearances](../machine-design/concepts/fits-clearances.md)),
  not by hoping the check stays empty.

## Agent loop

1. `assembly_document` / scene inspect → confirm occurrences and visibility.
2. `assembly_interference_check` (optionally scoped + threshold).
3. If overlap is unintended: fix pose/joint or solid; re-inspect; re-check.
4. If overlap matches a press/interference **intent**: document that; do not “clear”
   it by shrinking functional interference without a VERIFY row.

Standards bodies publish GPS / fit systems (ISO 286, ASME B4.x, etc.) — open them
for contractual designations. This page does **not** redistribute preferred-fit
tables.

Related: [fits & clearances](../machine-design/concepts/fits-clearances.md),
[MCP harness](mcp-harness.md), [DFM overview](../machine-design/concepts/dfm-overview.md).
