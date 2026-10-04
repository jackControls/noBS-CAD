# Configure CAD MCP clients

For a downloaded application, follow [Install → Connect an MCP agent](../INSTALL.md#connect-an-mcp-agent).
That setup uses the installed CAD executable with `--headless` and needs no source build.

`cargo xtask install-mcp` updates selected clients' user configurations and
preserves unrelated entries. It can use the installed Bevy application in place
or copy a standalone development server. It does not launch CAD or create a live
session.

## Installed Bevy application

Use the canonical installed executable, with its adjacent runtime libraries:

```text
cargo xtask install-mcp --clients codex,cursor,vscode,claude,opencode --no-build --binary ABSOLUTE_CAD_PATH --in-place --server-arg --headless --desktop ABSOLUTE_CAD_PATH
```

Replace `ABSOLUTE_CAD_PATH` with the installed executable on your OS. On this
Windows machine it is `C:/Users/jeffg/AppData/Local/nbcad/bevy/noBS-CAD.exe`.
`--in-place` leaves the executable and runtime libraries together and adds no
SDK paths. `--server-arg` accepts a literal argument, including `--headless`,
and can be repeated. `--desktop` sets `NBCAD_DESKTOP_BIN` for an explicit
`cad_interface launch`. Reload the client's MCP connection after installing.

GUI and MCP use the same Bevy binary. `--headless` runs an independent document
without a window; explicit attach selects a live document. Without that flag,
the application opens a Bevy window and its stdio MCP controls that window.

Standalone installation refuses to write through a redirected install directory
(a symlink or Windows junction). Use `--in-place` when an old MCP path has been
redirected to the packaged application.

## Standalone development server

Use the [developer guide](../DEVELOPMENT.md#standalone-mcp-server) to build the
standalone server and configure its native OCCT runtime. Pair it with a desktop
from the same source revision when using live control. A standalone server uses
no arguments. Packaged desktop executables must use `--in-place` and the launch
arguments above rather than being copied out of their runtime directory.

From the repository root:

```sh
cargo xtask install-mcp --dry-run
cargo xtask install-mcp --clients cursor,vscode
```

The dry run discovers client configuration directories and prints the intended
changes without building, copying or writing. A real install requires an
explicit `--clients` list. Supported names are `codex`, `cursor`, `vscode`, `claude` and
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

- **Codex:** `$CODEX_HOME/config.toml`, default `~/.codex/config.toml`, with
  `mcp_servers.nobs-cad`. TOML comments and unrelated tables are preserved.
  Malformed TOML is refused without logging its contents.
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

Empty files, Codex TOML and plain JSON are accepted. JSONC comments are rejected so a
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
configuration writer and focused tests. Run `cargo test --locked -p xtask install_mcp::tests::` for this
installer. Native CAD build and test commands remain in [DEVELOPMENT.md](../DEVELOPMENT.md).

## Local help (`cad_help` + knowledge resources)

After the server is installed, prefer:

1. MCP tool **`cad_help`** with actions `search` → `get` / `topics` (snippet-first;
   caps locked in [`machine-design-help-search.md`](../machine-design-help-search.md)).
2. MCP **`resources/list`** / **`resources/read`** on `nbcad://knowledge/...` when the
   full markdown page is needed.

Rebuild/reinstall the MCP binary after knowledge or `crates/help` changes so the
embedded corpus matches the checkout:

```sh
cargo xtask install-mcp --clients cursor
```

Then re-Add / reload the Cursor MCP server (restart alone is not enough after a
binary replace).

