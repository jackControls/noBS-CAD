---
type: Concept
title: AM snap-fits and living hinges
description: Cantilever clips, latches, and living hinges for FDM — role-based thickness, seat depth, and print orientation before commit.
status: draft
updated: 2026-09-20
topics: dfam, am, snap-fit, fdm, joints
keywords: snap fit, cantilever, latch, living hinge, flexure, barb, seat
related_recipes: turbine-fit-coupons, fillet-basics
sources: nwtc-guns-dfm, doe-3d, palni-dfma
---

# AM snap-fits and living hinges

**Cantilever / latch / living-hinge roles** for FDM — name the class, beam
thickness vs seat depth, and print orientation **before** inventing sizing
numbers. Numeric clearance alone is not enough: a clip can pass a gap check and
still print as a shard, or a deep seat can consume the cavity wall so the beam
cannot flex. Heuristics only — confirm with material, nozzle, and a **coupon**.

**Attribution:** DFAM habits adapted from Guns / NWTC LibreTexts DFM
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), DOE Module 3D
checklists (US government / public domain), and PALNI DFMA principles
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Prefer link-out
over pasting closed vendor design tables.

## Name the mechanism class

Pick **one** before modeling:

| Class | Intent |
|-------|--------|
| **Cantilever snap** | Beam bends; hook/barb catches a seat |
| **Annular snap** | Ring expands/contracts over a groove |
| **Latch / catch** | Separate latch body; often reusable release |
| **Living hinge** | Thin flexible web in the same part |
| **Friction detent** | Interference or bump without a distinct hook |

Prefer choosing the snap **class** before modeling a clip. Wrong class → wrong thickness
and wrong print orientation.

## Role-based thickness (not one global wall)

Name roles for every mating surface: **flexure beam**, **hook/barb**,
**seat/shoulder**, **relief cut**, **stop face**. Prefer sizing each feature over one thickness
for all roles.

Starting guidance (confirm with coupon):

1. **Beam thickness** ≥ process min wall for material/nozzle; keep uniform;
   avoid accidental necks thinner than adjacent walls unless that neck *is*
   the designed hinge.
2. **Seat / pocket depth** must leave remaining wall ≥ min wall on *every*
   side after the seat is cut:
   `remaining = parent_wall - seat_depth - opposite_feature`.
   If remaining < min wall → shallower seat, boss, or thicker parent.
3. **Deflection space**: the hook needs free travel; keep the seat from eating the
   cavity so the beam can flex.
4. **Lead-ins** on entry faces; avoid knife-edge printed barbs.
5. Prefer **role-based fits** (slip / locate / press) over one global XY hole
   compensation — see [fits & clearances](fits-clearances.md).

## Living hinges (sizing deepen)

A living hinge is a **designed thin web**, not leftover material after a deep
pocket. Keep hinge length and thickness intentional; keep adjacent walls thick
enough to survive print and flex cycles.

Starting checklist (coupon before commit — no universal mm from this page):

1. **Web thickness** — thin enough to bend, ≥ process min for a continuous skin;
   uniform along the hinge length; no accidental necks unless that neck *is*
   the hinge.
2. **Hinge length (span)** — long enough for the required open angle without
   yielding the web; short stubs concentrate strain and crack early.
3. **Land / shoulder** — thick sections on both sides of the web so clamps and
   loads stay off the flexure root.
4. **Bend vs layers** — prefer orientation so bend does not peel layer bonds on
   first open ([AM thin walls / anisotropy](am-thin-walls.md)). When unsure,
   print a hinge coupon first.
5. **Cycle life** — living hinges are mechanism class, not decoration; state
   expected open/close count and material (some filaments flex far better than
   others).

Do **not** create a separate “hinge page” guess: size here, then validate with
a coupon. Related drafts/ribs for stiff lands:
[AM ribs, gussets, and draft](am-ribs-gussets-draft.md).

## Print orientation for flexures

State orientation intent for the flexure: layer planes vs bend axis. Prefer
bending **across** layers only with explicit risk acceptance. Layer lines that
run parallel to the bend often fail early. See also
[AM thin walls and orientation](am-thin-walls.md).

## Validate before commit

1. Section the seat/cavity: prove remaining wall numerically and visually.
2. Replay or print a **fit/flex coupon** for the snap region when the joint is
   load-critical (`turbine-fit-coupons` pattern).
3. Mesh/artifact audit on export candidates (no clip shards, no zero-volume
   spikes).
4. Do **not** treat “clearance ≥ X” alone as ship criteria.

## MCP / script

- Novel snap geometry → one-step MCP; `solid_scene` after cuts.
- Proven coupon pattern → script/recipe on a **blank** document only.
  See [agent MCP workflow](../../concepts/agent-mcp-workflow.md).

Related: [DFM process guidelines](dfm-process-guidelines.md),
[fits & clearances](fits-clearances.md),
[FDM load / layers / infill](am-fdm-load-layers-infill.md).
