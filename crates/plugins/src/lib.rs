//! Out-of-process plugins.
//!
//! A plugin is a local program described by a `nbcad-plugin.json` manifest in
//! its own directory. The host starts the program with one JSON request on
//! standard input and reads one JSON response from standard output. The only
//! way a plugin changes a design is by returning a version 1 `.nbcad.jsonc`
//! script, which the host validates with the ordinary parser and then runs
//! through the ordinary interpreter. Plugins never receive kernel, document or
//! session access, and the host never evaluates plugin code in-process.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

/// Protocol version carried by manifests, requests and responses.
pub const PROTOCOL_VERSION: u64 = 1;
/// Manifest file name inside each plugin directory.
pub const MANIFEST_FILE: &str = "nbcad-plugin.json";
/// Environment variable listing extra plugin directories as a platform path list.
pub const DIRS_ENV: &str = "NBCAD_PLUGIN_DIRS";
/// Application identifier shared with the desktop per-user configuration directory.
pub const APP_DIR_NAME: &str = "org.nbcad.desktop";
/// Response text limit: the script limit plus room for the report.
pub const MAX_RESPONSE_BYTES: usize = nbcad_script::MAX_SCRIPT_BYTES + 1024 * 1024;
/// Retained standard error tail for diagnostics.
pub const MAX_STDERR_BYTES: usize = 64 * 1024;
pub const MAX_MANIFEST_BYTES: usize = 256 * 1024;
pub const DEFAULT_TIMEOUT_SECONDS: u64 = 120;
pub const MAX_TIMEOUT_SECONDS: u64 = 3600;
pub const MAX_ID_LENGTH: usize = 64;
/// Key used to select a per-operating-system command from a manifest.
pub const HOST_OS: &str = if cfg!(target_os = "windows") {
    "windows"
} else if cfg!(target_os = "macos") {
    "macos"
} else {
    "linux"
};

/// `nbcad-plugin.json`. Unknown fields are ignored so later protocol versions
/// can add optional data without breaking older hosts.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Manifest {
    pub protocol: u64,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    pub kind: PluginKind,
    pub command: CommandSpec,
    #[serde(default)]
    pub input: InputSpec,
    /// Optional JSON Schema object describing `options` in the request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options_schema: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PluginKind {
    /// Reads one input file and returns a construction script.
    Import,
    /// Returns a construction script from options alone.
    Generate,
}

impl PluginKind {
    pub fn as_str(self) -> &'static str {
        match self {
            PluginKind::Import => "import",
            PluginKind::Generate => "generate",
        }
    }
}

/// Either one argv list, or argv lists keyed by `windows`, `macos`, `linux`
/// and `default`. The program is never passed through a shell.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(untagged)]
pub enum CommandSpec {
    Argv(Vec<String>),
    PerOs(BTreeMap<String, Vec<String>>),
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct InputSpec {
    /// Lowercase extensions without the dot, for example `["pdf", "png"]`.
    #[serde(default)]
    pub extensions: Vec<String>,
}

impl Manifest {
    pub fn validate(&self) -> Result<(), String> {
        if self.protocol != PROTOCOL_VERSION {
            return Err(format!(
                "unsupported plugin protocol {}; expected {PROTOCOL_VERSION}",
                self.protocol
            ));
        }
        validate_id(&self.id)?;
        if self.name.trim().is_empty() {
            return Err("plugin name must not be empty".into());
        }
        if self.version.trim().is_empty() {
            return Err("plugin version must not be empty".into());
        }
        self.command_for_host()?;
        match self.kind {
            PluginKind::Import => {
                if self.input.extensions.is_empty() {
                    return Err("import plugins must list input extensions".into());
                }
                for extension in &self.input.extensions {
                    let plain = !extension.is_empty()
                        && extension
                            .chars()
                            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
                    if !plain {
                        return Err(format!(
                            "input extension {extension:?} must be lowercase letters or digits without a dot"
                        ));
                    }
                }
            }
            PluginKind::Generate => {
                if !self.input.extensions.is_empty() {
                    return Err("generate plugins take no input file".into());
                }
            }
        }
        if self
            .options_schema
            .as_ref()
            .is_some_and(|schema| !schema.is_object())
        {
            return Err("options_schema must be a JSON Schema object".into());
        }
        if self
            .timeout_seconds
            .is_some_and(|seconds| seconds == 0 || seconds > MAX_TIMEOUT_SECONDS)
        {
            return Err(format!(
                "timeout_seconds must be between 1 and {MAX_TIMEOUT_SECONDS}"
            ));
        }
        Ok(())
    }

