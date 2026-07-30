//! Desktop → disk snapshot publisher for MCP `cad_attach`.
//!
//! Writes `<NBCAD_SESSION_DIR>/<uuid>/{model.json,focus.json,heartbeat.json}`
//! with atomic temp+rename and a generation guard so stale async publishes
//! cannot overwrite newer snapshots. MCP never writebacks here.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::json;

static PUBLISH_LOCK: Mutex<()> = Mutex::new(());
static LAST_APPLIED_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Deserialize)]
struct PublishPayload {
    session_id: String,
    focus: String,
    model_json: String,
    #[serde(default)]
    generation: u64,
}

#[derive(Debug, Deserialize)]
struct HeartbeatPayload {
    session_id: String,
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

fn is_valid_session_id(session_id: &str) -> bool {
    let bytes = session_id.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (index, byte) in bytes.iter().enumerate() {
        match index {
            8 | 13 | 18 | 23 => {
                if *byte != b'-' {
                    return false;
                }
            }
            14 => {
                if *byte != b'4' {
                    return false;
                }
            }
            19 => {
                let lower = byte.to_ascii_lowercase();
                if !matches!(lower, b'8' | b'9' | b'a' | b'b') {
                    return false;
                }
            }
            _ => {
                if !byte.is_ascii_hexdigit() {
                    return false;
                }
            }
        }
    }
    true
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

/// Publish a read-only snapshot for MCP attach.
///
/// Payload JSON: `{ session_id, focus, model_json, generation }`.
#[tauri::command]
pub fn mcp_session_bridge_write(payload: String) -> Result<serde_json::Value, String> {
    let parsed: PublishPayload = serde_json::from_str(&payload)
        .map_err(|error| format!("invalid session payload: {error}"))?;
    if !is_valid_session_id(&parsed.session_id) {
        return Err(format!(
            "session_id must be a UUID v4 string (got '{}')",
            parsed.session_id
        ));
    }

    let _guard = PUBLISH_LOCK
        .lock()
        .map_err(|_| "session publish lock poisoned".to_string())?;
    let last = LAST_APPLIED_GENERATION.load(Ordering::SeqCst);
    if parsed.generation < last {
        return Ok(json!({
            "skipped": true,
            "reason": "stale_generation",
            "generation": parsed.generation,
            "last_applied_generation": last,
            "session_mode": "read_only_snapshot",
        }));
    }

    let dir = session_root().join(&parsed.session_id);
    fs::create_dir_all(&dir).map_err(|error| format!("create session dir: {error}"))?;

    let focus_body = serde_json::to_string_pretty(&json!({
        "focus": parsed.focus,
        "session_id": parsed.session_id,
        "updated_ms": now_ms(),
        "generation": parsed.generation,
        "session_mode": "read_only_snapshot",
    }))
    .map_err(|error| format!("encode focus.json: {error}"))?;

    let heartbeat_body = serde_json::to_string_pretty(&json!({
        "updated_ms": now_ms(),
        "generation": parsed.generation,
        "session_id": parsed.session_id,
        "session_mode": "read_only_snapshot",
    }))
    .map_err(|error| format!("encode heartbeat.json: {error}"))?;

    atomic_write(&dir.join("model.json"), &parsed.model_json)?;
    atomic_write(&dir.join("focus.json"), &focus_body)?;
    atomic_write(&dir.join("heartbeat.json"), &heartbeat_body)?;

    LAST_APPLIED_GENERATION.store(parsed.generation, Ordering::SeqCst);

    Ok(json!({
        "skipped": false,
        "session_id": parsed.session_id,
        "session_dir": dir.display().to_string(),
        "generation": parsed.generation,
        "session_mode": "read_only_snapshot",
        "writeback": false,
    }))
}

/// Refresh `heartbeat.json` only — no model export / generation bump.
///
/// Keeps MCP `stale` false without racing heavy full publishes.
#[tauri::command]
pub fn mcp_session_bridge_heartbeat(payload: String) -> Result<serde_json::Value, String> {
    let parsed: HeartbeatPayload = serde_json::from_str(&payload)
        .map_err(|error| format!("invalid heartbeat payload: {error}"))?;
    if !is_valid_session_id(&parsed.session_id) {
        return Err(format!(
            "session_id must be a UUID v4 string (got '{}')",
            parsed.session_id
        ));
    }

    let _guard = PUBLISH_LOCK
        .lock()
        .map_err(|_| "session publish lock poisoned".to_string())?;
    let generation = LAST_APPLIED_GENERATION.load(Ordering::SeqCst);
    let dir = session_root().join(&parsed.session_id);
    if !dir.is_dir() {
        return Ok(json!({
            "skipped": true,
            "reason": "no_session_dir",
            "session_id": parsed.session_id,
            "session_mode": "read_only_snapshot",
        }));
    }

    let heartbeat_body = serde_json::to_string_pretty(&json!({
        "updated_ms": now_ms(),
        "generation": generation,
        "session_id": parsed.session_id,
        "session_mode": "read_only_snapshot",
        "kind": "heartbeat",
    }))
    .map_err(|error| format!("encode heartbeat.json: {error}"))?;
    atomic_write(&dir.join("heartbeat.json"), &heartbeat_body)?;

    Ok(json!({
        "skipped": false,
        "session_id": parsed.session_id,
        "generation": generation,
        "session_mode": "read_only_snapshot",
        "writeback": false,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serialize bridge tests — they share process-global generation state.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn reset_generation(value: u64) {
        let _guard = PUBLISH_LOCK.lock().unwrap();
        LAST_APPLIED_GENERATION.store(value, Ordering::SeqCst);
    }

    #[test]
    fn stale_generation_is_skipped() {
        let _test = TEST_LOCK.lock().unwrap();
        reset_generation(5);

        let session_id = "123e4567-e89b-42d3-a456-426614174000";
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-test-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let payload = json!({
            "session_id": session_id,
            "focus": "solid",
            "model_json": "{\"version\":1}",
            "generation": 3,
        })
        .to_string();
        let result = mcp_session_bridge_write(payload).unwrap();
        assert_eq!(result["skipped"], true);
        assert_eq!(result["reason"], "stale_generation");
        assert!(!dir.join(session_id).join("model.json").exists());
        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
        reset_generation(0);
    }

    #[test]
    fn publish_writes_uuid_layout() {
        let _test = TEST_LOCK.lock().unwrap();
        reset_generation(0);

        let session_id = "123e4567-e89b-42d3-a456-426614174099";
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-ok-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let payload = json!({
            "session_id": session_id,
            "focus": "print",
            "model_json": "{\"version\":1,\"bodies\":[]}",
            "generation": 1,
        })
        .to_string();
        let result = mcp_session_bridge_write(payload).unwrap();
        assert_eq!(result["skipped"], false);
        let session_dir = dir.join(session_id);
        assert!(session_dir.join("model.json").is_file());
        assert!(session_dir.join("focus.json").is_file());
        assert!(session_dir.join("heartbeat.json").is_file());
        let focus = fs::read_to_string(session_dir.join("focus.json")).unwrap();
        assert!(focus.contains("\"focus\": \"print\"") || focus.contains("\"focus\":\"print\""));
        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
        reset_generation(0);
    }

    #[test]
    fn heartbeat_updates_without_touching_model() {
        let _test = TEST_LOCK.lock().unwrap();
        reset_generation(0);

        let session_id = "123e4567-e89b-42d3-a456-426614174088";
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-hb-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let write = mcp_session_bridge_write(
            json!({
                "session_id": session_id,
                "focus": "solid",
                "model_json": "{\"version\":1,\"marker\":\"original\"}",
                "generation": 2,
            })
            .to_string(),
        )
        .unwrap();
        assert_eq!(write["skipped"], false);

        let before = fs::read_to_string(dir.join(session_id).join("model.json")).unwrap();
        let result = mcp_session_bridge_heartbeat(
            json!({ "session_id": session_id }).to_string(),
        )
        .unwrap();
        assert_eq!(result["skipped"], false);
        assert_eq!(result["generation"], 2);
        let after = fs::read_to_string(dir.join(session_id).join("model.json")).unwrap();
        assert_eq!(before, after);
        let beat = fs::read_to_string(dir.join(session_id).join("heartbeat.json")).unwrap();
        assert!(beat.contains("\"kind\": \"heartbeat\"") || beat.contains("\"kind\":\"heartbeat\""));

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
        reset_generation(0);
    }
}
