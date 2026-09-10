use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

/// Launch only the explicitly configured CAD executable, without a shell or
/// inherited stdio handles. Correlate readiness with the child's PID lease.
pub fn launch(arguments: &Value) -> Result<Value, String> {
    let configured = arguments
        .get("executable")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| std::env::var("NBCAD_DESKTOP_BIN").ok())
        .ok_or("Set NBCAD_DESKTOP_BIN or provide the CAD executable path")?;
    let path = PathBuf::from(configured)
        .canonicalize()
        .map_err(|e| format!("CAD executable: {e}"))?;
    if !path.is_file() {
        return Err("CAD executable is not a file".into());
    }
    let mut command = Command::new(&path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(parent) = path.parent() {
        command.current_dir(parent);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not launch CAD: {e}"))?;
    let pid = child.id();
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!("CAD exited before becoming ready: {status}"));
        }
        let dir = crate::session::session_dir().join("_ui/processes");
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.filter_map(Result::ok) {
                let Ok(body) = fs::read_to_string(entry.path()) else {
                    continue;
                };
                let Ok(lease) = serde_json::from_str::<Value>(&body) else {
                    continue;
                };
                if lease.get("pid").and_then(Value::as_u64) != Some(pid as u64) {
                    continue;
                }
                let session = lease
                    .get("windows")
                    .and_then(Value::as_array)
                    .and_then(|windows| windows.first())
                    .and_then(|w| w.get("active_session_id"))
                    .and_then(Value::as_str);
                if let Some(session_id) = session {
                    if crate::session::heartbeat_meta(session_id)
                        .get("stale")
                        .and_then(Value::as_bool)
                        != Some(false)
                    {
                        continue;
                    }
                    let ui = crate::session::request_ui(
                        &json!({"session_id":session_id,"action":"inspect"}),
                        None,
                    )?;
                    if ui.get("status").and_then(Value::as_str) == Some("applied") {
                        return Ok(
                            json!({"status":"ready","pid":pid,"session_id":session_id,"executable":path,"ui":ui}),
                        );
                    }
                    return Ok(
                        json!({"status":"starting","pid":pid,"session_id":session_id,"executable":path,"ui":ui}),
                    );
                }
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    // Do not kill the application on timeout: it may be displaying recovery UI.
    Ok(json!({"status":"starting","pid":pid,"executable":path,
        "hint":"Launch is not yet acknowledged. Inspect sessions; do not launch a duplicate automatically."}))
}