    /// The argv list for this operating system.
    pub fn command_for_host(&self) -> Result<&[String], String> {
        let argv = match &self.command {
            CommandSpec::Argv(argv) => argv.as_slice(),
            CommandSpec::PerOs(map) => map
                .get(HOST_OS)
                .or_else(|| map.get("default"))
                .map(Vec::as_slice)
                .ok_or_else(|| format!("plugin command has no entry for {HOST_OS} or default"))?,
        };
        if argv.first().is_none_or(|program| program.trim().is_empty()) {
            return Err("plugin command must start with a program".into());
        }
        Ok(argv)
    }

    pub fn timeout(&self) -> Duration {
        Duration::from_secs(self.timeout_seconds.unwrap_or(DEFAULT_TIMEOUT_SECONDS))
    }

    /// Whether an import plugin accepts this file by extension.
    pub fn accepts(&self, path: &Path) -> bool {
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .is_some_and(|extension| self.input.extensions.contains(&extension))
    }
}

fn validate_id(id: &str) -> Result<(), String> {
    let starts_plain = id
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let plain = id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'));
    if !starts_plain || !plain || id.len() > MAX_ID_LENGTH {
        return Err(format!(
            "plugin id {id:?} must be 1 to {MAX_ID_LENGTH} lowercase letters, digits, '-', '_' or '.', starting with a letter or digit"
        ));
    }
    Ok(())
}

/// One installed plugin: its validated manifest and directory.
#[derive(Clone, Debug)]
pub struct Plugin {
    pub manifest: Manifest,
    pub dir: PathBuf,
}

impl Plugin {
    pub fn manifest_path(&self) -> PathBuf {
        self.dir.join(MANIFEST_FILE)
    }

    /// Listing entry without the command, which is an installation detail.
    pub fn summary(&self) -> Value {
        json!({
            "id": self.manifest.id,
            "name": self.manifest.name,
            "version": self.manifest.version,
            "kind": self.manifest.kind.as_str(),
            "description": self.manifest.description,
            "input": {"extensions": self.manifest.input.extensions},
            "options_schema": self.manifest.options_schema,
            "timeout_seconds": self.manifest.timeout().as_secs(),
            "directory": self.dir.to_string_lossy(),
        })
    }
}

#[derive(Debug, Default)]
pub struct Discovery {
    pub plugins: Vec<Plugin>,
    pub directories: Vec<PathBuf>,
    /// Manifests that were present but not loaded, with the reason.
    pub problems: Vec<String>,
}

impl Discovery {
    pub fn find(&self, id: &str) -> Result<&Plugin, String> {
        self.plugins
            .iter()
            .find(|plugin| plugin.manifest.id == id)
            .ok_or_else(|| {
                let installed: Vec<&str> = self
                    .plugins
                    .iter()
                    .map(|plugin| plugin.manifest.id.as_str())
                    .collect();
                format!("unknown plugin {id:?}; installed plugins: {installed:?}")
            })
    }

    pub fn summary(&self) -> Value {
        json!({
            "protocol": PROTOCOL_VERSION,
            "plugins": self.plugins.iter().map(Plugin::summary).collect::<Vec<_>>(),
            "directories": self.directories.iter().map(|dir| dir.to_string_lossy()).collect::<Vec<_>>(),
            "problems": self.problems,
        })
    }
}

/// The per-user plugin directory beside the desktop configuration.
pub fn user_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library/Application Support")
                .join(APP_DIR_NAME)
                .join("plugins")
        })
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA")
            .map(|appdata| PathBuf::from(appdata).join(APP_DIR_NAME).join("plugins"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
            .map(|config| config.join(APP_DIR_NAME).join("plugins"))
    }
}

/// `NBCAD_PLUGIN_DIRS` entries first, then the per-user directory.
pub fn default_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os(DIRS_ENV)
        .map(|value| {
            std::env::split_paths(&value)
                .filter(|path| !path.as_os_str().is_empty())
                .collect()
        })
        .unwrap_or_default();
    if let Some(user) = user_dir() {
        if !dirs.contains(&user) {
            dirs.push(user);
        }
    }
    dirs
}

pub fn discover_default() -> Discovery {
    discover(&default_dirs())
}

