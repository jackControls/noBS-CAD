# Contributing to noBS CAD

Issue-first, worktree-per-change, PR-babysit-to-merge.

## 1. Start from an issue

1. Search existing issues before opening a new one (deduplicate).
2. One issue = one problem or proposal. Link related issues instead of restating them.
3. Prefer labels: `bug`, `enhancement`, `agent`, `docs`, `geometry`, `mcp`, `packaging`.
4. Do not start implementation without an issue number you can put on the branch and PR.

## 2. Branch in a worktree

From a clean `main`:

```sh
git fetch origin
git worktree add ../nbcad-issue-N -b issue/N-short-slug origin/main
cd ../nbcad-issue-N
```

Keep `main` checked out in the primary clone; do all feature work in the worktree.

## 3. While you work

- Update the issue with progress, blockers, and decisions (agents included).
- Keep diffs focused. Prefer small PRs over multi-week branches.
- Add or extend tests for geometry/MCP regressions when you change behavior.
- Do not commit secrets, local OCCT paths, or machine-specific config.

## 4. Open a PR

- Title: imperative, scoped (`mcp: add solid_export_3mf`, not `updates`).
- Body: link the issue (`Fixes #N` / `Refs #N`), summary, test plan.
- Request review. Expect automated review (Bugbot / CODEOWNERS) where configured.
- Keep the PR mergeable: rebase or merge `main` when behind.

## 5. Babysit until merge

A PR is not done when opened. Stay on it until merge-ready:

1. Triage review comments (including bot findings); fix valid ones or reply why not.
2. Resolve merge conflicts intentionally (preserve both intents; ask if they conflict).
3. Fix CI failures caused by this PR; do not weaken checks to force green.
4. Re-run until: green CI, unresolved threads addressed, no conflicts.

Maintainers merge only when the above holds and branch protection allows it.

## 6. Branch protection (maintainers)

Recommended `main` rules once CI exists:

- Require pull request before merge
- Require at least one approving review
- Require status checks to pass (build/test/e2e subset)
- Disallow force-push to `main`
- Prefer linear history (squash or rebase merge)

See `docs/process.md` for the full agent/human loop.
