use std::fs;
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

pub fn list_sessions() -> Result<Vec<String>, String> {
    let root = session_dir();
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut sessions = Vec::new();
    for entry in fs::read_dir(&root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().map_err(|error| error.to_string())?.is_dir() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == "_ui" {
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

pub fn write_session(session_id: &str, filename: &str, content: &str) -> Result<(), String> {
    let path = session_path(session_id, filename)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&path, content).map_err(|error| format!("could not write {}: {error}", path.display()))
}

pub fn sessions_list_json() -> Value {
    match list_sessions() {
        Ok(sessions) => json!({
            "co_link": "session_dir_headless",
            "sessions": sessions,
            "session_dir": session_dir().display().to_string(),
        }),
        Err(error) => json!({
            "co_link": "session_dir_headless",
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
    fn session_file_bridge_roundtrip() {
        let _guard = ENV_LOCK.lock().unwrap();
        let unique = format!("test-session-{}", now_ms());
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-test-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        write_session(&unique, "model.json", "{\"version\":1}").unwrap();
        let listed = list_sessions().unwrap();
        assert!(listed.iter().any(|session| session == &unique));
        let body = read_session_file(&unique, "model.json").unwrap();
        assert!(body.contains("\"version\":1"));
        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(dir.join(&unique));
        let _ = fs::remove_dir_all(dir);
    }
}
