//! Explicit, bounded navigation diagnostics.
//!
//! The recorder is intentionally opt-in. While active, the frontend sends
//! timestamped input/camera entries here and asks the native Bevy viewport for
//! periodic screenshots. A session is stored in Downloads so a tester can
//! attach the complete folder without finding an application-private log path.

use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::native_viewport::NativeViewport;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationDiagnosticSessionInfo {
    pub id: String,
    pub directory: String,
    pub trace_path: String,
    pub started_unix_ms: u128,
}

struct NavigationDiagnosticSession {
    info: NavigationDiagnosticSessionInfo,
    directory: PathBuf,
    trace: BufWriter<File>,
    capture_index: u32,
}

#[derive(Default)]
pub struct NavigationDiagnosticsState {
    session: Mutex<Option<NavigationDiagnosticSession>>,
}

fn unix_millis() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|error| format!("system clock is before the Unix epoch: {error}"))
}

fn write_json_line(writer: &mut BufWriter<File>, value: &Value) -> Result<(), String> {
    serde_json::to_writer(&mut *writer, value)
        .map_err(|error| format!("could not encode navigation diagnostic entry: {error}"))?;
    writer
        .write_all(b"\n")
        .map_err(|error| format!("could not write navigation diagnostic entry: {error}"))
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[tauri::command]
pub fn navigation_diagnostics_start(
    app: AppHandle,
    state: State<'_, NavigationDiagnosticsState>,
) -> Result<NavigationDiagnosticSessionInfo, String> {
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "navigation diagnostics lock poisoned".to_string())?;
    if let Some(session) = guard.as_ref() {
        return Ok(session.info.clone());
    }

    let started_unix_ms = unix_millis()?;
    let id = format!("navigation-{started_unix_ms}-{}", std::process::id());
    let base = app
        .path()
        .download_dir()
        .map_err(|error| format!("could not locate Downloads: {error}"))?
        .join("noBS CAD Diagnostics");
    let directory = base.join(&id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create diagnostic folder: {error}"))?;

    let trace_path = directory.join("navigation-trace.jsonl");
    let trace_file = File::create(&trace_path)
        .map_err(|error| format!("could not create diagnostic trace: {error}"))?;
    let mut trace = BufWriter::new(trace_file);
    write_json_line(
        &mut trace,
        &json!({
            "stage": "native.recorder.start",
            "unixMs": started_unix_ms,
            "appVersion": env!("CARGO_PKG_VERSION"),
            "platform": std::env::consts::OS,
            "architecture": std::env::consts::ARCH,
            "processId": std::process::id(),
        }),
    )?;
    trace
        .flush()
        .map_err(|error| format!("could not initialize diagnostic trace: {error}"))?;

    let readme = [
        "noBS CAD navigation diagnostic session",
        "",
        "navigation-trace.jsonl records raw device packets, normalized motion,",
        "touchpad wheel events, camera transforms, native bridge updates, timing,",
        "viewport geometry, and Retina scale.",
        "",
        "frame-*.png are periodic captures of the native Bevy viewport.",
        "Attach this entire folder to the debugging task.",
        "",
    ]
    .join("\n");
    fs::write(directory.join("README.txt"), readme)
        .map_err(|error| format!("could not create diagnostic README: {error}"))?;

    let info = NavigationDiagnosticSessionInfo {
        id,
        directory: display_path(&directory),
        trace_path: display_path(&trace_path),
        started_unix_ms,
    };
    *guard = Some(NavigationDiagnosticSession {
        info: info.clone(),
        directory,
        trace,
        capture_index: 0,
    });
    Ok(info)
}

#[tauri::command]
pub fn navigation_diagnostics_append(
    state: State<'_, NavigationDiagnosticsState>,
    entries: Vec<Value>,
) -> Result<(), String> {
    if entries.len() > 4_096 {
        return Err("navigation diagnostic batch is too large".to_string());
    }
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "navigation diagnostics lock poisoned".to_string())?;
    let Some(session) = guard.as_mut() else {
        return Ok(());
    };
    for entry in entries {
        write_json_line(&mut session.trace, &entry)?;
    }
    session
        .trace
        .flush()
        .map_err(|error| format!("could not flush navigation diagnostic trace: {error}"))
}

#[tauri::command]
pub fn navigation_diagnostics_capture(
    state: State<'_, NavigationDiagnosticsState>,
    viewport: State<'_, NativeViewport>,
) -> Result<String, String> {
    let (path, relative_name) = {
        let mut guard = state
            .session
            .lock()
            .map_err(|_| "navigation diagnostics lock poisoned".to_string())?;
        let session = guard
            .as_mut()
            .ok_or_else(|| "navigation diagnostics are not active".to_string())?;
        session.capture_index = session.capture_index.saturating_add(1);
        let relative_name = format!("frame-{:04}.png", session.capture_index);
        (session.directory.join(&relative_name), relative_name)
    };
    viewport.capture(path)?;
    Ok(relative_name)
}

#[tauri::command]
pub fn navigation_diagnostics_stop(
    state: State<'_, NavigationDiagnosticsState>,
) -> Result<NavigationDiagnosticSessionInfo, String> {
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "navigation diagnostics lock poisoned".to_string())?;
    let mut session = guard
        .take()
        .ok_or_else(|| "navigation diagnostics are not active".to_string())?;
    write_json_line(
        &mut session.trace,
        &json!({
            "stage": "native.recorder.stop",
            "unixMs": unix_millis()?,
            "captureCount": session.capture_index,
        }),
    )?;
    session
        .trace
        .flush()
        .and_then(|_| session.trace.get_ref().sync_all())
        .map_err(|error| format!("could not finish navigation diagnostic trace: {error}"))?;
    Ok(session.info)
}
