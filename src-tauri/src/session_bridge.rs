//! Desktop → disk snapshot publisher for MCP `cad_attach`.
//!
//! Writes `<NBCAD_SESSION_DIR>/<uuid>/{model.json,focus.json,heartbeat.json}`
//! with atomic temp+rename. Tauri owns one session UUID per desktop window and
//! reserves generations before async exports so stale publishes cannot
//! overwrite newer snapshots, including across WebView reloads.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

#[derive(Debug)]
struct WindowPublisher {
    session_id: String,
    next_generation: u64,
    last_applied_generation: u64,
}

impl WindowPublisher {
    fn new() -> Self {
        Self {
            session_id: Uuid::new_v4().to_string(),
            next_generation: 0,
            last_applied_generation: 0,
        }
    }
}

/// Process-lifetime bridge state. Tauri keeps this alive across WebView reloads.
#[derive(Debug, Default)]
pub struct SessionBridgeState {
    publishers: Mutex<HashMap<String, WindowPublisher>>,
}

#[derive(Debug, Deserialize)]
struct PublishPayload {
    focus: String,
    model_json: String,
    generation: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn session_root() -> PathBuf {
    std::env::var_os("NBCAD_SESSION_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("nbcad-sessions"))
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "session path has no file name".to_string())?;
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let temporary = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("could not create temp {}: {error}", temporary.display()))?;
        file.write_all(content.as_bytes())
            .map_err(|error| format!("could not write temp {}: {error}", temporary.display()))?;
        file.sync_all()
            .map_err(|error| format!("could not flush temp {}: {error}", temporary.display()))?;
        fs::rename(&temporary, path)
            .map_err(|error| format!("could not replace {}: {error}", path.display()))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

impl SessionBridgeState {
    fn reserve_for_window(&self, window_label: &str) -> Result<serde_json::Value, String> {
        let mut publishers = self
            .publishers
            .lock()
            .map_err(|_| "session publisher lock poisoned".to_string())?;
        let publisher = publishers
            .entry(window_label.to_string())
            .or_insert_with(WindowPublisher::new);
        publisher.next_generation = publisher
            .next_generation
            .checked_add(1)
            .ok_or_else(|| "session generation exhausted".to_string())?;
        Ok(json!({
            "session_id": publisher.session_id,
            "generation": publisher.next_generation,
            "session_mode": "read_only_snapshot",
        }))
    }

    fn write_for_window(
        &self,
        window_label: &str,
        parsed: PublishPayload,
    ) -> Result<serde_json::Value, String> {
        let mut publishers = self
            .publishers
            .lock()
            .map_err(|_| "session publisher lock poisoned".to_string())?;
        let publisher = publishers
            .get_mut(window_label)
            .ok_or_else(|| "session publish requires a reserved generation".to_string())?;
        if parsed.generation == 0 || parsed.generation > publisher.next_generation {
            return Err(format!(
                "session generation {} was not reserved",
                parsed.generation
            ));
        }
        if parsed.generation <= publisher.last_applied_generation {
            return Ok(json!({
                "skipped": true,
                "reason": "stale_generation",
                "session_id": publisher.session_id,
                "generation": parsed.generation,
                "last_applied_generation": publisher.last_applied_generation,
                "session_mode": "read_only_snapshot",
            }));
        }

        let dir = session_root().join(&publisher.session_id);
        fs::create_dir_all(&dir).map_err(|error| format!("create session dir: {error}"))?;

        let focus_body = serde_json::to_string_pretty(&json!({
            "focus": parsed.focus,
            "session_id": publisher.session_id,
            "updated_ms": now_ms(),
            "generation": parsed.generation,
            "session_mode": "read_only_snapshot",
        }))
        .map_err(|error| format!("encode focus.json: {error}"))?;

        let heartbeat_body = serde_json::to_string_pretty(&json!({
            "updated_ms": now_ms(),
            "generation": parsed.generation,
            "session_id": publisher.session_id,
            "session_mode": "read_only_snapshot",
        }))
        .map_err(|error| format!("encode heartbeat.json: {error}"))?;

        atomic_write(&dir.join("model.json"), &parsed.model_json)?;
        atomic_write(&dir.join("focus.json"), &focus_body)?;
        atomic_write(&dir.join("heartbeat.json"), &heartbeat_body)?;

        publisher.last_applied_generation = parsed.generation;

        Ok(json!({
            "skipped": false,
            "session_id": publisher.session_id,
            "session_dir": dir.display().to_string(),
            "generation": parsed.generation,
            "session_mode": "read_only_snapshot",
            "writeback": false,
        }))
    }

