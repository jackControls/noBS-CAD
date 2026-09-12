//! Repo maintenance tasks for noBS CAD.
//!
//! ```text
//! cargo run -p xtask -- install-mcp --dry-run
//! cargo run -p xtask -- install-mcp --clients cursor,vscode --no-build
//! ```

mod install_mcp;
mod package;
mod package_mcp;
mod playback_test;
mod replay;
mod test_mcp;

use anyhow::{bail, Result};
use std::env;
use std::process::ExitCode;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<()> {
    let mut args = env::args().skip(1);
    let Some(command) = args.next() else {
        print_usage();
        bail!("missing command");
    };

    match command.as_str() {
        "package" => package::run(args),
        "run-script" => replay::run(args),
        "cad-call" => replay::call(args),
        "verify-package-mcp" => package_mcp::run(args),
        "test-mcp" => test_mcp::run(args),
        "install-mcp" => {
            let options = install_mcp::Options::parse(args)?;
            install_mcp::run(options)
        }
        "help" | "--help" | "-h" => {
            print_usage();
            Ok(())
        }
        other => {
            print_usage();
            bail!("unknown command '{other}'");
        }
    }
}

fn print_usage() {
    eprintln!(
        "\
noBS CAD xtask

Usage:
  cargo xtask package
  cargo run -p xtask -- install-mcp --dry-run
  cargo run -p xtask -- install-mcp --clients LIST [--no-build] [--binary PATH]

Commands:
  package       Build the host desktop package using the existing platform bundler.
                Use --help for prerequisites and optional Windows target selection.
  run-script    Run a .nbcad.jsonc file or --recipe ID using the Rust MCP client. Use --server PATH,
                --session UUID --new --present to replay in an existing window.
                --repeat 2 verifies independent headless runs are deterministic.
  cad-call      Send one MCP command from Rust (--tool NAME --args JSON).
  verify-package-mcp
                Verify a packaged executable over stdio without launching a GUI:
                --server PATH --server-arg --mcp [--out REPORT.json]
                Repeat --server-arg for additional executable arguments.
                --timeout-seconds N bounds each request (default: 120).
  test-mcp      Run contracts (default), live, controls, playback, scripts-workspace, exit, bench, garden-bench, or drawing. Additional
                arguments pass directly to the selected MCP test/demo driver.
                Example: cargo xtask test-mcp live --server PATH --desktop PATH
  install-mcp   Detect installed agent clients and upsert the local nbcad-mcp
                stdio server into each client's user config (Cursor, VS Code,
                Claude, OpenCode).

Options for install-mcp:
  --dry-run           Discover/print only — zero build, copy, or config write
  --no-build          Do not cargo-build the MCP server (use existing binary)
  --binary PATH       Explicit path to nbcad-mcp (skips default discovery)
  --clients LIST      Required for writes. Comma-separated:
                      cursor,vscode,claude,opencode
  --server-name NAME  Config key (default: nobs-cad)

Docs: docs/agentic/INSTALL_MCP.md
"
    );
}
