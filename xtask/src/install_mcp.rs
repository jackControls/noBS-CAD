//! Detect agent clients from their user config locations and upsert `nobs-cad`.

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Map, Value};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use toml_edit::{value, Array, DocumentMut, Item, Table};

pub const DEFAULT_SERVER_NAME: &str = "nobs-cad";

#[derive(Debug, Clone)]
pub struct Options {
    pub dry_run: bool,
    pub build: bool,
    pub binary: Option<PathBuf>,
    pub clients: Option<Vec<ClientKind>>,
    pub server_name: String,
}

impl Options {
    pub fn parse(args: impl Iterator<Item = String>) -> Result<Self> {
        let mut options = Self {
            dry_run: false,
            build: true,
            binary: None,
            clients: None,
            server_name: DEFAULT_SERVER_NAME.to_string(),
        };

        let mut args = args.peekable();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--dry-run" => options.dry_run = true,
                "--no-build" => options.build = false,
                "--binary" => {
                    let path = args
                        .next()
                        .ok_or_else(|| anyhow!("--binary requires a path"))?;
                    options.binary = Some(PathBuf::from(path));
                }
                "--clients" => {
                    let list = args
                        .next()
                        .ok_or_else(|| anyhow!("--clients requires a comma-separated list"))?;
                    options.clients = Some(parse_clients(&list)?);
                }
                "--server-name" => {
                    options.server_name = args
                        .next()
                        .ok_or_else(|| anyhow!("--server-name requires a value"))?;
                }
                "--help" | "-h" => bail!("help requested"),
                other => bail!("unknown install-mcp option '{other}'"),
            }
        }
        Ok(options)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientKind {
    Cursor,
    VsCode,
    Claude,
    OpenCode,
    Grok,
}

impl ClientKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Cursor => "cursor",
            Self::VsCode => "vscode",
            Self::Claude => "claude",
            Self::OpenCode => "opencode",
            Self::Grok => "grok",
        }
    }

    fn parse(name: &str) -> Result<Self> {
        match name.trim().to_ascii_lowercase().as_str() {
            "cursor" => Ok(Self::Cursor),
            "vscode" | "code" | "vs-code" => Ok(Self::VsCode),
            "claude" => Ok(Self::Claude),
            "opencode" | "open-code" => Ok(Self::OpenCode),
            "grok" | "xai" => Ok(Self::Grok),
            other => bail!("unknown client '{other}'"),
        }
    }
}

fn parse_clients(list: &str) -> Result<Vec<ClientKind>> {
    let mut out = Vec::new();
    for part in list.split(',') {
        if part.trim().is_empty() {
            continue;
        }
        out.push(ClientKind::parse(part)?);
    }
    if out.is_empty() {
        bail!("--clients list is empty");
    }
    Ok(out)
}

#[derive(Debug, Clone)]
struct ServerLaunch {
    command: PathBuf,
    env: Map<String, Value>,
}

