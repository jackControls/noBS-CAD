---
type: Concept
title: AM assembly join choice — glue, weld, screw, or snap
description: When FDM enclosures should use screws, solvent/glue, ultrasonic-style joints, or snaps — and when not to snap.
status: draft
updated: 2026-09-20
topics: dfam, am, fdm, joints, fasteners, enclosures, dfa
keywords: glue joint AM, solvent weld, ultrasonic weld plastic, screw assembly FDM, when not to snap, permanent bond enclosure, serviceable joint, adhesive boss, plastic weld AM, join choice DFMA
related_recipes: turbine-fit-coupons, d-screw-vise, mounting-plate
sources: palni-dfma, nwtc-guns-dfm, doe-3d, nasa-fastener
---

# AM assembly join choice — glue, weld, screw, or snap

Pick the **join class** from service, strength, sealing, and process — before
detailing a clip. Snap-fits are not the default for every FDM enclosure.

**Attribution:** DFA principles from PALNI DFMA
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), DFM habits from
Guns / NWTC ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), DOE
Module 3D (public domain), fastener thinking from NASA RP-1228 (public domain).
Adhesive and ultrasonic **process windows** are vendor-/material-specific —
link out; do not invent cure schedules here.

## Decision table (first pass)

| Prefer | When |
|--------|------|
| **Screw / insert / nut trap** | Service access, field replace, clamp for gasket, many cycles |
| **Snap / latch** | Tool-light open, low clamp, demonstrated coupon flexure |
| **Clamshell + detent** | Slide locate first, light retention — [clamshell](am-clamshell-retainer.md) |
| **Solvent / glue / epoxy** | Permanent or semi-permanent; large bond area; no screw access |
| **Ultrasonic / thermal stake** (prod) | High volume, designed energy directors — usually **not** hobby FDM |
| **Through-bolt** | Structural clamp; both sides accessible |

## When **not** to snap

- Seal requires sustained **clamp load** (gasket / O-ring) — snaps creep
- Beam would violate min wall or sit on a deep seat that ate the cavity —
  [snap-fits](am-snap-fit.md), [thin walls](am-thin-walls.md)
- User service needs obvious fasteners or torque control
- Material is brittle in the flex direction (orientation / anisotropy risk)
- Safety or regulatory path expects captive hardware

Snaps fail as “invisible glue”: they look done in CAD and ship as shards or
loose lids.

## Glue / weld hygiene (AM)

- Design a **bond land** (width, length, flash control) — do not rely on edge
  contact of two thin shells.
- Keep adhesive away from living hinges, cable jackets, and heat-set melt zones.
- Solvent welding is material-pair specific (e.g. some ABS systems); many FDM
  blends do **not** solvent-weld cleanly — VERIFY.
- Ultrasonic joints need energy-director geometry from a production playbook;
  for prototype FDM prefer screws or adhesive lands unless you own that process.

## Screw path reminders

Name clearance vs insert vs trap per hole
([fastener clearance](fastener-clearance-counterbore.md),
[heat-set](am-heat-set-inserts.md),
[captive nut](captive-nut-hex-trap.md)). Mix roles only with a BOM note.

## Anti-patterns

- Defaulting to snaps because “3D printed parts snap”
- Glue as repair for a joint that needed service
- Ultrasonic language on a desktop FDM BOM with no process owner
- Sealed lid held only by friction detents
- No coupon for the chosen join class before committing the housing

Related: [enclosure lid / seal](am-enclosure-lid-gasket-labyrinth.md),
[research before commit](../../concepts/research-before-commit.md),
[fit coupons map](fit-coupons-recipes-map.md).
