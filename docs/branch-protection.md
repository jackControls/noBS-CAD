# Branch protection checklist (maintainers)

Enable after minimal **engine + MCP** CI from
[#14](https://github.com/jackControls/noBS-CAD/issues/14) is green on `main`.

**Today:** only `.github/workflows/windows-portable.yml` (`Windows x64 portable ZIP`)
runs on PRs/tags. Branch protection is **not** enabled yet — do not require
job names that do not exist.

Process PR: this file. Lean on merged Windows portable (#1); add focused
workflows without boiling the ocean.

## GitHub settings → Branches → Branch protection rule for `main`

- [ ] Require a pull request before merging
- [ ] Require approvals: 1
- [ ] Dismiss stale approvals when new commits are pushed
- [ ] Require review from Code Owners (once `CODEOWNERS` handles are real)
- [ ] Require status checks to pass (list **exact** job names from CI)
- [ ] Require branches to be up to date before merging
- [ ] Do not allow force pushes
- [ ] Do not allow deletions

## Suggested required checks (when [#14](https://github.com/jackControls/noBS-CAD/issues/14) lands)

| Check | Job idea | Required? |
|-------|----------|-----------|
| Engine | `ci-engine` — `cargo test --workspace` | **Yes** once green |
| MCP | `ci-mcp` — build/test `mcp-server` | **Yes** once green |
| E2E smoke | small Playwright subset | Soft → then required |
| Windows portable | existing `Windows x64 portable ZIP` | Informative until stable/fast |
| Co-link smoke | only after [#11](https://github.com/jackControls/noBS-CAD/issues/11) | Later |

Path-filter or skip expensive portable ZIP on docs-only PRs when practical.

## Agent babysit expectation

PRs that fail checks or accumulate unresolved review threads should be babysat
to merge-ready rather than abandoned. See `CONTRIBUTING.md` §5 and `docs/process.md`.