pub fn run(options: Options) -> Result<()> {
    let repo_root = repo_root()?;
    let binary = resolve_binary(&repo_root, &options)?;
    let launch = ServerLaunch {
        command: binary,
        env: server_env(&repo_root),
    };

    println!("MCP binary: {}", launch.command.display());
    if options.dry_run {
        println!("mode: dry-run (no files will be written)");
    }

    let wanted = options.clients.unwrap_or_else(|| {
        vec![
            ClientKind::Cursor,
            ClientKind::VsCode,
            ClientKind::Claude,
            ClientKind::OpenCode,
            ClientKind::Grok,
        ]
    });

    let mut installed = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;

    for kind in wanted {
        let targets = discover_targets(kind);
        if targets.is_empty() {
            println!(
                "skip  {:<10} (not detected — no user config/marker present)",
                kind.as_str()
            );
            skipped += 1;
            continue;
        }
        for target in targets {
            match upsert_target(&target, &options.server_name, &launch, options.dry_run) {
                Ok(action) => {
                    println!(
                        "{:<5} {:<10} {}  ({})",
                        action.verb(),
                        kind.as_str(),
                        target.path.display(),
                        target.format.label()
                    );
                    installed += 1;
                }
                Err(error) => {
                    eprintln!(
                        "error {:<10} {}: {error:#}",
                        kind.as_str(),
                        target.path.display()
                    );
                    failed += 1;
                }
            }
        }
    }

    println!(
        "done: {installed} upsert(s), {skipped} client family(ies) skipped, {failed} error(s)"
    );
    if installed == 0 && failed == 0 {
        println!(
            "hint: install/open a client once so its user config directory exists, then re-run"
        );
    } else if !options.dry_run && installed > 0 {
        println!("restart each client (or reload MCP) to pick up the new server");
    }
    if failed > 0 {
        bail!("{failed} client config(s) failed; see errors above");
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
enum ConfigFormat {
    /// `{ "mcpServers": { "name": { command, args, env } } }`
    McpServers,
    /// VS Code `{ "servers": { "name": { type, command, args, env } } }`
    VsCodeServers,
    /// OpenCode `{ "mcp": { "name": { type, command, ... } } }` or nested `mcp.servers`
    OpenCodeMcp,
    /// Grok TOML `[mcp_servers.name]`
    GrokToml,
}

impl ConfigFormat {
    fn label(self) -> &'static str {
        match self {
            Self::McpServers => "mcpServers",
            Self::VsCodeServers => "servers",
            Self::OpenCodeMcp => "opencode mcp",
            Self::GrokToml => "mcp_servers toml",
        }
    }
}

#[derive(Debug, Clone)]
struct Target {
    path: PathBuf,
    format: ConfigFormat,
}

#[derive(Debug, Clone, Copy)]
enum Action {
    WouldWrite,
    Created,
    Updated,
}

impl Action {
    fn verb(self) -> &'static str {
        match self {
            Self::WouldWrite => "plan",
            Self::Created => "add",
            Self::Updated => "update",
        }
    }
}

fn discover_targets(kind: ClientKind) -> Vec<Target> {
    match kind {
        ClientKind::Cursor => detect_json(
            home_path(&[".cursor", "mcp.json"]),
            &[home_path(&[".cursor"])],
            ConfigFormat::McpServers,
        ),
        ClientKind::VsCode => {
            let mut targets = Vec::new();
            for (user_dir, markers) in vscode_user_dirs() {
                targets.extend(detect_json(
                    user_dir.join("mcp.json"),
                    &markers,
                    ConfigFormat::VsCodeServers,
                ));
            }
            targets
        }
        ClientKind::Claude => {
            let mut targets = Vec::new();
            targets.extend(detect_json(
                home_path(&[".claude.json"]),
                &[home_path(&[".claude.json"]), home_path(&[".claude"])],
                ConfigFormat::McpServers,
            ));
            // Claude Desktop (separate app)
            if let Some(appdata) = env::var_os("APPDATA") {
                let desktop = PathBuf::from(appdata)
                    .join("Claude")
                    .join("claude_desktop_config.json");
                let marker = desktop
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| desktop.clone());
                targets.extend(detect_json(
                    desktop,
                    &[marker],
                    ConfigFormat::McpServers,
                ));
            } else {
                let desktop = home_path(&["Library", "Application Support", "Claude", "claude_desktop_config.json"]);
                let marker = desktop
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| desktop.clone());
                targets.extend(detect_json(
                    desktop,
                    &[marker],
                    ConfigFormat::McpServers,
                ));
            }
            targets
        }
        ClientKind::OpenCode => {
            let mut markers = vec![
                xdg_config_path(&["opencode"]),
                home_path(&[".config", "opencode"]),
            ];
            if let Some(appdata) = env::var_os("APPDATA") {
                markers.push(PathBuf::from(appdata).join("opencode"));
            }
            let path = xdg_config_path(&["opencode", "opencode.json"]);
            let alt = home_path(&[".config", "opencode", "opencode.json"]);
            let mut targets = detect_json(path, &markers, ConfigFormat::OpenCodeMcp);
            if targets.is_empty() {
                targets = detect_json(alt, &markers, ConfigFormat::OpenCodeMcp);
            }
            targets
        }
        ClientKind::Grok => {
            let config = grok_config_path();
            let marker = config
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| config.clone());
            detect_toml(config, &[marker, home_path(&[".grok"])], ConfigFormat::GrokToml)
        }
    }
}

