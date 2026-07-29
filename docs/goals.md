# What we are building

Short shared directions for people and contributors. Detail that is still
**proposed architecture** lives in [proposed-architecture.md](proposed-architecture.md).

noBS CAD is **local** mechanical CAD. Files stay on your machine. There is no
required cloud account or cloud control plane.

## Accepted high-level directions

These broaden the original noBS CAD goal; they do not replace it.

| Direction | Meaning |
|-----------|---------|
| **Reliable mechanical CAD** | Dependable sketch / feature / history / project workflows, better UX and performance. |
| **CAM** | Careful path toward functional, modern **3-axis** CAM, with machining feedback. |
| **Additive manufacturing** | **3MF** (with useful color/material metadata) as a print target; keep **STEP** for CAD interchange. |
| **Strong local automation** | **MCP** as a serious, fully local control and testing surface. |
| **Simulation / analysis** | Longer-term module family, **staged** (see below) — not one feature. |

Education-style tutorials ("quests") that reuse golden automation scenarios are
interesting later. They are **not** a top-level committed product goal today.

## Simulation in stages

Do not treat fit, motion, and strength as one deliverable:

1. **Geometric fit / interference** — approachable on today's solid bodies.
2. **Motion** — needs assemblies, joints, and kinematics infrastructure.
3. **Strength / FEA** — needs a separately validated meshing, material, load,
   and solver stack; much later.

## Near-term engineering priorities

1. Make today's sketching, solid modeling, history, undo, and project-file
   workflows more dependable.
2. Harden and expand modeled hole-thread coverage (ISO metric / Unified base
   capability has landed); edge cases and regression tests.
3. Keep improving general UX.
4. Improve preview, selection, and recompute performance.
5. Turn reported failures into focused regression tests.
6. Grow MCP as a local automation/testing surface (see
   [mcp-harness.md](mcp-harness.md)). On branch `feat/3mf-print-export`:
   soft focus-scoped disclosure and headless `cad_list_sessions` /
   `cad_attach` (read-only load) — not live UI co-link.
7. Native **3MF** / **STL** export with materials/colors is landing on
   `feat/3mf-print-export`; treat `main` as STEP-first until that merges.

## Related reading

- [README.md](../README.md) — public product overview
- [mcp-harness.md](mcp-harness.md) — MCP as-built vs design notes
- [proposed-architecture.md](proposed-architecture.md) — aspirational proposals
  (focus-scoped tools, UI co-link, multi-window broker, agent-alignment files)
- [mcp-server/README.md](../mcp-server/README.md) — as-built server
