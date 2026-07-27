# Branch protection checklist (maintainers)

Enable after a minimal CI workflow is green on `main`.

## GitHub settings → Branches → Branch protection rule for `main`

- [ ] Require a pull request before merging
- [ ] Require approvals: 1
- [ ] Dismiss stale approvals when new commits are pushed
- [ ] Require review from Code Owners (once `CODEOWNERS` handles are real)
- [ ] Require status checks to pass (list job names from CI)
- [ ] Require branches to be up to date before merging
- [ ] Do not allow force pushes
- [ ] Do not allow deletions

## Suggested required checks (when added)

- Engine: `cargo test` workspace
- MCP: `cargo test --manifest-path mcp-server/Cargo.toml`
- Frontend: `npm run build` (and a small e2e subset on PRs)

## Agent babysit expectation

PRs that fail checks or accumulate unresolved review threads should be babysat to merge-ready rather than abandoned. See `CONTRIBUTING.md` §5 and `docs/process.md`.
