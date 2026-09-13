# Configure a standalone development MCP server

For a downloaded application, follow [Install → Connect an MCP agent](../INSTALL.md#connect-an-mcp-agent).
That setup uses the installed CAD executable with `--headless` and needs no source build.

This page describes `cargo xtask install-mcp`, the developer utility for a
separate `nbcad-mcp` binary. It updates selected clients' user configurations,
copies the server to a stable user directory and preserves unrelated entries.
It does not launch CAD or create a live session.

## Prepare and install

Use the [developer guide](../DEVELOPMENT.md#standalone-mcp-server) to build the
standalone server and configure its native OCCT runtime. Pair it with a desktop
from the same source revision when using live control. This installer launches
its selected binary with no arguments; do not pass a packaged CAD executable
to `--binary`.

From the repository root:

```sh
cargo xtask install-mcp --dry-run
cargo xtask install-mcp --clients cursor,vscode
```

The dry run discovers client configuration directories and prints the intended
changes without building, copying or writing. A real install requires an
explicit `--clients` list. Supported names are `cursor`, `vscode`, `claude` and
`opencode`; an absent client is skipped with a log message.

To select an already-built standalone server explicitly:

```sh
cargo xtask install-mcp --clients cursor --no-build --binary /absolute/path/to/nbcad-mcp
```

Use `nbcad-mcp.exe` on Windows. The server entry is named **nobs-cad**.
Reload the client's MCP servers after installation.

## Configuration destinations

The utility detects the existing user configuration, rather than writing a
committed workspace file:

- **Cursor:** `~/.cursor/mcp.json`, with `mcpServers.nobs-cad`.
- **VS Code:** the detected Code or Code Insiders user `mcp.json`, with
  `servers.nobs-cad` and `"type": "stdio"`. Default-profile locations are
  `%APPDATA%/Code/User/mcp.json` on Windows,
  `~/Library/Application Support/Code/User/mcp.json` on macOS and
  `~/.config/Code/User/mcp.json` on Linux.
- **Claude Code / Claude Desktop:** detected `~/.claude.json` and/or
  `claude_desktop_config.json`, with `mcpServers.nobs-cad`.
- **OpenCode v2:** detected `opencode.json` under its configuration directory,
  with `mcp.servers.nobs-cad`.

On Windows, `~` means `%USERPROFILE%`. The
[application setup guide](../INSTALL.md#connect-an-mcp-agent) owns the copyable
manual Cursor and VS Code configurations. Keep those formats separate.

## Binary and runtime resolution

The installer resolves a standalone binary in this order:

1. An explicit `--binary PATH`.
2. `mcp-server/target/release/nbcad-mcp(.exe)`.
3. `mcp-server/target/debug/nbcad-mcp(.exe)`.
4. A release build, only if no binary exists and neither `--dry-run` nor
   `--no-build` prohibits it.

Build the intended source revision before installing; an existing executable
can be reused without rebuilding. On write, the binary is copied to
`%LOCALAPPDATA%/nbcad/mcp/nbcad-mcp.exe` on Windows, or
`$XDG_DATA_HOME/nbcad/mcp/nbcad-mcp` (default
`~/.local/share/nbcad/mcp/nbcad-mcp`) on Unix.

The generated entry includes the discovered `NBCAD_REPO_ROOT`, `OCCT_ROOT` and
OCCT `bin` addition to `PATH`. The SDK runtime remains necessary for this
standalone development installation. Packaged CAD already bundles its
runtime separately.

## Existing configurations

The installer changes only the selected `nobs-cad` entry. It backs up an existing
file to `*.bak.<pid>`, writes through a temporary file and preserves portable
permissions. Repeated client names are processed once.

Empty files and plain JSON are accepted. JSONC comments are rejected so a
pretty-print rewrite cannot silently discard them. If a client uses commented
configuration, follow the manual setup guide and add the entry yourself.

## Verify and maintain

Confirm **nobs-cad** appears in the client's server list and call
`cad_get_focus` or `cad_list_focus_areas`. Then use the
[first-part prompt](../INSTALL.md#choose-the-executable-and-try-it).
For dynamic tool discovery and live document selection, read the
[MCP interface](../../mcp-server/README.md) and [ownership guide](../mcp-harness.md).

Implementation lives in `xtask/src/install_mcp.rs`; `xtask/src/main.rs` routes
the command. New client support should include detection, the correct
configuration writer and focused tests. Run `cargo test -p xtask` for this
installer. Native CAD build and test commands remain in [DEVELOPMENT.md](../DEVELOPMENT.md).
