//! Desktop → disk snapshot publisher and UI-owned inbox apply for MCP.
//!
//! Writes `<NBCAD_SESSION_DIR>/<uuid>/{model.json,active-sketch.json?,focus.json,heartbeat.json}`
//! with atomic temp+rename. MCP `cad_submit` drops `inbox/<seq>.json`; this
//! module applies those ops on the live SketchManager (shared
//! `nbcad_mcp_mutate` name→engine-method map + solid replay) and then the
//! existing TS publisher emits a new snapshot. MCP never writes model.json
//! (no last-writer-wins).
//!
//! # Authoritative engine revision (Jack #60 blocker 2)
//!
//! `WindowPublisher.engine_revision` is the sole OCC gate for inbox apply.
//! It is advanced atomically with the live engine mutation under the
//! publisher lock:
//! - UI local edits call `note_mutation_for_window` immediately (no 300 ms
//!   debounce) so a stale-base op cannot slip in before heartbeat publish.
//! - Successful inbox apply requires `base_generation == engine_revision`,
//!   applies on the live engine, then `engine_revision += 1` and writes
//!   heartbeat.json. Two same-base ops therefore cannot both apply.
//! - Debounced snapshot publish may only raise `engine_revision` to the
//!   published generation (never regress it). Heartbeat-only refreshes do
//!   not bump the counter.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use nbcad_mcp_mutate::ExecutionKind;

use crate::state::AppState;

#[derive(Debug)]
struct WindowPublisher {
    session_id: String,
    next_generation: u64,
    last_applied_generation: u64,
    /// Authoritative live-engine revision for inbox OCC (see module docs).
    engine_revision: u64,
}

impl WindowPublisher {
    fn new() -> Self {
        Self {
            session_id: Uuid::new_v4().to_string(),
            next_generation: 0,
            last_applied_generation: 0,
            engine_revision: 0,
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
    /// Project export is unavailable while a sketch transaction is active.
    /// In that state retain the last completed model.json and still publish
    /// the live sketch snapshot below.
    #[serde(default)]
    model_json: Option<String>,
    /// The normal project export intentionally refuses an active sketch.
    /// Carry its live read-only DTO beside model.json so diagnostics can see
    /// exactly what the user is editing without making the project format
    /// accept half-finished history state.
    #[serde(default)]
    active_sketch_json: Option<String>,
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

        if let Some(model_json) = parsed.model_json.as_deref() {
            atomic_write(&dir.join("model.json"), model_json)?;
        }
        let active_sketch_path = dir.join("active-sketch.json");
        if let Some(active_sketch_json) = parsed.active_sketch_json.as_deref() {
            atomic_write(&active_sketch_path, active_sketch_json)?;
        } else if active_sketch_path.exists() {
            fs::remove_file(&active_sketch_path)
                .map_err(|error| format!("remove stale active-sketch.json: {error}"))?;
        }
        atomic_write(&dir.join("focus.json"), &focus_body)?;
        atomic_write(&dir.join("heartbeat.json"), &heartbeat_body)?;

        publisher.last_applied_generation = parsed.generation;
        if parsed.generation > publisher.engine_revision {
            publisher.engine_revision = parsed.generation;
        }

        Ok(json!({
            "skipped": false,
            "session_id": publisher.session_id,
            "session_dir": dir.display().to_string(),
            "generation": parsed.generation,
            "engine_revision": publisher.engine_revision,
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
            "generation": publisher.engine_revision,
            "session_id": publisher.session_id,
            "session_mode": "read_only_snapshot",
            "kind": "heartbeat",
        }))
        .map_err(|error| format!("encode heartbeat.json: {error}"))?;
        atomic_write(&dir.join("heartbeat.json"), &heartbeat_body)?;

        Ok(json!({
            "skipped": false,
            "session_id": publisher.session_id,
            "generation": publisher.engine_revision,
            "engine_revision": publisher.engine_revision,
            "session_mode": "read_only_snapshot",
            "writeback": false,
        }))
    }
}

fn inbox_dir(session_id: &str) -> PathBuf {
    session_root().join(session_id).join("inbox")
}

fn parse_inbox_seq(name: &str) -> Option<u64> {
    name.strip_suffix(".json")?.parse().ok()
}

fn pending_inbox_seqs(session_id: &str) -> Vec<u64> {
    let mut seqs = Vec::new();
    let Ok(entries) = fs::read_dir(inbox_dir(session_id)) else {
        return seqs;
    };
    for entry in entries.flatten() {
        if !entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false)
        {
            continue;
        }
        if let Some(seq) = parse_inbox_seq(&entry.file_name().to_string_lossy()) {
            seqs.push(seq);
        }
    }
    seqs.sort_unstable();
    seqs
}

