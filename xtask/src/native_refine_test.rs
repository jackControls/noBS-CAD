//! Refine the rendered model and edit original topology through live MCP.
use crate::native_fixture::{begin_sketch, control, controls, start, ui};
use crate::replay::Client;
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::{fs, path::Path};

fn edit(client: &mut Client, name: &str, context_menu: bool) -> Result<()> {
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
fn case(client: &mut Client, out: &Path, kind: &str) -> Result<Value> {
    begin_sketch(client, "XY")?;
    client.call(
        "sketch_add_rectangle",
        json!({"mode":"two_point","p1":{"x":0.,"y":0.},"p2":{"x":30.,"y":20.},"ctrl_held":true}),
    )?;
    control(client, "Finish sketch", None)?;
    client.call("solid_extrude",json!({"sketch_name":"Sketch1","profile_indices":[0],"extent":{"type":"distance","distance":10.}}))?;
    control(client, "Isometric", None)?;
    let scene = client.call("solid_scene", json!({}))?;
    let body = &scene["bodies"][0];
    let edge = body["edges"]
        .as_array()
        .context("No edges")?
        .iter()
        .find(|e| {
            e["refinable"] == true
                && e["points"].as_array().is_some_and(|p| {
                    p.len() >= 2
                        && p.iter().all(|p| {
                            p["z"].as_f64().is_some_and(|z| (z - 10.).abs() < 1e-6)
                                && p["y"].as_f64().is_some_and(|y| y.abs() < 1e-6)
                        })
                })
        })
        .context("Visible upper front edge missing")?;
    let points = edge["points"].as_array().unwrap();
    let world: Vec<_> = ["x", "y", "z"]
        .iter()
        .map(|k| {
            (points.first().unwrap()[*k].as_f64().unwrap()
                + points.last().unwrap()[*k].as_f64().unwrap())
                * 0.5
        })
        .collect();
    control(client, kind, None)?;
    ui(
        client,
        json!({"action":"viewport","gesture":"move","world":world}),
    )?;
    ui(
        client,
        json!({"action":"viewport","gesture":"click","world":world}),
    )?;
    let size = if kind == "Fillet" {
        "Radius"
    } else {
        "Distance"
    };
    let property = if kind == "Fillet" {
        "radius"
    } else {
        "distance"
    };
    control(client, size, Some("0"))?;
    let inspected = ui(client, json!({"action":"inspect"}))?;
    ensure!(
        controls(&inspected)
            .any(|c| c["label"] == format!("Apply {kind}") && c["disabled"] == true),
        "Invalid size did not block Apply"
    );
    ensure!(
        controls(&inspected)
            .filter(|c| c["label"] == size || c["label"] == format!("Apply {kind}"))
            .all(|c| c["surface"] == "solid/refine"),
        "Refinement fields escaped the shared Refine group"
    );
    control(client, size, Some("0.1 cm"))?;
    control(client, "Tangent chain", None)?;
    ui(
        client,
        json!({"action":"capture","path":out.join(format!("{}-form.png",kind.to_lowercase()))}),
    )?;
    control(client, &format!("Apply {kind}"), None)?;
    let method = format!("solid_{}_definitions", kind.to_lowercase());
    let original = client.call(&method, json!({}))?;
    ensure!(
        original[0][property] == 1.
            && original[0]["edge_ids"]
                .as_array()
                .is_some_and(|ids| ids.contains(&edge["id"])),
        "Wrong edge or size: {original}"
    );
    let name = original[0]["name"]
        .as_str()
        .context("Feature name missing")?;
    let before = client.call("cad_document", json!({}))?;
    edit(client, name, true)?;
    ensure!(
        client.call("cad_document", json!({}))? == before,
        "Opening edit changed live history"
    );
    control(client, size, Some("2 mm"))?;
    control(client, &format!("Close {kind}"), None)?;
    ensure!(
        client.call(&method, json!({}))? == original,
        "Cancel changed the feature"
    );
    edit(client, name, false)?;
    control(client, size, Some("2 mm"))?;
    ui(
        client,
        json!({"action":"capture","path":out.join(format!("{}-edit.png",kind.to_lowercase()))}),
    )?;
    control(client, &format!("Apply {kind}"), None)?;
    ensure!(
        client.call(&method, json!({}))?[0][property] == 2.,
        "Edit failed"
    );
    control(client, "Undo", None)?;
    ensure!(
        client.call(&method, json!({}))? == original,
        "Undo did not restore original feature"
    );
    control(client, "Redo", None)?;
    ensure!(
        client.call(&method, json!({}))?[0][property] == 2.,
        "Redo failed"
    );
    let final_scene = client.call("solid_scene", json!({}))?;
    ensure!(
        final_scene["bodies"]
            .as_array()
            .is_some_and(|b| b.len() == 1)
            && final_scene["errors"].as_array().is_some_and(Vec::is_empty),
        "Refine produced invalid geometry"
    );
    control(client, "Isometric", None)?;
    let capture = out.join(format!("native-{}.png", kind.to_lowercase()));
    let project = out.join(format!("native-{}.nbcad", kind.to_lowercase()));
    ensure!(
        !capture.exists() && !project.exists(),
        "Preserve existing evidence"
    );
    ui(client, json!({"action":"capture","path":capture}))?;
    ui(
        client,
        json!({"action":"file","command":"save","path":project}),
    )?;
    println!("PASS: {kind} live edge picking, typed sizes, validation, history edit, Cancel, Undo/Redo and Save");
    Ok(json!({"project":project,"capture":capture,"definitions":client.call(&method,json!({}))?}))
}
pub(super) fn run(args: impl Iterator<Item = String>) -> Result<()> {
    let mut fixture = start(args, "native-refine")?;
    let mut cases = Vec::new();
    cases.push(case(&mut fixture.client, &fixture.out, "Fillet")?);
    let new = control(&mut fixture.client, "New document", None)?;
    fixture
        .client
        .call("cad_attach", json!({"session_id":new["active_session_id"]}))?;
    cases.push(case(&mut fixture.client, &fixture.out, "Chamfer")?);
    fs::write(
        &fixture.report,
        serde_json::to_string_pretty(&json!({"passed":true,"cases":cases}))?,
    )?;
    println!("PASS: saved {}", fixture.report.display());
    Ok(())
}
