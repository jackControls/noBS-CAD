---
type: Concept
title: Locating schemes, DOF, and overconstraint
description: Plan how many degrees of freedom each locator freezes — primary/secondary datums, pins vs slots — before multiplying nubs or dowels.
status: draft
updated: 2026-09-20
topics: locators, gdt, joints, dfam, assembly
keywords: overconstraint, degrees of freedom, DOF, locating scheme, primary datum, secondary locator, pin and slot, 3-2-1, kinematic location, fixture locators
related_recipes: repeated-bracket-assembly, turbine-fit-coupons
sources: nist-gdt-1, nist-gdt-2, palni-dfma
---

# Locating schemes, DOF, and overconstraint

A **locating scheme** is the set of features that freeze pose between parts (or
between part and fixture). Count **degrees of freedom (DOF)** before copying
“more pins = better.”

Teaching companion: NIST / Berez GD&T decks
([Part I](https://zenodo.org/records/7647256),
[Part II](https://zenodo.org/records/8237278), **CC BY 4.0**). This page does
**not** reproduce ASME Y14.5 text.

## Rigid-body reminder

A free rigid body in 3D has **6 DOF** (3 translation, 3 rotation). Each
independent contact removes some. If two features fight over the same DOF,
the assembly is **overconstrained**: it only closes when parts deform or when
CAD ignores tolerance.

## Primary → secondary → tertiary

Borrow fixture thinking (often summarized as **3-2-1** style location):

1. **Primary** — establishes the main plane / face (stops 1 translation + 2 rotations).
2. **Secondary** — stops the next translation + remaining in-plane rotation.
3. **Tertiary** — stops the last translation (often a single point or short slot end).

Exact contact counts vary with feature type; the point is **ordered roles**, not
six identical pins.

## Pins, holes, and slots

| Pattern | Typical intent |
|---------|----------------|
| **One round pin + round hole** | Centers (2 translations in plane) if long enough to also clock poorly |
| **Round pin + slot** | Centers in one direction; floats in the slot axis |
| **Two round pins + two round holes** | Easy to **overconstrain** in-plane unless fits are transition/clearance and process is capable |
| **Diamond / relieved secondary pin** | Classic machine-design relief so the second pin clocks without fighting center distance |

For AM clamshells, prefer short **nubs + socks** with explicit primary/secondary
roles — see [alignment nubs vs pins](alignment-nubs-pins.md).

## Overconstraint checklist

1. List DOF each feature is *meant* to freeze.
2. Mark one **primary** locate; make others **slots, clearance, or soft**.
3. Separate **location** from **retention** (snaps, screws, detents) and from
   **clamp** faces ([clamshell retainer](am-clamshell-retainer.md)).
4. Ask whether process capability (print shrink, drill walk) can hold the
   implied center-distance tolerance — if not, add float.
5. Datum language on drawings: see [GD&T intro](gdt-intro.md).

## Anti-patterns

- Four tight dowels at rectangle corners “because symmetry”
- Using snap beams as the only locate **and** retain
- Ignoring that a long tongue-and-groove already removed the DOF your nubs fight

Related: [fits & clearances](fits-clearances.md),
[tolerance stack-up intro](tolerance-stackup-intro.md).