fn read_session_generation(session_id: &str) -> Option<u64> {
    let body = fs::read_to_string(session_root().join(session_id).join("heartbeat.json")).ok()?;
    let parsed: Value = serde_json::from_str(&body).ok()?;
    parsed.get("generation").and_then(Value::as_u64)
}

fn generation_conflict(session_id: &str, base: u64, current: Option<u64>) -> String {
    serde_json::to_string(&json!({
        "code": "generation_conflict",
        "writeback": false,
        "session_mode": "ui_owned_apply",
        "session_id": session_id,
        "base_generation": base,
        "current_generation": current,
        "hint": "UI moved; cad_refresh then resubmit with the new heartbeat generation",
    }))
    .unwrap_or_else(|_| "generation_conflict".to_string())
}

fn parse_engine_envelope(raw: String) -> Result<Value, String> {
    let envelope: Value =
        serde_json::from_str(&raw).map_err(|error| format!("invalid engine response: {error}"))?;
    if envelope.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(envelope.get("value").cloned().unwrap_or(Value::Null))
    } else {
        Err(envelope
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("unknown noBS CAD engine error")
            .to_string())
    }
}

fn write_engine_revision_heartbeat(publisher: &WindowPublisher) -> Result<(), String> {
    let dir = session_root().join(&publisher.session_id);
    fs::create_dir_all(&dir).map_err(|error| format!("create session dir: {error}"))?;
    let heartbeat_body = serde_json::to_string_pretty(&json!({
        "updated_ms": now_ms(),
        "generation": publisher.engine_revision,
        "session_id": publisher.session_id,
        "session_mode": "ui_owned_apply",
        "kind": "engine_revision",
    }))
    .map_err(|error| format!("encode heartbeat.json: {error}"))?;
    atomic_write(&dir.join("heartbeat.json"), &heartbeat_body)
}

/// Dispatch an MCP mutate onto the live desktop engine using the shared map.
fn dispatch_inbox_on_engine(
    engine: &AppState,
    name: &str,
    arguments: &Value,
) -> Result<Value, String> {
    let spec = nbcad_mcp_mutate::lookup_mutate(name)
        .ok_or_else(|| format!("unsupported inbox mutate '{name}'"))?;
    let encoded = nbcad_mcp_mutate::encode_payload(spec.payload, arguments)?;
    let solid = matches!(spec.execution, ExecutionKind::SolidReplay);
    parse_engine_envelope(engine.apply_encoded_mutate(spec.engine_method, &encoded, solid))
}

