# Contributing to noBS CAD

Thanks for helping. This guide is meant to be practical and welcoming — not
heavy bureaucracy.

Maintainers today: `@jackControls` and `@jeffglousher`. Either can review the
other’s work; a PR author should not approve their own PR.

## 1. Issues

- Search existing issues before opening a new one.
- **Recommended** for substantial bugs and features so discussion stays
  visible.
- **Optional** for small fixes, typos, and documentation-only PRs — open
  straight to a PR if that is clearer.

Useful labels include: `bug`, `enhancement`, `mcp`, `geometry`, `packaging`,
`documentation`.

## 2. Branches

From a clean `main`:

```sh
git fetch origin
git checkout -b fix/short-slug origin/main
```

[Git worktrees](https://git-scm.com/docs/git-worktree) are helpful for
**parallel** or agent work. They are **not** required for every contribution.

## 3. While you work

- Keep diffs focused. Prefer small PRs.
- Add or extend tests when you change geometry/MCP behavior.
- Do not commit secrets, `.env*` files, machine-local OCCT paths, or personal
  editor/agent state (those paths are gitignored).
- Do not weaken CI to force a green check.

## 4. Open a PR

- Title: imperative and scoped (`mcp: clarify stdio setup`, not `updates`).
- Link an issue when one exists (`Fixes #N` / `Refs #N`).
- Include a short **test plan** proportional to the change (see template).
- Keep the PR mergeable with `main`.

### Validation (proportional)

Pick what fits:

- Ran `cargo test` (or named crates) — note which
- Ran an MCP or e2e scenario — describe briefly
- Docs-only / no runtime impact — say so explicitly

## 5. Follow through until merge-ready

Stay with the PR until it is ready to merge:

1. Address review comments (or explain disagreements).
2. Resolve conflicts intentionally.
3. Fix CI failures caused by the PR.

Maintainers merge when the above holds and required reviews pass.

## 6. Branch protection (maintainers)

See [docs/branch-protection.md](docs/branch-protection.md).

## License / borrow

Project is **LGPL-2.0-or-later**. Peer projects (e.g. Open CAD Studio, **GPL-3**)
— borrow **ideas**, not code, unless counsel says otherwise.
