---
type: Concept
title: Linkages and mobility (CAD-time)
description: Name joints and DOFs before fancy links; Gruebler/Kutzbach as roles; four-bar and slider-crank envelopes for CAD — no formula dump.
status: draft
updated: 2026-09-20
topics: mechanisms, joints, assembly, machine-elements
keywords: linkage, four-bar, four bar, slider-crank, Gruebler, Kutzbach, mobility, DOF, revolute, prismatic, coupler, crank rocker, drag link, ground link
related_recipes: repeated-bracket-assembly, vertical-axis-turbine, mounting-plate, d-screw-vise-fit
sources: mit-272, doe-3d
---

# Linkages and mobility (CAD-time)

A **linkage** is a set of rigid bodies joined by named joints so the assembly
has a **mobility** (degrees of freedom) you intend. CAD sketches links and
pivots; mobility thinking decides whether the mechanism moves as planned or
locks / flops. Prefer naming **joints and DOFs** before drawing ornate link
shapes.

**Attribution:** mobility and four-bar roles aligned with MIT OCW
[2.72 Elements of Mechanical Design](https://ocw.mit.edu/courses/2-72-elements-of-mechanical-design-spring-2009/)
(`mit-272`, CC BY-NC-SA — **link-out only**). No Gruebler formula dump or
dimensioned coupler-curve atlas here.

## Vocabulary (roles, not formulas)

| Term | Role in CAD |
|------|-------------|
| **Link** | Rigid body; keep length between joint centers as the design variable |
| **Ground / frame** | Fixed link; name which pivots live on the frame |
| **Revolute (pin)** | Removes translation DOFs; allows rotation about one axis |
| **Prismatic (slider)** | Allows translation along one axis; removes others |
| **Mobility** | How many independent inputs the chain needs to be determined |
| **Gruebler / Kutzbach** | **Counting roles** for planar chains — use to sanity-check joint count, not as a substitute for a kinematics course |
| **Four-bar** | Ground + crank + coupler + rocker (or drag-link / double-crank variants) |
| **Slider-crank** | Crank + connecting rod + slider — classic rotary→linear |

Treat Gruebler/Kutzbach as: *count bodies and joint types → expect mobility →
match the actuators you actually provide*. Spatial joints, springs, clearances,
and overconstraint change the story — VERIFY with a pose study, not a single
equation ([locating schemes](locating-scheme-dof.md)).

## CAD-time checklist

1. **Name the motion story** — continuous rotation, rocker oscillation, stroke,
   or path guidance ([mechanisms overview](mechanisms-overview.md)).
2. **List joints first** — each pin/slider gets an axis, stack height, and
   fit class ([fits](fits-clearances.md), [alignment nubs vs pins](alignment-nubs-pins.md)).
3. **Mobility sanity** — intended inputs vs joint/link count; if mobility ≠
   actuator count, stop and rename joints before sketching fancy outlines.
4. **Four-bar envelope** — ground pivots fixed; crank and rocker swing arcs;
   coupler clears both extremes. Prefer center-to-center lengths over decorative
   dog-bones until the motion works.
5. **Slider-crank envelope** — crank radius, rod length, stroke box, and slider
   guide length; leave nut/keeper access if a screw drives the slide
   ([power screws](power-screws-lead-screws.md)).
6. **Bearing / bushing seats** — pin OD and hub bore from purchased hardware;
   printed hubs need coupons ([shafts / keys](shafts-keys-retaining-rings.md),
   [bearing stacks](../../concepts/bearing-stacks.md)).
7. **Overconstraint** — parallel pins fighting shrink, dual slides without float,
   or redundant ground pivots. Prefer one locate scheme per DOF removed.
8. **VERIFY** — sweep extreme poses for interference; check bushing wear and
   pin retention; do not claim transmission angles or force advantage without
   a cited method ([research before commit](../../concepts/research-before-commit.md)).

## Prefer these patterns

| Need | Prefer |
|------|--------|
| Oscillating output from continuous crank | Four-bar crank-rocker with named ground pivots |
| Rotary → linear stroke | Slider-crank or screw; document stroke box |
| Quick experimental pin lattice | [Technic-style envelope](technic-envelope.md) (unofficial; measure first) |
| Soft misalignment between shafts | Coupling, not a pretzel linkage ([springs / couplings](springs-couplings.md)) |

## Live examples

- `repeated-bracket-assembly` — pin/bracket patterns and access
- `vertical-axis-turbine` — rotating stack hygiene adjacent to linkage work
- `d-screw-vise-fit` — qualify running fits before locking product geometry

Related: [mechanisms overview](mechanisms-overview.md),
[cams](mechanisms-cams.md),
[gears](../../concepts/gears.md),
[locating schemes](locating-scheme-dof.md),
[assembly interference](../../concepts/assembly-interference.md),
[taxonomy](../taxonomy.md).