fn detect_json(path: PathBuf, markers: &[PathBuf], format: ConfigFormat) -> Vec<Target> {
    if path.exists() || markers.iter().any(|marker| marker.exists()) {
        vec![Target { path, format }]
    } else {
        Vec::new()
    }
}

fn detect_toml(path: PathBuf, markers: &[PathBuf], format: ConfigFormat) -> Vec<Target> {
    detect_json(path, markers, format)
}

fn vscode_user_dirs() -> Vec<(PathBuf, Vec<PathBuf>)> {
    let mut dirs = Vec::new();
    if let Some(appdata) = env::var_os("APPDATA") {
        let appdata = PathBuf::from(appdata);
        for product in ["Code", "Code - Insiders"] {
            let user = appdata.join(product).join("User");
            dirs.push((user.clone(), vec![user, appdata.join(product)]));
        }
    } else {
        // macOS / Linux typical locations
        dirs.push((
            home_path(&["Library", "Application Support", "Code", "User"]),
            vec![home_path(&["Library", "Application Support", "Code"])],
        ));
        dirs.push((
            home_path(&[".config", "Code", "User"]),
            vec![home_path(&[".config", "Code"])],
        ));
    }
    dirs
}

fn grok_config_path() -> PathBuf {
    if let Ok(home) = env::var("GROK_HOME") {
        return PathBuf::from(home).join("config.toml");
    }
    home_path(&[".grok", "config.toml"])
}

fn home_path(parts: &[&str]) -> PathBuf {
    let home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    parts.iter().fold(home, |acc, part| acc.join(part))
}

fn xdg_config_path(parts: &[&str]) -> PathBuf {
    if let Some(xdg) = env::var_os("XDG_CONFIG_HOME") {
        return parts.iter().fold(PathBuf::from(xdg), |acc, p| acc.join(p));
    }
    let mut base = home_path(&[".config"]);
    for part in parts {
        base = base.join(part);
    }
    base
}

fn upsert_target(
    target: &Target,
    server_name: &str,
    launch: &ServerLaunch,
    dry_run: bool,
) -> Result<Action> {
    if let Some(parent) = target.path.parent() {
        if !parent.exists() {
            if dry_run {
                return Ok(Action::WouldWrite);
            }
            fs::create_dir_all(parent)
                .with_context(|| format!("create {}", parent.display()))?;
        }
    }

    let existed = target.path.exists();
    let original = if existed {
        fs::read_to_string(&target.path)
            .with_context(|| format!("read {}", target.path.display()))?
    } else {
        String::new()
    };

    let next = match target.format {
        ConfigFormat::McpServers => upsert_mcp_servers_json(&original, server_name, launch)?,
        ConfigFormat::VsCodeServers => upsert_vscode_servers_json(&original, server_name, launch)?,
        ConfigFormat::OpenCodeMcp => upsert_opencode_json(&original, server_name, launch)?,
        ConfigFormat::GrokToml => upsert_grok_toml(&original, server_name, launch)?,
    };

    if dry_run {
        return Ok(Action::WouldWrite);
    }

    // Preserve trailing newline style when possible.
    let mut out = next;
    if !out.ends_with('\n') {
        out.push('\n');
    }
    fs::write(&target.path, out).with_context(|| format!("write {}", target.path.display()))?;
    Ok(if existed {
        Action::Updated
    } else {
        Action::Created
    })
}

