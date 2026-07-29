---
type: Concept
title: Export and print
description: Current CAD interchange support and planned additive-manufacturing formats.
status: stable
updated: 2026-07-29
---

# Export and print

## Today

- STEP import
- AP242 STEP export in the UI
- No 3MF on `main` yet

## Target

- **3MF** from OCCT tessellation (preferred print package)
- Useful **color/material** metadata when the model has appearance data
- **STL** fallback; document appearance limits
- Keep STEP for CAD interchange

See [goals](../../docs/goals.md) for the accepted direction and
[proposed architecture](../../docs/proposed-architecture.md) for ideas that
have not shipped.
