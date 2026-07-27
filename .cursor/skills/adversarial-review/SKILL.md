---
name: adversarial-review
description: >-
  Run a hostile-but-fair review of noBS CAD open PRs, main code, CI/CD,
  licensing, and agentic/local/gamified positioning. Use when asked for an
  adversarial review, PR pack review for Jack, or architecture attack on
  MCP/UI co-link and multi-window.
---

# Adversarial review (noBS CAD)

Follow **[docs/prompts/ADVERSARIAL_REVIEW.md](../../docs/prompts/ADVERSARIAL_REVIEW.md)** exactly.

That file is the source of truth for mission, mandatory reading, adversarial questions, and required output format.

## Quick start

1. `gh pr list --repo jackControls/noBS-CAD --state open`
2. Diff each open PR; inspect `main` MCP/UI/CI/license
3. Attack co-linked MCP↔UI, multi-window MCP routing, in-the-loop browser+MCP validation
4. Emit the required output sections; end with ranked next PRs

Do not soft-pedal. Continue actionable suggestions.
