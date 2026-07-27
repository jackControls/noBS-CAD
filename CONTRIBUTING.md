# Contributing to noBS CAD

Issue-first, worktree-per-change, PR-babysit-to-merge, **prove it ran**.

Harness / agentic backlog: epic
[#9](https://github.com/jackControls/noBS-CAD/issues/9).
Runnable evidence on PRs:
[#18](https://github.com/jackControls/noBS-CAD/issues/18).
CI checks:
[#14](https://github.com/jackControls/noBS-CAD/issues/14).

## 1. Start from an issue

1. Search existing issues before opening a new one (deduplicate). Prefer linking
   children of epic #9 when the work is harness / MCP / export / CI related.
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
- Do not claim MCP↔UI co-link, focus-aware tools, or multi-window agent control
  until those issues are done ([#22](https://github.com/jackControls/noBS-CAD/issues/22)).

## 4. Open a PR

- Title: imperative, scoped (`mcp: add solid_export_3mf`, not `updates`).
- Body: link the issue (`Fixes #N` / `Refs #N`), summary, **validation evidence**.
- Request review. Expect automated review (Bugbot / CODEOWNERS) where configured.
- Keep the PR mergeable: rebase or merge `main` when behind.

### Validation evidence (required)

Check **one** of the following in the PR template ([#18](https://github.com/jackControls/noBS-CAD/issues/18)):

- [ ] Ran `cargo test --workspace` (or named crates) — paste summary
- [ ] Ran MCP scenario (tool sequence) — describe
- [ ] Ran named e2e script (e.g. `npm run e2e:m2`) — say which
- [ ] Docs-only / no runtime impact — state explicitly

“Looks good in the editor” is not enough for engine/MCP/UI behavior changes.

## 5. Babysit until merge

A PR is not done when opened. Stay on it until merge-ready:

1. Triage review comments (including bot findings); fix valid ones or reply why not.
2. Resolve merge conflicts intentionally (preserve both intents; ask if they conflict).
3. Fix CI failures caused by this PR; do not weaken checks to force green.
4. Re-run until: green CI, unresolved threads addressed, no conflicts.

Maintainers merge only when the above holds and branch protection allows it.

## 6. Branch protection (maintainers)

Enable **after** engine/MCP jobs from [#14](https://github.com/jackControls/noBS-CAD/issues/14)
are green. Today only Windows portable CI exists — do not require checks that
do not exist yet.

See [docs/branch-protection.md](docs/branch-protection.md) and
[docs/process.md](docs/process.md).

## License / borrow

Project is **LGPL-2.0-or-later**. Peer projects (e.g. Open CAD Studio, **GPL-3**)
— borrow **ideas**, not code, unless counsel says otherwise
([#19](https://github.com/jackControls/noBS-CAD/issues/19)).
