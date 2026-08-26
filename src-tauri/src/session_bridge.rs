//! Desktop → disk snapshot publisher and UI-owned inbox apply for MCP.
//!
//! Writes `<NBCAD_SESSION_DIR>/<uuid>/{model.json,active-sketch.json?,focus.json,heartbeat.json}`
//! with atomic temp+rename. MCP `cad_submit` drops `inbox/<seq>.json`; this
//! module applies those ops on the live SketchManager (shared
//! `nbcad_mcp_mutate` name→engine-method map + solid replay) and then the
//! existing TS publisher emits a new snapshot. MCP never writes model.json
//! (no last-writer-wins).
//!
//! # Authoritative engine revision (Jack #60)
//!
//! Per native project-session `engine_revision` is the sole OCC gate for inbox
//! apply. It is advanced atomically with the live engine mutation under the
//! publisher lock (lock order: publisher → engine):
//! - UI local edits go through `run_ui_mutation`, which holds the publisher
//!   lock across the engine call and bumps `engine_revision` + heartbeat on
//!   success. A later JS `noteEngineRevision` is not the sole advance and
//!   must not double-count (frontend suppresses while applying / omits it).
//! - Successful inbox apply requires `base_generation == engine_revision`,
//!   applies on the live engine, then `engine_revision += 1` and writes
//!   heartbeat.json. Two same-base ops therefore cannot both apply.
//! - Conflicting or malformed head inbox entries are dead-lettered to
//!   `inbox/failed/` so the queue cannot wedge forever.
//! - Debounced snapshot publish may only raise `engine_revision` to the
//!   published generation (never regress it). Heartbeat-only refreshes do
//!   not bump the counter.
//! - `reserve` captures `engine_revision`; `write` rejects the snapshot if
//!   the revision advanced during the JS export window (mutation-between-
//!   export-and-write). Frontend retries with a fresh reserve.
//!
//! # Native project-session identity
//!
//! Each window publisher is bound to the active native project-session id
//! (`AppState` tab identity). Bind/create/activate/drop rebind under the
//! publisher lock. Per-project MCP sessions are retained, so an inbox op
//! queued for tab A is never dispatched onto tab B. Apply also rejects a
//! bound/active mismatch so a bypassed transition cannot retarget the op.
//!
//! # Publish reservation identity
//!
//! `reserve` returns `session_id` + `project_session_id` with the generation.
//! `write` must carry that reserved identity and is resolved against the
//! matching per-project publisher — never `active_mut()` at write time. A
//! delayed write from tab A cannot consume tab B's reservation or publish
//! A's model into B's session. Missing or mismatched identity is rejected.

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

use crate::state::{AppState, BOOTSTRAP_SESSION_ID};

/// Placeholder key used before the window is bound to a native project tab.
const UNBOUND_PROJECT: &str = "__unbound__";

#[derive(Debug)]
struct ProjectPublisher {
    session_id: String,
    next_generation: u64,
    last_applied_generation: u64,
    /// Authoritative live-engine revision for inbox OCC (see module docs).
    engine_revision: u64,
    /// generation → `engine_revision` captured at reserve. Write rejects if
    /// the live revision moved during export.
    pending_exports: HashMap<u64, u64>,
}

impl ProjectPublisher {
    fn new() -> Self {
        Self {
            session_id: Uuid::new_v4().to_string(),
            next_generation: 0,
            last_applied_generation: 0,
            engine_revision: 0,
            pending_exports: HashMap::new(),
        }
    }
}

#[derive(Debug)]
struct WindowPublisher {
    /// Native project-session identity this window currently publishes/applies.
    active_project_session_id: Option<String>,
    /// Retained per-tab MCP publishers (inbox + revision). Switching A→B
    /// rebinds the active pointer; A's session stays isolated.
    by_project: HashMap<String, ProjectPublisher>,
}

impl WindowPublisher {
    fn new() -> Self {
        Self {
            active_project_session_id: None,
            by_project: HashMap::new(),
        }
    }

    fn active_key(&self) -> &str {
        self.active_project_session_id
            .as_deref()
            .unwrap_or(UNBOUND_PROJECT)
    }

    fn active_mut(&mut self) -> &mut ProjectPublisher {
        let key = self.active_key().to_string();
        self.by_project
            .entry(key)
            .or_insert_with(ProjectPublisher::new)
    }

    fn rebind_to(&mut self, project_session_id: &str) {
        if self.active_project_session_id.as_deref() == Some(project_session_id) {
            self.by_project
                .entry(project_session_id.to_string())
                .or_insert_with(ProjectPublisher::new);
            return;
        }
        let previous = self.active_key().to_string();
        // Bootstrap bind *renames* the engine; keep the MCP UUID/revision.
        // Unbound first-publish likewise adopts the first real tab identity.
        if previous == UNBOUND_PROJECT || previous == BOOTSTRAP_SESSION_ID {
            if let Some(existing) = self.by_project.remove(&previous) {
                self.by_project
                    .insert(project_session_id.to_string(), existing);
            }
        }
        self.active_project_session_id = Some(project_session_id.to_string());
        self.by_project
            .entry(project_session_id.to_string())
            .or_insert_with(ProjectPublisher::new);
    }

