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
| **Simulation / analysis** | Longer-term module family, **staged** (see below) ΓÇö not one feature. |

Education-style tutorials (ΓÇ£questsΓÇ¥) that reuse golden automation scenarios are
interesting later. They are **not** a top-level committed product goal today.

## Simulation in stages

Do not treat fit, motion, and strength as one deliverable:

1. **Geometric fit / interference** ΓÇö approachable on todayΓÇÖs solid bodies.
2. **Motion** ΓÇö needs assemblies, joints, and kinematics infrastructure.
3. **Strength / FEA** ΓÇö needs a separately validated meshing, material, load,
   and solver stack; much later.

## Near-term engineering priorities

1. Make todayΓÇÖs sketching, solid modeling, history, undo, and project-file
   workflows more dependable.
2. Harden and expand modeled hole-thread coverage (ISO metric / Unified base
   capability has landed); edge cases and regression tests.
3. Keep improving general UX.
4. Improve preview, selection, and recompute performance.
5. Turn reported failures into focused regression tests.
6. Grow MCP as a local automation/testing surface (see
   [mcp-harness.md](mcp-harness.md)); keep UI and MCP honesty about todayΓÇÖs
   separate documents.
7. Define testable scope for 3MF + materials/colors as a **target**, not as
   current functionality.

## Related reading

- [README.md](../README.md) ΓÇö public product overview
- [mcp-harness.md](mcp-harness.md) ΓÇö MCP as-built vs design notes
- [proposed-architecture.md](proposed-architecture.md) ΓÇö aspirational proposals
  (focus-scoped tools, UI co-link, multi-window broker, agent-alignment files)
- [mcp-server/README.md](../mcp-server/README.md) ΓÇö as-built server
