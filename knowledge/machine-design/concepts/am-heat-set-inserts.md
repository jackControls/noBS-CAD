---
type: Concept
title: AM heat-set inserts, bosses, and crush ribs
description: FDM boss geometry for heat-set / heat-stake threaded inserts — OD, pilot, crush ribs, melt path, and when to prefer inserts over tapped plastic.
status: draft
updated: 2026-09-20
topics: dfam, am, fdm, fasteners, joints
keywords: heat-set insert, heat stake, heat-stake, thermal stake, heat stake boss, heat-set boss, brass insert, threaded insert, boss, crush ribs, melt, soldering iron, ultrasonic, tapped plastic, FDM boss, insert OD, pilot hole
related_recipes: turbine-fit-coupons, d-screw-vise
sources: nasa-fastener, nwtc-guns-dfm, doe-3d
---

# AM heat-set inserts, bosses, and crush ribs

**Heat-stake / heat-set (thermal) insert in a printed boss** — for FDM housings
with **repeated screw cycles**, prefer a purchased insert over cutting threads
in plastic. Name the insert (thread, OD, length, knurl style) before modeling
the pilot. Standoff *patterns* (boss grids, board height) live on
[boss-to-boss / standoff patterns](am-boss-standoff-patterns.md); this page owns
the insert + pilot.

**Attribution:** joint thinking from NASA Fastener Design Manual RP-1228
(public domain) and DFM habits from Guns / NWTC LibreTexts
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Vendor insert
charts are **link-out only** — prefer vendor charts outside CAD.

## When inserts beat tapped plastic

| Choice | Prefer when |
|--------|-------------|
| **Heat-set / heat-stake / ultrasonic insert** | Many assemble/disassemble cycles; metal fastener; higher clamp load |
| **Printed thread / self-tap into plastic** | One-shot fixtures, soft plastics, low reuse |
| **Through-bolt + nut** | Access both sides; avoid melting bosses entirely |

Threaded plastic alone wears, strips, and creeps under preload. Inserts move
the wear surface to metal.

## Boss anatomy (design roles)

1. **Pilot hole** — sized to the insert’s recommended **pre-melt ID** (vendor
   drawing), not the finished thread major. Leave stock for melt flow.
2. **Boss OD / wall** — enough plastic around the insert so melt does not blow
   through to the outer skin. Compute remaining wall after the pilot.
3. **Crush / knurl ribs** (optional) — short longitudinal ribs on the pilot ID
   that collapse as the insert seats; improve anti-rotation without oversizing
   the whole hole.
4. **Lead-in chamfer** — helps start the insert square; see
   [fillet vs chamfer](fillet-chamfer.md).
5. **Stand-off / base fillet** — blend boss into the parent wall so layer bonds
   and molding-style sink are less severe ([AM thin walls](am-thin-walls.md)).

Prefer modeling the **pilot hole** diameter from the vendor chart, not the insert’s **external knurl**. The hole
is for the **cold pilot**; the knurl melts into plastic.

## Process notes (FDM)

- Orient bosses so the insert axis is near build **Z** when you can — layer
  rings around the pilot resist pull-out better than stacked disks.
- Heat-set with the manufacturer’s tip/temperature guidance; stop when the
  flange seats flush. Overheating softens the whole boss.
- Coupon: print a strip of bosses, install, then pull/torque sample screws
  before committing the housing.
- Keep melt heat away from thin cavity walls and snap beams
  ([AM snap-fits](am-snap-fit.md)).
