# Main branch protection and validation

## Verified repository policy

As of 2026-09-17, jackControls/noBS-CAD uses the active **[Protect main](https://github.com/jackControls/noBS-CAD/rules/19790895)**
ruleset (id `19790895`). Main requires one approving review, dismissal of stale
approvals, and resolution of review threads. Force pushes and branch deletion are
blocked. The PR author cannot supply their own approval.

Required status checks are **not configured**. Passing CI is evidence for review,
but GitHub does not yet enforce it as a merge requirement. Updating the ruleset
requires repository administration; collaborator push and triage access is
insufficient. Until a maintainer applies the change below, inspect all applicable
results on the exact PR head before merging — an approval alone does not establish
that the code passed CI.

Tracking: [#14](https://github.com/jackControls/noBS-CAD/issues/14) (parent
[#9](https://github.com/jackControls/noBS-CAD/issues/9)).

## Proposed required check names

Use the Check Run `name` strings as shown in the PR Checks UI and Checks API, not
only the workflow file titles. Reusable-workflow jobs include the caller job id as
a prefix.

### Lean set to require on `main`

These four names are the intended first required-status-check list for #14. Prefer
this lean set over the full desktop package matrix.

| Check Run name | Workflow | Why |
| --- | --- | --- |
| `VERSION matches every carrier` | Version guard | Always runs on every PR and main push; cheapest always-reporting gate. |
| `frontend_regressions / Frontend regression tests` | Desktop packages → Frontend | Always runs on every PR via the reusable Frontend workflow. Copy this prefixed name from the PR; the bare `Frontend regression tests` name is what appears on direct Frontend workflow runs (for example main pushes), not the PR check name. |
| `MCP tests (Ubuntu)` | MCP server | Lean OCCT/MCP gate on Ubuntu. |
| `Ubuntu host-neutral crates` | Linux engine tests | Workspace `cargo test --locked` without packaging cost. |

Do **not** require Windows portable package jobs (`Windows x64 portable ZIP`,
`Windows arm64 portable ZIP`) or the other Desktop packages matrix builds for #14.
Keep them informative; the issue title calls for staying lean on Windows portable.
Likewise leave Windows `mcp-tests`, pages-knowledge `build`/`deploy`, and
`Classify desktop build inputs` optional.

### Path-filter and skip pitfalls

`MCP tests (Ubuntu)` and `Ubuntu host-neutral crates` only start when their
workflows' path filters match. A docs-only or otherwise filtered PR never creates
those check runs. If they are marked required in Protect main before they always
report (success, failure, or an explicit always-on stub), that PR waits forever.

Until those workflows gain an always-reporting gate, either:

1. Require only the two always-on names above first, then add the MCP and
   host-neutral names after always-report stubs land, or
2. Add all four names only when a maintainer accepts that docs-only PRs must touch
   a watched path or wait for a follow-up workflow change.

Desktop package jobs that classify to skip are the same class of trap — do not
require them.

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
- **Version guard** checks `VERSION` against every carrier and unit-tests those
  carriers on every pull request and main push. It installs no dependencies, so
  it is the cheapest always-reporting gate available.

Local checks:

```sh
npm ci --ignore-scripts
npm run test:frontend
npm run build:desktop
npm run check:knowledge
npm run version:check
npm run test:version
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

After the current jobs have passed on a PR, an administrator (Jack) can add the
exact Check Run names from the lean set above to **[Protect main](https://github.com/jackControls/noBS-CAD/rules/19790895)**,
preserving its review and deletion rules. Start with the always-on names if path
filters still skip MCP and host-neutral jobs. Reusable-workflow check names may
include the caller job prefix; copy the name from the actual PR.

Do not mark path-filtered engine or MCP workflows required until they have an
always-reporting gate, unless the maintainer explicitly accepts the docs-only
deadlock. Keep platform packaging informative until its cost and reliability
justify making it required. Do not disable failing checks just to permit a merge.

Documenting these names does not finish #14. Acceptance still needs the ruleset
edit and a verify pass that a failing required check blocks merge.

## Repository ownership

Collaborators can use branches directly on `jackControls/noBS-CAD` with that
repository as `origin`; a personal fork is optional. Before deleting a fork,
preserve unique commits and finish or migrate any upstream PR using its branches.
Disable redundant fork Actions separately so retiring a fork does not remove
upstream test coverage.
