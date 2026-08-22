//! Headless session directories under `NBCAD_SESSION_DIR` (or temp `nbcad-sessions`).
//!
//! Snapshot publish is **UI-owned**. MCP may `cad_attach` (copy) and `cad_submit`
//! an inbox op; it must **not** write `model.json` back (no last-writer-wins).
//! The desktop/engine applies inbox ops via the same `host::handle` path as
//! Tauri IPC, then the existing publisher writes a new snapshot. This is still
//! **not** in-process shared memory.
//!
//! Layout: `<session_dir>/<uuid>/{model.json,active-sketch.json?,focus.json,heartbeat.json,inbox/<seq>.json}`.
//! Session ids must be UUID v4 strings.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
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
            })
        }
        Err(_) => json!({
            "updated_ms": null,
            "age_ms": null,
            "stale": true,
            "generation": null,
        }),
    }
}

pub fn sessions_list_json() -> Value {
    match list_sessions() {
        Ok(sessions) => {
            let detailed: Vec<Value> = sessions
                .iter()
                .map(|session_id| {
                    let has_model = session_path(session_id, "model.json")
                        .map(|path| path.is_file())
                        .unwrap_or(false);
                    json!({
                        "session_id": session_id,
                        "has_model": has_model,
                        "heartbeat": heartbeat_meta(session_id),
                    })
                })
                .collect();
            json!({
                "session_mode": "read_only_snapshot",
                "sessions": sessions,
                "session_details": detailed,
                "session_dir": session_dir().display().to_string(),
                "heartbeat_stale_ms": HEARTBEAT_STALE_MS,
            })
        }
        Err(error) => json!({
            "session_mode": "read_only_snapshot",
            "sessions": [],
            "session_details": [],
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

/// Next inbox sequence (1-based), considering pending and archived ops.
pub fn next_inbox_seq(session_id: &str) -> Result<u64, String> {
    require_valid_session_id(session_id)?;
    let root = session_dir().join(session_id);
    let mut max = 0u64;
    for seq in inbox_seqs_in(&root.join("inbox")) {
        max = max.max(seq);
    }
    for seq in inbox_seqs_in(&root.join("inbox").join("applied")) {
        max = max.max(seq);
    }
    Ok(max.saturating_add(1))
}

/// Pending inbox seqs, lowest first.
pub fn pending_inbox_seqs(session_id: &str) -> Result<Vec<u64>, String> {
    require_valid_session_id(session_id)?;
    Ok(inbox_seqs_in(&session_dir().join(session_id).join("inbox")))
}

/// Atomically write `inbox/<seq>.json`. Does not mutate any in-memory document.
pub fn write_inbox_op(session_id: &str, op: &InboxOp) -> Result<u64, String> {
    let seq = next_inbox_seq(session_id)?;
    let body = serde_json::to_string_pretty(&op.to_json())
        .map_err(|error| format!("encode inbox op: {error}"))?;
    write_session(session_id, &format!("inbox/{seq}.json"), &body)?;
    Ok(seq)
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
    let op = read_inbox_op(session_id, seq)?;
    let current = match read_heartbeat_generation(session_id) {
        Ok(generation) => generation,
        Err(_) => {
            return Err(generation_conflict_error(
                session_id,
                op.base_generation,
                None,
            ));
        }
    };
    if op.base_generation != current {
        return Err(generation_conflict_error(
            session_id,
            op.base_generation,
            Some(current),
        ));
    }
    let host_result = host_apply(&op.name, op.arguments.clone())?;
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
        write_session(&unique, "model.json", "{\"version\":1}").unwrap();
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
        let err = apply_inbox_op(&unique, |_name, _args| Ok(json!({"applied": true})))
            .expect_err("stale base_generation must not apply");
        let parsed: Value = serde_json::from_str(&err).unwrap();
        assert_eq!(parsed["code"], "generation_conflict");
        assert_eq!(parsed["writeback"], false);
        assert_eq!(parsed["session_mode"], "ui_owned_apply");
        assert_eq!(pending_inbox_seqs(&unique).unwrap(), vec![1]);

        std::env::remove_var("NBCAD_SESSION_DIR");
        let _ = fs::remove_dir_all(&dir);
    }
}
