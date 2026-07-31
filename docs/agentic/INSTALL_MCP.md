# Install noBS CAD MCP into agent clients

**Audience:** humans setting up local automation, and coding agents that need a
repeatable, safe install path.

This installer **upserts** (inserts or updates) the local `nbcad-mcp` stdio
server into each chosen client’s **user** config. Other MCP servers are left
alone.

It does **not** launch the CAD UI, start a desktop session, or write session
state. Config wiring only.

---

## Quick start

Discover which clients are present (zero build / copy / write):

```powershell
cargo run -p xtask -- install-mcp --dry-run
```

Install into an explicit client list (required for any real write):

```powershell
cargo run -p xtask -- install-mcp --clients cursor,vscode
```

Skip the release build when a binary already exists:

```powershell
cargo run -p xtask -- install-mcp --clients cursor --no-build
```

Then **restart** the client (or reload MCP) so it picks up the new server.

Server key written into configs: **`nobs-cad`**.

---

## Safety rules (Jack §4)

| Rule | Behavior |
|------|----------|
| `--dry-run` | **Zero** `cargo build`, binary copy, config write, or backup |
| `--clients` | **Required** for install writes; omit only with `--dry-run` to discover |
| Duplicate clients | Repeated names are collapsed before any config is touched |
| Backups | Existing configs copied once to `*.bak.<pid>` before replace |
| Atomic write | Temp file inherits the existing portable permissions, then renames into place |
| Supported clients | `cursor`, `vscode`, `claude`, `opencode` only |
| Rejected | `grok` / `xai` (no official contract yet) |

Without `--clients` on a real install:

```text
error: --clients is required for install writes (use --dry-run to discover …)
```

---

## What “detect” means

For each requested client family the installer looks for a known **user config
file** or **config directory**. If nothing is present, that family is
**skipped** with a clear log line.

| Client | Detection markers (typical) | File upserted |
|--------|-----------------------------|---------------|
| **Cursor** | `~/.cursor/` or `~/.cursor/mcp.json` | `~/.cursor/mcp.json` |
| **VS Code** | `%APPDATA%/Code/` (and Insiders) or macOS/Linux Code dirs | `…/User/mcp.json` |
| **Claude** | `~/.claude.json` or `~/.claude/`; also Claude Desktop app folder | Claude Code user file and/or `claude_desktop_config.json` |
| **OpenCode** | `~/.config/opencode/` (or `XDG_CONFIG_HOME` / `%APPDATA%/opencode`) | `opencode.json` |

Windows home is `%USERPROFILE%`. macOS/Linux home is `$HOME`.

---

## What “upsert” means

1. Read the existing config if present (or start from an empty template).
   Empty files and strict JSON are accepted. Commented JSONC is refused so
   comments are never destroyed by a pretty-print rewrite.
2. Set / replace only the **`nobs-cad`** entry.
3. Preserve every other server and unrelated settings.
4. Backup (if the file existed) then write pretty JSON atomically.

Shapes used:

- Cursor / Claude: top-level `mcpServers.nobs-cad`
- VS Code: top-level `servers.nobs-cad` with `"type": "stdio"`
- OpenCode v2: `mcp.servers.nobs-cad`; servers connect automatically, so no
  legacy `enabled` field is written

---

## What gets configured

| Field | Value |
|-------|--------|
| Command | Resolved `nbcad-mcp` path (see binary resolution below) |
| Args | `[]` |
| Env | `NBCAD_REPO_ROOT`, `OCCT_ROOT` when found; `PATH` with OCCT `bin` for DLLs |

### Binary resolution

1. `--binary PATH` if provided (copied to the user install dir on write)
2. Else `mcp-server/target/release/nbcad-mcp(.exe)` if present
3. Else `mcp-server/target/debug/nbcad-mcp(.exe)` if present
4. Else, **only when not `--dry-run` and not `--no-build`**:

```text
cargo build --release --manifest-path mcp-server/Cargo.toml
```

On **write** installs the chosen binary is copied to a stable user path so client
configs do not point at `target/` (wiped by `cargo clean`):

- Windows: `%LOCALAPPDATA%\nbcad\mcp\nbcad-mcp.exe`
- Unix: `$XDG_DATA_HOME/nbcad/mcp/nbcad-mcp` or `~/.local/share/nbcad/mcp/nbcad-mcp`

Dry-run never builds or copies; it prints the planned user path when the binary
is missing.

Point at a custom binary:

```powershell
cargo run -p xtask -- install-mcp --clients cursor --binary path\to\nbcad-mcp.exe
```

---

## Prerequisites

1. Rust toolchain (`cargo` on `PATH`).
2. For a real install that needs a build: OCCT available — see
   [MAINTENANCE.md](MAINTENANCE.md) and [WINDOWS_PACKAGING.md](../WINDOWS_PACKAGING.md).
3. At least one requested client already present (config dir or file).
4. Client config must be **plain JSON** (no `//` / `/* */` JSONC). The upsert
   pretty-prints and would drop comments — installs refuse JSONC rather than
   silently destroy them.

Local MCP behavior (disclosure, tools): [../mcp-harness.md](../mcp-harness.md).

---

## After install — smoke check

1. Restart Cursor / VS Code / Claude / OpenCode (as applicable).
2. Confirm server **`nobs-cad`** appears in that client’s MCP list.
3. Call a cheap tool, e.g. `cad_get_focus` or `cad_list_focus_areas`.
4. Prefer **dynamic** disclosure for the main agent; use `cad_list_all_tools` or
   `full_static` only when needed ([STEERABLE_MCP.md](STEERABLE_MCP.md)).

---

## Safety notes

- Writes only to **user** configs (not committed project MCP files).
- Atomic update: existing file copied to `*.bak.<pid>`, then temp+rename.
- Existing portable config permissions, including Unix mode bits, are preserved
  across replacement.
- Duplicate names in `--clients` are processed once, preserving the first order.
- Does not delete other servers.
- Does not enable cloud transport; `nbcad-mcp` stays **local stdio**.
- Does **not** launch UI or touch session control channels.
- Prefer `--dry-run` first to see paths before writing.
- Refuses JSONC-with-comments rather than rewriting them away.

---

## For agents maintaining this feature

| Path | Role |
|------|------|
| `xtask/src/install_mcp.rs` | Detection + upsert + atomic write |
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
