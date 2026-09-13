//! Exercise the shipped executable and its runtime libraries over the ordinary
//! Rust MCP client. This creates only an independent headless document.
use crate::replay::Client;
use anyhow::{bail, ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::{Cursor, Read},
    path::PathBuf,
    process::Command,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Debug)]
struct Options {
    server: String,
    arguments: Vec<String>,
    out: Option<PathBuf>,
    timeout: Duration,
}
impl Options {
    fn parse(mut args: impl Iterator<Item = String>) -> Result<Self> {
        let mut server = None;
        let mut arguments = Vec::new();
        let mut out = None;
        let mut timeout = None;
        while let Some(option) = args.next() {
            let value = args
                .next()
                .with_context(|| format!("Missing value for {option}"))?;
            match option.as_str() {
                "--server" if server.is_none() => server = Some(value),
                // Flag-shaped values are intentional: --server-arg --mcp.
                "--server-arg" => arguments.push(value),
                "--out" if out.is_none() => out = Some(PathBuf::from(value)),
                "--timeout-seconds" if timeout.is_none() => {
                    let seconds: u64 = value.parse().context("timeout must be whole seconds")?;
                    ensure!(
                        (1..=600).contains(&seconds),
                        "timeout must be 1–600 seconds"
                    );
                    timeout = Some(Duration::from_secs(seconds));
                }
                _ => bail!("Unknown or duplicate option {option}"),
            }
        }
        Ok(Self {
            server: server.context("Supply --server PATH")?,
            arguments,
            out,
            timeout: timeout.unwrap_or(Duration::from_secs(120)),
        })
    }
}

// An exclusive empty directory lets the check detect accidental desktop/session
// startup without looking at, attaching to, or changing the user's sessions.
struct SessionDirectory(PathBuf);
impl SessionDirectory {
    fn create() -> Result<Self> {
        let time = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let path =
            std::env::temp_dir().join(format!("nbcad-package-mcp-{}-{time}", std::process::id()));
        fs::create_dir(&path).context("Create isolated package-check session directory")?;
        Ok(Self(path))
    }
    fn ensure_empty(&self) -> Result<()> {
        ensure!(
            fs::read_dir(&self.0)?.next().is_none(),
            "Headless MCP unexpectedly published desktop/session files under {}",
            self.0.display()
        );
        Ok(())
    }
}
impl Drop for SessionDirectory {
    fn drop(&mut self) {
        // Only remove the empty directory we created exclusively. Preserve any
        // unexpected publication as diagnostic evidence rather than deleting it.
        let _ = fs::remove_dir(&self.0);
    }
}

pub fn run(args: impl Iterator<Item = String>) -> Result<()> {
    let mut options = Options::parse(args)?;
    options.server = fs::canonicalize(&options.server)
        .context("Resolve packaged executable before changing child working directory")?
        .to_string_lossy()
        .into_owned();
    if let Some(parent) = options.out.as_ref().and_then(|path| path.parent()) {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).context("Create package-check report directory")?;
        }
    }
    let started = Instant::now();
    let result = verify(&options);
    let report = match &result {
        Ok(report) => report.clone(),
        Err(error) => json!({"passed":false,"error":format!("{error:#}")}),
    };
    let mut report = report;
    report["executable"] = json!(options.server);
    report["arguments"] = json!(options.arguments);
    report["elapsed_ms"] = json!(started.elapsed().as_millis());
    if let Some(path) = options.out {
        fs::write(&path, serde_json::to_vec_pretty(&report)?)
            .with_context(|| format!("Write package-check report {}", path.display()))?;
    }
    println!("{}", serde_json::to_string_pretty(&report)?);
    result.map(|_| ())
}

