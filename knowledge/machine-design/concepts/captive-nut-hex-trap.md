---
type: Concept
title: Captive nut and hex nut trap
description: Printed hex pockets and captive-nut traps so nuts cannot spin or fall out — geometry roles, access, and AM wall checks before commit.
status: draft
updated: 2026-09-20
topics: fasteners, joints, dfam, am, hardware
keywords: captive nut, hex nut trap, nut pocket, anti-rotation, Nylock, press nut, drop-in nut, wrench flats, nut trap, FDM nut captive, hex socket
related_recipes: d-screw-vise, mounting-plate, garden-bench
sources: nasa-fastener, nwtc-guns-dfm
---

# Captive nut and hex nut trap

A **nut trap** (hex pocket) holds a purchased nut so it cannot spin while the
screw is driven from the opposite side. A **captive** design also keeps the nut
from falling out during handling. Name the nut (thread, width across flats,
thickness, locking style) before modeling the pocket.

**Attribution:** joint hygiene from NASA Fastener Design Manual RP-1228
(public domain) plus AM wall habits. Vendor nut charts are **link-out** —
measure or read the standard sheet for the SKU you buy.

## When to use a trap vs insert vs tap

| Choice | Prefer when |
|--------|-------------|
| **Hex nut trap** | Through-bolt stack; metal nut; limited reuse heat; easy drop-in |
| **Heat-set / press insert** | Blind bosses; many cycles; no far-side access — [heat-set inserts](am-heat-set-inserts.md) |
| **Tapped plastic** | Soft fixture, low cycle — usually worse than trap/insert |
| **Weld / clinch nut (metal)** | Sheet metal production — out of FDM scope here |

## Trap anatomy (roles)

1. **Across-flats pocket** — sized to the nut’s wrench flats with a small
   print allowance so the nut drops in but does not spin.
2. **Depth** — ≥ nut thickness; leave a **floor** or **retention lip** when
   captivity matters.
3. **Screw clearance** — coaxial hole role is **clearance** through the trapped
   nut’s path ([fastener clearance](fastener-clearance-counterbore.md)).
4. **Insertion path** — open face, slot from the side, or split housing that
   closes over the nut ([clamshell](am-clamshell-retainer.md)).
5. **Tool / finger access** — prove you can seat the nut after print supports
   are gone.

Do not model the **thread** inside the trap as load-bearing plastic. The nut
owns the thread.

## AM / FDM notes

- Remaining walls around the hex must meet process min after the pocket —
  [AM thin walls](am-thin-walls.md).
- Prefer trap axis along build **Z** when you can so flats are clean; coupon
  across-flats fit (loose spin vs jammed).
- Locking nuts (nylon insert, all-metal) need the full thickness plus any
  collar — do not truncate the pocket.
- Heat-set inserts and nut traps solve different access problems; do not mix
  roles on one joint without a BOM note.

## Anti-patterns

- Circular “nut-ish” holes that let the nut spin
- Pocket depth < nut thickness so the screw pulls the nut into plastic
- Paper-thin floors under the trap
- Modeling cosmetic threads in the plastic instead of dropping in a nut —
  [cosmetic threads](cosmetic-threads-vs-clearance.md)
- No insertion path once the enclosure is closed

Related: [fasteners & joints](fasteners-joints.md),
[fits & clearances](fits-clearances.md).
