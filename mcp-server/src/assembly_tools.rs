//! Typed assembly operations shared by the native inspector and MCP.
use super::*;

pub fn specs() -> Vec<ToolSpec> {
    let id = json!({"type":"integer","minimum":1});
    let mut contact = json!({
        "name":{"type":"string","minLength":1},
        "occurrence_a":id,"body_a":id,"occurrence_b":id,"body_b":id,
        "clearance_mm":{"type":"number","minimum":0},
        "stop_motion":{"type":"boolean"}
    });
    let create = object_schema(
        contact.clone(),
        &["name", "occurrence_a", "body_a", "occurrence_b", "body_b"],
    );
    contact["id"] = id.clone();
    contact["enabled"] = json!({"type":"boolean"});
    vec![
        ToolSpec::direct("assembly_swept_collision_check", "Check swept assembly collisions",
            "Check exact placed B-reps throughout a persisted motion study. Read-only; rates are 1–240 Hz with at most 100,001 samples. Results are sampled collision intervals, not a continuous collision proof.",
            "assembly_swept_collision_check", Payload::Object,
            object_schema(json!({"study_id":id,"sample_rate_hz":{"type":"number","minimum":1,"maximum":240},"clearance_threshold_mm":{"type":"number","minimum":0},"stop_at_first":{"type":"boolean"}}), &["study_id"])),
        ToolSpec::direct("assembly_create_contact_set", "Create assembly contact stop",
            "Create a persisted contact between two placed component bodies. Clearance is millimetres; stop_motion defaults to true.",
            "assembly_create_contact_set", Payload::Object, create),
        ToolSpec::direct("assembly_update_contact_set", "Update assembly contact stop",
            "Replace the full queried contact record, including its stable id, body instances, clearance and enabled/stop flags.",
            "assembly_update_contact_set", Payload::Object,
            object_schema(contact, &["id","name","occurrence_a","body_a","occurrence_b","body_b","clearance_mm","stop_motion","enabled"])),
        ToolSpec::direct("assembly_delete_contact_set", "Delete assembly contact stop",
            "Remove the contact by its stable id without modifying part geometry.",
            "assembly_delete_contact_set", Payload::Field("contact_id"),
            object_schema(json!({"contact_id":id}), &["contact_id"])),
    ]
}