/// Every immediate subdirectory holding a manifest is one plugin. A missing
/// directory is normal; an invalid manifest is reported, never loaded.
pub fn discover(dirs: &[PathBuf]) -> Discovery {
    let mut discovery = Discovery::default();
    for dir in dirs {
        discovery.directories.push(dir.clone());
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        let mut candidates: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect();
        candidates.sort();
        for plugin_dir in candidates {
            let manifest_path = plugin_dir.join(MANIFEST_FILE);
            if !manifest_path.is_file() {
                continue;
            }
            match load_manifest(&manifest_path) {
                Ok(manifest) => {
                    if discovery
                        .plugins
                        .iter()
                        .any(|plugin| plugin.manifest.id == manifest.id)
                    {
                        discovery.problems.push(format!(
                            "{}: duplicate plugin id {:?} ignored",
                            manifest_path.display(),
                            manifest.id
                        ));
                    } else {
                        discovery.plugins.push(Plugin {
                            manifest,
                            dir: plugin_dir,
                        });
                    }
                }
                Err(error) => discovery
                    .problems
                    .push(format!("{}: {error}", manifest_path.display())),
            }
        }
    }
    discovery
}

pub fn load_manifest(path: &Path) -> Result<Manifest, String> {
    let text = std::fs::read_to_string(path).map_err(|error| format!("read manifest: {error}"))?;
    if text.len() > MAX_MANIFEST_BYTES {
        return Err("manifest exceeds 256 KiB".into());
    }
    let manifest: Manifest =
        serde_json::from_str(&text).map_err(|error| format!("invalid manifest: {error}"))?;
    manifest.validate()?;
    Ok(manifest)
}

/// The single JSON document written to the plugin's standard input.
#[derive(Clone, Debug, Serialize)]
pub struct Request<'a> {
    pub protocol: u64,
    pub action: &'static str,
    pub plugin: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<RequestInput>,
    pub options: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_dir: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RequestInput {
    pub path: String,
}

/// The single JSON document read from the plugin's standard output.
#[derive(Debug, Deserialize)]
struct Response {
    #[serde(default)]
    protocol: Option<u64>,
    #[serde(default)]
    ok: Option<bool>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    script_source: Option<String>,
    #[serde(default)]
    script: Option<Value>,
    #[serde(default)]
    report: Option<Report>,
}

/// What the plugin wants a person to know before trusting the script.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Report {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub flags: Vec<Flag>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Flag {
    pub severity: Severity,
    pub message: String,
    /// Script step id the flag refers to, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Warning,
    Error,
}

/// A validated plugin result. The script has passed the parser; the caller
/// decides whether to run it.
#[derive(Debug)]
pub struct Outcome {
    pub plugin_id: String,
    /// The script text exactly as the interpreter will read it.
    pub source: String,
    pub script: nbcad_script::Script,
    pub report: Report,
    pub duration_ms: u128,
    /// Trailing standard error text, for diagnostics only.
    pub stderr: String,
}

impl Outcome {
    pub fn summary(&self) -> Value {
        json!({
            "id": self.plugin_id,
            "report": self.report,
            "duration_ms": self.duration_ms,
            "stderr": self.stderr,
        })
    }
}

