//! External-thread parity through an existing native window's actual MCP controls.
use crate::native_fixture::{begin_sketch, control, controls, edit_feature, start, ui};
use crate::replay::Client;
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::{fs, path::Path};

fn field(client: &mut Client, label: &str, value: Option<&str>) -> Result<Value> {
    // Expanded custom profiles scroll naturally; drive those same scroll buttons.
    // Search current position, then from top to bottom, never hidden controls.
    for pass in 0..2 {
        if pass == 1 {
            for _ in 0..12 {
                let state = ui(client, json!({"action":"inspect"}))?;
                if !controls(&state)
                    .any(|c| c["label"] == "Scroll feature up" && c["disabled"] == false)
                {
                    break;
                }
                control(client, "Scroll feature up", None)?;
            }
        }
        for _ in 0..12 {
            let state = ui(client, json!({"action":"inspect"}))?;
            let found: Vec<_> = controls(&state)
                .filter(|c| {
                    c["disabled"] == false
                        && c["label"]
                            .as_str()
                            .is_some_and(|s| s == label || s.starts_with(&format!("{label}: ")))
                })
                .collect();
            if found.len() == 1 {
                return ui(
                    client,
                    if let Some(v) = value {
                        json!({"action":"set_value","target":found[0]["id"],"value":v})
                    } else {
                        json!({"action":"click","target":found[0]["id"]})
                    },
                );
            }
            ensure!(found.is_empty(), "Ambiguous thread control {label}");
            if !controls(&state)
                .any(|c| c["label"] == "Scroll feature down" && c["disabled"] == false)
            {
                break;
            }
            control(client, "Scroll feature down", None)?;
        }
    }
    anyhow::bail!("No visible, enabled thread control {label}")
}
fn capture(client: &mut Client, out: &Path, name: &str) -> Result<()> {
    ui(
        client,
        json!({"action":"capture","path":out.join(format!("{name}.png"))}),
    )?;
    Ok(())
}