fn upsert_mcp_servers_json(original: &str, server_name: &str, launch: &ServerLaunch) -> Result<String> {
    let mut root = parse_json_object(original, json!({ "mcpServers": {} }))
        .context("parse JSON (mcpServers)")?;
    let obj = root
        .as_object_mut()
        .ok_or_else(|| anyhow!("root JSON value must be an object"))?;
    let servers = obj
        .entry("mcpServers")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| anyhow!("mcpServers must be an object"))?;
    servers.insert(server_name.to_string(), mcp_servers_entry(launch));
    Ok(serde_json::to_string_pretty(&root)?)
}

fn upsert_vscode_servers_json(
    original: &str,
    server_name: &str,
    launch: &ServerLaunch,
) -> Result<String> {
    let mut root = parse_json_object(original, json!({ "servers": {} }))
        .context("parse JSON (VS Code servers)")?;
    let obj = root
        .as_object_mut()
        .ok_or_else(|| anyhow!("root JSON value must be an object"))?;
    let servers = obj
        .entry("servers")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| anyhow!("servers must be an object"))?;
    servers.insert(
        server_name.to_string(),
        json!({
            "type": "stdio",
            "command": path_string(&launch.command),
            "args": [],
            "env": Value::Object(launch.env.clone()),
        }),
    );
    Ok(serde_json::to_string_pretty(&root)?)
}

fn upsert_opencode_json(original: &str, server_name: &str, launch: &ServerLaunch) -> Result<String> {
    let mut root = parse_json_object(
        original,
        json!({
            "$schema": "https://opencode.ai/config.json",
            "mcp": {}
        }),
    )
    .context("parse JSON (OpenCode)")?;
    let obj = root
        .as_object_mut()
        .ok_or_else(|| anyhow!("root JSON value must be an object"))?;
    let mcp = obj
        .entry("mcp")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| anyhow!("mcp must be an object"))?;

    let entry = json!({
        "type": "local",
        "command": [path_string(&launch.command)],
        "enabled": true,
        "environment": Value::Object(launch.env.clone()),
    });

    // Prefer nested `mcp.servers` when that object already exists (OpenCode v2).
    if let Some(servers) = mcp.get_mut("servers").and_then(Value::as_object_mut) {
        servers.insert(server_name.to_string(), entry);
    } else {
        mcp.insert(server_name.to_string(), entry);
    }
    Ok(serde_json::to_string_pretty(&root)?)
}

fn upsert_grok_toml(original: &str, server_name: &str, launch: &ServerLaunch) -> Result<String> {
    let mut doc = if original.trim().is_empty() {
        DocumentMut::new()
    } else {
        original.parse::<DocumentMut>().context("parse TOML (Grok)")?
    };

    let root = doc.as_table_mut();
    let mcp_servers = root
        .entry("mcp_servers")
        .or_insert(Item::Table(Table::new()))
        .as_table_mut()
        .ok_or_else(|| anyhow!("mcp_servers must be a table"))?;

    let server = mcp_servers
        .entry(server_name)
        .or_insert(Item::Table(Table::new()))
        .as_table_mut()
        .ok_or_else(|| anyhow!("mcp_servers.{server_name} must be a table"))?;

    server["command"] = value(path_string(&launch.command));
    server["args"] = Item::Value(toml_edit::Value::Array(Array::new()));

    let mut env_table = Table::new();
    for (key, val) in &launch.env {
        if let Some(s) = val.as_str() {
            env_table.insert(key, value(s));
        }
    }
    server["env"] = Item::Table(env_table);
    Ok(doc.to_string())
}

fn mcp_servers_entry(launch: &ServerLaunch) -> Value {
    json!({
        "command": path_string(&launch.command),
        "args": [],
        "env": Value::Object(launch.env.clone()),
    })
}

