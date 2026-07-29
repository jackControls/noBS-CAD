# xtask index

Repo maintenance CLI (workspace member).

| Path | Role |
|------|------|
| [Cargo.toml](Cargo.toml) | Crate manifest |
| [src/main.rs](src/main.rs) | Commands |
| [src/install_mcp.rs](src/install_mcp.rs) | Detect + upsert MCP into agent clients |

## Commands

```powershell
cargo run -p xtask -- install-mcp
cargo run -p xtask -- install-mcp --dry-run
cargo test -p xtask
```

Guide: [../docs/agentic/INSTALL_MCP.md](../docs/agentic/INSTALL_MCP.md).