    fn heartbeat_for_window(&self, window_label: &str) -> Result<serde_json::Value, String> {
        let publishers = self
            .publishers
            .lock()
            .map_err(|_| "session publisher lock poisoned".to_string())?;
        let Some(publisher) = publishers.get(window_label) else {
            return Ok(json!({
                "skipped": true,
                "reason": "no_window_session",
                "session_mode": "read_only_snapshot",
            }));
        };

        let dir = session_root().join(&publisher.session_id);
        if !dir.is_dir() {
            return Ok(json!({
                "skipped": true,
                "reason": "no_session_dir",
                "session_id": publisher.session_id,
                "session_mode": "read_only_snapshot",
            }));
        }

        let heartbeat_body = serde_json::to_string_pretty(&json!({
            "updated_ms": now_ms(),
            "generation": publisher.last_applied_generation,
            "session_id": publisher.session_id,
            "session_mode": "read_only_snapshot",
            "kind": "heartbeat",
        }))
        .map_err(|error| format!("encode heartbeat.json: {error}"))?;
        atomic_write(&dir.join("heartbeat.json"), &heartbeat_body)?;

        Ok(json!({
            "skipped": false,
            "session_id": publisher.session_id,
            "generation": publisher.last_applied_generation,
            "session_mode": "read_only_snapshot",
            "writeback": false,
        }))
    }
}

/// Reserve a monotonic generation before the frontend starts an async export.
#[tauri::command]
pub fn mcp_session_bridge_reserve(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SessionBridgeState>,
) -> Result<serde_json::Value, String> {
    state.reserve_for_window(window.label())
}

/// Publish a read-only snapshot for MCP attach.
///
/// Payload JSON: `{ focus, model_json, generation }`.
#[tauri::command]
pub fn mcp_session_bridge_write(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SessionBridgeState>,
    payload: String,
) -> Result<serde_json::Value, String> {
    let parsed: PublishPayload = serde_json::from_str(&payload)
        .map_err(|error| format!("invalid session payload: {error}"))?;
    state.write_for_window(window.label(), parsed)
}

/// Refresh `heartbeat.json` only — no model export / generation bump.
#[tauri::command]
pub fn mcp_session_bridge_heartbeat(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SessionBridgeState>,
) -> Result<serde_json::Value, String> {
    state.heartbeat_for_window(window.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serialize bridge tests because they share `NBCAD_SESSION_DIR`.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn reserve(state: &SessionBridgeState, window_label: &str) -> (String, u64) {
        let result = state.reserve_for_window(window_label).unwrap();
        (
            result["session_id"].as_str().unwrap().to_string(),
            result["generation"].as_u64().unwrap(),
        )
    }

    fn payload(generation: u64, marker: &str) -> PublishPayload {
        PublishPayload {
            focus: "solid".to_string(),
            model_json: format!(r#"{{"version":1,"marker":"{marker}"}}"#),
            generation,
        }
    }

    #[test]
    fn older_reserved_publish_cannot_overwrite_newer_snapshot() {
        let _test = TEST_LOCK.lock().unwrap();
        let state = SessionBridgeState::default();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-test-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);

        let (session_id, older) = reserve(&state, "main");
        let (_, newer) = reserve(&state, "main");
        assert_eq!(older, 1);
        assert_eq!(newer, 2);
        let applied = state
            .write_for_window("main", payload(newer, "newer"))
            .unwrap();
        assert_eq!(applied["skipped"], false);
        let stale = state
            .write_for_window("main", payload(older, "older"))
            .unwrap();
        assert_eq!(stale["skipped"], true);
        assert_eq!(stale["reason"], "stale_generation");
        let model = fs::read_to_string(dir.join(session_id).join("model.json")).unwrap();
        assert!(model.contains("\"marker\":\"newer\""));

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn webview_reload_continues_backend_generation() {
        let _test = TEST_LOCK.lock().unwrap();
        let state = SessionBridgeState::default();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-reload-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);

        let (session_id, first) = reserve(&state, "main");
        state
            .write_for_window("main", payload(first, "before-reload"))
            .unwrap();
        // A reloaded WebView asks Tauri for its next ticket instead of resetting locally.
        let (same_session_id, after_reload) = reserve(&state, "main");
        assert_eq!(same_session_id, session_id);
        assert_eq!(after_reload, first + 1);
        let applied = state
            .write_for_window("main", payload(after_reload, "after-reload"))
            .unwrap();
        assert_eq!(applied["skipped"], false);
        let model = fs::read_to_string(dir.join(session_id).join("model.json")).unwrap();
        assert!(model.contains("\"marker\":\"after-reload\""));

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn windows_have_independent_sessions_and_generations() {
        let _test = TEST_LOCK.lock().unwrap();
        let state = SessionBridgeState::default();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-windows-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);

        let (main_session, main_generation) = reserve(&state, "main");
        let (second_session, second_generation) = reserve(&state, "secondary");
        assert_ne!(main_session, second_session);
        assert_eq!(main_generation, 1);
        assert_eq!(second_generation, 1);
        assert_eq!(main_session.as_bytes()[14], b'4');
        assert_eq!(second_session.as_bytes()[14], b'4');

        state
            .write_for_window("main", payload(main_generation, "main"))
            .unwrap();
        state
            .write_for_window("secondary", payload(second_generation, "secondary"))
            .unwrap();
        let main_model = fs::read_to_string(dir.join(main_session).join("model.json")).unwrap();
        let second_model = fs::read_to_string(dir.join(second_session).join("model.json")).unwrap();
        assert!(main_model.contains("\"marker\":\"main\""));
        assert!(second_model.contains("\"marker\":\"secondary\""));

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn heartbeat_updates_without_touching_model() {
        let _test = TEST_LOCK.lock().unwrap();
        let state = SessionBridgeState::default();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-hb-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);

        let (session_id, generation) = reserve(&state, "main");
        state
            .write_for_window("main", payload(generation, "original"))
            .unwrap();
        let before = fs::read_to_string(dir.join(&session_id).join("model.json")).unwrap();
        let result = state.heartbeat_for_window("main").unwrap();
        assert_eq!(result["skipped"], false);
        assert_eq!(result["generation"], generation);
        let after = fs::read_to_string(dir.join(&session_id).join("model.json")).unwrap();
        assert_eq!(before, after);
        let beat = fs::read_to_string(dir.join(&session_id).join("heartbeat.json")).unwrap();
        assert!(
            beat.contains("\"kind\": \"heartbeat\"") || beat.contains("\"kind\":\"heartbeat\"")
        );

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }
}
