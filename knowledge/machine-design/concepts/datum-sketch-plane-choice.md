---
type: Concept
title: Datum, coordinate system, and sketch plane choice (MCP)
description: Pick origin planes, datum planes, and sketch planes deliberately for one-step MCP modeling — avoid wrong-face sketches and flipped extrudes.
status: draft
updated: 2026-09-20
topics: modeling, mcp, gdt, datums, sketch
keywords: datum plane, sketch plane, coordinate system, origin plane, XY YZ ZX, plane choice, MCP one-step, datum_plane_create, sketch on face, normal direction
related_recipes: fillet-basics, mounting-plate, angle-bracket
sources: nist-gdt-1
---

# Datum, coordinate system, and sketch plane choice (MCP)

Agents fail one-step models when the **sketch plane** is wrong: profile on the
wrong face, extrude flipped into solid, or a “datum” that is really a floating
construction plane with no story. Choose **coordinate frame → plane → sketch**
on purpose.

GD&T **datums** (A/B/C) are a different vocabulary from CAD **datum planes** —
see [GD&T intro](gdt-intro.md). This page is about **modeling planes** for MCP.

## Default frame

1. Prefer the **origin triad** (XY / YZ / ZX) for the first sketch unless the
   part must sit on a purchased face.
2. Keep **+Z up** habits consistent with the project unless a recipe documents
   otherwise.
3. Name the **functional bottom / mounting face** before cosmetic faces.

## When to create a datum plane

Use `datum_plane_create` / edit tools when:

- You need an **offset** from origin or a planar face
- You need a **midplane** between two faces
- You need a **plane at angle** for a drafted or angled feature

Do **not** create datum planes to paper over a wrong first sketch — fix the
sketch plane or edit the feature
([MCP workflow](../../concepts/agent-mcp-workflow.md)).

## Sketch plane checklist (MCP one-step)

1. **State the plane** in the plan (“rectangle on XY, extrude +Z”).
2. Confirm with `solid_scene` / document inspect that the intended face or
   origin plane is selected — see
   [MCP workflow](../../concepts/agent-mcp-workflow.md).
3. Sketch closed profile; finish sketch before extrude/revolve.
4. Check extrude **direction** (into air vs into material) before long chains.
5. Prefer **sketch on planar face** only when that face already exists and is
   the functional reference.
6. Avoid stacking anonymous offset planes without names/ids you will reuse.

## Locating vs modeling planes

- **Modeling plane** — where geometry is born (sketch/extrude).
- **GD&T datum** — inspection reference on the drawing
  ([GD&T intro](gdt-intro.md), [locating schemes](locating-scheme-dof.md)).

Prefer deliberate datum planes; keep ASME frames tied to functional faces, not a random construction plane.

## Related recipes

`fillet-basics`, `mounting-plate`, and `angle-bracket` show clean plane →
sketch → feature chains on blank documents.

Related: [agent MCP workflow](../../concepts/agent-mcp-workflow.md),
[GD&T intro](gdt-intro.md),
[drawing vs MBD / PMI](drawing-vs-mbd-pmi.md).
