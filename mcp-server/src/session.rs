//! Headless session directories under `NBCAD_SESSION_DIR` (or temp `nbcad-sessions`).
//!
//! Snapshot publish is **UI-owned**. MCP may `cad_attach` (copy) and `cad_submit`
//! an inbox op; it must **not** write `model.json` back (no last-writer-wins).
//! The desktop/engine applies inbox ops via the same `host::handle` path as
//! Tauri IPC, then the existing publisher writes a new snapshot. This is still
//! **not** in-process shared memory.
//!
//! Layout: `<session_dir>/<uuid>/{model.json,active-sketch.json?,focus.json,heartbeat.json,closed.json?,inbox/<seq>.json}`.
//! Live window projection also reads `<session_dir>/_ui/process.json` (desktop process instance).
//! Session ids must be UUID v4 strings.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

/// Heartbeats older than this are marked `stale` in list metadata (no auto-delete).
pub const HEARTBEAT_STALE_MS: u64 = 30_000;

pub fn session_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("NBCAD_SESSION_DIR") {
        if !custom.trim().is_empty() {
            return PathBuf::from(custom);
        }
    }
    std::env::temp_dir().join("nbcad-sessions")
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// UUID v4 string form (8-4-4-4-12 hex with version nibble `4` and RFC variant).
pub fn is_valid_session_id(session_id: &str) -> bool {
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

pub fn require_valid_session_id(session_id: &str) -> Result<(), String> {
    if is_valid_session_id(session_id) {
        Ok(())
    } else {
        Err(format!(
            "session_id must be a UUID v4 string (got '{session_id}')"
        ))
    }
}

/// List attachable session directories. Skips control dirs (`_*`) and non-UUID names.
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
            if name.starts_with('_') || !is_valid_session_id(&name) {
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
    require_valid_session_id(session_id)?;
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

/// Heartbeat age / staleness for a session directory (no auto-delete).
pub fn heartbeat_meta(session_id: &str) -> Value {
    match read_session_file(session_id, "heartbeat.json") {
        Ok(body) => {
            let parsed: Value = serde_json::from_str(&body).unwrap_or(json!({}));
            let updated_ms = parsed
                .get("updated_ms")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let age_ms = now_ms().saturating_sub(updated_ms);
            json!({
                "updated_ms": updated_ms,
                "age_ms": age_ms,
                "stale": age_ms > HEARTBEAT_STALE_MS,
                "generation": parsed.get("generation").cloned().unwrap_or(Value::Null),
                "window_id": parsed.get("window_id").cloned().unwrap_or(Value::Null),
                "document_id": parsed
                    .get("document_id")
                    .or_else(|| parsed.get("project_session_id"))
                    .cloned()
                    .unwrap_or(Value::Null),
                "project_session_id": parsed
                    .get("project_session_id")
                    .or_else(|| parsed.get("document_id"))
                    .cloned()
                    .unwrap_or(Value::Null),
            })
        }
        Err(_) => json!({
            "updated_ms": null,
            "age_ms": null,
            "stale": true,
            "generation": null,
            "window_id": null,
            "document_id": null,
            "project_session_id": null,
        }),
    }
}

/// Stable identities published beside a session snapshot (UI-owned).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionIdentity {
    pub session_id: String,
    pub window_id: Option<String>,
    pub document_id: Option<String>,
}

fn optional_id(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Read window/document identity from heartbeat (focus.json fallback).
pub fn session_identity(session_id: &str) -> SessionIdentity {
    let mut window_id = None;
    let mut document_id = None;
    if let Ok(body) = read_session_file(session_id, "heartbeat.json") {
        let parsed: Value = serde_json::from_str(&body).unwrap_or(json!({}));
        window_id = optional_id(&parsed, "window_id");
        document_id = optional_id(&parsed, "document_id")
            .or_else(|| optional_id(&parsed, "project_session_id"));
    }
    if window_id.is_none() || document_id.is_none() {
        if let Ok(body) = read_session_file(session_id, "focus.json") {
            let parsed: Value = serde_json::from_str(&body).unwrap_or(json!({}));
            if window_id.is_none() {
                window_id = optional_id(&parsed, "window_id");
            }
            if document_id.is_none() {
                document_id = optional_id(&parsed, "document_id")
                    .or_else(|| optional_id(&parsed, "project_session_id"));
            }
        }
    }
    SessionIdentity {
        session_id: session_id.to_string(),
        window_id,
        document_id,
    }
}

/// Explicit close marker written when the UI drops a tab's publisher.
pub const CLOSED_TOMBSTONE: &str = "closed.json";

pub fn is_session_closed(session_id: &str) -> bool {
    session_path(session_id, CLOSED_TOMBSTONE)
        .map(|path| path.is_file())
        .unwrap_or(false)
}

/// Mark a session directory closed so it leaves the live `windows[]` set.
pub fn write_closed_tombstone(session_id: &str) -> Result<(), String> {
    let body = serde_json::to_string_pretty(&json!({
        "closed_ms": now_ms(),
        "session_id": session_id,
    }))
    .map_err(|error| error.to_string())?;
    write_session(session_id, CLOSED_TOMBSTONE, &body)
}

/// Clear a close marker when the same session UUID is republished.
pub fn clear_closed_tombstone(session_id: &str) -> Result<(), String> {
    let path = session_path(session_id, CLOSED_TOMBSTONE)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Current desktop process instance from `_ui/process.json`, if the UI wrote one.
pub fn current_process_instance_id() -> Option<String> {
    let path = session_dir().join("_ui").join("process.json");
    let body = fs::read_to_string(path).ok()?;
    let parsed: Value = serde_json::from_str(&body).ok()?;
    optional_id(&parsed, "process_instance_id")
}

fn heartbeat_process_instance_id(session_id: &str) -> Option<String> {
    let body = read_session_file(session_id, "heartbeat.json").ok()?;
    let parsed: Value = serde_json::from_str(&body).ok()?;
    optional_id(&parsed, "process_instance_id")
}

/// Live for window projection: not closed, and (when a process file exists)
/// stamped with the current desktop process instance. Stale heartbeats still
/// count — inactive open tabs must remain visible.
fn is_live_for_windows(session_id: &str) -> bool {
    if is_session_closed(session_id) {
        return false;
    }
    match current_process_instance_id() {
        Some(current) => {
            heartbeat_process_instance_id(session_id).as_deref() == Some(current.as_str())
        }
        None => true,
    }
}

/// Resolve attach target to a UUID session dir.
///
/// Accepts `session_id` (UUID), `window_id` (Tauri label), and/or `document_id`
/// (native project-session id). UUID `document_id` remains an alias for
/// `session_id` for compatibility. All provided selectors are intersected;
/// ambiguity is reported only after every supplied filter is applied. Closed
/// sessions are excluded from window/document matching (explicit `session_id`
/// still resolves for recovery).
pub fn resolve_attach_target(
    session_id: Option<&str>,
    window_id: Option<&str>,
    document_id: Option<&str>,
) -> Result<SessionIdentity, String> {
    let session_id = session_id.map(str::trim).filter(|s| !s.is_empty());
    let window_id = window_id.map(str::trim).filter(|s| !s.is_empty());
    let document_id = document_id.map(str::trim).filter(|s| !s.is_empty());
    if session_id.is_none() && window_id.is_none() && document_id.is_none() {
        return Err(
            "missing attach target: provide session_id, window_id, and/or document_id".to_string(),
        );
    }

    let mut candidates: Vec<String> = if let Some(id) = session_id {
        require_valid_session_id(id)?;
        if !list_sessions()?.iter().any(|existing| existing == id) {
            return Err(format!(
                "session '{id}' was not found under {}",
                session_dir().display()
            ));
        }
        vec![id.to_string()]
    } else {
        // Window/document matching uses the live set only (not closed, and when
        // `_ui/process.json` exists only the current desktop process instance).
        list_sessions()?
            .into_iter()
            .filter(|id| is_live_for_windows(id))
            .collect()
    };

    if let Some(window) = window_id {
        candidates.retain(|id| session_identity(id).window_id.as_deref() == Some(window));
        if candidates.is_empty() {
            return Err(format!(
                "window_id '{window}' was not found under {}",
                session_dir().display()
            ));
        }
    }

    if let Some(document) = document_id {
        // Compat: UUID document_id still means the session directory name.
        if is_valid_session_id(document) && list_sessions()?.iter().any(|id| id == document) {
            candidates.retain(|id| id == document);
        } else {
            candidates.retain(|id| session_identity(id).document_id.as_deref() == Some(document));
        }
        if candidates.is_empty() {
            return Err(format!(
                "document_id '{document}' was not found under {}",
                session_dir().display()
            ));
        }
    }

    candidates.sort();
    candidates.dedup();
    match candidates.as_slice() {
        [] => Err("could not resolve attach target".to_string()),
        [only] => Ok(session_identity(only)),
        many => {
            let labels: Vec<&str> = [
                session_id.map(|_| "session_id"),
                window_id.map(|_| "window_id"),
                document_id.map(|_| "document_id"),
            ]
            .into_iter()
            .flatten()
            .collect();
            Err(format!(
                "attach target is ambiguous after filters ({}); matches {} ({})",
                labels.join("+"),
                many.len(),
                many.join(", ")
            ))
        }
    }
}

fn windows_projection(detailed: &[Value]) -> Vec<Value> {
    use std::collections::BTreeMap;
    let mut by_window: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for detail in detailed {
        if detail.get("closed").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        if detail.get("live_for_windows").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        let Some(window_id) = detail.get("window_id").and_then(Value::as_str) else {
            continue;
        };
        let doc = json!({
            "session_id": detail.get("session_id"),
            "document_id": detail.get("document_id"),
            "has_model": detail.get("has_model"),
            "heartbeat": detail.get("heartbeat"),
        });
        by_window
            .entry(window_id.to_string())
            .or_default()
            .push(doc);
    }

    by_window
        .into_iter()
        .map(|(window_id, mut documents)| {
            documents.sort_by(|a, b| {
                let a_id = a.get("document_id").and_then(Value::as_str).unwrap_or("");
                let b_id = b.get("document_id").and_then(Value::as_str).unwrap_or("");
                a_id.cmp(b_id)
            });
            // Active = freshest heartbeat among this window's documents.
            let active = documents
                .iter()
                .max_by_key(|doc| {
                    doc.get("heartbeat")
                        .and_then(|hb| hb.get("updated_ms"))
                        .and_then(Value::as_u64)
                        .unwrap_or(0)
                })
                .cloned();
            json!({
                "window_id": window_id,
                "active_document_id": active.as_ref().and_then(|d| d.get("document_id").cloned()).unwrap_or(Value::Null),
                "active_session_id": active.as_ref().and_then(|d| d.get("session_id").cloned()).unwrap_or(Value::Null),
                "documents": documents,
            })
        })
        .collect()
}

pub fn sessions_list_json() -> Value {
    match list_sessions() {
        Ok(sessions) => {
            let process_instance_id = current_process_instance_id();
            let detailed: Vec<Value> = sessions
                .iter()
                .map(|session_id| {
                    let has_model = session_path(session_id, "model.json")
                        .map(|path| path.is_file())
                        .unwrap_or(false);
                    let identity = session_identity(session_id);
                    let closed = is_session_closed(session_id);
                    let live = is_live_for_windows(session_id);
                    json!({
                        "session_id": session_id,
                        "window_id": identity.window_id,
                        "document_id": identity.document_id,
                        "has_model": has_model,
                        "closed": closed,
                        "live_for_windows": live,
                        "process_instance_id": heartbeat_process_instance_id(session_id),
                        "heartbeat": heartbeat_meta(session_id),
                    })
                })
                .collect();
            let windows = windows_projection(&detailed);
            json!({
                "session_mode": "read_only_snapshot",
                "sessions": sessions,
                "session_details": detailed,
                "windows": windows,
                "process_instance_id": process_instance_id,
                "session_dir": session_dir().display().to_string(),
                "heartbeat_stale_ms": HEARTBEAT_STALE_MS,
            })
        }
        Err(error) => json!({
            "session_mode": "read_only_snapshot",
            "sessions": [],
            "session_details": [],
            "windows": [],
            "process_instance_id": null,
            "session_dir": session_dir().display().to_string(),
            "heartbeat_stale_ms": HEARTBEAT_STALE_MS,
            "error": error,
        }),
    }
}

fn session_path(session_id: &str, filename: &str) -> Result<PathBuf, String> {
    require_valid_session_id(session_id)?;
    if filename.is_empty() || filename.contains('\\') || filename.contains("..") {
        return Err("invalid filename".to_string());
    }
    let parts: Vec<&str> = filename.split('/').collect();
    if parts.is_empty()
        || parts.iter().any(|part| {
            part.is_empty()
                || *part == "."
                || *part == ".."
                || !part
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
        })
    {
        return Err("invalid filename".to_string());
    }
    let mut path = session_dir().join(session_id);
    for part in parts {
        path.push(part);
    }
    Ok(path)
}

/// One MCP-submitted modeling op. UI/engine is the only live-document writer.
#[derive(Debug, Clone)]
pub struct InboxOp {
    pub name: String,
    pub arguments: Value,
    pub base_generation: u64,
}

impl InboxOp {
    pub fn to_json(&self) -> Value {
        json!({
            "name": self.name,
            "arguments": self.arguments,
            "base_generation": self.base_generation,
        })
    }

    pub fn from_json(value: &Value) -> Result<Self, String> {
        let name = value
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| "inbox op missing 'name'".to_string())?
            .to_string();
        let arguments = value.get("arguments").cloned().unwrap_or(json!({}));
        let base_generation = value
            .get("base_generation")
            .and_then(Value::as_u64)
            .ok_or_else(|| "inbox op missing 'base_generation'".to_string())?;
        Ok(Self {
            name,
            arguments,
            base_generation,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ApplyResult {
    pub seq: u64,
    pub op: InboxOp,
    pub host_result: Value,
}

/// Current heartbeat `generation`, if the file is present and parseable.
pub fn read_heartbeat_generation(session_id: &str) -> Result<u64, String> {
    let meta = heartbeat_meta(session_id);
    meta.get("generation")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            format!("session '{session_id}' has no heartbeat generation; UI must publish first")
        })
}

/// Structured writer-lock error. MCP never writes model.json (`writeback: false`).
pub fn generation_conflict_error(
    session_id: &str,
    base_generation: u64,
    current_generation: Option<u64>,
) -> String {
    serde_json::to_string(&json!({
        "code": "generation_conflict",
        "writeback": false,
        "session_mode": "ui_owned_apply",
        "session_id": session_id,
        "base_generation": base_generation,
        "current_generation": current_generation,
        "hint": "UI moved; cad_refresh then resubmit with the new heartbeat generation",
    }))
    .unwrap_or_else(|_| {
        format!(
            "{{\"code\":\"generation_conflict\",\"writeback\":false,\"session_mode\":\"ui_owned_apply\",\"session_id\":\"{session_id}\"}}"
        )
    })
}

pub fn not_attached_error() -> String {
    serde_json::to_string(&json!({
        "code": "not_attached",
        "writeback": false,
        "session_mode": "ui_owned_apply",
        "session_id": Value::Null,
        "hint": "cad_submit requires cad_attach; headless goldens call modeling tools directly",
    }))
    .unwrap_or_else(|_| {
        "{\"code\":\"not_attached\",\"writeback\":false,\"session_mode\":\"ui_owned_apply\"}"
            .to_string()
    })
}

fn parse_inbox_seq(name: &str) -> Option<u64> {
    name.strip_suffix(".json")?.parse().ok()
}

fn inbox_seqs_in(dir: &std::path::Path) -> Vec<u64> {
    let mut seqs = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
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

/// Next inbox sequence (1-based), considering pending, applied, and failed ops.
pub fn next_inbox_seq(session_id: &str) -> Result<u64, String> {
    require_valid_session_id(session_id)?;
    let root = session_dir().join(session_id);
    let inbox = root.join("inbox");
    let mut max = 0u64;
    for seq in inbox_seqs_in(&inbox) {
        max = max.max(seq);
    }
    for seq in inbox_seqs_in(&inbox.join("applied")) {
        max = max.max(seq);
    }
    for seq in inbox_seqs_in(&inbox.join("failed")) {
        max = max.max(seq);
    }
    Ok(max.saturating_add(1))
}

/// Pending inbox seqs, lowest first.
pub fn pending_inbox_seqs(session_id: &str) -> Result<Vec<u64>, String> {
    require_valid_session_id(session_id)?;
    Ok(inbox_seqs_in(&session_dir().join(session_id).join("inbox")))
}

/// Write `inbox/<seq>.json` with an exclusive sequence reservation.
///
/// `next_inbox_seq` is only a hint. The durable allocation is `create_new` on
/// `inbox/<seq>.json` so two `cad_submit` callers cannot share a sequence or
/// overwrite each other while both report success. On collision the loser
/// retries the next free sequence.
pub fn write_inbox_op(session_id: &str, op: &InboxOp) -> Result<u64, String> {
    require_valid_session_id(session_id)?;
    let body = serde_json::to_string_pretty(&op.to_json())
        .map_err(|error| format!("encode inbox op: {error}"))?;
    const MAX_ATTEMPTS: u32 = 1024;
    for _ in 0..MAX_ATTEMPTS {
        let seq = next_inbox_seq(session_id)?;
        let path = session_path(session_id, &format!("inbox/{seq}.json"))?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        match exclusive_create_file(&path, &body) {
            Ok(()) => return Ok(seq),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!("could not create inbox/{seq}.json: {error}"));
            }
        }
    }
    Err("could not reserve an exclusive inbox sequence".to_string())
}

fn exclusive_create_file(path: &Path, content: &str) -> std::io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let result = file
        .write_all(content.as_bytes())
        .and_then(|_| file.sync_all());
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

pub fn read_inbox_op(session_id: &str, seq: u64) -> Result<InboxOp, String> {
    let body = read_session_file(session_id, &format!("inbox/{seq}.json"))?;
    let parsed: Value = serde_json::from_str(&body)
        .map_err(|error| format!("invalid inbox/{seq}.json: {error}"))?;
    InboxOp::from_json(&parsed)
}

fn archive_inbox_op(session_id: &str, seq: u64) -> Result<(), String> {
    let src = session_path(session_id, &format!("inbox/{seq}.json"))?;
    let dest = session_path(session_id, &format!("inbox/applied/{seq}.json"))?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    match fs::rename(&src, &dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            let body = fs::read_to_string(&src)
                .map_err(|error| format!("archive read inbox/{seq}.json: {error}"))?;
            write_session(session_id, &format!("inbox/applied/{seq}.json"), &body)?;
            fs::remove_file(&src).map_err(|error| format!("remove applied inbox op: {error}"))
        }
    }
}

fn dead_letter_inbox_op(session_id: &str, seq: u64, error: &str) -> Result<(), String> {
    let src = session_path(session_id, &format!("inbox/{seq}.json"))?;
    if let Some(parent) = session_path(session_id, "inbox/failed")?.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let original = fs::read_to_string(&src).unwrap_or_default();
    let body = match serde_json::from_str::<Value>(&original) {
        Ok(mut parsed) => {
            if let Some(object) = parsed.as_object_mut() {
                object.insert("error".to_string(), Value::String(error.to_string()));
                object.insert("failed_ms".to_string(), json!(now_ms()));
            }
            serde_json::to_string_pretty(&parsed).unwrap_or(original.clone())
        }
        Err(_) => serde_json::to_string_pretty(&json!({
            "error": error,
            "failed_ms": now_ms(),
            "raw": original,
        }))
        .map_err(|e| e.to_string())?,
    };
    write_session(session_id, &format!("inbox/failed/{seq}.json"), &body)?;
    if src.exists() {
        fs::remove_file(&src).map_err(|e| format!("remove dead-lettered inbox op: {e}"))?;
    }
    Ok(())
}

/// Read the lowest pending inbox op, check `base_generation` against heartbeat,
/// call `host_apply`, then archive the op. Does **not** write model.json —
/// the caller (UI publisher or test) publishes the new snapshot.
///
/// `host_apply` must target the **live** engine (desktop) or a **separate**
/// SketchManager loaded from the published model (tests). Never the attached
/// MCP in-memory copy.
pub fn apply_inbox_op<F>(session_id: &str, host_apply: F) -> Result<ApplyResult, String>
where
    F: FnOnce(&str, Value) -> Result<Value, String>,
{
    require_valid_session_id(session_id)?;
    let seqs = pending_inbox_seqs(session_id)?;
    let seq = seqs
        .first()
        .copied()
        .ok_or_else(|| format!("session '{session_id}' has no pending inbox op"))?;
    let op = match read_inbox_op(session_id, seq) {
        Ok(op) => op,
        Err(error) => {
            dead_letter_inbox_op(session_id, seq, &error)?;
            return Err(error);
        }
    };
    let current = match read_heartbeat_generation(session_id) {
        Ok(generation) => generation,
        Err(_) => {
            let error = generation_conflict_error(session_id, op.base_generation, None);
            // Match native apply: generation_conflict (including a missing /
            // unreadable heartbeat generation) must not wedge later seqs.
            // Age-only stale heartbeats still apply when generation matches —
            // listing staleness is not a writer lock.
            dead_letter_inbox_op(session_id, seq, &error)?;
            return Err(error);
        }
    };
    if op.base_generation != current {
        let error = generation_conflict_error(session_id, op.base_generation, Some(current));
        // Match native apply: a stale head must not wedge later seqs.
        dead_letter_inbox_op(session_id, seq, &error)?;
        return Err(error);
    }
    if nbcad_mcp_mutate::lookup_mutate(&op.name).is_none() {
        let error = format!("unsupported inbox mutate '{}'", op.name);
        // Match native apply: reject before host so inspect/unknown names
        // cannot archive as applied.
        dead_letter_inbox_op(session_id, seq, &error)?;
        return Err(error);
    }
    let host_result = match host_apply(&op.name, op.arguments.clone()) {
        Ok(result) => result,
        Err(error) => {
            // Match native apply: a failed head must not wedge later seqs.
            dead_letter_inbox_op(session_id, seq, &error)?;
            return Err(error);
        }
    };
    archive_inbox_op(session_id, seq)?;
    Ok(ApplyResult {
        seq,
        op,
        host_result,
    })
}

/// Test/helper: replace model.json and bump heartbeat generation.
/// Used after a successful host apply on a **separate** SketchManager.
/// Not an MCP writeback path — the live UI publisher is the production writer.
pub fn publish_applied_snapshot(session_id: &str, model_json: &str) -> Result<u64, String> {
    let next = read_heartbeat_generation(session_id)
        .unwrap_or(0)
        .saturating_add(1);
    write_session(session_id, "model.json", model_json)?;
    let heartbeat = serde_json::to_string_pretty(&json!({
        "updated_ms": now_ms(),
        "generation": next,
        "session_id": session_id,
        "session_mode": "ui_owned_apply",
        "writeback": false,
    }))
    .map_err(|error| format!("encode heartbeat: {error}"))?;
    write_session(session_id, "heartbeat.json", &heartbeat)?;
    Ok(next)
}

/// Deterministic-looking UUID v4 for tests (unique via `now_ms` nibble).
#[cfg(test)]
pub fn test_session_uuid() -> String {
    format!("00000000-0000-4000-8000-{:012x}", now_ms() & 0xffffffffffff)
}

/// Serialize tests that mutate `NBCAD_SESSION_DIR`.
#[cfg(test)]
pub static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_v4_validation_accepts_and_rejects() {
        assert!(is_valid_session_id("123e4567-e89b-42d3-a456-426614174000"));
        assert!(!is_valid_session_id("123e4567-e89b-12d3-a456-426614174000")); // not version 4
        assert!(!is_valid_session_id("My Document"));
        assert!(!is_valid_session_id("../escape"));
        assert!(!is_valid_session_id(""));
    }

    #[test]
    fn session_snapshot_roundtrip_skips_control_and_non_uuid() {
        let _guard = ENV_LOCK.lock().unwrap();
        let unique = test_session_uuid();
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-test-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        write_session(&unique, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &unique,
            "heartbeat.json",
            &format!(r#"{{"updated_ms":{},"generation":1}}"#, now_ms()),
        )
        .unwrap();
        fs::create_dir_all(dir.join("_ui")).unwrap();
        fs::create_dir_all(dir.join("document-name")).unwrap();
        let listed = list_sessions().unwrap();
        assert_eq!(listed, vec![unique.clone()]);
        assert!(!listed.iter().any(|session| session == "_ui"));
        let body = require_model_json(&unique).unwrap();
        assert!(body.contains("\"version\":1"));
        let list = sessions_list_json();
        assert_eq!(list["sessions"][0], unique);
        assert_eq!(list["session_details"][0]["has_model"], true);
        assert_eq!(list["session_details"][0]["heartbeat"]["stale"], false);
        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_and_resolve_expose_window_and_document_ids() {
        let _guard = ENV_LOCK.lock().unwrap();
        let unique = test_session_uuid();
        let other = format!(
            "00000000-0000-4000-8000-{:012x}",
            (now_ms().wrapping_add(7)) & 0xffffffffffff
        );
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-mw-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        write_session(&unique, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &unique,
            "heartbeat.json",
            &format!(
                r#"{{"updated_ms":{},"generation":1,"session_id":"{unique}","window_id":"main","document_id":"tab-a","project_session_id":"tab-a"}}"#,
                now_ms()
            ),
        )
        .unwrap();
        write_session(&other, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &other,
            "heartbeat.json",
            &format!(
                r#"{{"updated_ms":{},"generation":2,"session_id":"{other}","window_id":"secondary","document_id":"tab-b","project_session_id":"tab-b"}}"#,
                now_ms()
            ),
        )
        .unwrap();

        let list = sessions_list_json();
        assert_eq!(list["session_details"].as_array().unwrap().len(), 2);
        let main = list["session_details"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["session_id"] == unique)
            .cloned()
            .unwrap();
        assert_eq!(main["window_id"], "main");
        assert_eq!(main["document_id"], "tab-a");
        assert_eq!(list["windows"].as_array().unwrap().len(), 2);
        let main_window = list["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["window_id"] == "main")
            .cloned()
            .unwrap();
        assert_eq!(main_window["documents"].as_array().unwrap().len(), 1);
        assert_eq!(main_window["active_document_id"], "tab-a");

        let by_window = resolve_attach_target(None, Some("main"), None).unwrap();
        assert_eq!(by_window.session_id, unique);
        assert_eq!(by_window.window_id.as_deref(), Some("main"));
        let by_document = resolve_attach_target(None, None, Some("tab-b")).unwrap();
        assert_eq!(by_document.session_id, other);
        let by_uuid_document = resolve_attach_target(None, None, Some(&unique)).unwrap();
        assert_eq!(by_uuid_document.session_id, unique);
        assert!(resolve_attach_target(Some(&unique), Some("secondary"), None).is_err());
        assert!(resolve_attach_target(None, Some("missing-window"), None).is_err());
        assert!(resolve_attach_target(None, None, None).is_err());

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn attach_intersects_window_and_document_before_ambiguity() {
        let _guard = ENV_LOCK.lock().unwrap();
        let tab_a = test_session_uuid();
        let tab_b = format!(
            "00000000-0000-4000-8000-{:012x}",
            (now_ms().wrapping_add(11)) & 0xffffffffffff
        );
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-intersect-{tab_a}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        for (sid, doc) in [(&tab_a, "tab-a"), (&tab_b, "tab-b")] {
            write_session(sid, "model.json", r#"{"version":1}"#).unwrap();
            write_session(
                sid,
                "heartbeat.json",
                &format!(
                    r#"{{"updated_ms":{},"generation":1,"session_id":"{sid}","window_id":"main","document_id":"{doc}","project_session_id":"{doc}"}}"#,
                    now_ms()
                ),
            )
            .unwrap();
        }

        // window_id alone is ambiguous with two tabs in main.
        let err = resolve_attach_target(None, Some("main"), None).expect_err("ambiguous window");
        assert!(err.contains("ambiguous"), "{err}");

        // Combined window + document selects exactly one.
        let hit = resolve_attach_target(None, Some("main"), Some("tab-a")).unwrap();
        assert_eq!(hit.session_id, tab_a);
        assert_eq!(hit.document_id.as_deref(), Some("tab-a"));

        let list = sessions_list_json();
        assert_eq!(list["windows"].as_array().unwrap().len(), 1);
        let main = &list["windows"][0];
        assert_eq!(main["window_id"], "main");
        assert_eq!(main["documents"].as_array().unwrap().len(), 2);

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn closed_tombstone_and_process_instance_shape_live_windows() {
        let _guard = ENV_LOCK.lock().unwrap();
        let live = test_session_uuid();
        let closed = format!(
            "00000000-0000-4000-8000-{:012x}",
            (now_ms().wrapping_add(13)) & 0xffffffffffff
        );
        let prior = format!(
            "00000000-0000-4000-8000-{:012x}",
            (now_ms().wrapping_add(17)) & 0xffffffffffff
        );
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-tombstone-{live}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        fs::create_dir_all(dir.join("_ui")).unwrap();
        fs::write(
            dir.join("_ui").join("process.json"),
            r#"{"process_instance_id":"proc-live"}"#,
        )
        .unwrap();

        write_session(&live, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &live,
            "heartbeat.json",
            &format!(
                r#"{{"updated_ms":{},"generation":1,"session_id":"{live}","window_id":"main","document_id":"open","project_session_id":"open","process_instance_id":"proc-live"}}"#,
                now_ms()
            ),
        )
        .unwrap();

        write_session(&closed, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &closed,
            "heartbeat.json",
            &format!(
                r#"{{"updated_ms":{},"generation":1,"session_id":"{closed}","window_id":"main","document_id":"gone","project_session_id":"gone","process_instance_id":"proc-live"}}"#,
                now_ms()
            ),
        )
        .unwrap();
        write_closed_tombstone(&closed).unwrap();

        write_session(&prior, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &prior,
            "heartbeat.json",
            &format!(
                r#"{{"updated_ms":{},"generation":1,"session_id":"{prior}","window_id":"main","document_id":"old-run","project_session_id":"old-run","process_instance_id":"proc-old"}}"#,
                now_ms()
            ),
        )
        .unwrap();

        let list = sessions_list_json();
        assert_eq!(list["process_instance_id"], "proc-live");
        assert_eq!(list["windows"].as_array().unwrap().len(), 1);
        assert_eq!(list["windows"][0]["documents"].as_array().unwrap().len(), 1);
        assert_eq!(list["windows"][0]["active_document_id"], "open");

        // Closed / prior-run tabs are not window-selectable.
        assert!(resolve_attach_target(None, Some("main"), Some("gone")).is_err());
        assert!(resolve_attach_target(None, None, Some("old-run")).is_err());
        // Explicit session_id still resolves the closed dir for recovery.
        let recovered = resolve_attach_target(Some(&closed), None, None).unwrap();
        assert_eq!(recovered.session_id, closed);

        clear_closed_tombstone(&closed).unwrap();
        assert!(!is_session_closed(&closed));

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_session_rejects_non_uuid() {
        let _guard = ENV_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-bad-{}", now_ms()));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        assert!(write_session("not-a-uuid", "model.json", "{}").is_err());
        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn inbox_write_and_stale_apply_are_generation_locked() {
        let _guard = ENV_LOCK.lock().unwrap();
        let unique = test_session_uuid();
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-inbox-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        write_session(&unique, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &unique,
            "heartbeat.json",
            &format!(r#"{{"updated_ms":{},"generation":3}}"#, now_ms()),
        )
        .unwrap();

        let seq = write_inbox_op(
            &unique,
            &InboxOp {
                name: "solid_mirror".to_string(),
                arguments: json!({"body_ids": [1]}),
                base_generation: 3,
            },
        )
        .unwrap();
        assert_eq!(seq, 1);
        let pending = pending_inbox_seqs(&unique).unwrap();
        assert_eq!(pending, vec![1]);
        let body = read_session_file(&unique, "inbox/1.json").unwrap();
        assert!(body.contains("solid_mirror"));
        assert!(body.contains("base_generation"));

        write_session(
            &unique,
            "heartbeat.json",
            &format!(r#"{{"updated_ms":{},"generation":4}}"#, now_ms()),
        )
        .unwrap();
        // Valid follow-up at the new generation. After seq 1 dead-letters,
        // the next apply_inbox_op must take the lowest remaining pending.
        let seq2 = write_inbox_op(
            &unique,
            &InboxOp {
                name: "cad_set_document_name".to_string(),
                arguments: json!({"name": "AfterStaleHead"}),
                base_generation: 4,
            },
        )
        .unwrap();
        assert_eq!(seq2, 2);
        let err = apply_inbox_op(&unique, |_name, _args| Ok(json!({"applied": true})))
            .expect_err("stale base_generation must not apply");
        let parsed: Value = serde_json::from_str(&err).unwrap();
        assert_eq!(parsed["code"], "generation_conflict");
        assert_eq!(parsed["writeback"], false);
        assert_eq!(parsed["session_mode"], "ui_owned_apply");
        assert_eq!(
            pending_inbox_seqs(&unique).unwrap(),
            vec![2],
            "stale head must dead-letter so seq 2 can apply"
        );
        let failed = session_dir().join(&unique).join("inbox/failed/1.json");
        assert!(failed.exists(), "expected inbox/failed/1.json");
        let failed_body = fs::read_to_string(&failed).unwrap();
        assert!(
            failed_body.contains("generation_conflict"),
            "dead-letter must record the conflict reason: {failed_body}"
        );

        let applied = apply_inbox_op(&unique, |name, arguments| {
            assert_eq!(name, "cad_set_document_name");
            assert_eq!(arguments["name"], "AfterStaleHead");
            Ok(json!({"name": "AfterStaleHead"}))
        })
        .unwrap();
        assert_eq!(applied.seq, 2);
        assert_eq!(applied.op.name, "cad_set_document_name");

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn concurrent_inbox_alloc_gives_distinct_durable_entries() {
        let _guard = ENV_LOCK.lock().unwrap();
        let unique = test_session_uuid();
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-inbox-race-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        write_session(&unique, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &unique,
            "heartbeat.json",
            &format!(r#"{{"updated_ms":{},"generation":1}}"#, now_ms()),
        )
        .unwrap();

        const THREADS: usize = 16;
        const PER_THREAD: usize = 8;
        let session_id = unique.clone();
        let mut handles = Vec::new();
        for thread in 0..THREADS {
            let sid = session_id.clone();
            handles.push(std::thread::spawn(move || {
                let mut allocated = Vec::new();
                for index in 0..PER_THREAD {
                    let marker = format!("{thread}-{index}");
                    let seq = write_inbox_op(
                        &sid,
                        &InboxOp {
                            name: "solid_mirror".to_string(),
                            arguments: json!({"body_ids": [1], "marker": marker}),
                            base_generation: 1,
                        },
                    )
                    .expect("exclusive inbox reserve must succeed");
                    allocated.push((seq, format!("{thread}-{index}")));
                }
                allocated
            }));
        }
        let mut all = Vec::new();
        for handle in handles {
            all.extend(handle.join().expect("inbox alloc thread"));
        }
        let expected = THREADS * PER_THREAD;
        assert_eq!(all.len(), expected);
        let mut seqs: Vec<u64> = all.iter().map(|(seq, _)| *seq).collect();
        seqs.sort_unstable();
        let mut unique_seqs = seqs.clone();
        unique_seqs.dedup();
        assert_eq!(
            unique_seqs.len(),
            expected,
            "duplicate inbox seq under contention: {seqs:?}"
        );
        for (seq, marker) in &all {
            let body = read_session_file(&session_id, &format!("inbox/{seq}.json")).unwrap();
            assert!(
                body.contains(marker),
                "seq {seq} lost marker {marker}: {body}"
            );
        }
        assert_eq!(pending_inbox_seqs(&session_id).unwrap().len(), expected);

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_inbox_json_is_dead_lettered_and_unblocks_queue() {
        let _guard = ENV_LOCK.lock().unwrap();
        let unique = test_session_uuid();
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-badjson-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        write_session(&unique, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &unique,
            "heartbeat.json",
            &format!(r#"{{"updated_ms":{},"generation":1}}"#, now_ms()),
        )
        .unwrap();
        let inbox = session_dir().join(&unique).join("inbox");
        fs::create_dir_all(&inbox).unwrap();
        fs::write(inbox.join("1.json"), "{not-json").unwrap();
        let seq = write_inbox_op(
            &unique,
            &InboxOp {
                name: "cad_set_document_name".to_string(),
                arguments: json!({"name": "AfterBadJson"}),
                base_generation: 1,
            },
        )
        .unwrap();
        assert_eq!(seq, 2);
        let err = apply_inbox_op(&unique, |_name, _args| Ok(json!({"applied": true})))
            .expect_err("malformed json must fail apply");
        assert!(
            err.contains("invalid inbox") || err.contains("expected"),
            "expected a JSON parse error, got {err}"
        );
        assert_eq!(
            pending_inbox_seqs(&unique).unwrap(),
            vec![2],
            "malformed head must dead-letter so seq 2 can apply"
        );
        let failed = session_dir().join(&unique).join("inbox/failed/1.json");
        assert!(failed.exists(), "expected inbox/failed/1.json");
        let failed_body = fs::read_to_string(&failed).unwrap();
        assert!(
            failed_body.contains("raw") && failed_body.contains("{not-json"),
            "dead-letter must keep the raw malformed bytes: {failed_body}"
        );

        let applied = apply_inbox_op(&unique, |name, arguments| {
            assert_eq!(name, "cad_set_document_name");
            assert_eq!(arguments["name"], "AfterBadJson");
            Ok(json!({"name": "AfterBadJson"}))
        })
        .unwrap();
        assert_eq!(applied.seq, 2);
        assert_eq!(applied.op.name, "cad_set_document_name");

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn same_base_generation_second_op_is_dead_lettered() {
        // Match native: first apply + publish advances generation; the leftover
        // same-base head dead-letters with a reason so later seqs can run.
        let _guard = ENV_LOCK.lock().unwrap();
        let unique = test_session_uuid();
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-samebase-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        write_session(&unique, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &unique,
            "heartbeat.json",
            &format!(r#"{{"updated_ms":{},"generation":1}}"#, now_ms()),
        )
        .unwrap();
        write_inbox_op(
            &unique,
            &InboxOp {
                name: "cad_set_document_name".to_string(),
                arguments: json!({"name": "First"}),
                base_generation: 1,
            },
        )
        .unwrap();
        write_inbox_op(
            &unique,
            &InboxOp {
                name: "cad_set_document_name".to_string(),
                arguments: json!({"name": "Second"}),
                base_generation: 1,
            },
        )
        .unwrap();
        let first = apply_inbox_op(&unique, |name, arguments| {
            assert_eq!(name, "cad_set_document_name");
            assert_eq!(arguments["name"], "First");
            Ok(json!({"name": "First"}))
        })
        .unwrap();
        assert_eq!(first.seq, 1);
        publish_applied_snapshot(&unique, r#"{"version":1,"name":"First"}"#).unwrap();
        assert_eq!(pending_inbox_seqs(&unique).unwrap(), vec![2]);

        let err = apply_inbox_op(&unique, |_name, _args| {
            panic!("host must not run on generation_conflict")
        })
        .expect_err("same-base leftover must conflict");
        let parsed: Value = serde_json::from_str(&err).unwrap();
        assert_eq!(parsed["code"], "generation_conflict");
        assert!(
            pending_inbox_seqs(&unique).unwrap().is_empty(),
            "conflicted same-base head must dead-letter"
        );
        let failed = session_dir().join(&unique).join("inbox/failed/2.json");
        assert!(failed.exists(), "expected inbox/failed/2.json");
        let failed_body = fs::read_to_string(&failed).unwrap();
        assert!(
            failed_body.contains("generation_conflict"),
            "dead-letter must record the reason: {failed_body}"
        );

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unsupported_inbox_mutate_is_dead_lettered_and_unblocks_queue() {
        // Match native: a head that is not in the shared mutate map must
        // dead-letter before host_apply so later seqs can run.
        let _guard = ENV_LOCK.lock().unwrap();
        let unique = test_session_uuid();
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-unsupported-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        write_session(&unique, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &unique,
            "heartbeat.json",
            &format!(r#"{{"updated_ms":{},"generation":1}}"#, now_ms()),
        )
        .unwrap();
        write_inbox_op(
            &unique,
            &InboxOp {
                name: "assembly_document".to_string(),
                arguments: json!({}),
                base_generation: 1,
            },
        )
        .unwrap();
        write_inbox_op(
            &unique,
            &InboxOp {
                name: "cad_set_document_name".to_string(),
                arguments: json!({"name": "AfterUnsupported"}),
                base_generation: 1,
            },
        )
        .unwrap();
        assert!(
            nbcad_mcp_mutate::lookup_mutate("assembly_document").is_none(),
            "assembly_document is inspect-only and must not be an inbox mutate"
        );
        let err = apply_inbox_op(&unique, |_name, _args| {
            panic!("host must not run on unsupported inbox mutate")
        })
        .expect_err("unsupported mutate must fail apply");
        assert!(
            err.contains("unsupported inbox mutate") && err.contains("assembly_document"),
            "expected unsupported mutate error, got {err}"
        );
        assert_eq!(
            pending_inbox_seqs(&unique).unwrap(),
            vec![2],
            "unsupported head must dead-letter so seq 2 can apply"
        );
        let failed = session_dir().join(&unique).join("inbox/failed/1.json");
        assert!(failed.exists(), "expected inbox/failed/1.json");
        let failed_body = fs::read_to_string(&failed).unwrap();
        assert!(
            failed_body.contains("unsupported inbox mutate"),
            "dead-letter must record the reason: {failed_body}"
        );

        let applied = apply_inbox_op(&unique, |name, arguments| {
            assert_eq!(name, "cad_set_document_name");
            assert_eq!(arguments["name"], "AfterUnsupported");
            Ok(json!({"name": "AfterUnsupported"}))
        })
        .unwrap();
        assert_eq!(applied.seq, 2);
        assert_eq!(applied.op.name, "cad_set_document_name");

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn already_applied_inbox_seq_second_apply_is_noop() {
        // applyInboxNow of an already-archived seq must not call host again.
        // Native returns applied:false / empty; helper errors "no pending".
        let _guard = ENV_LOCK.lock().unwrap();
        let unique = test_session_uuid();
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-already-applied-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        write_session(&unique, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &unique,
            "heartbeat.json",
            &format!(r#"{{"updated_ms":{},"generation":1}}"#, now_ms()),
        )
        .unwrap();
        write_inbox_op(
            &unique,
            &InboxOp {
                name: "cad_set_document_name".to_string(),
                arguments: json!({"name": "Once"}),
                base_generation: 1,
            },
        )
        .unwrap();
        let mut host_calls = 0u32;
        let first = apply_inbox_op(&unique, |name, arguments| {
            host_calls += 1;
            assert_eq!(name, "cad_set_document_name");
            assert_eq!(arguments["name"], "Once");
            Ok(json!({"name": "Once"}))
        })
        .unwrap();
        assert_eq!(first.seq, 1);
        assert_eq!(host_calls, 1);
        assert!(
            pending_inbox_seqs(&unique).unwrap().is_empty(),
            "applied seq must leave the pending queue"
        );
        let applied_path = session_dir().join(&unique).join("inbox/applied/1.json");
        assert!(applied_path.exists(), "expected inbox/applied/1.json");

        let err = apply_inbox_op(&unique, |_name, _args| {
            host_calls += 1;
            panic!("host must not run on already-applied seq")
        })
        .expect_err("already-applied seq must be a no-op");
        assert!(
            err.contains("no pending inbox op"),
            "expected empty-inbox no-op, got {err}"
        );
        assert_eq!(
            host_calls, 1,
            "already-applied seq must not host-apply again"
        );
        assert!(pending_inbox_seqs(&unique).unwrap().is_empty());

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_heartbeat_generation_is_dead_lettered_and_unblocks_queue() {
        // Leftover apply reads heartbeat.json generation. If that source is
        // missing/unreadable, treat it as generation_conflict and dead-letter
        // so later seqs are not wedged. Native apply uses in-memory
        // engine_revision and never waits on the file.
        let _guard = ENV_LOCK.lock().unwrap();
        let unique = test_session_uuid();
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-no-hb-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        write_session(&unique, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &unique,
            "heartbeat.json",
            &format!(r#"{{"updated_ms":{},"generation":1}}"#, now_ms()),
        )
        .unwrap();
        write_inbox_op(
            &unique,
            &InboxOp {
                name: "cad_set_document_name".to_string(),
                arguments: json!({"name": "MissingHb"}),
                base_generation: 1,
            },
        )
        .unwrap();
        write_inbox_op(
            &unique,
            &InboxOp {
                name: "cad_set_document_name".to_string(),
                arguments: json!({"name": "AfterMissingHb"}),
                base_generation: 1,
            },
        )
        .unwrap();
        let hb = session_dir().join(&unique).join("heartbeat.json");
        fs::remove_file(&hb).unwrap();
        let err = apply_inbox_op(&unique, |_name, _args| {
            panic!("host must not run without a heartbeat generation")
        })
        .expect_err("missing heartbeat must generation_conflict");
        let parsed: Value = serde_json::from_str(&err).unwrap();
        assert_eq!(parsed["code"], "generation_conflict");
        assert_eq!(parsed["writeback"], false);
        assert_eq!(parsed["session_mode"], "ui_owned_apply");
        assert_eq!(
            pending_inbox_seqs(&unique).unwrap(),
            vec![2],
            "missing-heartbeat head must dead-letter so seq 2 can apply"
        );
        let failed = session_dir().join(&unique).join("inbox/failed/1.json");
        assert!(failed.exists(), "expected inbox/failed/1.json");
        let failed_body = fs::read_to_string(&failed).unwrap();
        assert!(
            failed_body.contains("generation_conflict"),
            "dead-letter must record the reason: {failed_body}"
        );

        // Restore a matching generation so the leftover helper can apply seq 2.
        write_session(
            &unique,
            "heartbeat.json",
            &format!(r#"{{"updated_ms":{},"generation":1}}"#, now_ms()),
        )
        .unwrap();
        let applied = apply_inbox_op(&unique, |name, arguments| {
            assert_eq!(name, "cad_set_document_name");
            assert_eq!(arguments["name"], "AfterMissingHb");
            Ok(json!({"name": "AfterMissingHb"}))
        })
        .unwrap();
        assert_eq!(applied.seq, 2);
        assert_eq!(applied.op.name, "cad_set_document_name");

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn age_stale_heartbeat_with_matching_generation_still_applies() {
        // Listing staleness (age > HEARTBEAT_STALE_MS) is not a writer lock.
        // Matching generation must apply, leftover and native alike.
        let _guard = ENV_LOCK.lock().unwrap();
        let unique = test_session_uuid();
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-age-stale-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        write_session(&unique, "model.json", r#"{"version":1}"#).unwrap();
        let stale_ms = now_ms().saturating_sub(HEARTBEAT_STALE_MS + 5_000);
        write_session(
            &unique,
            "heartbeat.json",
            &format!(r#"{{"updated_ms":{stale_ms},"generation":1}}"#),
        )
        .unwrap();
        let meta = heartbeat_meta(&unique);
        assert_eq!(meta["stale"], true, "fixture must be age-stale: {meta}");
        assert_eq!(meta["generation"], 1);
        write_inbox_op(
            &unique,
            &InboxOp {
                name: "cad_set_document_name".to_string(),
                arguments: json!({"name": "AgeStaleOk"}),
                base_generation: 1,
            },
        )
        .unwrap();
        let applied = apply_inbox_op(&unique, |name, arguments| {
            assert_eq!(name, "cad_set_document_name");
            assert_eq!(arguments["name"], "AgeStaleOk");
            Ok(json!({"name": "AgeStaleOk"}))
        })
        .unwrap();
        assert_eq!(applied.seq, 1);
        assert!(
            pending_inbox_seqs(&unique).unwrap().is_empty(),
            "matching generation must archive, not dead-letter on age"
        );
        let failed = session_dir().join(&unique).join("inbox/failed/1.json");
        assert!(
            !failed.exists(),
            "age-stale matching gen must not dead-letter"
        );
        let archived = session_dir().join(&unique).join("inbox/applied/1.json");
        assert!(archived.exists(), "expected inbox/applied/1.json");

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_takes_lowest_pending_seq_even_when_higher_exists() {
        // Out-of-order: seq 2 must not apply while seq 1 is still pending.
        let _guard = ENV_LOCK.lock().unwrap();
        let unique = test_session_uuid();
        let dir = std::env::temp_dir().join(format!("nbcad-sessions-seq-order-{unique}"));
        std::env::set_var("NBCAD_SESSION_DIR", &dir);
        write_session(&unique, "model.json", r#"{"version":1}"#).unwrap();
        write_session(
            &unique,
            "heartbeat.json",
            &format!(r#"{{"updated_ms":{},"generation":1}}"#, now_ms()),
        )
        .unwrap();
        write_inbox_op(
            &unique,
            &InboxOp {
                name: "cad_set_document_name".to_string(),
                arguments: json!({"name": "First"}),
                base_generation: 1,
            },
        )
        .unwrap();
        write_inbox_op(
            &unique,
            &InboxOp {
                name: "cad_set_document_name".to_string(),
                arguments: json!({"name": "Second"}),
                base_generation: 1,
            },
        )
        .unwrap();
        assert_eq!(pending_inbox_seqs(&unique).unwrap(), vec![1, 2]);
        let first = apply_inbox_op(&unique, |name, arguments| {
            assert_eq!(name, "cad_set_document_name");
            assert_eq!(arguments["name"], "First");
            Ok(json!({"name": "First"}))
        })
        .unwrap();
        assert_eq!(first.seq, 1);
        assert_eq!(pending_inbox_seqs(&unique).unwrap(), vec![2]);

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }
}
