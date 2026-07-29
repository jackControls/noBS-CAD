//! Launch / status / window-control helpers for the optional desktop UI.
//!
//! Headless MCP remains the default. The UI is a separate process; co-link is
//! still file-bridge. Window commands are written to
//! `$NBCAD_SESSION_DIR/_ui/control.json` for the running shell to apply.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{json, Value};

use crate::session;

const UI_SUBDIR: &str = "_ui";
const CONTROL_FILE: &str = "control.json";
const LAUNCHER_FILE: &str = "launcher.json";

#[derive(Debug, Clone)]
pub struct LaunchResult {
    pub pid: u32,
    pub exe: PathBuf,
    pub session_dir: PathBuf,
    pub already_running: bool,
}

pub fn ui_dir() -> PathBuf {
    session::session_dir().join(UI_SUBDIR)
}

pub fn control_path() -> PathBuf {
    ui_dir().join(CONTROL_FILE)
}

pub fn launcher_path() -> PathBuf {
    ui_dir().join(LAUNCHER_FILE)
}

pub fn resolve_ui_exe() -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("NBCAD_UI_EXE") {
        let path = PathBuf::from(explicit.trim());
        if path.is_file() {
            return Ok(normalize_path(path));
        }
        return Err(format!(
            "NBCAD_UI_EXE is set but not a file: {}",
            path.display()
        ));
    }

    let names = if cfg!(windows) {
        vec!["nbcad.exe", "noBS-CAD.exe"]
    } else if cfg!(target_os = "macos") {
        vec!["nbcad"]
    } else {
        vec!["nbcad"]
    };

    let mut candidates = Vec::new();
    for root in guess_repo_roots() {
        candidates.push(root.join("src-tauri").join("target").join("release"));
        candidates.push(
            root.join("src-tauri")
                .join("target")
                .join("x86_64-pc-windows-msvc")
                .join("release"),
        );
        candidates.push(
            root.join("src-tauri")
                .join("target")
                .join("release")
                .join("bundle")
                .join("portable"),
        );
    }

    for dir in candidates {
        for name in &names {
            let path = dir.join(name);
            if path.is_file() {
                return Ok(normalize_path(path));
            }
            // Portable layout: nested folder
            if dir.is_dir() {
                if let Ok(entries) = fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let nested = entry.path().join(name);
                        if nested.is_file() {
                            return Ok(normalize_path(nested));
                        }
                    }
                }
            }
        }
    }

    Err(
        "UI executable not found. Build with `npx tauri build` or set NBCAD_UI_EXE to nbcad/noBS-CAD."
            .to_string(),
    )
}

pub fn launch_ui(force: bool) -> Result<LaunchResult, String> {
    if let Some(existing) = read_tracked_pid() {
        if pid_alive(existing) && !force {
            return Ok(LaunchResult {
                pid: existing,
                exe: read_tracked_exe().unwrap_or_default(),
                session_dir: session::session_dir(),
                already_running: true,
            });
        }
    }

    let exe = resolve_ui_exe()?;
    let session_dir = session::session_dir();
    fs::create_dir_all(ui_dir()).map_err(|error| format!("create _ui dir: {error}"))?;

    let mut command = Command::new(&exe);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .env("NBCAD_SESSION_DIR", &session_dir);
    if let Ok(occt) = std::env::var("OCCT_ROOT") {
        command.env("OCCT_ROOT", occt);
    }
    // Prefer the MCP process PATH (already includes OCCT bin when installed via xtask).
    if let Ok(path) = std::env::var("PATH") {
        command.env("PATH", path);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Detach from the MCP console/job so stdout cannot corrupt JSON-RPC.
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("failed to launch UI {}: {error}", exe.display()))?;
    let pid = child.id();
    // Detach: do not wait; drop Child so the UI outlives this MCP tool call.
    std::mem::forget(child);

    write_launcher_record(pid, &exe)?;
    Ok(LaunchResult {
        pid,
        exe,
        session_dir,
        already_running: false,
    })
}

pub fn ui_status_json(tracked_pid: Option<u32>) -> Value {
    let pid = tracked_pid.or_else(read_tracked_pid);
    let alive = pid.map(pid_alive).unwrap_or(false);
    let exe = read_tracked_exe();
    let sessions = session::sessions_list_json();
    json!({
        "ui": {
            "mode": if alive { "running" } else { "not_running" },
            "pid": pid,
            "alive": alive,
            "exe": exe.map(|path| path.display().to_string()),
            "session_dir": session::session_dir().display().to_string(),
            "control_path": control_path().display().to_string(),
            "headless_mcp": true,
            "co_link": "file_bridge_v1",
            "window_control": "file_bridge_control_json",
        },
        "sessions": sessions,
    })
}

