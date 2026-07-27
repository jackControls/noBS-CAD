# ADR 0004 — Project rename shortlist

- Status: Proposed
- Date: 2026-07-27

## Context

`noBS CAD` / `noBS-CAD` / `nbcad` is memorable and on-brand for “no cloud, no BS,” but the “BS” token can limit formal channels, academic citations, and some app-store surfaces. A rename is easier **before** wide adoption.

## Decision (proposed)

Do **not** mass-rename in this ADR. Pick a public name first, then plan crate/binary/repo migration.

### Shortlist

| Name | Notes |
|------|-------|
| **AnvilCAD** | Strong mechanical metaphor; short |
| **BenchCAD** | Workbench + agent bench |
| **LocalForge** | Local-first + craft |
| **ForgeLocal** | Same idea, noun-first |
| **AgentAnvil** | Leans into AI-CAD identity |

Internal crate prefix can stay `nbcad` temporarily or move to `anvil_` / `bench_` after decision.

## Consequences

- Marketing, GitHub rename, package IDs, and MCP server name all move together
- Defer until process + AGENTS + OKF land to avoid churn on docs

## Open questions

- Preferred top choice?
- Keep “no cloud” slogan under the new name?
