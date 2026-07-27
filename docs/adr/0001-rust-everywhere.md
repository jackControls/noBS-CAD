# ADR 0001 — Rust everywhere for cross-platform

- Status: Proposed
- Date: 2026-07-27

## Context

The geometry kernel, history, and MCP server are already Rust. The UI is React/TypeScript + Three.js inside Tauri. Packaging today is strongest on macOS. Cross-platform reliability suffers when new logic lands only in JS or platform-specific shell code.

## Decision (proposed)

1. **New engine, export, MCP, and IO features are implemented in Rust** and exposed to UI/MCP via existing bridges.
2. **Do not rewrite the React UI wholesale.** Migrate seams (export, file IO, viewport bridge) first.
3. **Packaging parity**: treat Windows and Linux as first-class native targets alongside macOS; track gaps in issues, not README hope.
4. Keep OCCT as the B-rep backend; Rust owns planning/history around it.

## Consequences

- Agents default to Rust for semantic changes.
- TypeScript remains for ribbon/dialogs until a Rust UI path exists.
- CI should eventually gate Win/Linux builds, not only macOS.

## Follow-up PRs

- Windows portable CI exists (merged #1); extend with engine/MCP required
  checks ([#14](https://github.com/jackControls/noBS-CAD/issues/14)).
- Shared export crate used by Tauri and MCP (pairs with [#13](https://github.com/jackControls/noBS-CAD/issues/13)).
- Packaging parity for Linux remains an open gap; track in issues, not README hope.
