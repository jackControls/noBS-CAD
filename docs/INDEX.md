# Docs index

## Product / directions

| Doc | Audience | When to update |
|-----|----------|----------------|
| [goals.md](goals.md) | Everyone | Product direction changes |
| [proposed-architecture.md](proposed-architecture.md) | Everyone | When proposals ship or change |

## MCP / automation

| Doc | Audience | When to update |
|-----|----------|----------------|
| [mcp-harness.md](mcp-harness.md) | Humans + agents | Any MCP behavior change |
| [agent-mcp.md](agent-mcp.md) | Day-to-day agents | Workflow changes |
| [../mcp-server/README.md](../mcp-server/README.md) | Integrators | Tool surface / build |
| [../mcp-server/OKRs.md](../mcp-server/OKRs.md) | Maintainers | MCP milestone changes |

## Agentic / maintenance (committed project guidance)

| Doc | Audience | When to update |
|-----|----------|----------------|
| [agentic/INDEX.md](agentic/INDEX.md) | Agents + maintainers | Structure changes |
| [agentic/STEERABLE_MCP.md](agentic/STEERABLE_MCP.md) | Agents | Disclosure invariants |
| [agentic/MAINTENANCE.md](agentic/MAINTENANCE.md) | Agents + CI | Toolchain / test commands |
| [agentic/UI_OVERLAYS.md](agentic/UI_OVERLAYS.md) | UI agents + maintainers | Overlay or shell-layout changes |

## Manufacturing export

| Doc | Notes |
|-----|-------|
| [manufacturing/INDEX.md](manufacturing/INDEX.md) | 3MF/STL export subsystem |
| [manufacturing/DRAFT_PR.md](manufacturing/DRAFT_PR.md) | A+ PR summary (humans) |

## Packaging / provenance

| Doc | Notes |
|-----|-------|
| [OCCT_PACKAGING.md](OCCT_PACKAGING.md) | Native OCCT |
| [WINDOWS_PACKAGING.md](WINDOWS_PACKAGING.md) | Portable ZIP |
| [WINDOWS_NATIVE_VIEWPORT_DEBUGGING.md](WINDOWS_NATIVE_VIEWPORT_DEBUGGING.md) | Windows Bevy/WebView2 field-debugging runbook |
| [ICON_PROVENANCE.md](ICON_PROVENANCE.md) | Icons |

> Editor-specific files (`AGENTS.md`, `.cursor/`) stay **gitignored** per project policy.
> Use `docs/agentic/` for shared agent guidance that belongs in the repo.