/// Parse a JSON object, tolerating empty files, UTF-8 BOM, and light JSONC (`//` / `/* */`).
fn parse_json_object(original: &str, empty_default: Value) -> Result<Value> {
    let trimmed = original.trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() {
        return Ok(empty_default);
    }
    match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => {
            if value.is_object() {
                Ok(value)
            } else {
                bail!("root JSON value must be an object")
            }
        }
        Err(_) => {
            let stripped = strip_jsonc_comments(trimmed);
            let value: Value = serde_json::from_str(stripped.trim())
                .context("invalid JSON (after stripping comments)")?;
            if !value.is_object() {
                bail!("root JSON value must be an object");
            }
            Ok(value)
        }
    }
}

fn strip_jsonc_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    let mut in_string = false;
    let mut escaped = false;
    while i < bytes.len() {
        let b = bytes[i];
        if in_string {
            out.push(b as char);
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if b == b'"' {
            in_string = true;
            out.push('"');
            i += 1;
            continue;
        }
        if b == b'/' && i + 1 < bytes.len() {
            if bytes[i + 1] == b'/' {
                i += 2;
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
                continue;
            }
            if bytes[i + 1] == b'*' {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
                continue;
            }
        }
        out.push(b as char);
        i += 1;
    }
    out
}

fn path_string(path: &Path) -> String {
    // Windows canonicalize() often yields \\?\C:\... which some MCP clients mishandle.
    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        raw.into_owned()
    }
}

/// Prepend OCCT `bin` once and keep a short, deduped PATH for MCP child processes.
fn clean_path_with_occt_bin(occt_bin: &Path) -> String {
    let sep = if cfg!(windows) { ';' } else { ':' };
    let mut parts: Vec<String> = vec![path_string(occt_bin)];
    if let Ok(existing) = env::var("PATH") {
        for part in existing.split(sep) {
            if part.is_empty() {
                continue;
            }
            // Drop cargo/target noise and repeated OCCT bin prefixes from nested shells.
            let lower = part.to_ascii_lowercase();
            if lower.contains("\\target\\debug")
                || lower.contains("/target/debug")
                || lower.contains("vcpkg_installed")
                    && lower.ends_with(&format!("{}bin", std::path::MAIN_SEPARATOR))
            {
                continue;
            }
            if parts.iter().any(|existing_part| {
                existing_part.eq_ignore_ascii_case(part)
            }) {
                continue;
            }
            parts.push(part.to_string());
        }
    }
    // Cap length so client config files stay readable.
    if parts.len() > 40 {
        parts.truncate(40);
    }
    parts.join(&sep.to_string())
}

fn normalize_path(path: PathBuf) -> PathBuf {
    path.canonicalize()
        .map(|canonical| {
            let as_string = path_string(&canonical);
            PathBuf::from(as_string)
        })
        .unwrap_or(path)
}

fn server_env(repo_root: &Path) -> Map<String, Value> {
    let mut env_map = Map::new();
    env_map.insert(
        "NBCAD_REPO_ROOT".to_string(),
        Value::String(path_string(repo_root)),
    );
    let occt = default_occt_root(repo_root);
    if let Some(occt) = occt {
        env_map.insert(
            "OCCT_ROOT".to_string(),
            Value::String(occt.to_string_lossy().into_owned()),
        );
        let bin = occt.join("bin");
        if bin.is_dir() {
            env_map.insert(
                "PATH".to_string(),
                Value::String(clean_path_with_occt_bin(&bin)),
            );
        }
    }
    env_map
}

fn default_occt_root(repo_root: &Path) -> Option<PathBuf> {
    if let Ok(explicit) = env::var("OCCT_ROOT") {
        let path = PathBuf::from(explicit);
        if path.is_dir() {
            return Some(path);
        }
    }
    let candidates = [
        repo_root.join("vcpkg_installed").join("x64-windows"),
        repo_root.join("vcpkg_installed").join("x64-linux"),
        repo_root.join("vcpkg_installed").join("arm64-osx"),
        repo_root.join("vcpkg_installed").join("x64-osx"),
    ];
    candidates.into_iter().find(|path| path.is_dir())
}