pub fn write_window_command(arguments: &Value) -> Result<Value, String> {
    let action = arguments
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(|| "missing required argument 'action'".to_string())?;
    match action {
        "focus" | "show" | "hide" | "move" | "resize" => {}
        other => {
            return Err(format!(
                "unknown action '{other}' (expected focus|show|hide|move|resize)"
            ))
        }
    }

    let mut body = json!({
        "seq": session::now_ms(),
        "action": action,
        "updated_at_ms": session::now_ms(),
        "source": "mcp",
    });
    let obj = body.as_object_mut().unwrap();
    for key in ["x", "y", "width", "height"] {
        if let Some(value) = arguments.get(key) {
            obj.insert(key.to_string(), value.clone());
        }
    }

    if matches!(action, "move" | "resize") {
        let needs_xy = action == "move";
        let needs_wh = action == "resize";
        if needs_xy && (obj.get("x").is_none() || obj.get("y").is_none()) {
            return Err("move requires numeric x and y".to_string());
        }
        if needs_wh && (obj.get("width").is_none() || obj.get("height").is_none()) {
            return Err("resize requires numeric width and height".to_string());
        }
    }

    fs::create_dir_all(ui_dir()).map_err(|error| format!("create _ui dir: {error}"))?;
    let path = control_path();
    fs::write(
        &path,
        serde_json::to_string_pretty(&body).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("write {}: {error}", path.display()))?;

    Ok(json!({
        "queued": true,
        "action": action,
        "control_path": path.display().to_string(),
        "note": "UI applies this when running and watching _ui/control.json (poll ~500ms).",
        "backlog": "Live IPC window broker / multi-window is not implemented yet.",
    }))
}

pub fn launch_result_json(result: &LaunchResult) -> Value {
    json!({
        "launched": !result.already_running,
        "already_running": result.already_running,
        "pid": result.pid,
        "exe": result.exe.display().to_string(),
        "session_dir": result.session_dir.display().to_string(),
        "headless_mcp": true,
        "co_link": "file_bridge_v1",
        "next": [
            "Wait for the UI to publish a session (or create geometry headless).",
            "cad_list_sessions → cad_attach to load a UI-published model into this MCP process.",
            "cad_ui_window to focus/move/resize/show/hide when the UI is running.",
        ],
    })
}

fn write_launcher_record(pid: u32, exe: &Path) -> Result<(), String> {
    let body = json!({
        "pid": pid,
        "exe": exe.display().to_string(),
        "session_dir": session::session_dir().display().to_string(),
        "updated_at_ms": session::now_ms(),
    });
    fs::write(
        launcher_path(),
        serde_json::to_string_pretty(&body).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn read_tracked_pid() -> Option<u32> {
    let body = fs::read_to_string(launcher_path()).ok()?;
    let value: Value = serde_json::from_str(&body).ok()?;
    value.get("pid").and_then(Value::as_u64).map(|pid| pid as u32)
}

fn read_tracked_exe() -> Option<PathBuf> {
    let body = fs::read_to_string(launcher_path()).ok()?;
    let value: Value = serde_json::from_str(&body).ok()?;
    value
        .get("exe")
        .and_then(Value::as_str)
        .map(PathBuf::from)
}

pub fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output();
        match output {
            Ok(output) => {
                let text = String::from_utf8_lossy(&output.stdout);
                text.contains(&pid.to_string())
            }
            Err(_) => false,
        }
    }
    #[cfg(target_os = "linux")]
    {
        PathBuf::from(format!("/proc/{pid}")).exists()
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

fn guess_repo_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(root) = std::env::var("NBCAD_REPO_ROOT") {
        let path = PathBuf::from(root);
        if path.is_dir() {
            roots.push(path);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        // .../mcp-server/target/<profile>/nbcad-mcp(.exe) → repo root
        if let Some(repo) = exe
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
        {
            roots.push(repo.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.clone());
        if let Some(parent) = cwd.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    roots
}

fn normalize_path(path: PathBuf) -> PathBuf {
    path.canonicalize()
        .map(|canonical| {
            let raw = canonical.to_string_lossy();
            if let Some(stripped) = raw.strip_prefix(r"\\?\") {
                PathBuf::from(stripped)
            } else {
                PathBuf::from(raw.as_ref())
            }
        })
        .unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::ENV_LOCK;

    #[test]
    fn window_command_requires_move_coords() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-ui-test-{}", session::now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let err = write_window_command(&json!({"action": "move"})).unwrap_err();
        assert!(err.contains("x and y"));
        let ok = write_window_command(&json!({"action": "focus"})).unwrap();
        assert_eq!(ok["queued"], true);
        assert!(control_path().is_file());
        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(dir);
    }
}
