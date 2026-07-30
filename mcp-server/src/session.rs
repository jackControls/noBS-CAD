//! Headless session directories under `NBCAD_SESSION_DIR` (or temp `nbcad-sessions`).
//!
//! This is a **read-only snapshot** helper for MCP goldens and offline loads.
//! It is **not** a live UI co-link: the desktop app does not publish here in the
//! A+ slice, and MCP never writes model/focus back after attach.
//!
//! Layout: `<session_dir>/<session_id>/model.json` (+ optional `focus.json`).
//! Prefer UUID-like `session_id` values when creating directories (enforced later
//! when the UI snapshot bridge lands).

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde_json::{json, Value};

pub fn session_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("NBCAD_SESSION_DIR") {
        if !custom.trim().is_empty() {
            return PathBuf::from(custom);
        }
    }
    std::env::temp_dir().join("nbcad-sessions")
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// List attachable session directories. Skips control dirs (names starting with `_`,
/// including `_ui`).
pub fn list_sessions() -> Result<Vec<String>, String> {
    let root = session_dir();
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut sessions = Vec::new();
    for entry in fs::read_dir(&root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            let name = entry.file_name().to_string_lossy().into_owned();
            // `_ui` and other underscore-prefixed dirs are control/plumbing, not models.
            if name.starts_with('_') {
                continue;
            }
            sessions.push(name);
        }
    }
    sessions.sort();
    Ok(sessions)
}

pub fn read_session_file(session_id: &str, filename: &str) -> Result<String, String> {
    let path = session_path(session_id, filename)?;
    fs::read_to_string(&path).map_err(|error| format!("could not read {}: {error}", path.display()))
}

/// Require `model.json` for the session. Missing file → hard error (Jack §3).
pub fn require_model_json(session_id: &str) -> Result<String, String> {
    read_session_file(session_id, "model.json").map_err(|error| {
        format!("session '{session_id}' has no valid model.json ({error}); attach refused")
    })
}

/// Write a session file via temp + rename so readers never see a partial file.
pub fn write_session(session_id: &str, filename: &str, content: &str) -> Result<(), String> {
    let path = session_path(session_id, filename)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension(format!(
        "{}.tmp.{}",
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("json"),
        std::process::id()
    ));
    {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("could not create temp {}: {error}", temporary.display()))?;
        file.write_all(content.as_bytes())
            .map_err(|error| format!("could not write temp {}: {error}", temporary.display()))?;
        file.sync_all()
            .map_err(|error| format!("could not flush temp {}: {error}", temporary.display()))?;
    }
    fs::rename(&temporary, &path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("could not replace {}: {error}", path.display())
    })
}

pub fn sessions_list_json() -> Value {
    match list_sessions() {
        Ok(sessions) => json!({
            // Honest label: directories on disk, not a live UI co-link.
            "session_mode": "read_only_snapshot",
            "sessions": sessions,
            "session_dir": session_dir().display().to_string(),
        }),
        Err(error) => json!({
            "session_mode": "read_only_snapshot",
            "sessions": [],
            "session_dir": session_dir().display().to_string(),
            "error": error,
        }),
    }
}

fn session_path(session_id: &str, filename: &str) -> Result<PathBuf, String> {
    if session_id.is_empty()
        || session_id.contains('/')
        || session_id.contains('\\')
        || session_id.contains("..")
    {
        return Err("invalid session_id".to_string());
    }
    if filename.is_empty()
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
    {
        return Err("invalid filename".to_string());
    }
    Ok(session_dir().join(session_id).join(filename))
}

/// Serialize tests that mutate `NBCAD_SESSION_DIR`.
#[cfg(test)]
pub static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_snapshot_roundtrip_and_skips_control_dirs() {
        let _guard = ENV_LOCK.lock().unwrap();
        let unique = format!("test-session-{}", now_ms());
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-test-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        write_session(&unique, "model.json", "{\"version\":1}").unwrap();
        fs::create_dir_all(dir.join("_ui")).unwrap();
        let listed = list_sessions().unwrap();
        assert!(listed.iter().any(|session| session == &unique));
        assert!(!listed.iter().any(|session| session == "_ui"));
        let body = require_model_json(&unique).unwrap();
        assert!(body.contains("\"version\":1"));
        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(dir.join(&unique));
        let _ = fs::remove_dir_all(dir);
    }
}
