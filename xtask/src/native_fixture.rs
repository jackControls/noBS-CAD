//! Shared MCP transport and blank-document guards for native live fixtures.
use crate::replay::Client;
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, path::PathBuf, process::Command, time::Duration};
pub(super) fn controls(value: &Value) -> impl Iterator<Item = &Value> {
    value["ui"]["surfaces"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|s| s["controls"].as_array().into_iter().flatten())
}
pub(super) fn ui(client: &mut Client, request: Value) -> Result<Value> {
    let result = client.call("cad_interface", request)?;
    ensure!(result["status"] == "applied", "Interface failed: {result}");
    Ok(result)
}
pub(super) fn control(client: &mut Client, label: &str, value: Option<&str>) -> Result<Value> {
    control_matching(client, None, label, value)
}
pub(super) fn control_in(
    client: &mut Client,
    surface: &str,
    label: &str,
    value: Option<&str>,
) -> Result<Value> {
    control_matching(client, Some(surface), label, value)
}
fn control_matching(
    client: &mut Client,
    surface: Option<&str>,
    label: &str,
    value: Option<&str>,
) -> Result<Value> {
    let inspected = ui(client, json!({"action":"inspect"}))?;
    let found: Vec<_> = controls(&inspected)
        .filter(|c| c["label"] == label && c["disabled"] == false)
        .filter(|c| surface.is_none_or(|surface| c["surface"] == surface))
        .collect();
    ensure!(
        found.len() == 1,
        "Expected one enabled {label}, got {found:?}"
    );
    ui(
        client,
        if let Some(value) = value {
            json!({"action":"set_value","target":found[0]["id"],"value":value})
        } else {
            json!({"action":"click","target":found[0]["id"]})
        },
    )
}
pub(super) fn sketch(client: &mut Client) -> Result<Value> {
    client.call("sketch_active", json!({}))
}
pub(super) fn begin_sketch(client: &mut Client, plane: &str) -> Result<Value> {
    control(client, "Create Sketch", None)?;
    browser_select(client, "Origin", plane)
}
pub(super) fn browser_select(client: &mut Client, folder: &str, name: &str) -> Result<Value> {
    let mut inspected = ui(client, json!({"action":"inspect"}))?;
    let matches = |c: &&Value| {
        c["label"] == name
            && c["surface"] == "solid/selection"
            && c["role"] == "treeitem"
            && c["disabled"] == false
    };
    if controls(&inspected).filter(matches).next().is_none() {
        control(client, &format!("Expand {folder}"), None)?;
        inspected = ui(client, json!({"action":"inspect"}))?;
    }
    let found: Vec<_> = controls(&inspected).filter(matches).collect();
    ensure!(found.len() == 1, "Expected one visible browser row {name}");
    ui(client, json!({"action":"click","target":found[0]["id"]}))
}
pub(super) fn click(client: &mut Client, point: [f64; 2], shift: bool) -> Result<Value> {
    ui(
        client,
        json!({"action":"viewport","gesture":"click","world":[point[0],point[1],0.],"shift":shift}),
    )
}

pub(super) struct Fixture {
    pub client: Client,
    pub server: String,
    pub session: String,
    pub out: PathBuf,
    pub project: PathBuf,
    pub capture: PathBuf,
    pub report: PathBuf,
}
pub(super) fn start(mut args: impl Iterator<Item = String>, name: &str) -> Result<Fixture> {
    let mut options = HashMap::new();
    while let Some(key) = args.next() {
        ensure!(
            ["--server", "--session", "--out"].contains(&key.as_str()),
            "Unknown option {key}"
        );
        let value = args
            .next()
            .with_context(|| format!("Missing value for {key}"))?;
        ensure!(
            options.insert(key.clone(), value).is_none(),
            "Duplicate option {key}"
        );
    }
    let server = options
        .get("--server")
        .context("Use --server PATH for the rebuilt CAD binary")?;
    let session = options
        .get("--session")
        .context("Use --session UUID for an existing blank native document")?;
    let out = PathBuf::from(
        options
            .get("--out")
            .context("Use --out PATH for local evidence")?,
    );
    ensure!(out.is_absolute(), "The evidence directory must be absolute");
    ensure!(
        !out.exists() || fs::read_dir(&out)?.next().is_none(),
        "Choose an empty evidence directory; preserve partial runs as well as completed results"
    );
    let project = out.join(format!("{name}.nbcad"));
    let capture = out.join(format!("{name}.png"));
    let report = out.join(format!("{name}.json"));
    ensure!(
        !project.exists() && !capture.exists() && !report.exists(),
        "Choose a fresh evidence directory; existing results are preserved"
    );
    fs::create_dir_all(&out)?;
    let mut command = Command::new(server);
    command.arg("--headless");
    let mut client = Client::start_command(command, Some(Duration::from_secs(45)))?;
    client.call("cad_attach", json!({"session_id":session}))?;
    let document = client.call("cad_document", json!({}))?;
    ensure!(
        document["features"].as_array().is_some_and(Vec::is_empty),
        "The selected document contains work; choose a blank document"
    );
    ensure!(
        sketch(&mut client)?.is_null(),
        "Finish the active sketch or choose a blank document"
    );

    Ok(Fixture {
        client,
        server: server.clone(),
        session: session.clone(),
        out,
        project,
        capture,
        report,
    })
}

pub(super) fn edit_feature(client: &mut Client, name: &str, context_menu: bool) -> Result<()> {
    let state = ui(client, json!({"action":"inspect"}))?;
    let target = controls(&state)
        .find(|c| c["label"] == name && c["surface"] == "document/history")
        .context("History feature missing")?;
    ui(
        client,
        json!({"action":if context_menu {"context_menu"} else {"double_click"},"target":target["id"]}),
    )?;
    if context_menu {
        control(client, "Edit feature", None)?;
    }
    Ok(())
}