fn resolve_binary(repo_root: &Path, options: &Options) -> Result<PathBuf> {
    if let Some(path) = &options.binary {
        if !path.is_file() {
            bail!("--binary path does not exist: {}", path.display());
        }
        return match install_user_binary(path) {
            Ok(installed) => Ok(installed),
            Err(error) => {
                eprintln!("warning: could not install user copy ({error}); using --binary path");
                Ok(normalize_path(path.clone()))
            }
        };
    }

    let release = mcp_binary_path(repo_root, "release");
    let debug = mcp_binary_path(repo_root, "debug");

    if options.build {
        build_mcp_server(repo_root)?;
    }

    let built = if release.is_file() {
        release
    } else if debug.is_file() {
        eprintln!(
            "warning: using debug MCP binary (release missing): {}",
            debug.display()
        );
        debug
    } else {
        bail!(
            "MCP binary not found at {} (run without --no-build, or pass --binary)",
            mcp_binary_path(repo_root, "release").display()
        );
    };

    // Copy to a stable user path so Cursor/etc. do not lock target/release during rebuilds.
    match install_user_binary(&built) {
        Ok(path) => Ok(path),
        Err(error) => {
            eprintln!("warning: could not install user copy ({error}); using build output");
            Ok(normalize_path(built))
        }
    }
}

