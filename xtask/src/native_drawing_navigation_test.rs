//! Real Winit gestures on a private, PID-verified fixture window.
//! JSON preserves intent; captured pixels must separately prove pan and zoom.
use crate::{
    native_fixture::{capture, control, controls, ui},
    native_platform_test::Driver,
    replay::Client,
};
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};
mod owned;
pub(super) use owned::run as run_owned;
pub(super) use owned::run_cam as run_cam_owned;
pub(super) use owned::run_cam_geometry as run_cam_geometry_owned;
pub(super) use owned::run_centers as run_centers_owned;
pub(super) use owned::run_chamfer as run_chamfer_owned;
pub(super) use owned::run_cloud as run_cloud_owned;
pub(super) use owned::run_hole as run_hole_owned;
pub(super) use owned::run_mechanism as run_mechanism_owned;
pub(super) use owned::run_output as run_output_owned;
pub(super) use owned::run_scripts as run_scripts_owned;

fn inspect(client: &mut Client) -> Result<Value> {
    ui(client, json!({"action":"inspect"}))
}
fn fitted(state: &Value) -> Result<bool> {
    controls(state)
        .find(|c| c["label"] == "Fit sheet")
        .and_then(|c| c["selected"].as_bool())
        .context("Drawing Fit state missing")
}
pub(super) fn canvas(state: &Value) -> Result<&Value> {
    state["ui"]["canvases"]
        .as_array()
        .and_then(|c| c.iter().find(|c| c["name"] == "drawing"))
        .filter(|c| {
            ["x", "y", "width", "height"]
                .iter()
                .all(|key| c[key].as_f64().is_some_and(f64::is_finite))
        })
        .filter(|c| c["width"].as_f64().unwrap() > 0. && c["height"].as_f64().unwrap() > 0.)
        .context("Visible drawing canvas missing")
}
pub(super) fn owned_pid(out: &Path, session: &str, server: &str) -> Result<u32> {
    let root = out
        .parent()
        .context("Owned evidence root")?
        .canonicalize()?;
    let sessions = PathBuf::from(
        std::env::var_os("NBCAD_SESSION_DIR").context("Private session registry required")?,
    )
    .canonicalize()?;
    ensure!(
        sessions == root.join("sessions"),
        "Drawing input requires the fixture's private session registry"
    );
    let launch: Value = serde_json::from_slice(&fs::read(root.join("host.json"))?)?;
    ensure!(
        PathBuf::from(launch["exe"].as_str().context("Owned launcher binary")?).canonicalize()?
            == Path::new(server).canonicalize()?,
        "Owned launch binary does not match fixture server"
    );
    let pid = u32::try_from(launch["pid"].as_u64().context("Owned launcher PID")?)?;
    let mut matches = 0;
    for entry in fs::read_dir(sessions.join("_ui/processes"))? {
        let path = entry?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let registry: Value = serde_json::from_slice(&fs::read(path)?)?;
        if registry["pid"] == pid
            && registry["windows"]
                .as_array()
                .is_some_and(|windows| windows.iter().any(|w| w["active_session_id"] == session))
        {
            matches += 1;
        }
    }
    ensure!(
        matches == 1,
        "Session is not uniquely owned by the fixture launch PID"
    );
    Ok(pid)
}
pub(super) fn exercise(
    client: &mut Client,
    out: &Path,
    session: &str,
    server: &str,
    segments: usize,
    desktop_input: bool,
) -> Result<Value> {
    ensure!(
        cfg!(target_os = "windows") || cfg!(target_os = "linux"),
        "Real drawing input requires Windows or disposable Linux Xvfb"
    );
    // Loading the saved annotated model retires the original blank session.
    // Prove the current inspected session belongs to the same launched PID.
    let current = inspect(client)?;
    fs::write(
        out.join("navigation-owner.json"),
        serde_json::to_vec_pretty(&current)?,
    )?;
    let active_session = current["active_session_id"]
        .as_str()
        .context("Current native session missing")?;
    let pid = owned_pid(out, active_session, server)?;
    let before = client.call("cad_project_model", json!({}))?;
    control(client, "Fit sheet", None)?;
    let fit = inspect(client)?;
    ensure!(fitted(&fit)?, "Fit did not become selected");
    let fit_capture = ui(
        client,
        json!({"action":"capture","path":out.join("dense-fit.png")}),
    )?;
    if std::env::var("NBCAD_NATIVE_PAPER_DIAGNOSTICS").as_deref() == Ok("1") {
        fs::write(
            out.join("dense-fit-capture.json"),
            serde_json::to_vec_pretty(&fit_capture)?,
        )?;
        ensure!(fit_capture["value"]["paper_probe"]["fitted_paper_white"]==true,
            "Fitted paper is not visible at the known 3 mm blank margin; dense-fit.png and paper diagnostics were retained");
    }
    for _ in 0..8 {
        control(client, "Zoom drawing in", None)?;
    }
    ensure!(
        !fitted(&inspect(client)?)?,
        "Zoom buttons did not leave fitted mode"
    );
    capture(client, out, "dense-button-zoom")?;
    control(client, "Zoom drawing out", None)?;
    capture(client, out, "dense-button-out")?;
    control(client, "Fit sheet", None)?;
    let restored = inspect(client)?;
    ensure!(
        fitted(&restored)? && canvas(&restored)? == canvas(&fit)?,
        "Fit did not restore the same paper bounds"
    );
    ensure!(
        client.call("cad_project_model", json!({}))? == before,
        "MCP paper navigation changed saved intent"
    );
    fs::write(
        out.join("navigation-mcp.json"),
        serde_json::to_vec_pretty(&json!({
            "mcp_fit_zoom_passed":true,"model_exactly_preserved":true,"dense_view_count":20,"visible_segments":segments,
            "os_input":if desktop_input {"pending; a later helper failure must not be reported as a pass"} else {"not attempted (--mcp-only)"},"fit_canvas":canvas(&fit)?
        }))?,
    )?;
    if !desktop_input {
        return Ok(
            json!({"mcp_fit_zoom_passed":true,"dense_view_count":20,"visible_segments":segments,
            "model_exactly_preserved":true,"os_input":"not attempted (--mcp-only)","pan_inverse_pixels_exact":null,
            "captures":["dense-fit.png","dense-button-zoom.png","dense-button-out.png"],
            "not_proven":["OS wheel","OS middle pan","macOS/Linux paper gestures","monitor DPI transition","touchpad hardware"]}),
        );
    }
    if cfg!(target_os = "linux") {
        owned::verify_display()?;
    }
    let driver = Driver::new(pid, out)?;
    driver.event("focus")?;
    let bounds = canvas(&restored)?;
    let point = [
        bounds["x"].as_f64().unwrap() + bounds["width"].as_f64().unwrap() * 0.5,
        bounds["y"].as_f64().unwrap() + bounds["height"].as_f64().unwrap() * 0.5,
    ];
    let mut input_evidence = Vec::new();
    // Windows reports one line per notch; this Linux XTEST fixture reports two.
    // Two bounded Windows gestures reach the same ~423% review scale. Sending
    // all 16 notches together would hit the navigation's per-event delta clamp.
    let wheel_calls = if cfg!(target_os = "windows") { 2 } else { 1 };
    let mut wheel_requests = Vec::new();
    for invocation in 1..=wheel_calls {
        let request = json!({"x":point[0],"y":point[1],"notches":8,"ctrl":true,"client":restored["ui"]["client"]});
        let wheel_evidence = driver.invoke("drawing-wheel", Some(&request.to_string()))?;
        let receipt = if wheel_evidence.trim().is_empty() {
            Value::Null
        } else {
            let receipt = serde_json::from_str::<Value>(&wheel_evidence)?;
            input_evidence.push(receipt.clone());
            receipt
        };
        wheel_requests.push(json!({"invocation":invocation,"request":request,"receipt":receipt}));
    }
    let wheel_intent = json!({"total_notches":wheel_calls * 8,"invocations":wheel_requests});
    fs::write(
        out.join("navigation-wheel-input.json"),
        serde_json::to_vec_pretty(&wheel_intent)?,
    )?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if !fitted(&inspect(client)?)? {
            break;
        }
        ensure!(
            Instant::now() < deadline,
            "Actual OS Ctrl-wheel did not reach paper navigation"
        );
        thread::sleep(Duration::from_millis(30));
    }
    capture(client, out, "dense-os-wheel")?;
    let target = [point[0] - 90., point[1] - 60.];
    let pan_evidence=driver.invoke(
        "drawing-pan",
        Some(&json!({"x":point[0],"y":point[1],"to_x":target[0],"to_y":target[1],"client":restored["ui"]["client"]}).to_string()),
    )?;
    if !pan_evidence.trim().is_empty() {
        input_evidence.push(serde_json::from_str::<Value>(&pan_evidence)?);
    }
    capture(client, out, "dense-os-pan")?;
    let back_evidence=driver.invoke(
        "drawing-pan",
        Some(&json!({"x":target[0],"y":target[1],"to_x":point[0],"to_y":point[1],"client":restored["ui"]["client"]}).to_string()),
    )?;
    if !back_evidence.trim().is_empty() {
        input_evidence.push(serde_json::from_str::<Value>(&back_evidence)?);
    }
    fs::write(
        out.join("navigation-os-input.json"),
        serde_json::to_vec_pretty(&input_evidence)?,
    )?;
    capture(client, out, "dense-os-pan-back")?;
    ensure!(
        fs::read(out.join("dense-os-pan.png"))? != fs::read(out.join("dense-os-wheel.png"))?,
        "Middle pan did not change captured pixels"
    );
    ensure!(
        fs::read(out.join("dense-os-pan-back.png"))? == fs::read(out.join("dense-os-wheel.png"))?,
        "Inverse middle pan did not restore exact captured pixels"
    );
    control(client, "Fit sheet", None)?;
    capture(client, out, "dense-fit-restored")?;
    ensure!(
        fitted(&inspect(client)?)?,
        "Fit did not reset after actual pan"
    );
    ensure!(
        client.call("cad_project_model", json!({}))? == before,
        "Paper navigation changed document or drawing intent"
    );
    Ok(
        json!({"actual_input":if cfg!(target_os="linux"){"X11 XTEST wheel/middle button and pointer movement into real Winit"}else{"Windows SendInput wheel/middle button and OS cursor movement into real Winit"},
        "initial_session":session,"active_session":active_session,"dense_view_count":20,"visible_segments":segments,"model_exactly_preserved":true,"pan_inverse_pixels_exact":true,"input_evidence":input_evidence,"wheel_intent":wheel_intent,
        "captures":["dense-fit.png","dense-button-zoom.png","dense-button-out.png","dense-os-wheel.png","dense-os-pan.png","dense-os-pan-back.png","dense-fit-restored.png"],
        "not_proven":["Other OS paper gestures","monitor DPI transition","touchpad hardware","Wayland"]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canvas_requires_the_flat_published_rectangle() {
        let published = json!({"name":"drawing","x":355.96,"y":132.,"width":888.08,"height":628.});
        assert_eq!(
            canvas(&json!({"ui":{"canvases":[published.clone()]}})).unwrap(),
            &published
        );
        for invalid in [
            json!({"name":"drawing","bounds":published}),
            json!({"name":"drawing"}),
            json!({"name":"drawing","x":0.,"y":0.,"width":0.,"height":100.}),
        ] {
            assert!(canvas(&json!({"ui":{"canvases":[invalid]}})).is_err());
        }
    }
}