    fn drop_project(&mut self, project_session_id: &str) {
        self.by_project.remove(project_session_id);
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
    /// MCP session UUID captured at reserve. Required so write cannot target
    /// whichever project is active after a tab switch.
    #[serde(default)]
    session_id: Option<String>,
    /// Native project-session id captured at reserve. When present it must
    /// match the reserved project; write never falls back to the active tab.
    #[serde(default)]
    project_session_id: Option<String>,
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
        self.reserve_for_window_on_project(window_label, None)
    }

    fn reserve_for_window_on_project(
        &self,
        window_label: &str,
        project_session_id: Option<&str>,
    ) -> Result<serde_json::Value, String> {
        let mut publishers = self
            .publishers
            .lock()
            .map_err(|_| "session publisher lock poisoned".to_string())?;
        let publisher = publishers
            .entry(window_label.to_string())
            .or_insert_with(WindowPublisher::new);
        if let Some(project_session_id) = project_session_id {
            publisher.rebind_to(project_session_id);
        }
        let project = publisher.active_mut();
        project.next_generation = project
            .next_generation
            .checked_add(1)
            .ok_or_else(|| "session generation exhausted".to_string())?;
        project
            .pending_exports
            .insert(project.next_generation, project.engine_revision);
        Ok(json!({
            "session_id": project.session_id,
            "generation": project.next_generation,
            "engine_revision": project.engine_revision,
            "project_session_id": publisher.active_project_session_id,
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
        let reserved_session = parsed
            .session_id
            .as_deref()
            .ok_or_else(|| "session write requires reserved session_id".to_string())?;
        let target_key = match parsed.project_session_id.as_deref() {
            Some(project_session_id) => {
                let Some(project) = publisher.by_project.get(project_session_id) else {
                    return Ok(json!({
                        "skipped": true,
                        "reason": "session_identity_mismatch",
                        "session_id": reserved_session,
                        "project_session_id": project_session_id,
                        "generation": parsed.generation,
                        "session_mode": "read_only_snapshot",
                    }));
                };
                if project.session_id != reserved_session {
                    return Ok(json!({
                        "skipped": true,
                        "reason": "session_identity_mismatch",
                        "session_id": reserved_session,
                        "reserved_session_id": project.session_id,
                        "project_session_id": project_session_id,
                        "generation": parsed.generation,
                        "session_mode": "read_only_snapshot",
                    }));
                }
                project_session_id.to_string()
            }
            None => {
                let matches: Vec<String> = publisher
                    .by_project
                    .iter()
                    .filter(|(_, project)| project.session_id == reserved_session)
                    .map(|(key, _)| key.clone())
                    .collect();
                match matches.as_slice() {
                    [key] => key.clone(),
                    [] => {
                        return Ok(json!({
                            "skipped": true,
                            "reason": "session_identity_mismatch",
                            "session_id": reserved_session,
                            "generation": parsed.generation,
                            "session_mode": "read_only_snapshot",
                        }));
                    }
                    _ => {
                        return Err(
                            "session_id matches multiple projects; project_session_id required"
                                .to_string(),
                        );
                    }
                }
            }
        };
        let project_session_id = if target_key == UNBOUND_PROJECT {
            None
        } else {
            Some(target_key.clone())
        };
        let project = publisher
            .by_project
            .get_mut(&target_key)
            .ok_or_else(|| format!("session write project '{target_key}' was not reserved"))?;
        if parsed.generation == 0 || parsed.generation > project.next_generation {
            return Err(format!(
                "session generation {} was not reserved",
                parsed.generation
            ));
        }
        let Some(captured_revision) = project.pending_exports.remove(&parsed.generation) else {
            return Err(format!(
                "session generation {} was not reserved",
                parsed.generation
            ));
        };
        if parsed.generation <= project.last_applied_generation {
            return Ok(json!({
                "skipped": true,
                "reason": "stale_generation",
                "session_id": project.session_id,
                "generation": parsed.generation,
                "last_applied_generation": project.last_applied_generation,
                "project_session_id": project_session_id,
                "session_mode": "read_only_snapshot",
            }));
        }
        if project.engine_revision != captured_revision {
            return Ok(json!({
                "skipped": true,
                "reason": "engine_revision_changed",
                "session_id": project.session_id,
                "generation": parsed.generation,
                "reserved_engine_revision": captured_revision,
                "engine_revision": project.engine_revision,
                "project_session_id": project_session_id,
                "session_mode": "read_only_snapshot",
            }));
        }

        let dir = session_root().join(&project.session_id);
        fs::create_dir_all(&dir).map_err(|error| format!("create session dir: {error}"))?;

        let focus_body = serde_json::to_string_pretty(&json!({
            "focus": parsed.focus,
            "session_id": project.session_id,
            "updated_ms": now_ms(),
            "generation": parsed.generation,
            "project_session_id": project_session_id,
            "session_mode": "read_only_snapshot",
        }))
        .map_err(|error| format!("encode focus.json: {error}"))?;

        let heartbeat_body = serde_json::to_string_pretty(&json!({
            "updated_ms": now_ms(),
            "generation": parsed.generation,
            "session_id": project.session_id,
            "project_session_id": project_session_id,
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

        project.last_applied_generation = parsed.generation;
        if parsed.generation > project.engine_revision {
            project.engine_revision = parsed.generation;
        }

        Ok(json!({
            "skipped": false,
            "session_id": project.session_id,
            "session_dir": dir.display().to_string(),
            "generation": parsed.generation,
            "engine_revision": project.engine_revision,
            "project_session_id": project_session_id,
            "session_mode": "read_only_snapshot",
            "writeback": false,
        }))
    }

    fn heartbeat_for_window(&self, window_label: &str) -> Result<serde_json::Value, String> {
        let mut publishers = self
            .publishers
            .lock()
            .map_err(|_| "session publisher lock poisoned".to_string())?;
        let Some(publisher) = publishers.get_mut(window_label) else {
            return Ok(json!({
                "skipped": true,
                "reason": "no_window_session",
                "session_mode": "read_only_snapshot",
            }));
        };
        let project_session_id = publisher.active_project_session_id.clone();
        let project = publisher.active_mut();

        let dir = session_root().join(&project.session_id);
        if !dir.is_dir() {
            return Ok(json!({
                "skipped": true,
                "reason": "no_session_dir",
                "session_id": project.session_id,
                "project_session_id": project_session_id,
                "session_mode": "read_only_snapshot",
            }));
        }

        let heartbeat_body = serde_json::to_string_pretty(&json!({
            "updated_ms": now_ms(),
            "generation": project.engine_revision,
            "session_id": project.session_id,
            "project_session_id": project_session_id,
            "session_mode": "read_only_snapshot",
            "kind": "heartbeat",
        }))
        .map_err(|error| format!("encode heartbeat.json: {error}"))?;
        atomic_write(&dir.join("heartbeat.json"), &heartbeat_body)?;

        Ok(json!({
            "skipped": false,
            "session_id": project.session_id,
            "generation": project.engine_revision,
            "engine_revision": project.engine_revision,
            "project_session_id": project_session_id,
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

fn write_engine_revision_heartbeat(project: &ProjectPublisher) -> Result<(), String> {
    let dir = session_root().join(&project.session_id);
    fs::create_dir_all(&dir).map_err(|error| format!("create session dir: {error}"))?;
    let heartbeat_body = serde_json::to_string_pretty(&json!({
        "updated_ms": now_ms(),
        "generation": project.engine_revision,
        "session_id": project.session_id,
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

/// Move a failed/invalid/conflicting op out of the pending queue so later
/// ops are not wedged forever.
fn dead_letter_inbox_op(session_id: &str, seq: u64, error: &str) -> Result<(), String> {
    let src = inbox_dir(session_id).join(format!("{seq}.json"));
    let dest_dir = inbox_dir(session_id).join("failed");
    fs::create_dir_all(&dest_dir).map_err(|error| error.to_string())?;
    let original = fs::read_to_string(&src).unwrap_or_default();
    let body = match serde_json::from_str::<Value>(&original) {
        Ok(mut parsed) => {
            if let Some(object) = parsed.as_object_mut() {
                object.insert("error".to_string(), Value::String(error.to_string()));
                object.insert("failed_ms".to_string(), json!(now_ms()));
            }
            serde_json::to_string_pretty(&parsed).unwrap_or_else(|_| original.clone())
        }
        Err(_) => serde_json::to_string_pretty(&json!({
            "error": error,
            "failed_ms": now_ms(),
            "raw": original,
        }))
        .map_err(|error| error.to_string())?,
    };
    let dest = dest_dir.join(format!("{seq}.json"));
    atomic_write(&dest, &body)?;
    if src.exists() {
        fs::remove_file(&src).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn engine_envelope_ok(raw: &str) -> bool {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|envelope| envelope.get("ok").and_then(Value::as_bool))
        .unwrap_or(false)
}

fn bump_engine_revision(project: &mut ProjectPublisher) -> Result<(), String> {
    project.engine_revision = project
        .engine_revision
        .checked_add(1)
        .ok_or_else(|| "session engine revision exhausted".to_string())?;
    if project.engine_revision > project.next_generation {
        project.next_generation = project.engine_revision;
    }
    write_engine_revision_heartbeat(project)
}

impl SessionBridgeState {
    #[allow(dead_code)]
    fn session_id_for_window(&self, window_label: &str) -> Result<Option<String>, String> {
        let mut publishers = self
            .publishers
            .lock()
            .map_err(|_| "session publisher lock poisoned".to_string())?;
        Ok(publishers
            .get_mut(window_label)
            .map(|publisher| publisher.active_mut().session_id.clone()))
    }

    /// Advance the authoritative engine revision immediately.
    /// Prefer [`Self::run_ui_mutation`] so the bump shares the publisher lock
    /// with the live engine call; this remains for tests and rare callers.
    fn note_mutation_for_window(&self, window_label: &str) -> Result<Value, String> {
        let mut publishers = self
            .publishers
            .lock()
            .map_err(|_| "session publisher lock poisoned".to_string())?;
        let publisher = publishers
            .entry(window_label.to_string())
            .or_insert_with(WindowPublisher::new);
        let project_session_id = publisher.active_project_session_id.clone();
        let project = publisher.active_mut();
        bump_engine_revision(project)?;
        Ok(json!({
            "session_id": project.session_id,
            "engine_revision": project.engine_revision,
            "generation": project.engine_revision,
            "project_session_id": project_session_id,
            "session_mode": "ui_owned_apply",
            "writeback": false,
        }))
    }

    /// Run a live UI engine mutation under the publisher lock and advance
    /// `engine_revision` on success — same critical section inbox apply uses.
    ///
    /// If this window has no publisher yet (MCP session never reserved), the
    /// mutate still runs but revision is not tracked (no inbox race).
    pub fn run_ui_mutation(&self, window_label: &str, mutate: impl FnOnce() -> String) -> String {
        let Ok(mut publishers) = self.publishers.lock() else {
            return mutate();
        };
        let Some(publisher) = publishers.get_mut(window_label) else {
            drop(publishers);
            return mutate();
        };
        let result = mutate();
        if engine_envelope_ok(&result) {
            if let Err(error) = bump_engine_revision(publisher.active_mut()) {
                eprintln!("session bridge could not bump engine_revision: {error}");
            }
        }
        result
    }

    fn engine_revision_for_window(&self, window_label: &str) -> Result<Option<u64>, String> {
        let mut publishers = self
            .publishers
            .lock()
            .map_err(|_| "session publisher lock poisoned".to_string())?;
        Ok(publishers.get_mut(window_label).map(|publisher| {
            publisher
                .by_project
                .get(publisher.active_key())
                .map(|project| project.engine_revision)
                .unwrap_or(0)
        }))
    }

    /// Run a native project-session transition under the publisher lock, then
    /// rebind this window's MCP publisher to the engine's new active identity.
    /// Lock order: publisher → engine (same as inbox apply / UI mutate).
    pub fn with_project_session_transition<R>(
        &self,
        window_label: &str,
        engine: &AppState,
        transition: impl FnOnce() -> R,
    ) -> R {
        let Ok(mut publishers) = self.publishers.lock() else {
            return transition();
        };
        let previous = engine.active_project_session_id();
        let result = transition();
        let next = engine.active_project_session_id();
        let publisher = publishers
            .entry(window_label.to_string())
            .or_insert_with(WindowPublisher::new);
        if previous != next || publisher.active_project_session_id.is_none() {
            publisher.rebind_to(&next);
        }
        result
    }

    /// Drop a retained inactive project's MCP publisher (inbox + revision).
    pub fn drop_bound_project_session(&self, window_label: &str, project_session_id: &str) {
        if let Ok(mut publishers) = self.publishers.lock() {
            if let Some(publisher) = publishers.get_mut(window_label) {
                publisher.drop_project(project_session_id);
            }
        }
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
    let engine_active = engine.active_project_session_id();
    match publisher.active_project_session_id.as_deref() {
        Some(bound) if bound != engine_active => {
            return Ok(json!({
                "applied": false,
                "reason": "project_session_mismatch",
                "bound_project_session_id": bound,
                "active_project_session_id": engine_active,
                "session_mode": "ui_owned_apply",
                "writeback": false,
            }));
        }
        None => publisher.rebind_to(&engine_active),
        Some(_) => {}
    }
    let project = publisher.active_mut();
    let session_id = project.session_id.clone();
    let seqs = pending_inbox_seqs(&session_id);
    let Some(seq) = seqs.first().copied() else {
        return Ok(json!({
            "applied": false,
            "reason": "empty",
            "session_id": session_id,
            "session_mode": "ui_owned_apply",
            "writeback": false,
            "pending": 0,
            "engine_revision": project.engine_revision,
        }));
    };
    let path = inbox_dir(&session_id).join(format!("{seq}.json"));
    let body = match fs::read_to_string(&path) {
        Ok(body) => body,
        Err(error) => {
            let message = format!("read inbox/{seq}.json: {error}");
            dead_letter_inbox_op(&session_id, seq, &message)?;
            return Ok(json!({
                "applied": false,
                "dead_lettered": true,
                "seq": seq,
                "error": message,
                "session_id": session_id,
                "session_mode": "ui_owned_apply",
                "writeback": false,
                "pending": pending_inbox_seqs(&session_id).len(),
                "engine_revision": project.engine_revision,
            }));
        }
    };
    let parsed: Value = match serde_json::from_str(&body) {
        Ok(parsed) => parsed,
        Err(error) => {
            let message = format!("invalid inbox/{seq}.json: {error}");
            dead_letter_inbox_op(&session_id, seq, &message)?;
            return Ok(json!({
                "applied": false,
                "dead_lettered": true,
                "seq": seq,
                "error": message,
                "reason": "malformed",
                "session_id": session_id,
                "session_mode": "ui_owned_apply",
                "writeback": false,
                "pending": pending_inbox_seqs(&session_id).len(),
                "engine_revision": project.engine_revision,
            }));
        }
    };
    let name = match parsed.get("name").and_then(Value::as_str) {
        Some(name) => name.to_string(),
        None => {
            let message = "inbox op missing name".to_string();
            dead_letter_inbox_op(&session_id, seq, &message)?;
            return Ok(json!({
                "applied": false,
                "dead_lettered": true,
                "seq": seq,
                "error": message,
                "reason": "malformed",
                "session_id": session_id,
                "session_mode": "ui_owned_apply",
                "writeback": false,
                "pending": pending_inbox_seqs(&session_id).len(),
                "engine_revision": project.engine_revision,
            }));
        }
    };
    let arguments = parsed.get("arguments").cloned().unwrap_or(json!({}));
    let base_generation = match parsed.get("base_generation").and_then(Value::as_u64) {
        Some(base) => base,
        None => {
            let message = "inbox op missing base_generation".to_string();
            dead_letter_inbox_op(&session_id, seq, &message)?;
            return Ok(json!({
                "applied": false,
                "dead_lettered": true,
                "seq": seq,
                "name": name,
                "error": message,
                "reason": "malformed",
                "session_id": session_id,
                "session_mode": "ui_owned_apply",
                "writeback": false,
                "pending": pending_inbox_seqs(&session_id).len(),
                "engine_revision": project.engine_revision,
            }));
        }
    };
    let current = project.engine_revision;
    if current != base_generation {
        let conflict = generation_conflict(&session_id, base_generation, Some(current));
        dead_letter_inbox_op(&session_id, seq, &conflict)?;
        return Ok(json!({
            "applied": false,
            "dead_lettered": true,
            "seq": seq,
            "name": name,
            "error": conflict,
            "reason": "generation_conflict",
            "base_generation": base_generation,
            "current_generation": current,
            "session_id": session_id,
            "session_mode": "ui_owned_apply",
            "writeback": false,
            "pending": pending_inbox_seqs(&session_id).len(),
            "engine_revision": project.engine_revision,
        }));
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
            "engine_revision": project.engine_revision,
        }));
    }
    match dispatch_inbox_on_engine(engine, &name, &arguments) {
        Ok(result) => {
            bump_engine_revision(project)?;
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
                "engine_revision": project.engine_revision,
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
                "engine_revision": project.engine_revision,
            }))
        }
    }
}

/// Reserve a monotonic generation before the frontend starts an async export.
#[tauri::command]
pub fn mcp_session_bridge_reserve(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SessionBridgeState>,
    engine: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    state.reserve_for_window_on_project(window.label(), Some(&engine.active_project_session_id()))
}

/// Publish a read-only snapshot for MCP attach.
///
/// Payload JSON: `{ focus, model_json?, active_sketch_json?, generation,
/// session_id, project_session_id? }`. `session_id` (and project identity
/// when reserved) must match the reservation; write never targets the
/// currently active tab by generation alone.
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

    fn payload(session_id: &str, generation: u64, marker: &str) -> PublishPayload {
        PublishPayload {
            focus: "solid".to_string(),
            model_json: Some(format!(r#"{{"version":1,"marker":"{marker}"}}"#)),
            active_sketch_json: None,
            generation,
            session_id: Some(session_id.to_string()),
            project_session_id: None,
        }
    }

    fn payload_on_project(
        session_id: &str,
        project_session_id: &str,
        generation: u64,
        marker: &str,
    ) -> PublishPayload {
        let mut parsed = payload(session_id, generation, marker);
        parsed.project_session_id = Some(project_session_id.to_string());
        parsed
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
            .write_for_window("main", payload(&session_id, newer, "newer"))
            .unwrap();
        assert_eq!(applied["skipped"], false);
        let stale = state
            .write_for_window("main", payload(&session_id, older, "older"))
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
            .write_for_window("main", payload(&session_id, first, "before-reload"))
            .unwrap();
        // A reloaded WebView asks Tauri for its next ticket instead of resetting locally.
        let (same_session_id, after_reload) = reserve(&state, "main");
        assert_eq!(same_session_id, session_id);
        assert_eq!(after_reload, first + 1);
        let applied = state
            .write_for_window("main", payload(&session_id, after_reload, "after-reload"))
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
            .write_for_window("main", payload(&main_session, main_generation, "main"))
            .unwrap();
        state
            .write_for_window(
                "secondary",
                payload(&second_session, second_generation, "secondary"),
            )
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
            .write_for_window("main", payload(&session_id, generation, "original"))
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
        let mut editing = payload(&session_id, first, "editing");
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
            .write_for_window("main", payload(&session_id, second, "finished"))
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
    fn inbox_generation_mismatch_is_dead_lettered_and_unblocks_queue() {
        // Production: a conflicting head must not remain pending forever.
        let _test = TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-inbox-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let state = SessionBridgeState::default();
        let (session_id, generation) = reserve(&state, "main");
        state
            .write_for_window("main", payload(&session_id, generation, "base"))
            .unwrap();
        write_inbox(
            &session_id,
            1,
            "cad_set_document_name",
            99,
            json!({"name": "Nope"}),
        );
        write_inbox(
            &session_id,
            2,
            "cad_set_document_name",
            generation,
            json!({"name": "Next"}),
        );
        let engine = AppState::new();
        let dead = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(dead["applied"], false);
        assert_eq!(dead["dead_lettered"], true);
        assert_eq!(dead["reason"], "generation_conflict");
        assert_eq!(dead["seq"], 1);
        assert!(session_root()
            .join(&session_id)
            .join("inbox/failed/1.json")
            .exists());
        assert_eq!(pending_inbox_seqs(&session_id), vec![2]);

        let next = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(next["applied"], true);
        assert_eq!(next["seq"], 2);

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ui_native_mutation_rejects_stale_base_without_js_note() {
        // Race: between native UI mutation completion and a later JS
        // noteEngineRevision, inbox apply must already see the advanced
        // revision. run_ui_mutation bumps under the publisher lock.
        let _test = TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-stale-ui-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let state = SessionBridgeState::default();
        let (session_id, generation) = reserve(&state, "main");
        state
            .write_for_window("main", payload(&session_id, generation, "base"))
            .unwrap();
        assert_eq!(
            state.engine_revision_for_window("main").unwrap(),
            Some(generation)
        );

        let engine = AppState::new();
        let raw = state.run_ui_mutation("main", || {
            engine.engine_call("document_set_name", r#""NativeUI""#)
        });
        assert!(engine_envelope_ok(&raw), "ui mutate should succeed: {raw}");
        assert_eq!(
            state.engine_revision_for_window("main").unwrap(),
            Some(generation + 1)
        );
        assert_eq!(read_session_generation(&session_id), Some(generation + 1));

        write_inbox(
            &session_id,
            1,
            "cad_set_document_name",
            generation, // stale relative to native UI mutation
            json!({"name": "Stale"}),
        );
        write_inbox(
            &session_id,
            2,
            "cad_set_document_name",
            generation + 1,
            json!({"name": "Fresh"}),
        );
        let dead = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(dead["applied"], false);
        assert_eq!(dead["dead_lettered"], true);
        assert_eq!(dead["reason"], "generation_conflict");
        assert_eq!(dead["current_generation"], generation + 1);
        assert_eq!(pending_inbox_seqs(&session_id), vec![2]);

        let fresh = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(fresh["applied"], true);
        assert_eq!(fresh["seq"], 2);

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_same_base_ops_second_is_dead_lettered_after_first_advances() {
        // Race 2: two queued ops share the same base_generation. The first
        // apply advances engine_revision atomically; the second must
        // dead-letter so a later refreshed seq can progress.
        let _test = TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-same-base-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let state = SessionBridgeState::default();
        let (session_id, generation) = reserve(&state, "main");
        state
            .write_for_window("main", payload(&session_id, generation, "base"))
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
        write_inbox(
            &session_id,
            3,
            "cad_set_document_name",
            generation + 1,
            json!({"name": "Rebased"}),
        );
        let engine = AppState::new();
        let first = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(first["applied"], true);
        assert_eq!(first["seq"], 1);
        assert_eq!(first["engine_revision"], generation + 1);
        assert_eq!(pending_inbox_seqs(&session_id), vec![2, 3]);

        let dead = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(dead["applied"], false);
        assert_eq!(dead["dead_lettered"], true);
        assert_eq!(dead["reason"], "generation_conflict");
        assert_eq!(dead["base_generation"], generation);
        assert_eq!(dead["current_generation"], generation + 1);
        assert_eq!(pending_inbox_seqs(&session_id), vec![3]);

        let rebased = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(rebased["applied"], true);
        assert_eq!(rebased["seq"], 3);

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_inbox_head_is_dead_lettered_so_next_seq_applies() {
        let _test = TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-malformed-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let state = SessionBridgeState::default();
        let (session_id, generation) = reserve(&state, "main");
        state
            .write_for_window("main", payload(&session_id, generation, "base"))
            .unwrap();
        let inbox = session_root().join(&session_id).join("inbox");
        fs::create_dir_all(&inbox).unwrap();
        fs::write(inbox.join("1.json"), "{not-json").unwrap();
        write_inbox(
            &session_id,
            2,
            "cad_set_document_name",
            generation,
            json!({"name": "AfterMalformed"}),
        );
        let engine = AppState::new();
        let dead = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(dead["applied"], false);
        assert_eq!(dead["dead_lettered"], true);
        assert_eq!(dead["reason"], "malformed");
        assert_eq!(pending_inbox_seqs(&session_id), vec![2]);
        assert!(session_root()
            .join(&session_id)
            .join("inbox/failed/1.json")
            .exists());

        let second = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(second["applied"], true);
        assert_eq!(second["seq"], 2);

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
            .write_for_window("main", payload(&session_id, generation, "base"))
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
    fn malformed_joint_inbox_payload_is_dead_lettered_and_unblocks_queue() {
        // Valid mutate name, invalid CreateJointRequestDto — dispatch fails
        // and must dead-letter so a later op can apply.
        let _test = TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-joint-malformed-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let state = SessionBridgeState::default();
        let (session_id, generation) = reserve(&state, "main");
        state
            .write_for_window("main", payload(&session_id, generation, "base"))
            .unwrap();
        write_inbox(
            &session_id,
            1,
            "assembly_create_joint",
            generation,
            json!({"name": "Broken"}),
        );
        write_inbox(
            &session_id,
            2,
            "cad_set_document_name",
            generation,
            json!({"name": "AfterJointFail"}),
        );
        let engine = AppState::new();
        let dead = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(dead["applied"], false);
        assert_eq!(dead["dead_lettered"], true);
        assert_eq!(dead["seq"], 1);
        assert_eq!(dead["name"], "assembly_create_joint");
        assert!(session_root()
            .join(&session_id)
            .join("inbox/failed/1.json")
            .exists());
        assert_eq!(pending_inbox_seqs(&session_id), vec![2]);

        let second = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(second["applied"], true);
        assert_eq!(second["seq"], 2);
        assert_eq!(engine.document_snapshot().name, "AfterJointFail");

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
            (
                "assembly_create_joint",
                "assembly_create_joint",
                ExecutionKind::Direct,
            ),
            (
                "assembly_update_joint",
                "assembly_update_joint",
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
        assert_eq!(
            nbcad_mcp_mutate::lookup_mutate("assembly_create_component")
                .unwrap()
                .engine_method,
            "assembly_create_component"
        );
    }

    fn envelope_ok(raw: &str) {
        assert!(engine_envelope_ok(raw), "engine error: {raw}");
    }

    #[test]
    fn mutation_between_export_and_write_rejects_stale_snapshot() {
        // Race: reserve captures engine_revision, JS exports live state, a UI
        // mutation completes before write. The stale export must not publish
        // at the post-mutation revision.
        let _test = TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-export-write-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let state = SessionBridgeState::default();
        let engine = AppState::new();
        envelope_ok(&state.with_project_session_transition("main", &engine, || {
            engine.bind_project_session("tab-a")
        }));

        let (session_id, generation) = reserve(&state, "main");
        state
            .write_for_window("main", payload(&session_id, generation, "base"))
            .unwrap();
        let reserved_revision = state.engine_revision_for_window("main").unwrap();

        let (_, in_flight) = reserve(&state, "main");
        let mutated = state.run_ui_mutation("main", || {
            engine.engine_call("document_set_name", r#""MutatedDuringExport""#)
        });
        envelope_ok(&mutated);
        assert_eq!(engine.document_snapshot().name, "MutatedDuringExport");
        let after_mutation = state.engine_revision_for_window("main").unwrap();
        assert_ne!(after_mutation, reserved_revision);

        let stale = state
            .write_for_window("main", payload(&session_id, in_flight, "stale-export"))
            .unwrap();
        assert_eq!(stale["skipped"], true);
        assert_eq!(stale["reason"], "engine_revision_changed");
        let model = fs::read_to_string(dir.join(&session_id).join("model.json")).unwrap();
        assert!(
            model.contains("\"marker\":\"base\""),
            "stale export must not replace the last coherent snapshot: {model}"
        );
        assert!(!model.contains("stale-export"));

        let (_, fresh) = reserve(&state, "main");
        let applied = state
            .write_for_window("main", payload(&session_id, fresh, "fresh"))
            .unwrap();
        assert_eq!(applied["skipped"], false);
        let fresh_model = fs::read_to_string(dir.join(&session_id).join("model.json")).unwrap();
        assert!(fresh_model.contains("\"marker\":\"fresh\""));

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn inbox_op_for_tab_a_cannot_mutate_retained_tab_b() {
        let _test = TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-tab-switch-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let state = SessionBridgeState::default();
        let engine = AppState::new();
        envelope_ok(&state.with_project_session_transition("main", &engine, || {
            engine.bind_project_session("tab-a")
        }));
        envelope_ok(&state.run_ui_mutation("main", || {
            engine.engine_call("document_set_name", r#""Alpha""#)
        }));

        let (session_a, generation) = reserve(&state, "main");
        state
            .write_for_window("main", payload(&session_a, generation, "alpha"))
            .unwrap();
        let base = state
            .engine_revision_for_window("main")
            .unwrap()
            .expect("tab A revision");
        write_inbox(
            &session_a,
            1,
            "cad_set_document_name",
            base,
            json!({"name": "FromA"}),
        );

        envelope_ok(&state.with_project_session_transition("main", &engine, || {
            engine.create_project_session("tab-b")
        }));
        envelope_ok(&state.run_ui_mutation("main", || {
            engine.engine_call("document_set_name", r#""Beta""#)
        }));
        assert_eq!(engine.document_snapshot().name, "Beta");
        assert_eq!(engine.active_project_session_id(), "tab-b");

        let applied = apply_one_inbox_op(&state, "main", &engine).unwrap();
        assert_eq!(
            applied["applied"], false,
            "tab A inbox must not apply on tab B: {applied}"
        );
        assert_ne!(applied.get("reason"), Some(&json!("generation_conflict")));
        assert_eq!(engine.document_snapshot().name, "Beta");
        assert!(
            session_root()
                .join(&session_a)
                .join("inbox/1.json")
                .exists(),
            "A op must remain in A's inbox, not land on B"
        );

        // Safety net: engine switched to B without notifying the bridge.
        let engine_bypass = AppState::new();
        let state_bypass = SessionBridgeState::default();
        envelope_ok(
            &state_bypass.with_project_session_transition("main", &engine_bypass, || {
                engine_bypass.bind_project_session("tab-a")
            }),
        );
        envelope_ok(&state_bypass.run_ui_mutation("main", || {
            engine_bypass.engine_call("document_set_name", r#""Alpha""#)
        }));
        let (session_bypass, gen_bypass) = reserve(&state_bypass, "main");
        state_bypass
            .write_for_window("main", payload(&session_bypass, gen_bypass, "alpha"))
            .unwrap();
        let base_bypass = state_bypass
            .engine_revision_for_window("main")
            .unwrap()
            .expect("bypass A revision");
        write_inbox(
            &session_bypass,
            1,
            "cad_set_document_name",
            base_bypass,
            json!({"name": "FromA"}),
        );
        envelope_ok(&engine_bypass.create_project_session("tab-b"));
        envelope_ok(&engine_bypass.engine_call("document_set_name", r#""Beta""#));
        let mismatch = apply_one_inbox_op(&state_bypass, "main", &engine_bypass).unwrap();
        assert_eq!(mismatch["applied"], false);
        assert_eq!(mismatch["reason"], "project_session_mismatch");
        assert_eq!(engine_bypass.document_snapshot().name, "Beta");

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reserve_a_activate_b_reserve_b_write_a_does_not_publish_into_b() {
        // Race: A reserves generation N, B becomes active and also reserves
        // generation N, then A's delayed export writes. Without reserved
        // identity on the write, that payload consumes B's reservation and
        // publishes A's model into B's session.
        let _test = TEST_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-bridge-reserve-id-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        let state = SessionBridgeState::default();
        let engine = AppState::new();
        envelope_ok(&state.with_project_session_transition("main", &engine, || {
            engine.bind_project_session("tab-a")
        }));

        let reserved_a = state
            .reserve_for_window_on_project("main", Some("tab-a"))
            .unwrap();
        let session_a = reserved_a["session_id"].as_str().unwrap().to_string();
        let gen_a = reserved_a["generation"].as_u64().unwrap();
        let project_a = reserved_a["project_session_id"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(project_a, "tab-a");

        envelope_ok(&state.with_project_session_transition("main", &engine, || {
            engine.create_project_session("tab-b")
        }));
        assert_eq!(engine.active_project_session_id(), "tab-b");

        let reserved_b = state
            .reserve_for_window_on_project("main", Some("tab-b"))
            .unwrap();
        let session_b = reserved_b["session_id"].as_str().unwrap().to_string();
        let gen_b = reserved_b["generation"].as_u64().unwrap();
        let project_b = reserved_b["project_session_id"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(project_b, "tab-b");
        assert_ne!(session_a, session_b);
        assert_eq!(
            gen_a, gen_b,
            "both tabs independently reserve generation 1 — the collision window"
        );

        let no_identity = PublishPayload {
            focus: "solid".to_string(),
            model_json: Some(r#"{"version":1,"marker":"no-identity"}"#.to_string()),
            active_sketch_json: None,
            generation: gen_a,
            session_id: None,
            project_session_id: None,
        };
        let rejected = state.write_for_window("main", no_identity);
        assert!(
            rejected.is_err(),
            "generation-only write must not target the active tab: {rejected:?}"
        );

        let crossed = payload_on_project(&session_a, &project_b, gen_a, "crossed");
        let mismatch = state.write_for_window("main", crossed).unwrap();
        assert_eq!(mismatch["skipped"], true);
        assert_eq!(mismatch["reason"], "session_identity_mismatch");

        let applied_a = state
            .write_for_window(
                "main",
                payload_on_project(&session_a, &project_a, gen_a, "from-a"),
            )
            .unwrap();
        assert_eq!(applied_a["skipped"], false);
        assert_eq!(applied_a["session_id"], session_a);
        assert_eq!(applied_a["project_session_id"], project_a);
        let model_a = fs::read_to_string(dir.join(&session_a).join("model.json")).unwrap();
        assert!(model_a.contains("\"marker\":\"from-a\""));
        assert!(
            !dir.join(&session_b).join("model.json").exists(),
            "A's delayed write must not publish into B's session"
        );

        let applied_b = state
            .write_for_window(
                "main",
                payload_on_project(&session_b, &project_b, gen_b, "from-b"),
            )
            .unwrap();
        assert_eq!(applied_b["skipped"], false);
        assert_eq!(applied_b["session_id"], session_b);
        let model_b = fs::read_to_string(dir.join(&session_b).join("model.json")).unwrap();
        assert!(model_b.contains("\"marker\":\"from-b\""));
        let model_a_after = fs::read_to_string(dir.join(&session_a).join("model.json")).unwrap();
        assert!(model_a_after.contains("\"marker\":\"from-a\""));
        assert!(!model_a_after.contains("from-b"));

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }
}
