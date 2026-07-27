# ADR 0004 — Project rename shortlist

- Status: Proposed — **deferred**
- Date: 2026-07-27
- Tracking: [#21](https://github.com/jackControls/noBS-CAD/issues/21)
- Queue: after harness docs land; **not** before co-link / focus P0

## Context

`noBS CAD` / `noBS-CAD` / `nbcad` is memorable and on-brand for “no cloud, no BS,”
but the “BS” token can limit formal channels, academic citations, and some
app-store surfaces. A rename is easier **before** wide adoption.

## Decision (proposed)

Do **not** mass-rename in this ADR. Record a maintainer decision on issue #21
first, then plan crate/binary/repo migration.

### Shortlist

| Name | Notes |
|------|-------|
| **AnvilCAD** | Strong mechanical metaphor; short |
| **BenchCAD** | Workbench + agent bench |
| **LocalForge** | Local-first + craft |
| **ForgeLocal** | Same idea, noun-first |
| **AgentAnvil** | Leans into AI-CAD identity |

Internal crate prefix can stay `nbcad` temporarily or move after decision.

## Consequences

- Marketing, GitHub rename, package IDs, and MCP server name all move together.
- Defer until process + AGENTS + MCP harness docs land to avoid churn.
- If “wont-rename,” close #21 with rationale.

## Open questions

- Preferred top choice?
- Keep “no cloud” slogan under the new name?