fn verify(options: &Options) -> Result<Value> {
    let sessions = SessionDirectory::create()?;
    let mut command = Command::new(&options.server);
    command
        .args(&options.arguments)
        .current_dir(&sessions.0)
        .env("NBCAD_SESSION_DIR", &sessions.0);
    // Package runtime discovery must not depend on a graphical login or these
    // development SDK overrides. Windows resolves shipped DLLs beside its EXE.
    for name in [
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "OCCT_ROOT",
        "NBCAD_OCCT_LIB_DIR",
        "NBCAD_PROJECT_ROOT",
        "NBCAD_REPO_ROOT",
        "VCPKG_INSTALLED_DIR",
        "VCPKG_TARGET_TRIPLET",
        "DYLD_LIBRARY_PATH",
        "DYLD_FALLBACK_LIBRARY_PATH",
        "DYLD_INSERT_LIBRARIES",
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
    ] {
        command.env_remove(name);
    }
    #[cfg(windows)]
    {
        let root =
            PathBuf::from(std::env::var_os("SystemRoot").context("Windows SystemRoot is missing")?);
        command.env("PATH", std::env::join_paths([root.join("System32"), root])?);
    }
    #[cfg(not(windows))]
    command.env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
    let mut client = Client::start_command(command, Some(options.timeout))?;
    let initialization = client.initialization().clone();
    ensure!(
        initialization["protocolVersion"] == "2025-06-18",
        "Unexpected MCP protocol: {initialization}"
    );
    ensure!(
        initialization.pointer("/serverInfo/name") == Some(&json!("nbcad")),
        "Unexpected MCP server: {initialization}"
    );
    ensure!(
        initialization.pointer("/capabilities/tools").is_some(),
        "MCP tools are not advertised"
    );
    let listing = client.rpc("tools/list", json!({}))?;
    let tools = listing["tools"]
        .as_array()
        .context("tools/list has no tool array")?;
    let mut names = HashSet::new();
    for tool in tools {
        let name = tool["name"].as_str().context("Tool has no name")?;
        ensure!(names.insert(name), "Duplicate tool {name}");
    }
    ensure!(
        names.contains("cad_interface"),
        "Canonical cad_interface tool is missing"
    );
    for legacy in ["cad_ui", "cad_view", "cad_launch"] {
        ensure!(
            !names.contains(legacy),
            "Retired interface alias is advertised: {legacy}"
        );
    }
    let catalog = client.call("cad_interface", json!({"action":"catalog"}))?;
    ensure!(
        catalog["groups"]
            .as_array()
            .is_some_and(|groups| !groups.is_empty()),
        "Product groups are missing"
    );
    let recipes = client.call("cad_interface", json!({"action":"recipes"}))?;
    let recipe = recipes
        .as_array()
        .context("Recipe catalog is not an array")?
        .iter()
        .find(|recipe| recipe["id"] == "fillet-basics")
        .context("The shipped first-part lesson is missing")?;
    let built = client.call(
        "cad_interface",
        json!({"action":"script","recipe":"fillet-basics","mode":"fast","validate":true}),
    )?;
    ensure!(
        built["steps_completed"] == recipe["step_count"]
            && built["checks_completed"] == recipe["check_count"],
        "The shipped lesson did not complete all construction and checks"
    );
    let model_text = client.call("cad_project_model", json!({}))?;
    let model: Value = serde_json::from_str(
        model_text
            .as_str()
            .context("Project-model export is not JSON text")?,
    )?;
    ensure!(
        model
            .pointer("/extrudes/0/extent/distance")
            .and_then(Value::as_f64)
            == Some(12.0),
        "The lesson did not retain its editable extrusion"
    );
    ensure!(
        model.pointer("/fillets/0/radius").and_then(Value::as_f64) == Some(2.0),
        "The lesson did not retain its editable fillet"
    );
    let sketches = client.call("sketch_finished", json!({}))?;
    ensure!(
        sketches.as_array().is_some_and(|items| items.len() == 1)
            && sketches.pointer("/0/dof/value") == Some(&json!(0)),
        "The lesson sketch is not fully constrained"
    );
    let scene = client.call("solid_scene", json!({}))?;
    ensure!(
        scene["errors"] == json!([]),
        "The lesson has geometry errors: {}",
        scene["errors"]
    );
    let bodies = scene["bodies"]
        .as_array()
        .context("The lesson has no body array")?;
    ensure!(bodies.len() == 1, "The lesson must produce one solid");
    let body_id = bodies[0]["id"].as_u64().context("Solid has no body ID")?;
    client.call(
        "set_body_appearance",
        json!({"body_id":body_id,"preset_id":"generic.pla.gray"}),
    )?;
    let exported = client.call(
        "solid_export_3mf",
        json!({"body_ids":[body_id],"slicer_target":"standard","include_appearance":true}),
    )?;
    let bytes = check_export(&exported)?;
    client.finish(Duration::from_secs(10))?;
    sessions.ensure_empty()?;
    Ok(
        json!({"passed":true,"initialization":initialization,"recipe":"fillet-basics",
        "steps_completed":built["steps_completed"],"checks_completed":built["checks_completed"],
        "fully_constrained_sketches":1,"solid_bodies":1,"export_3mf_bytes":bytes,
        "clean_eof_exit":true,"no_desktop_session":true}),
    )
}

