# ADR 0005 — Seven main goals

- Status: Proposed
- Date: 2026-07-27
- Detail: `docs/goals.md` (mission / harness docs PR)
- Tracking: epic [#9](https://github.com/jackControls/noBS-CAD/issues/9)

## Context

The project needs a short shared north star for humans and agents. Long prose
belongs in `docs/goals.md`; this ADR freezes the list.

## Decision (proposed)

Track these as the main goals:

1. Agentic CAD (MCP harness, co-link, multi-window — #10/#11/#12)
2. Additive manufacturing (3MF with materials/colors — #13)
3. Standards (STEP, 3MF, local project files)
4. Rust (engine + MCP)
5. Fully offline (stdio; no required cloud)
6. Simulation (later — do not claim early)
7. Education (tutor-style; quests = golden scenarios — #16)

Near-term engineering still prioritizes reliability, MCP focus/co-link, 3MF,
and CI — simulation and full education UX come after foundations.

## Consequences

- New features should map to at least one goal in the PR or issue.
- Docs stay plain language so both humans and agents can follow them.
- Kill-list claims that contradict reality: [#22](https://github.com/jackControls/noBS-CAD/issues/22).