fn archive_inbox_op(session_id: &str, seq: u64) -> Result<(), String> {
    let src = inbox_dir(session_id).join(format!("{seq}.json"));
    let dest_dir = inbox_dir(session_id).join("applied");
    fs::create_dir_all(&dest_dir).map_err(|error| error.to_string())?;
    let dest = dest_dir.join(format!("{seq}.json"));
    if fs::rename(&src, &dest).is_err() {
        let body = fs::read_to_string(&src).map_err(|error| error.to_string())?;
        atomic_write(&dest, &body)?;
        fs::remove_file(&src).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Move a failed op out of the pending queue so later ops are not wedged.
fn dead_letter_inbox_op(session_id: &str, seq: u64, error: &str) -> Result<(), String> {
    let src = inbox_dir(session_id).join(format!("{seq}.json"));
    let dest_dir = inbox_dir(session_id).join("failed");
    fs::create_dir_all(&dest_dir).map_err(|error| error.to_string())?;
    let original = fs::read_to_string(&src).map_err(|error| error.to_string())?;
    let mut parsed: Value = serde_json::from_str(&original)
        .map_err(|error| format!("invalid inbox/{seq}.json: {error}"))?;
    if let Some(object) = parsed.as_object_mut() {
        object.insert("error".to_string(), Value::String(error.to_string()));
        object.insert("failed_ms".to_string(), json!(now_ms()));
    }
    let body = serde_json::to_string_pretty(&parsed).map_err(|error| error.to_string())?;
    let dest = dest_dir.join(format!("{seq}.json"));
    atomic_write(&dest, &body)?;
    fs::remove_file(&src).map_err(|error| error.to_string())?;
    Ok(())
}

impl SessionBridgeState {
    fn session_id_for_window(&self, window_label: &str) -> Result<Option<String>, String> {
        let publishers = self
            .publishers
            .lock()
            .map_err(|_| "session publisher lock poisoned".to_string())?;
        Ok(publishers
            .get(window_label)
            .map(|publisher| publisher.session_id.clone()))
    }

    /// Advance the authoritative engine revision immediately on a local UI
    /// mutation (before the debounced snapshot publish).
    fn note_mutation_for_window(&self, window_label: &str) -> Result<Value, String> {
        let mut publishers = self
            .publishers
            .lock()
            .map_err(|_| "session publisher lock poisoned".to_string())?;
        let publisher = publishers
            .entry(window_label.to_string())
            .or_insert_with(WindowPublisher::new);
        publisher.engine_revision = publisher
            .engine_revision
            .checked_add(1)
            .ok_or_else(|| "session engine revision exhausted".to_string())?;
        if publisher.engine_revision > publisher.next_generation {
            publisher.next_generation = publisher.engine_revision;
        }
        write_engine_revision_heartbeat(publisher)?;
        Ok(json!({
            "session_id": publisher.session_id,
            "engine_revision": publisher.engine_revision,
            "generation": publisher.engine_revision,
            "session_mode": "ui_owned_apply",
            "writeback": false,
        }))
    }

    fn engine_revision_for_window(&self, window_label: &str) -> Result<Option<u64>, String> {
        let publishers = self
            .publishers
            .lock()
            .map_err(|_| "session publisher lock poisoned".to_string())?;
        Ok(publishers
            .get(window_label)
            .map(|publisher| publisher.engine_revision))
    }
}

/// Apply one pending inbox op under the publisher lock so revision check,
/// live engine apply, and revision advance are atomic w.r.t. other applies
/// and UI mutation notes.
fn apply_one_inbox_op(
    state: &SessionBridgeState,
    window_label: &str,
    engine: &AppState,
) -> Result<Value, String> {
    let mut publishers = state
        .publishers
        .lock()
        .map_err(|_| "session publisher lock poisoned".to_string())?;
    let Some(publisher) = publishers.get_mut(window_label) else {
        return Ok(json!({
            "applied": false,
            "reason": "no_window_session",
            "session_mode": "ui_owned_apply",
            "writeback": false,
        }));
    };
    let session_id = publisher.session_id.clone();
    let seqs = pending_inbox_seqs(&session_id);
    let Some(seq) = seqs.first().copied() else {
        return Ok(json!({
            "applied": false,
            "reason": "empty",
            "session_id": session_id,
            "session_mode": "ui_owned_apply",
            "writeback": false,
            "pending": 0,
            "engine_revision": publisher.engine_revision,
        }));
    };
    let path = inbox_dir(&session_id).join(format!("{seq}.json"));
    let body =
        fs::read_to_string(&path).map_err(|error| format!("read inbox/{seq}.json: {error}"))?;
    let parsed: Value = serde_json::from_str(&body)
        .map_err(|error| format!("invalid inbox/{seq}.json: {error}"))?;
    let name = parsed
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "inbox op missing name".to_string())?
        .to_string();
    let arguments = parsed.get("arguments").cloned().unwrap_or(json!({}));
    let base_generation = parsed
        .get("base_generation")
        .and_then(Value::as_u64)
        .ok_or_else(|| "inbox op missing base_generation".to_string())?;
    let current = publisher.engine_revision;
    if current != base_generation {
        return Err(generation_conflict(
            &session_id,
            base_generation,
            Some(current),
        ));
    }
    if nbcad_mcp_mutate::lookup_mutate(&name).is_none() {
        let error = format!("unsupported inbox mutate '{name}'");
        dead_letter_inbox_op(&session_id, seq, &error)?;
        return Ok(json!({
            "applied": false,
            "dead_lettered": true,
            "seq": seq,
            "name": name,
            "error": error,
            "session_id": session_id,
            "session_mode": "ui_owned_apply",
            "writeback": false,
            "pending": pending_inbox_seqs(&session_id).len(),
            "engine_revision": publisher.engine_revision,
        }));
    }
    match dispatch_inbox_on_engine(engine, &name, &arguments) {
        Ok(result) => {
            publisher.engine_revision = publisher
                .engine_revision
                .checked_add(1)
                .ok_or_else(|| "session engine revision exhausted".to_string())?;
            if publisher.engine_revision > publisher.next_generation {
                publisher.next_generation = publisher.engine_revision;
            }
            write_engine_revision_heartbeat(publisher)?;
            archive_inbox_op(&session_id, seq)?;
            Ok(json!({
                "applied": true,
                "seq": seq,
                "name": name,
                "result": result,
                "session_id": session_id,
                "session_mode": "ui_owned_apply",
                "writeback": false,
                "pending": pending_inbox_seqs(&session_id).len(),
                "engine_revision": publisher.engine_revision,
            }))
        }
        Err(error) => {
            dead_letter_inbox_op(&session_id, seq, &error)?;
            Ok(json!({
                "applied": false,
                "dead_lettered": true,
                "seq": seq,
                "name": name,
                "error": error,
                "session_id": session_id,
                "session_mode": "ui_owned_apply",
                "writeback": false,
                "pending": pending_inbox_seqs(&session_id).len(),
                "engine_revision": publisher.engine_revision,
            }))
        }
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
/// Payload JSON: `{ focus, model_json?, active_sketch_json?, generation }`.
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

/// Advance authoritative engine revision on a local UI mutation (no debounce).
#[tauri::command]
pub fn mcp_session_bridge_note_mutation(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SessionBridgeState>,
) -> Result<serde_json::Value, String> {
    state.note_mutation_for_window(window.label())
}

/// Apply one pending MCP inbox op on the live engine (UI-owned write).
///
/// Called from the session-bridge TS poll. After a successful apply the
/// frontend store updates and the existing publisher writes a new snapshot.
/// MCP `cad_refresh` then sees the same body. Never writes model.json here.
#[tauri::command]
pub fn mcp_session_bridge_apply_inbox(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SessionBridgeState>,
    engine: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    apply_one_inbox_op(&state, window.label(), &engine)
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
            model_json: Some(format!(r#"{{"version":1,"marker":"{marker}"}}"#)),
            active_sketch_json: None,
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

    #[test]
    fn active_sketch_snapshot_is_published_and_removed_when_editing_ends() {
        let _test = TEST_LOCK.lock().unwrap();
        let state = SessionBridgeState::default();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-sketch-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);

        let (session_id, first) = reserve(&state, "main");
        let mut editing = payload(first, "editing");
        editing.model_json = None;
        editing.active_sketch_json = Some(r#"{"name":"Sketch1","entities":[]}"#.to_string());
        state.write_for_window("main", editing).unwrap();
        let sketch_path = dir.join(&session_id).join("active-sketch.json");
        assert!(fs::read_to_string(&sketch_path)
            .unwrap()
            .contains("Sketch1"));
        assert!(
            !dir.join(&session_id).join("model.json").exists(),
            "a live sketch must publish even before the first completed project snapshot"
        );

        let (_, second) = reserve(&state, "main");
        state
            .write_for_window("main", payload(second, "finished"))
            .unwrap();
        assert!(!sketch_path.exists());

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    fn write_inbox(session_id: &str, seq: u64, name: &str, base: u64, arguments: Value) {
        let inbox = session_root().join(session_id).join("inbox");
        fs::create_dir_all(&inbox).unwrap();
        let body = serde_json::to_string_pretty(&json!({
            "name": name,
            "arguments": arguments,
            "base_generation": base,
        }))
        .unwrap();
        fs::write(inbox.join(format!("{seq}.json")), body).unwrap();
    }

    #[test]
    fn inbox_generation_mismatch_is_conflict_and_leaves_op() {
        let _test = TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-inbox-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let state = SessionBridgeState::default();
        let (session_id, generation) = reserve(&state, "main");
        state
            .write_for_window("main", payload(generation, "base"))
            .unwrap();
        write_inbox(
            &session_id,
            1,
            "cad_set_document_name",
            99,
            json!({"name": "Nope"}),
        );
        let engine = AppState::new();
        let err =
            apply_one_inbox_op(&state, "main", &engine).expect_err("stale base must conflict");
        let parsed: Value = serde_json::from_str(&err).unwrap();
        assert_eq!(parsed["code"], "generation_conflict");
        assert_eq!(parsed["writeback"], false);
        assert_eq!(parsed["session_mode"], "ui_owned_apply");
        assert_eq!(pending_inbox_seqs(&session_id), vec![1]);

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ui_mutation_note_rejects_stale_base_before_publish() {
        // Race 1: UI mutates and notes revision immediately; debounced publish
        // has not advanced heartbeat yet in the old design. Authoritative
        // engine_revision must already reject the stale-base inbox op.
        let _test = TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-stale-ui-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let state = SessionBridgeState::default();
        let (session_id, generation) = reserve(&state, "main");
        state
            .write_for_window("main", payload(generation, "base"))
            .unwrap();
        assert_eq!(
            state.engine_revision_for_window("main").unwrap(),
            Some(generation)
        );

        let noted = state.note_mutation_for_window("main").unwrap();
        assert_eq!(noted["engine_revision"], generation + 1);
        assert_eq!(read_session_generation(&session_id), Some(generation + 1));

        write_inbox(
            &session_id,
            1,
            "cad_set_document_name",
            generation, // stale relative to noted UI mutation
            json!({"name": "Stale"}),
        );
        let engine = AppState::new();
        let err = apply_one_inbox_op(&state, "main", &engine).expect_err("stale after UI note");
        let parsed: Value = serde_json::from_str(&err).unwrap();
        assert_eq!(parsed["code"], "generation_conflict");
        assert_eq!(parsed["current_generation"], generation + 1);
        assert_eq!(pending_inbox_seqs(&session_id), vec![1]);

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_same_base_ops_second_conflicts_after_first_advances() {
        // Race 2: two queued ops share the same base_generation. The first
        // apply advances engine_revision atomically; the second must conflict.
        let _test = TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-same-base-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let state = SessionBridgeState::default();
        let (session_id, generation) = reserve(&state, "main");
        state
            .write_for_window("main", payload(generation, "base"))
            .unwrap();
        write_inbox(
            &session_id,
            1,
            "cad_set_document_name",
            generation,
            json!({"name": "First"}),
        );
        write_inbox(
            &session_id,
            2,
            "cad_set_document_name",
            generation,
            json!({"name": "Second"}),
        );
        let engine = AppState::new();
        let first = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(first["applied"], true);
        assert_eq!(first["seq"], 1);
        assert_eq!(first["engine_revision"], generation + 1);
        assert_eq!(pending_inbox_seqs(&session_id), vec![2]);

        let err = apply_one_inbox_op(&state, "main", &engine).expect_err("second same-base");
        let parsed: Value = serde_json::from_str(&err).unwrap();
        assert_eq!(parsed["code"], "generation_conflict");
        assert_eq!(parsed["base_generation"], generation);
        assert_eq!(parsed["current_generation"], generation + 1);
        assert_eq!(pending_inbox_seqs(&session_id), vec![2]);

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn failed_inbox_op_is_dead_lettered_and_unblocks_queue() {
        let _test = TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-dead-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let state = SessionBridgeState::default();
        let (session_id, generation) = reserve(&state, "main");
        state
            .write_for_window("main", payload(generation, "base"))
            .unwrap();
        // Unsupported name should have been rejected at cad_submit, but if it
        // reaches the queue it must dead-letter rather than wedge.
        write_inbox(&session_id, 1, "not_a_real_tool", generation, json!({}));
        write_inbox(
            &session_id,
            2,
            "cad_set_document_name",
            generation,
            json!({"name": "AfterFail"}),
        );
        let engine = AppState::new();
        let dead = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(dead["applied"], false);
        assert_eq!(dead["dead_lettered"], true);
        assert_eq!(dead["seq"], 1);
        assert!(session_root()
            .join(&session_id)
            .join("inbox/failed/1.json")
            .exists());
        assert_eq!(pending_inbox_seqs(&session_id), vec![2]);

        let second = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(second["applied"], true);
        assert_eq!(second["seq"], 2);

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn shared_mutate_map_covers_every_inbox_dispatch() {
        for spec in nbcad_mcp_mutate::mutate_specs() {
            assert!(!spec.name.is_empty());
            assert!(!spec.engine_method.is_empty());
            // Encoding empty/object/field shapes must not panic on {} where optional.
            let _ = nbcad_mcp_mutate::encode_payload(spec.payload, &json!({}));
        }
        let locked = nbcad_mcp_mutate::lookup_mutate("sketch_add_line_locked").unwrap();
        assert_eq!(locked.engine_method, "add_line_locked");
        assert_eq!(locked.execution, ExecutionKind::Direct);
    }

    #[test]
    fn table_driven_accepted_mutates_dispatch_without_name_fallback() {
        // Every shared mutate must resolve to an engine method (no MCP-name
        // fallback). Spot-check a few that previously broke via name passthrough.
        let cases = [
            (
                "sketch_add_line_locked",
                "add_line_locked",
                ExecutionKind::Direct,
            ),
            ("sketch_begin", "begin_sketch", ExecutionKind::Direct),
            (
                "cad_set_document_name",
                "document_set_name",
                ExecutionKind::Direct,
            ),
            (
                "solid_extrude",
                "solid_prepare_extrude",
                ExecutionKind::SolidReplay,
            ),
            (
                "solid_mirror",
                "solid_prepare_body_feature",
                ExecutionKind::SolidReplay,
            ),
            (
                "set_body_appearance",
                "set_body_appearance",
                ExecutionKind::Direct,
            ),
        ];
        for (name, method, execution) in cases {
            let spec = nbcad_mcp_mutate::lookup_mutate(name).expect(name);
            assert_eq!(spec.engine_method, method, "{name}");
            assert_eq!(spec.execution, execution, "{name}");
        }
        assert_eq!(
            nbcad_mcp_mutate::mutate_specs().len(),
            nbcad_mcp_mutate::MUTATES.len()
        );
        // Jack's example: MCP sketch_add_line_locked must not be passed through
        // as the host method name.
        assert_ne!(
            nbcad_mcp_mutate::lookup_mutate("sketch_add_line_locked")
                .unwrap()
                .engine_method,
            "sketch_add_line_locked"
        );
    }
}