fn check_export(exported: &Value) -> Result<usize> {
    ensure!(
        exported["format"] == "3mf" && exported["encoding"] == "base64",
        "Unexpected export encoding"
    );
    let encoded = exported["bytes_base64"]
        .as_str()
        .context("3MF export has no bytes")?;
    ensure!(
        encoded.len() < 8 * 1024 * 1024,
        "First-part 3MF unexpectedly exceeds 8 MiB"
    );
    let bytes = STANDARD.decode(encoded).context("Invalid 3MF base64")?;
    ensure!(
        exported["byte_length"].as_u64() == Some(bytes.len() as u64),
        "3MF byte count mismatch"
    );
    let mut archive =
        zip::ZipArchive::new(Cursor::new(&bytes)).context("3MF is not a readable ZIP")?;
    for name in ["[Content_Types].xml", "_rels/.rels"] {
        archive
            .by_name(name)
            .with_context(|| format!("3MF is missing {name}"))?;
    }
    let mut model = archive
        .by_name("3D/3dmodel.model")
        .context("3MF model part is missing")?;
    ensure!(
        model.size() < 8 * 1024 * 1024,
        "First-part 3MF model is unexpectedly large"
    );
    let mut xml = String::new();
    model
        .read_to_string(&mut xml)
        .context("Read 3MF model XML")?;
    for fragment in [
        "unit=\"millimeter\"",
        "<vertex ",
        "<triangle ",
        "<item ",
        "<basematerials",
        "#B4B4B4",
    ] {
        ensure!(
            xml.contains(fragment),
            "3MF lacks expected geometry/material data: {fragment}"
        );
    }
    Ok(bytes.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_arguments_keep_flag_values_and_reject_bad_timeout() {
        let options = Options::parse(
            [
                "--server",
                "desktop",
                "--server-arg",
                "--mcp",
                "--server-arg",
                "literal",
            ]
            .into_iter()
            .map(str::to_owned),
        )
        .unwrap();
        assert_eq!(options.arguments, ["--mcp", "literal"]);
        assert!(Options::parse(
            ["--server", "desktop", "--timeout-seconds", "0"]
                .into_iter()
                .map(str::to_owned)
        )
        .is_err());
    }

    #[test]
    fn export_receipt_rejects_wrong_length_and_non_zip_payloads() {
        let mut reply = json!({"format":"3mf","encoding":"base64","bytes_base64":STANDARD.encode("not a zip"),"byte_length":9});
        assert!(check_export(&reply)
            .unwrap_err()
            .to_string()
            .contains("readable ZIP"));
        reply["byte_length"] = json!(10);
        assert!(check_export(&reply)
            .unwrap_err()
            .to_string()
            .contains("byte count"));
    }
}
