//! Poll file-bridge window commands from MCP (`$NBCAD_SESSION_DIR/_ui/control.json`).

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Size};

static LAST_SEQ: AtomicU64 = AtomicU64::new(0);

pub fn start_watcher(app: AppHandle) {
    thread::spawn(move || {
        loop {
            if let Err(error) = poll_once(&app) {
                eprintln!("[ui_control] {error}");
            }
            thread::sleep(Duration::from_millis(500));
        }
    });
}

fn control_path() -> PathBuf {
    let root = std::env::var_os("NBCAD_SESSION_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("nbcad-sessions"));
    root.join("_ui").join("control.json")
}

fn poll_once(app: &AppHandle) -> Result<(), String> {
    let path = control_path();
    if !path.is_file() {
        return Ok(());
    }
    let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|error| format!("parse control.json: {error}"))?;
    let seq = value
        .get("seq")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let last = LAST_SEQ.load(Ordering::Relaxed);
    if seq == 0 || seq == last {
        return Ok(());
    }
    LAST_SEQ.store(seq, Ordering::Relaxed);

    let action = value
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("focus");
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    match action {
        "focus" => {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        "show" => {
            let _ = window.unminimize();
            let _ = window.show();
        }
        "hide" => {
            let _ = window.hide();
        }
        "move" => {
            let x = value.get("x").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let y = value.get("y").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            window
                .set_position(Position::Physical(PhysicalPosition { x, y }))
                .map_err(|error| error.to_string())?;
            let _ = window.set_focus();
        }
        "resize" => {
            let width = value
                .get("width")
                .and_then(|v| v.as_u64())
                .unwrap_or(1440)
                .max(1) as u32;
            let height = value
                .get("height")
                .and_then(|v| v.as_u64())
                .unwrap_or(900)
                .max(1) as u32;
            window
                .set_size(Size::Physical(PhysicalSize { width, height }))
                .map_err(|error| error.to_string())?;
        }
        other => {
            return Err(format!("unknown window action '{other}'"));
        }
    }
    Ok(())
}