pub(super) fn run(args: impl Iterator<Item = String>) -> Result<()> {
    let mut fixture = start(args, "native-thread")?;
    let mut cases = Vec::new();
    for rounded in [false, true] {
        let client = &mut fixture.client;
        if rounded {
            let new = control(client, "New document", None)?;
            client.call("cad_attach", json!({"session_id":new["active_session_id"]}))?;
        }
        begin_sketch(client, "XY")?;
        for radius in [10., 5.] {
            client.call("sketch_add_circle",json!({"mode":"center_diameter","p1":{"x":0.,"y":0.},"p2":{"x":radius,"y":0.},"ctrl_held":true}))?;
        }
        control(client, "Finish sketch", None)?;
        client.call("solid_extrude",json!({"sketch_name":"Sketch1","profile_indices":[0],"extent":{"type":"distance","distance":20.}}))?;
        control(client, "Isometric", None)?;
        let before = client.call("cad_document", json!({}))?;
        control(client, "External Thread", None)?;
        capture(
            client,
            &fixture.out,
            if rounded {
                "rounded-empty"
            } else {
                "thread-empty"
            },
        )?;
        let bad = ui(
            client,
            json!({"action":"viewport","gesture":"click","world":[7.,0.,20.]}),
        );
        ensure!(
            bad.is_err(),
            "A planar face was accepted for external threading"
        );
        // Front view presents the outer cylinder without the rim hiding the pick.
        ui(
            client,
            json!({"action":"view","view":"front","fit":true,"duration_ms":0}),
        )?;
        ui(
            client,
            json!({"action":"viewport","gesture":"move","world":[0.,-10.,10.]}),
        )?;
        ui(
            client,
            json!({"action":"viewport","gesture":"click","world":[0.,-10.,10.]}),
        )?;
        field(client, "Size and pitch", Some("metric_coarse-16-2"))?;
        let state = ui(client, json!({"action":"inspect"}))?;
        ensure!(
            controls(&state)
                .any(|c| c["label"] == "Apply External Thread" && c["disabled"] == true),
            "Mismatched shaft diameter accepted"
        );
        field(client, "Size and pitch", Some("metric_coarse-20-2.5"))?;
        if rounded {
            field(client, "Standard", None)?;
            field(client, "Custom trapezoidal", None)?;
            for (label, value) in [
                ("Pitch", "2.5 mm"),
                ("Radial depth", "1.25"),
                ("Corner radius", "0.1875"),
                ("Radial clearance", "0.15625"),
                ("Axial clearance", "0.125"),
            ] {
                field(client, label, Some(value))?;
            }
        }
        field(client, "Representation", Some("modeled"))?;
        field(client, "Hand", None)?;
        field(
            client,
            if rounded { "Left-hand" } else { "Right-hand" },
            None,
        )?;
        field(client, "Thread the full cylindrical surface", None)?;
        field(client, "Thread length", Some("21"))?;
        let state = ui(client, json!({"action":"inspect"}))?;
        ensure!(
            controls(&state)
                .any(|c| c["label"] == "Apply External Thread" && c["disabled"] == true),
            "An over-length thread was accepted"
        );
        field(client, "Thread length", Some("0.8 cm"))?;
        field(client, "Flip thread start to the opposite end", None)?;
        ui(
            client,
            json!({"action":"view","view":"isometric","duration_ms":0}),
        )?;
        let tag = if rounded {
            "thread-rounded"
        } else {
            "thread-metric"
        };
        capture(client, &fixture.out, &format!("{tag}-form"))?;
        ensure!(
            client.call("cad_document", json!({}))? == before,
            "Thread draft changed history"
        );
        control(client, "Apply External Thread", None)?;
        let definitions = client.call("solid_body_feature_definitions", json!({}))?;
        let d = &definitions[0];
        ensure!(
            d["type"] == "external_thread" && d["thread"]["depth"] == 8. && d["flip"] == true,
            "Wrong saved thread: {d}"
        );
        ensure!(
            d["thread"]["standard"]
                == if rounded {
                    "custom_trapezoidal"
                } else {
                    "iso_metric"
                },
            "Wrong thread profile"
        );
        ensure!(
            client.call("solid_scene", json!({}))?["errors"]
                .as_array()
                .is_some_and(Vec::is_empty),
            "Invalid thread geometry"
        );
        capture(client, &fixture.out, tag)?;
        let name = d["name"].as_str().context("Thread feature name missing")?;
        let original = client.call("cad_document", json!({}))?;
        edit_feature(client, name, true)?;
        field(client, "Thread length", Some("6"))?;
        control(client, "Close External Thread", None)?;
        ensure!(
            client.call("cad_document", json!({}))? == original,
            "Cancel changed the thread"
        );
        edit_feature(client, name, false)?;
        field(client, "Thread length", Some("5"))?;
        field(client, "Flip thread start to the opposite end", None)?;
        capture(client, &fixture.out, &format!("{tag}-edit"))?;
        control(client, "Apply External Thread", None)?;
        let edited = client.call("solid_body_feature_definitions", json!({}))?;
        ensure!(
            edited != definitions
                && edited[0]["thread"]["depth"] == 5.
                && edited[0]["flip"] == false,
            "Thread edit not applied"
        );
        control(client, "Undo", None)?;
        ensure!(
            client.call("solid_body_feature_definitions", json!({}))? == definitions,
            "Thread Undo failed"
        );
        control(client, "Redo", None)?;
        ensure!(
            client.call("solid_body_feature_definitions", json!({}))? == edited,
            "Thread Redo failed"
        );
        ensure!(
            client.call("solid_scene", json!({}))?["errors"]
                .as_array()
                .is_some_and(Vec::is_empty),
            "Edited thread has geometry errors"
        );
        ui(
            client,
            json!({"action":"file","command":"save","path":fixture.out.join(format!("{tag}.nbcad"))}),
        )?;
        cases.push(json!({"standard":d["thread"]["standard"],"passed":true}));
    }
    fs::write(
        &fixture.report,
        serde_json::to_string_pretty(&json!({"passed":true,"cases":cases}))?,
    )?;
    println!(
        "PASS native external threads: saved {}",
        fixture.report.display()
    );
    Ok(())
}