fn install_user_binary(built: &Path) -> Result<PathBuf> {
    let dir = user_mcp_install_dir()?;
    fs::create_dir_all(&dir).with_context(|| format!("create {}", dir.display()))?;
    let name = if cfg!(windows) {
        "nbcad-mcp.exe"
    } else {
        "nbcad-mcp"
    };
    let dest = dir.join(name);
    // Replace atomically when possible (Windows can't replace a running exe).
    let staging = dir.join(format!(
        ".{name}.{}.tmp",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    fs::copy(built, &staging).with_context(|| {
        format!("copy {} → {}", built.display(), staging.display())
    })?;
    if dest.exists() {
        let bak = dir.join(format!("{name}.prev"));
        let _ = fs::remove_file(&bak);
        let _ = fs::rename(&dest, &bak);
    }
    fs::rename(&staging, &dest).with_context(|| {
        format!("rename {} → {}", staging.display(), dest.display())
    })?;
    Ok(normalize_path(dest))
}

fn user_mcp_install_dir() -> Result<PathBuf> {
    if let Some(base) = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share")))
    {
        return Ok(base.join("nbcad").join("mcp"));
    }
    bail!("could not resolve a user install directory");
}

fn mcp_binary_path(repo_root: &Path, profile: &str) -> PathBuf {
    let name = if cfg!(windows) {
        "nbcad-mcp.exe"
    } else {
        "nbcad-mcp"
    };
    repo_root
        .join("mcp-server")
        .join("target")
        .join(profile)
        .join(name)
}

fn build_mcp_server(repo_root: &Path) -> Result<()> {
    println!("building mcp-server (release)...");
    let mut command = Command::new("cargo");
    command
        .current_dir(repo_root)
        .args([
            "build",
            "--release",
            "--manifest-path",
            "mcp-server/Cargo.toml",
        ]);
    if let Some(occt) = default_occt_root(repo_root) {
        command.env("OCCT_ROOT", &occt);
        let bin = occt.join("bin");
        if bin.is_dir() {
            let mut path = bin.to_string_lossy().into_owned();
            if let Ok(existing) = env::var("PATH") {
                let sep = if cfg!(windows) { ';' } else { ':' };
                path.push(sep);
                path.push_str(&existing);
            }
            command.env("PATH", path);
        }
    }
    let status = command.status().context("spawn cargo build for mcp-server")?;
    if !status.success() {
        bail!("cargo build --release --manifest-path mcp-server/Cargo.toml failed");
    }
    Ok(())
}

fn repo_root() -> Result<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest_dir
        .parent()
        .ok_or_else(|| anyhow!("xtask crate has no parent directory"))?;
    Ok(root.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launch_fixture() -> ServerLaunch {
        let mut env = Map::new();
        env.insert("OCCT_ROOT".to_string(), Value::String("/occt".into()));
        ServerLaunch {
            command: PathBuf::from("/repo/mcp-server/target/release/nbcad-mcp"),
            env,
        }
    }

    #[test]
    fn upsert_preserves_sibling_mcp_servers() {
        let original = r#"{
  "mcpServers": {
    "other": { "command": "echo" }
  }
}"#;
        let next = upsert_mcp_servers_json(original, "nobs-cad", &launch_fixture()).unwrap();
        let value: Value = serde_json::from_str(&next).unwrap();
        assert_eq!(value["mcpServers"]["other"]["command"], "echo");
        assert_eq!(
            value["mcpServers"]["nobs-cad"]["command"],
            "/repo/mcp-server/target/release/nbcad-mcp"
        );
        assert_eq!(value["mcpServers"]["nobs-cad"]["env"]["OCCT_ROOT"], "/occt");
    }

    #[test]
    fn upsert_vscode_uses_servers_key() {
        let next = upsert_vscode_servers_json("", "nobs-cad", &launch_fixture()).unwrap();
        let value: Value = serde_json::from_str(&next).unwrap();
        assert_eq!(value["servers"]["nobs-cad"]["type"], "stdio");
        assert!(value.get("mcpServers").is_none());
    }

    #[test]
    fn upsert_opencode_respects_servers_nest() {
        let original = r#"{
  "mcp": {
    "servers": {
      "keep": { "type": "local", "command": ["true"] }
    }
  }
}"#;
        let next = upsert_opencode_json(original, "nobs-cad", &launch_fixture()).unwrap();
        let value: Value = serde_json::from_str(&next).unwrap();
        assert!(value["mcp"]["servers"]["keep"].is_object());
        assert_eq!(value["mcp"]["servers"]["nobs-cad"]["type"], "local");
    }

    #[test]
    fn upsert_opencode_flat_mcp_when_no_servers_key() {
        let next = upsert_opencode_json("{}", "nobs-cad", &launch_fixture()).unwrap();
        let value: Value = serde_json::from_str(&next).unwrap();
        assert_eq!(value["mcp"]["nobs-cad"]["type"], "local");
        assert!(value["mcp"].get("servers").is_none());
    }

    #[test]
    fn upsert_grok_toml_merges_table() {
        let original = r#"
[models]
default = "grok-build"

[mcp_servers.other]
command = "echo"
"#;
        let next = upsert_grok_toml(original, "nobs-cad", &launch_fixture()).unwrap();
        assert!(next.contains("[models]"));
        assert!(next.contains("[mcp_servers.other]"));
        assert!(next.contains("[mcp_servers.nobs-cad]"));
        assert!(next.contains("command = \"/repo/mcp-server/target/release/nbcad-mcp\""));
    }

    #[test]
    fn parse_clients_list() {
        let list = parse_clients("cursor, vscode, grok").unwrap();
        assert_eq!(
            list,
            vec![ClientKind::Cursor, ClientKind::VsCode, ClientKind::Grok]
        );
    }

    #[test]
    fn parse_json_object_accepts_empty_and_jsonc() {
        let empty = parse_json_object("  \n", json!({ "mcpServers": {} })).unwrap();
        assert!(empty["mcpServers"].is_object());
        let jsonc = parse_json_object(
            "{\n  // comment\n  \"mcpServers\": {}\n}\n",
            json!({}),
        )
        .unwrap();
        assert!(jsonc["mcpServers"].is_object());
    }
}
