# ADR 0001 — Rust for the shared engine and platform-neutral features

- Status: Proposed
- Date: 2026-07-27

## Context

The geometry planning, history, and MCP server are already Rust. The UI is
React/TypeScript + Three.js inside Tauri. Native packaging exists for macOS and
Windows, while Linux packaging remains incomplete. Cross-platform reliability
suffers when shared model behavior lands only in JavaScript or platform-specific
shell code.

## Decision (proposed)

1. Implement shared engine, export, MCP, and project-I/O behavior in Rust when
   it must serve more than one host, then expose it through the existing
   bridges.
2. **Do not rewrite the React UI wholesale.** Migrate seams such as export,
   file I/O, and the viewport bridge first.
3. Treat Windows and Linux as first-class native targets alongside macOS;
   track remaining packaging gaps in issues.
4. Keep OCCT as the B-rep backend; Rust owns planning/history around it.

## Consequences

- Contributors default to Rust for shared semantic model changes.
- TypeScript remains appropriate for the ribbon, dialogs, and browser-specific
  integration.
- Keep Windows and macOS builds gated; add Linux coverage when that packaging
  path exists.

## Follow-up PRs

- Windows portable CI exists (merged #1); extend with engine/MCP required
  checks ([#14](https://github.com/jackControls/noBS-CAD/issues/14)).
- Shared export crate used by Tauri and MCP (pairs with [#13](https://github.com/jackControls/noBS-CAD/issues/13)).
- Packaging parity for Linux remains an open gap; track in issues, not README hope.
