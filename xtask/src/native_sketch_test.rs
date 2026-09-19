//! Exercises rendered native controls and the canvas through MCP. The caller
//! supplies one blank development document; this fixture never launches a GUI,
//! closes a window, replaces a document or discards another person's work.
use crate::replay::Client;
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, path::PathBuf, process::Command, time::Duration};

fn controls(value: &Value) -> impl Iterator<Item = &Value> {
    value["ui"]["surfaces"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|s| s["controls"].as_array().into_iter().flatten())
}
fn ui(client: &mut Client, request: Value) -> Result<Value> {
    let result = client.call("cad_interface", request)?;
    ensure!(result["status"] == "applied", "Interface failed: {result}");
    Ok(result)
}
fn control(client: &mut Client, label: &str, value: Option<&str>) -> Result<Value> {
    let inspected = ui(client, json!({"action":"inspect"}))?;
    let found: Vec<_> = controls(&inspected)
        .filter(|c| c["label"] == label && c["disabled"] == false)
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
fn sketch(client: &mut Client) -> Result<Value> {
    client.call("sketch_active", json!({}))
}
fn click(client: &mut Client, point: [f64; 2], shift: bool) -> Result<Value> {
    ui(
        client,
        json!({"action":"viewport","gesture":"click","world":[point[0],point[1],0.],"shift":shift}),
    )
}
fn dimension(client: &mut Client) -> Result<Value> {
    let inspected = ui(client, json!({"action":"inspect"}))?;
    let labels: Vec<_> = controls(&inspected)
        .filter_map(|c| c["label"].as_str())
        .filter(|label| label.starts_with("Edit dimension "))
        .collect();
    ensure!(
        labels.len() == 1,
        "Expected one visible dimension, got {labels:?}"
    );
    control(client, labels[0], None)
}

pub fn run(mut args: impl Iterator<Item = String>) -> Result<()> {
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
    let project = out.join("native-sketch.nbcad");
    let capture = out.join("native-sketch.png");
    let report = out.join("native-sketch.json");
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

    control(&mut client, "Sketch on XY", None)?;
    control(&mut client, "Rectangle", None)?;
    click(&mut client, [-30., -20.], false)?;
    click(&mut client, [30., 20.], false)?;
    control(&mut client, "Select", None)?;
    ui(
        &mut client,
        json!({"action":"viewport","gesture":"move","world":[0.,-20.,0.]}),
    )?;
    let original = sketch(&mut client)?;
    ensure!(
        original["entities"]
            .as_array()
            .context("No sketch geometry")?
            .len()
            == 8,
        "Rectangle did not create four points and four lines"
    );

    click(&mut client, [0., -20.], false)?;
    click(&mut client, [30., 0.], true)?;
    control(&mut client, "Fillet", None)?;
    control(&mut client, "Radius", Some("5"))?;
    control(&mut client, "Apply Fillet", None)?;
    let rounded = sketch(&mut client)?;
    ensure!(
        rounded["entities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "arc" && e["radius"] == 5.),
        "Fillet did not create the requested arc"
    );
    control(&mut client, "Undo", None)?;
    ensure!(
        sketch(&mut client)?["entities"] == original["entities"],
        "Fillet Undo did not restore the rectangle"
    );
    println!("PASS: rendered fillet controls, selection and atomic undo");

    click(&mut client, [0., -20.], false)?;
    control(&mut client, "Rectangular Pattern", None)?;
    control(&mut client, "Count", Some("3"))?;
    control(&mut client, "Spacing", Some("10"))?;
    control(&mut client, "Apply Rectangular Pattern", None)?;
    let patterned = sketch(&mut client)?;
    ensure!(
        patterned["entities"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["kind"] == "line")
            .count()
            == 6,
        "Pattern did not add two line instances"
    );
    control(&mut client, "Undo", None)?;
    ensure!(
        sketch(&mut client)?["entities"] == original["entities"],
        "Pattern Undo changed source geometry"
    );
    println!("PASS: rendered pattern fields and atomic undo");

    for (label, menu, field, value, pair) in [
        ("Chamfer", Some("EDIT tools"), Some("Distance"), "3", true),
        ("Offset", None, Some("Distance"), "3", false),
        ("Move/Copy", None, Some("X distance"), "5", false),
        (
            "Scale",
            Some("EDIT tools"),
            Some("Scale factor"),
            "2",
            false,
        ),
        ("Mirror", None, None, "", true),
        ("Circular Pattern", None, Some("Count"), "4", false),
        ("Polygon", Some("DRAW tools"), Some("Sides"), "5", false),
    ] {
        control(&mut client, "Select", None)?;
        if label != "Polygon" {
            click(&mut client, [0., -20.], false)?;
        }
        if pair {
            click(&mut client, [30., 0.], true)?;
        }
        if let Some(menu) = menu {
            control(&mut client, menu, None)?;
        }
        control(&mut client, label, None)?;
        if label == "Offset" {
            click(&mut client, [0., -24.], false)?;
        }
        if label == "Move/Copy" {
            control(&mut client, "Create copy", None)?;
        }
        if let Some(field) = field {
            control(&mut client, field, Some(value))?;
        }
        control(&mut client, &format!("Apply {label}"), None)?;
        ensure!(
            sketch(&mut client)?["entities"] != original["entities"],
            "{label} did not change geometry"
        );
        control(&mut client, "Undo", None)?;
        ensure!(
            sketch(&mut client)?["entities"] == original["entities"],
            "{label} Undo did not restore geometry"
        );
        println!("PASS: {label} through rendered controls and undo");
    }

    click(&mut client, [0., -20.], false)?;
    control(&mut client, "Sketch Dimension", None)?;
    click(&mut client, [0., -28.], false)?;
    control(&mut client, "Dimension value", Some("70"))?;
    control(&mut client, "Apply Dimension", None)?;
    ensure!(
        sketch(&mut client)?["dimensions"][0]["value"] == 70.,
        "Dimension did not drive the model"
    );
    dimension(&mut client)?;
    control(&mut client, "Dimension value", Some("80"))?;
    control(&mut client, "Apply Dimension", None)?;
    ensure!(
        sketch(&mut client)?["dimensions"][0]["value"] == 80.,
        "Visible dimension label did not edit the model"
    );
    dimension(&mut client)?;
    control(&mut client, "Toggle Driving / Reference", None)?;
    ensure!(
        sketch(&mut client)?["dimensions"][0]["mode"] == "reference",
        "Dimension remained driving"
    );
    dimension(&mut client)?;
    let reference = ui(&mut client, json!({"action":"inspect"}))?;
    ensure!(
        controls(&reference).any(|c| c["label"] == "Dimension value" && c["read_only"] == true),
        "Reference measurement must be read only"
    );
    let target = controls(&reference)
        .find(|c| c["label"] == "Dimension value")
        .unwrap()["id"]
        .clone();
    let rejected = client.call(
        "cad_interface",
        json!({"action":"set_value","target":target,"value":"90"}),
    );
    ensure!(
        rejected.is_err(),
        "A reference measurement accepted an edit"
    );
    ensure!(
        sketch(&mut client)?["dimensions"][0]["value"] == 80.,
        "Rejected reference edit changed geometry"
    );
    control(&mut client, "Toggle Driving / Reference", None)?;
    ensure!(
        sketch(&mut client)?["dimensions"][0]["mode"] == "driving",
        "Dimension did not return to driving"
    );
    println!("PASS: visible dimension create/edit/reference/driving");

    let before = sketch(&mut client)?;
    let inspected = ui(&mut client, json!({"action":"inspect"}))?;
    let label = controls(&inspected)
        .filter_map(|c| c["label"].as_str())
        .find(|s| s.starts_with("Constraint "))
        .context("No visible constraint markers")?
        .to_owned();
    control(&mut client, &label, None)?;
    control(&mut client, "Delete Constraint", None)?;
    ensure!(
        sketch(&mut client)?["constraints"]
            .as_array()
            .unwrap()
            .len()
            + 1
            == before["constraints"].as_array().unwrap().len(),
        "Constraint inspector did not delete its relation"
    );
    control(&mut client, "Undo", None)?;
    ensure!(
        sketch(&mut client)?["constraints"] == before["constraints"],
        "Undo did not restore the deleted constraint"
    );

    control(&mut client, "Fillet", None)?;
    let inspected = control(&mut client, "Radius", Some("invalid_expression"))?;
    let target = controls(&inspected)
        .find(|c| c["label"] == "Radius")
        .context("Missing Radius field")?["id"]
        .clone();
    ui(
        &mut client,
        json!({"action":"key","target":target,"key":"Escape"}),
    )?;
    ensure!(
        !controls(&ui(&mut client, json!({"action":"inspect"}))?)
            .any(|c| c["label"] == "Apply Fillet"),
        "Escape left the form open"
    );
    ensure!(
        sketch(&mut client)?["entities"] == before["entities"],
        "Cancel changed geometry"
    );
    println!("PASS: constraint inspector, undo and Escape from an invalid expression");

    let final_sketch = sketch(&mut client)?;
    ui(&mut client, json!({"action":"capture","path":capture}))?;
    control(&mut client, "Finish sketch", None)?;
    ui(
        &mut client,
        json!({"action":"file","command":"save","path":project}),
    )?;
    ensure!(
        project.is_file() && capture.is_file(),
        "Evidence files were not produced"
    );
    fs::write(
        &report,
        serde_json::to_vec_pretty(&json!({"status":"passed","server":server,"session":session,
        "checks":["nine_modify_forms_and_undo","dimension_edit_modes","constraint_delete_undo","escape_cancel","render_capture","save"],
        "sketch":final_sketch,"project":project,"capture":capture}))?,
    )?;
    println!("PASS: native sketch saved; report {}", report.display());
    Ok(())
}
