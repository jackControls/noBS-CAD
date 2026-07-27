---
type: Concept
title: Contribution process
status: active
updated: 2026-07-27
---

# Contribution process

```text
issue (dedupe) → worktree/branch → implement → prove ran → PR → babysit → merge
```

- Search and deduplicate GitHub issues before coding.
- Prefer epic [#9](https://github.com/jackControls/noBS-CAD/issues/9) children for harness work.
- Use `git worktree` for `issue/<n>-slug` branches.
- **Validation evidence** on every PR (#18): cargo test / MCP scenario / named e2e / or docs-only.
- Babysit PRs: review comments, conflicts, CI until merge-ready.
- Maintainers: protect `main` only after engine/MCP checks exist (#14).

Canonical detail: `CONTRIBUTING.md`, `docs/process.md`, `docs/branch-protection.md`
(process docs PR).

## Shared vs local files

Track: root `AGENTS.md`, `.cursor/rules/`, optional `.cursor/skills/`, docs harness/ADRs, `.github/` templates.
Ignore: personal `.cursor/` state, nested agent files, `.env`, secrets, HANDOFF/qa captures, vcpkg/OCCT local trees. See root `.gitignore`.