/// Run one plugin to completion and validate what it returned.
///
/// `input` is required for import plugins and must be an existing regular
/// file with an accepted extension; generate plugins take none. `options`
/// must be a JSON object. `work_dir`, when given, is passed to the plugin as
/// a place for scratch files; the host does not create or clean it.
pub fn run(
    plugin: &Plugin,
    input: Option<&Path>,
    options: Value,
    work_dir: Option<&Path>,
) -> Result<Outcome, String> {
    let manifest = &plugin.manifest;
    let id = manifest.id.as_str();
    if !options.is_object() {
        return Err(format!("plugin {id} options must be a JSON object"));
    }
    let (action, request_input) = match (manifest.kind, input) {
        (PluginKind::Import, Some(path)) => {
            if !path.is_absolute() {
                return Err(format!("plugin {id} input must be an absolute path"));
            }
            let metadata = std::fs::metadata(path)
                .map_err(|error| format!("plugin {id} input {}: {error}", path.display()))?;
            if !metadata.is_file() {
                return Err(format!(
                    "plugin {id} input {} is not a regular file",
                    path.display()
                ));
            }
            if !manifest.accepts(path) {
                return Err(format!(
                    "plugin {id} accepts {:?}, not {}",
                    manifest.input.extensions,
                    path.display()
                ));
            }
            (
                "import",
                Some(RequestInput {
                    path: path.to_string_lossy().into_owned(),
                }),
            )
        }
        (PluginKind::Import, None) => return Err(format!("plugin {id} needs an input file")),
        (PluginKind::Generate, None) => ("generate", None),
        (PluginKind::Generate, Some(_)) => return Err(format!("plugin {id} takes no input file")),
    };
    let request = Request {
        protocol: PROTOCOL_VERSION,
        action,
        plugin: id,
        input: request_input,
        options,
        work_dir: work_dir.map(|path| path.to_string_lossy().into_owned()),
    };
    let request_bytes = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
    let argv = manifest.command_for_host()?;
    let program = resolve_program(&plugin.dir, &argv[0]);
    let timeout = manifest.timeout();
    let started = Instant::now();
    let mut child = Command::new(&program)
        .args(&argv[1..])
        .current_dir(&plugin.dir)
        .env("NBCAD_PLUGIN_PROTOCOL", PROTOCOL_VERSION.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("plugin {id}: cannot start {}: {error}", program.display()))?;
    let stdout = drain(
        child.stdout.take().expect("piped stdout"),
        MAX_RESPONSE_BYTES + 1,
    );
    let stderr = drain(child.stderr.take().expect("piped stderr"), MAX_STDERR_BYTES);
    if let Some(mut stdin) = child.stdin.take() {
        // A plugin that exits before reading explains itself through its status.
        let _ = stdin.write_all(&request_bytes);
    }
    let deadline = started + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout.join();
                let _ = stderr.join();
                return Err(format!(
                    "plugin {id} timed out after {} s",
                    timeout.as_secs()
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(error) => return Err(format!("plugin {id}: wait failed: {error}")),
        }
    };
    let out = stdout
        .join()
        .map_err(|_| format!("plugin {id}: standard output reader failed"))?;
    let err = stderr
        .join()
        .map_err(|_| format!("plugin {id}: standard error reader failed"))?;
    let stderr_text = tail(&String::from_utf8_lossy(&err));
    let duration_ms = started.elapsed().as_millis();
    if out.len() > MAX_RESPONSE_BYTES {
        return Err(format!(
            "plugin {id} response exceeds {MAX_RESPONSE_BYTES} bytes"
        ));
    }
    let detail = if stderr_text.is_empty() {
        String::new()
    } else {
        format!("\nstderr: {stderr_text}")
    };
    if !status.success() {
        if let Ok(Response {
            error: Some(error), ..
        }) = serde_json::from_slice::<Response>(&out)
        {
            return Err(format!("plugin {id} failed: {error}{detail}"));
        }
        return Err(format!("plugin {id} exited with {status}{detail}"));
    }
    let response: Response = serde_json::from_slice(&out)
        .map_err(|error| format!("plugin {id} returned invalid JSON: {error}{detail}"))?;
    if response.protocol != Some(PROTOCOL_VERSION) {
        return Err(format!(
            "plugin {id} response protocol must be {PROTOCOL_VERSION}"
        ));
    }
    if response.ok != Some(true) {
        return Err(format!(
            "plugin {id} failed: {}{detail}",
            response.error.unwrap_or_else(|| "no error message".into())
        ));
    }
    let source = match (response.script_source, response.script) {
        (Some(source), None) => source,
        (None, Some(script)) => {
            serde_json::to_string_pretty(&script).map_err(|error| error.to_string())?
        }
        _ => {
            return Err(format!(
                "plugin {id} response needs exactly one of script_source or script"
            ))
        }
    };
    let script = nbcad_script::Script::parse(&source)
        .map_err(|error| format!("plugin {id} returned an invalid script: {error}"))?;
    Ok(Outcome {
        plugin_id: id.to_owned(),
        source,
        script,
        report: response.report.unwrap_or_default(),
        duration_ms,
        stderr: stderr_text,
    })
}

/// A program with a path separator is relative to the plugin directory;
/// a bare name is found through PATH like any other command.
fn resolve_program(dir: &Path, program: &str) -> PathBuf {
    let path = Path::new(program);
    if path.components().count() > 1 && path.is_relative() {
        dir.join(path)
    } else {
        path.to_path_buf()
    }
}

