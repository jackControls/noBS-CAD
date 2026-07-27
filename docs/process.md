# Development process (humans + agents)

## Loop

```text
issue (dedupe) → worktree/branch → implement → PR → babysit → merge → close issue
```

## Issue hygiene

- Search title + body before filing.
- If two issues describe the same failure, close one as duplicate and point to the survivor.
- Agents must comment on the issue when they change scope or discover a duplicate mid-flight.

## Worktrees

Why: agents and humans can land multiple PRs without dirtying `main` or fighting checkouts.

```sh
git worktree add ../nbcad-issue-42 -b issue/42-fillet-regression origin/main
```

Remove when done:

```sh
git worktree remove ../nbcad-issue-42
```

## PR babysitting

Treat babysitting as first-class work (see Cursor babysit skill pattern):

| Concern | Action |
|---------|--------|
| Review comments | Fix valid requests; explain disagreements |
| Merge conflicts | Resolve preserving intent; ask if intents clash |
| CI | Fix failures in PR scope; never disable required checks to pass |
| Behind main | Merge/rebase latest `main`, re-verify |

## MCP / agent changes

Any MCP tool change should include:

1. Issue describing the modeling goal or bug
2. Golden scenario note in `mcp-server/README.md` or OKF wiki (when present)
3. Unit or integration coverage for the planner path touched

## Cross-platform note

Prefer Rust for new engine, export, and MCP surfaces so Windows / macOS / Linux stay aligned. UI packaging may still differ by host; document platform gaps in the issue.
