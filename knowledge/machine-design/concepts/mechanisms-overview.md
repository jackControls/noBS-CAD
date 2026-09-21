---
type: Concept
title: Mechanisms overview (CAD-time)
description: CAD-time mechanisms hub — name motion class, pick element family, lock envelopes/centers/DOFs, navigate child Concepts, VERIFY with coupons or purchased hardware (no tooth/cam/belt charts).
status: draft
updated: 2026-09-20
topics: mechanisms, machine-elements, joints, assembly
keywords: mechanism, motion class, element family, rotary to rotary, rotary to linear, intermittent, path generation, soft sync, linkage, gear, cam, belt, pulley, chain, sprocket, Geneva, indexer, mobility, DOF, center distance, envelope, CAD owns, catalog owns, navigate mechanisms, purchased profile, AGMA, tooth chart, cam chart, datasheet VERIFY
related_recipes: vertical-axis-turbine, d-screw-vise, d-screw-vise-fit, revolved-spacer, turbine-fit-coupons
sources: mit-272, doe-3d
---

# Mechanisms overview (CAD-time)

A **mechanism** turns named motion into named motion with constraints you can
sketch, seat, and VERIFY. CAD owns envelopes, centers, joint axes, and
interference at poses; catalogs and coupons own tooth forms, cam laws, belt
profiles, and duty ratings. Prefer purchased machine elements when load, wear,
or timing accuracy matters.

**Roles only** on this hub and its children. **AGMA / tooth / cam / belt charts**
stay on the datasheet — VERIFY; Help invents none ([taxonomy](../taxonomy.md)
lists charts as planned/datasheet).

This page is the **discoverability hub**. Detail lives on the linked Concepts.
Do **not** invent tooth, cam, belt, chain-pitch, or Geneva-slot charts in Help —
cite datasheets and [SOURCES](../SOURCES.md).

