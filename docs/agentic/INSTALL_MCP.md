# Install noBS CAD MCP into agent clients

**Audience:** humans setting up local automation, and coding agents that need a
repeatable, safe install path.

**One command** detects which AI clients you already use, then **upserts**
(inserts or updates) the local `nbcad-mcp` stdio server into each client’s
**user** config. Other MCP servers are left alone.

---

## Quick start

From the repository root:

```powershell
cargo run -p xtask -- install-mcp
```

Dry run (no writes):

```powershell
cargo run -p xtask -- install-mcp --dry-run
```

Then **restart** the client (or reload MCP) so it picks up the new server.

Server key written into configs: **`nobs-cad`**.

---

## What “detect” means

The installer does **not** force-install into every tool on the planet.

For each client family it looks for a known **user config file** or **config
directory**. If nothing is present, that family is **skipped** with a clear
log line.

| Client | Detection markers (typical) | File upserted |
|--------|-----------------------------|---------------|
| **Cursor** | `~/.cursor/` or `~/.cursor/mcp.json` | `~/.cursor/mcp.json` |
| **VS Code** | `%APPDATA%/Code/` (and Insiders) or macOS/Linux Code dirs | `…/User/mcp.json` |
| **Claude** | `~/.claude.json` or `~/.claude/`; also Claude Desktop app folder | Claude Code user file and/or `claude_desktop_config.json` |
| **OpenCode** | `~/.config/opencode/` (or `XDG_CONFIG_HOME` / `%APPDATA%/opencode`) | `opencode.json` |
| **Grok** | `~/.grok/` or `$GROK_HOME` | `config.toml` |

Windows home is `%USERPROFILE%`. macOS/Linux home is `$HOME`.

---

## What “upsert” means

1. Read the existing config if present (or start from an empty template).
   Empty files and light JSONC (`//` / `/* */`) are accepted for JSON clients.
2. Set / replace only the **`nobs-cad`** entry.
3. Preserve every other server and unrelated settings.
4. Write pretty JSON (or TOML for Grok).

Shapes used:

- Cursor / Claude: top-level `mcpServers.nobs-cad`
- VS Code: top-level `servers.nobs-cad` with `"type": "stdio"`
- OpenCode: `mcp.nobs-cad` (or `mcp.servers.nobs-cad` if that nest already exists)
- Grok: `[mcp_servers.nobs-cad]` in TOML

---

## What gets configured

| Field | Value |
|-------|--------|
| Command | Stable user copy: `%LOCALAPPDATA%/nbcad/mcp/nbcad-mcp.exe` (avoids locking `target/release`) |
| Args | `[]` |
| Env | `NBCAD_REPO_ROOT`, `OCCT_ROOT` when found; `PATH` with OCCT `bin` for DLLs |

Build step (default):

```text
cargo build --release --manifest-path mcp-server/Cargo.toml
```

Skip build if you already have a binary:

```powershell
cargo run -p xtask -- install-mcp --no-build
```

Point at a custom binary:

```powershell
cargo run -p xtask -- install-mcp --binary path\to\nbcad-mcp.exe
```

Limit clients:

```powershell
cargo run -p xtask -- install-mcp --clients cursor,vscode
```

---

## Prerequisites

1. Rust toolchain (`cargo` on `PATH`).
2. OCCT available for a successful MCP **release** build — see
   [MAINTENANCE.md](MAINTENANCE.md) and [WINDOWS_PACKAGING.md](../WINDOWS_PACKAGING.md).
3. At least one client already present (config dir or file) so detection succeeds.

Local MCP behavior (disclosure, co-link, tools): [../mcp-harness.md](../mcp-harness.md).

---

## After install — smoke check

1. Restart Cursor / VS Code / Claude / OpenCode / Grok (as applicable).
2. Confirm server **`nobs-cad`** appears in that client’s MCP list.
3. Call a cheap tool, e.g. `cad_get_focus` or `cad_list_focus_areas`.
4. Prefer **dynamic** disclosure for the main agent; use `cad_list_all_tools` or
   `full_static` only when needed ([STEERABLE_MCP.md](STEERABLE_MCP.md)).

---

## Safety notes

- Writes only to **user** configs (not committed project MCP files).
- Does not delete other servers.
- Does not enable cloud transport; `nbcad-mcp` stays **local stdio**.
- Dry-run first if you want to see paths before writing.

---

## For agents maintaining this feature

| Path | Role |
|------|------|
| `xtask/src/install_mcp.rs` | Detection + upsert logic |
| `xtask/src/main.rs` | CLI entry |
| This doc | Human + agent operating guide |

When adding a new client:

1. Add a `ClientKind` + discovery paths.
2. Reuse an existing upsert format or add a small format-specific writer.
3. Extend unit tests in `install_mcp.rs`.
4. Update the detection table in this file and [INDEX.md](INDEX.md).

Run tests:

```powershell
cargo test -p xtask
```

---

## Related docs

| Doc | Why |
|-----|-----|
| [STEERABLE_MCP.md](STEERABLE_MCP.md) | Soft disclosure invariants |
| [MAINTENANCE.md](MAINTENANCE.md) | OCCT / `cargo test` for mcp-server |
| [../mcp-harness.md](../mcp-harness.md) | As-built MCP surface |
| [../../mcp-server/README.md](../../mcp-server/README.md) | Build the server itself |
