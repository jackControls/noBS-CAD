---
type: Concept
title: Adversarial mesh and artifact audit
description: Printable-solid gate — manifold/watertight, wall probes at seats, clip shards, nub/sock quality; numeric gates alone are not enough.
status: draft
updated: 2026-09-20
topics: dfam, mesh, export, validation, am, fdm
keywords: adversarial mesh audit, manifold, watertight, wall probe, thin wall seat, clip shard, boolean artifact, non-manifold, export preflight, solid_export_preflight, printable solid, IFC
related_recipes: turbine-fit-coupons
---

# Adversarial mesh and artifact audit

Numeric IFC / snap / clearance gates can pass while the part is **unprintable**
(paper-thin walls, clip shards, bad nubs). Run this **before export handoff** and
before [validate before show](validate-before-show.md).

## When

- After any cut that deepens a seat/pocket toward a cavity
- Before STL/3MF ship or “done”
- When flexure, nubs/pins, bearings, or thin shells changed

## Audit pack (all that apply)

1. **Manifold / watertight** — no non-manifolds, inverted normals, zero-volume
   spikes, duplicate faces.
2. **Wall probe** — section or probe remaining wall at every deep seat/groove vs
   cavity; fail if remaining < process min wall. Vertex-only probes miss ledges —
   combine numeric probes with a **visual section**. See
   [AM thin walls](../machine-design/concepts/am-thin-walls.md).
3. **Clip / boolean artifacts** — no shard shells, sliver bodies, or tool-body
   leftovers from combine cuts.
4. **Flexure location** — compliance must live in the designed beam/clip, not a
   thinned parent shell ([AM snap-fits](../machine-design/concepts/am-snap-fit.md)).
5. **Nubs / socks** — reject wedding-cake stacked cylinders and open sock floors;
   prefer smooth lofted caps + closed socks
   ([alignment nubs vs pins](../machine-design/concepts/alignment-nubs-pins.md)).
6. **Lead-ins / proud humps** — continuous ramp; flush mating faces; no staircase catch.
7. **Export preflight** — run `solid_export_preflight` before `solid_export_3mf`
   (prefer) / STL.

## Pass / fail

- **Fail closed:** any paper-thin wall, non-manifold export candidate, or artifact
  body → redesign; do not ship.
- **Do not** treat “clearance ≥ X” or a green JSON gate alone as pass.
- Record measured min wall and where it was taken (section id / probe path).

## MCP vs offline

- Mutate/inspect via CAD MCP when attached (`solid_scene`, export preflight).
- Dedicated mesh IFC / wall-thickness MCP tools may be **TBD** — use documented
  offline audit scripts or mesh tools when MCP lacks them; say so in the report.
- Browser viewport ≠ Bevy truth for visual mesh claims when the product requires
  the packaged Bevy surface.

## Pair with

- [Validate before show](validate-before-show.md) for section/inner shot proof
- [Research before commit](research-before-commit.md) for process min-wall assumptions
- [Export and print](export-print.md)

Related: [DFM overview](../machine-design/concepts/dfm-overview.md),
[assembly interference](assembly-interference.md) (pose clash ≠ mesh health).