fn drain(mut reader: impl Read + Send + 'static, cap: usize) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut kept = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break kept,
                Ok(count) => {
                    // Keep draining past the cap so the plugin never blocks on a full pipe.
                    let room = cap.saturating_sub(kept.len()).min(count);
                    kept.extend_from_slice(&chunk[..room]);
                }
            }
        }
    })
}

fn tail(text: &str) -> String {
    const KEEP: usize = 2048;
    let trimmed = text.trim_end();
    if trimmed.len() <= KEEP {
        return trimmed.to_owned();
    }
    let mut start = trimmed.len() - KEEP;
    while !trimmed.is_char_boundary(start) {
        start += 1;
    }
    trimmed[start..].to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(value: Value) -> Result<Manifest, String> {
        let manifest: Manifest =
            serde_json::from_value(value).map_err(|error| error.to_string())?;
        manifest.validate()?;
        Ok(manifest)
    }

    #[test]
    fn manifests_are_validated_before_use() {
        let good = json!({"protocol":1,"id":"drawing-import","name":"Drawing import","version":"0.1.0",
            "kind":"import","command":["python3","-m","plugin"],"input":{"extensions":["pdf","png"]}});
        let manifest_ok = manifest(good.clone()).unwrap();
        assert_eq!(manifest_ok.command_for_host().unwrap()[0], "python3");
        assert!(manifest_ok.accepts(Path::new("/tmp/print.PDF")));
        assert!(!manifest_ok.accepts(Path::new("/tmp/print.dxf")));
        assert_eq!(
            manifest_ok.timeout(),
            Duration::from_secs(DEFAULT_TIMEOUT_SECONDS)
        );
        let mut per_os = good.clone();
        per_os["command"] = json!({"default":["a"],"windows":["b.exe"]});
        let expected = if HOST_OS == "windows" { "b.exe" } else { "a" };
        assert_eq!(
            manifest(per_os).unwrap().command_for_host().unwrap()[0],
            expected
        );
        let mut bad_cases = vec![
            ("protocol", json!(2)),
            ("id", json!("Bad Id")),
            ("id", json!("-leading")),
            ("id", json!("x".repeat(MAX_ID_LENGTH + 1))),
            ("name", json!("  ")),
            ("version", json!("")),
            ("command", json!([])),
            ("command", json!([""])),
            ("input", json!({"extensions":[]})),
            ("input", json!({"extensions":[".pdf"]})),
            ("input", json!({"extensions":["PDF"]})),
            ("options_schema", json!("string")),
            ("timeout_seconds", json!(0)),
            ("timeout_seconds", json!(MAX_TIMEOUT_SECONDS + 1)),
        ];
        if HOST_OS != "windows" {
            bad_cases.push(("command", json!({"windows":["only"]})));
        }
        for (field, value) in bad_cases {
            let mut bad = good.clone();
            bad[field] = value.clone();
            assert!(
                manifest(bad).is_err(),
                "{field} = {value} should be rejected"
            );
        }
        let mut generate = good.clone();
        generate["kind"] = json!("generate");
        assert!(
            manifest(generate.clone()).is_err(),
            "generate plugins take no input"
        );
        generate["input"] = json!({});
        assert_eq!(manifest(generate).unwrap().kind, PluginKind::Generate);
        let mut extra = good;
        extra["future_field"] = json!(true);
        assert!(manifest(extra).is_ok(), "unknown fields are ignored");
    }

    #[test]
    fn programs_resolve_relative_to_the_plugin_directory() {
        let dir = Path::new("/plugins/example");
        assert_eq!(resolve_program(dir, "python3"), PathBuf::from("python3"));
        assert_eq!(
            resolve_program(dir, ".venv/bin/python"),
            dir.join(".venv/bin/python")
        );
        #[cfg(unix)]
        assert_eq!(
            resolve_program(dir, "/usr/bin/python3"),
            PathBuf::from("/usr/bin/python3")
        );
    }

    #[test]
    fn tail_keeps_the_end_on_character_boundaries() {
        assert_eq!(tail("short\n"), "short");
        let long = "é".repeat(3000);
        let kept = tail(&long);
        assert!(kept.len() <= 2048 && kept.chars().all(|c| c == 'é'));
    }

    #[test]
    fn default_directories_start_with_the_environment_list() {
        let dirs = default_dirs();
        if let Some(user) = user_dir() {
            assert_eq!(dirs.last(), Some(&user));
        }
    }
}
