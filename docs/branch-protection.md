# Main branch protection and validation

## Verified repository policy

As of 2026-09-08, jackControls/noBS-CAD uses the active **Protect main**
ruleset. Main requires one approving review, dismissal of stale approvals,
and resolution of review threads. Force pushes and branch deletion are blocked.
The PR author cannot supply their own approval.

Required status checks are **not configured**. Passing CI is evidence for review,
but GitHub does not yet enforce it as a merge requirement. Updating the ruleset
requires repository administration; collaborator push access is insufficient.

## Validation responsibilities

- **Frontend regression tests** runs all seven frontend suites and the desktop
  production build. Desktop packages reuses this workflow for every main PR,
  release tag, and manual package build. The same workflow runs on main pushes.
- **Ubuntu host-neutral crates** runs `cargo test --locked --workspace`, including
  export, MCP mutation mapping, and installer tests. Source and lockfile changes
  trigger it; compiled dependencies are cached.
- **MCP server** tests native OpenCASCADE on Windows and Ubuntu. It also checks
  Rust formatting and keeps Windows installer coverage. Export tests are owned
  by the host-neutral workspace job instead of repeated in the Windows MCP job.
  New pushes cancel obsolete runs; lockfiles are enforced. Windows reuses the
  desktop SDK cache keyed by runner, MSVC version, vcpkg pin, and manifest.
- **Desktop packages** classifies build inputs before starting Windows x64/ARM64,
  macOS ARM64, and Ubuntu packages. Retain native launch checks: frontend or MCP
  tests do not establish that a packaged viewport starts correctly.
- **pages-knowledge** validates and publishes the active knowledge site. It is
  scoped to knowledge changes and is not a CAD runtime gate.

Local checks:

```sh
npm ci --ignore-scripts
npm run test:frontend
npm run build:desktop
npm run check:knowledge
cargo test --locked --workspace
cargo fmt --all -- --check
cargo fmt --manifest-path mcp-server/Cargo.toml -- --check
# Requires the platform OpenCASCADE SDK:
cargo test --locked --manifest-path mcp-server/Cargo.toml
# Browser host checks require rebuilding generated WASM first:
npm run build:wasm
npm run smoke:wasm
npm run e2e
```

## Enabling required checks

After the current jobs have passed on a PR, an administrator can add their exact
check-run names to **Protect main**, preserving its review and deletion rules.
Start with the frontend check, which runs for every PR. Reusable-workflow check
names may include the caller job prefix; copy the name from the actual PR.

Do not mark path-filtered engine or MCP workflows required until they have an
always-reporting gate. A docs-only PR otherwise waits for a check that never runs.
Keep platform packaging informative until its cost and reliability justify
making it required. Do not disable failing checks just to permit a merge.

## Repository ownership

Collaborators can use branches directly on `jackControls/noBS-CAD` with that
repository as `origin`; a personal fork is optional. Before deleting a fork,
preserve unique commits and finish or migrate any upstream PR using its branches.
Disable redundant fork Actions separately so retiring a fork does not remove
upstream test coverage.
