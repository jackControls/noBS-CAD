---
type: Concept
title: Contribution process
status: active
updated: 2026-07-27
---

# Contribution process

```text
issue (dedupe) → worktree/branch → implement → PR → babysit → merge
```

- Search and deduplicate GitHub issues before coding.
- Use `git worktree` for `issue/<n>-slug` branches.
- Babysit PRs: review comments, conflicts, CI until merge-ready.
- Maintainers: protect `main` with reviews + required checks.

Canonical detail lives in `CONTRIBUTING.md` and `docs/process.md` once merged.