**Attribution:** motion-class and element-family framing aligned with MIT OCW
[2.72 Elements of Mechanical Design](https://ocw.mit.edu/courses/2-72-elements-of-mechanical-design-spring-2009/)
(`mit-272`, [CC BY-NC-SA](https://creativecommons.org/licenses/by-nc-sa/4.0/) —
**link-out only**, not a chapter mirror); DFM checklist flavor from DOE Module 3D
(public domain — buy before invent when wear/timing matter).

## Vocabulary (roles for discovery)

| Term | CAD-time meaning |
|------|------------------|
| **Motion class** | Named in → out transform (rotary→rotary, rotary→linear, intermittent, path/guidance) |
| **Element family** | Gears, belts/chains, linkages, cams, screws, or a purchased actuator/indexer |
| **Envelope** | Clearance / swing / stroke box at extreme poses |
| **Center distance** | Shaft-to-shaft (or driver→wheel) spacing — primary layout lock |
| **Mobility / DOF** | Independent inputs the chain needs — match actuators before ornate links |
| **Soft sync** | Belt or chain spanning distance without rigid gear mesh |
| **Purchased profile / pitch / cam law** | Catalog-owned geometry — Help names the **role**, not the chart |
| **Index / dwell** | Intermittent story — advance, then hold |
| **CAD owns** | Centers, envelopes, joint axes, stroke boxes, pose interference |
| **Catalog / coupon owns** | Tooth form, cam law, belt length/profile, chain pitch, duty / PA limits |

## Golden path (CAD-time)

1. **Name the motion class** — what goes in, what must come out:
   - **Rotary → rotary** (ratio, direction, continuous or reversing)
   - **Rotary → linear** (lead/travel, stroke, backdrive risk)
   - **Intermittent** (dwell, index, rise/return)
   - **Path / guidance** (coupler curve, straight-line approx, constrained slide)
2. **Pick one element family** — gears, belts/chains, linkages, cams, screws,
   or a purchased actuator/indexer. Prefer one family that matches the motion
   class before stacking exotic hybrids
   ([requirements → make-vs-buy](design-hygiene-requirements-bom.md)).
3. **Lock envelopes, centers, and DOFs** — shaft centers, base circles, stroke
   boxes, joint axes, and which DOFs each joint removes
   ([locating schemes](locating-scheme-dof.md),
   [linkages / mobility](mechanisms-linkages-mobility.md)).
4. **Open the child Concept** — use the navigation table below; do not invent
   tooth/cam/belt numbers on this hub.
5. **VERIFY** — coupons, purchased hardware drawings, and interference at
   extreme poses before freezing product geometry
   ([research before commit](../../concepts/research-before-commit.md),
   [assembly interference](../../concepts/assembly-interference.md),
   [fit coupons map](fit-coupons-recipes-map.md)).

## Motion class → preferred families

| Motion class | Prefer first | Notes |
|--------------|--------------|-------|
| Rotary → rotary (ratio) | Gears or timing belts | Same module/DP + PA for gears; purchased belt profile for sync |
| Rotary → linear | Power/lead screw or cam + follower | Lead ↔ travel documented; cam law from datasheet |
| Intermittent / dwell | Cam, Geneva, or purchased indexer | Rise–dwell–return / index+lock as a **motion story** |
| Path / guidance | Linkage or slide + guides | Name joints/DOFs before fancy coupler curves |
| Soft sync / long span | Belt or chain + idlers | Center distance, wrap, tension path |

## Navigate by need (agent discovery)

| If you need… | Open |
|--------------|------|
| Joints / DOFs, four-bar, slider-crank envelopes | [linkages / mobility](mechanisms-linkages-mobility.md) |
| Rise–dwell–return, follower type, base circle | [cams](mechanisms-cams.md) |
| Timing/V belt, wrap, idler, tension path | [belts & pulleys](mechanisms-belts-pulleys.md) |
| Roller chain, sprocket, slack strand | [chains & sprockets](mechanisms-chains-sprockets.md) |
| Module/DP, compatible pairs, mounting | [gears](../../concepts/gears.md) |
| Printed FDM teeth / DFAM | [printed gears DFAM](am-printed-gears-dfam.md) |
| Lead vs pitch, nut, backdrive | [power / lead screws](power-screws-lead-screws.md) |
| Index + dwell + lock arc | [intermittent / Geneva](mechanisms-intermittent-geneva.md) |
| Experimental pin lattice (unofficial) | [Technic-style envelope](technic-envelope.md) |
| Shaft seats / keys / rings | [shafts / keys](shafts-keys-retaining-rings.md) |
| Bearing / hub seats | [bearings / hubs](bearings-hubs-seats.md); SKU: [bearing-stacks](../../concepts/bearing-stacks.md) |
| Misalignment between shafts | [springs / couplings](springs-couplings.md) |

## CAD owns vs catalog owns

| CAD owns (lock in the model) | Catalog / coupon owns (VERIFY out-of-band) |
|------------------------------|-------------------------------------------|
| Shaft / pivot **centers** and axes | Tooth form, module/DP tables |
| Swing / stroke / clearance **envelopes** | Cam law, displacement charts, PA limits |
| Joint type and intended **mobility** | Belt profile, pitch length, tension procedure |
| Idler / tensioner **locations** and access | Chain pitch / strand / length |
| Extreme-pose **interference** | Indexer duty, Geneva slot geometry |
| Mount / hub / guard envelopes | Load, wear, and life ratings |

Changing a catalog row past process tolerance ⇒ regenerate seats and envelopes;
do not patch tooth or lobe numbers from memory.

## Prefer these patterns

| Need | Prefer |
|------|--------|
| Ratio between parallel shafts | Gears or timing belt — name module/DP+PA **or** purchased profile first |
| Long-span soft sync | Belt or chain + idlers; lock **center distance** before decorative teeth |
| Rotary → linear stroke | Lead screw or cam; document the stroke box |
| Discrete indexes with dwell | Purchased indexer or Geneva; name index count + lock story |
| Path guidance | Linkage with named joints before fancy coupler curves |
| Wear / timing / high-cycle element | Buy the element; print the mounts |
| Ambiguous family | One family coupon **and** leave the purchased envelope |
| Late “what pitch was that?” | Stop — reopen VERIFY; do not invent pitch after centers freeze |
| Ornate links before kinematics | Name joints + intended mobility first; then sketch |
| Hybrid belt+gear+cam stack | Prove **one** family coupon before stacking families |
| Technic / LDraw pitch | Teaching envelope only — not OEM Lego or a load-rated drive |
| Hub detail questions | Open the child Concept checklist — this page is navigation |

## Checklist

- [ ] Motion class named (in → out)
- [ ] One element family chosen and justified (make-vs-buy noted)
- [ ] Centers / envelopes / joint DOFs locked
- [ ] Correct child Concept opened for family detail
- [ ] Purchased SKUs or coupon plan named where duty matters
- [ ] CAD-vs-catalog ownership clear (no invented charts)
- [ ] Extreme-pose interference reviewed

## Related Concepts

| Topic | Id | Page |
|-------|----|------|
| Gears (identify / pair) | `concepts.gears` | [gears](../../concepts/gears.md) |
| Linkages / mobility | `machine-design.concepts.mechanisms-linkages-mobility` | [mechanisms-linkages-mobility](mechanisms-linkages-mobility.md) |
| Cams (CAD-time) | `machine-design.concepts.mechanisms-cams` | [mechanisms-cams](mechanisms-cams.md) |
| Intermittent / Geneva | `machine-design.concepts.mechanisms-intermittent-geneva` | [mechanisms-intermittent-geneva](mechanisms-intermittent-geneva.md) |
| Belts & pulleys | `machine-design.concepts.mechanisms-belts-pulleys` | [mechanisms-belts-pulleys](mechanisms-belts-pulleys.md) |
| Chains & sprockets | `machine-design.concepts.mechanisms-chains-sprockets` | [mechanisms-chains-sprockets](mechanisms-chains-sprockets.md) |
| Power / lead screws | `machine-design.concepts.power-screws-lead-screws` | [power-screws-lead-screws](power-screws-lead-screws.md) |
| Shafts / keys / rings | `machine-design.concepts.shafts-keys-retaining-rings` | [shafts-keys-retaining-rings](shafts-keys-retaining-rings.md) |
| Bearings / hubs / seats | `machine-design.concepts.bearings-hubs-seats` | [bearings-hubs-seats](bearings-hubs-seats.md); SKU: [bearing-stacks](../../concepts/bearing-stacks.md) |
| Springs / couplings | `machine-design.concepts.springs-couplings` | [springs-couplings](springs-couplings.md) |
| Technic-style envelope | `machine-design.concepts.technic-envelope` | [technic-envelope](technic-envelope.md) |
| Requirements → BOM | `machine-design.concepts.design-hygiene-requirements-bom` | [design-hygiene-requirements-bom](design-hygiene-requirements-bom.md) |

## Further reading (link only)

- MIT OCW 2.72 — mechanisms, gears, bearings (`mit-272` in [SOURCES](../SOURCES.md))
- Gear pair math and mounting: [gears](../../concepts/gears.md)

Related: [taxonomy](../taxonomy.md), [SOURCES](../SOURCES.md).
