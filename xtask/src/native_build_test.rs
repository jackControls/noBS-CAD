//! Solid form parity through the actual rendered widgets and canvas.
use crate::native_fixture::{click, control, controls, start, ui, Fixture};
use crate::replay::Client;
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::fs;

fn revolve(client: &mut Client) -> Result<Value> {
    client.call("solid_revolve_definitions", json!({}))
}
fn edit_feature(client: &mut Client, label: &str) -> Result<()> {
    let state = ui(client, json!({"action":"inspect"}))?;
    let target = controls(&state)
        .find(|c| c["label"] == label && c["surface"] == "document/history")
        .context("Feature history control missing")?;
    ui(
        client,
        json!({"action":"double_click","target":target["id"]}),
    )?;
    Ok(())
}

pub fn run(args: impl Iterator<Item = String>) -> Result<()> {
    let Fixture {
        mut client,
        server,
        session,
        out,
        project,
        capture,
        report,
    } = start(args, "native-build")?;
    control(&mut client, "Sketch on XY", None)?;
    control(&mut client, "Rectangle", None)?;
    click(&mut client, [10., 0.], false)?;
    click(&mut client, [30., 20.], false)?;
    control(&mut client, "Finish sketch", None)?;
    control(&mut client, "Revolve", None)?;
    click(&mut client, [20., 10.], false)?;
    control(&mut client, "Select axis line", None)?;
    click(&mut client, [10., 10.], false)?;
    let selected = ui(&mut client, json!({"action":"inspect"}))?;
    ensure!(
        controls(&selected).any(|c| c["label"]
            .as_str()
            .is_some_and(|label| label.starts_with("Axis: Sketch1 · line "))),
        "Axis pick did not resolve a stable line"
    );
    control(&mut client, "Sketch Y axis", None)?;
    control(&mut client, "Angle (degrees)", Some("360"))?;
    ui(
        &mut client,
        json!({"action":"capture","path":out.join("revolve-form.png")}),
    )?;
    ensure!(
        client.call("solid_scene", json!({}))?["bodies"]
            .as_array()
            .is_some_and(Vec::is_empty),
        "Reference preview created geometry"
    );
    control(&mut client, "Apply Revolve", None)?;
    let definitions = revolve(&mut client)?;
    ensure!(
        definitions.as_array().is_some_and(|d| d.len() == 1),
        "Expected one parametric Revolve"
    );
    ensure!(
        definitions[0]["angle_deg"] == 360.,
        "Revolve angle did not persist"
    );
    let feature = definitions[0]["name"]
        .as_str()
        .context("Revolve name missing")?
        .to_owned();
    let body = client.call("solid_scene", json!({}))?;
    ensure!(
        body["errors"].as_array().is_some_and(Vec::is_empty)
            && body["bodies"].as_array().is_some_and(|b| b.len() == 1),
        "Revolve produced invalid solid: {}",
        body["errors"]
    );
    println!("PASS: profile and axis picking, native Revolve fields and exact solid");
    edit_feature(&mut client, &feature)?;
    control(&mut client, "Angle (degrees)", Some("180"))?;
    control(&mut client, "Close Revolve", None)?;
    ensure!(
        revolve(&mut client)? == definitions,
        "Closing the form changed the feature"
    );
    edit_feature(&mut client, &feature)?;
    control(&mut client, "Angle (degrees)", Some("180"))?;
    control(&mut client, "Apply Revolve", None)?;
    ensure!(
        revolve(&mut client)?[0]["angle_deg"] == 180.,
        "Revolve edit failed"
    );
    control(&mut client, "Undo", None)?;
    ensure!(
        revolve(&mut client)?[0]["angle_deg"] == 360.,
        "Undo did not restore full revolution"
    );
    control(&mut client, "Redo", None)?;
    ensure!(
        revolve(&mut client)?[0]["angle_deg"] == 180.,
        "Redo did not restore half revolution"
    );
    println!("PASS: Revolve history edit, close/cancel, Undo and Redo");
    control(&mut client, "Isometric", None)?;
    ui(&mut client, json!({"action":"capture","path":capture}))?;
    ui(
        &mut client,
        json!({"action":"file","command":"save","path":project}),
    )?;
    fs::write(
        &report,
        serde_json::to_vec_pretty(&json!({"status":"passed","server":server,"session":session,
        "checks":["profile_pick","axis_line_pick","axis_preset","revolve_apply","history_edit","close_cancel","undo_redo","render_capture","save"],
        "definitions":revolve(&mut client)?,"capture":capture,"project":project}))?,
    )?;
    println!("PASS: native build saved; report {}", report.display());
    Ok(())
}
