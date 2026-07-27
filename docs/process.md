# Development process (humans + agents)

## Loop

```text
issue (dedupe) → worktree/branch → implement → prove ran → PR → babysit → merge → close issue
```

Harness epic: [#9](https://github.com/jackControls/noBS-CAD/issues/9).  
Runnable evidence: [#18](https://github.com/jackControls/noBS-CAD/issues/18).  
CI: [#14](https://github.com/jackControls/noBS-CAD/issues/14).

## Issue hygiene

- Search title + body before filing.
- If two issues describe the same failure, close one as duplicate and point to the survivor.
- Agents must comment on the issue when they change scope or discover a duplicate mid-flight.
- Prefer extending epic #9 children over opening parallel vague “agentic CAD” issues.

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

Treat babysitting as first-class work:

| Concern | Action |
|---------|--------|
| Review comments | Fix valid requests; explain disagreements |
| Merge conflicts | Resolve preserving intent; ask if intents clash |
| CI | Fix failures in PR scope; never disable required checks to pass |
| Behind main | Merge/rebase latest `main`, re-verify |
| Validation | Template must show what was run (#18) |

## MCP / agent changes

Any MCP tool or session change should include:

1. Issue describing the modeling goal or bug (link #10/#11/#12 when applicable)
2. Golden scenario note in `mcp-server/README.md` or knowledge wiki (when present)
3. Unit or integration coverage for the planner / focus / attach path touched
4. Honest statement: headless-only vs UI co-link ([#11](https://github.com/jackControls/noBS-CAD/issues/11))

## Cross-platform note

Prefer Rust for new engine, export, and MCP surfaces so Windows / macOS / Linux
stay aligned. UI packaging may still differ by host; document platform gaps in
the issue. Windows portable artifact CI already exists; engine/MCP required
checks are [#14](https://github.com/jackControls/noBS-CAD/issues/14).
