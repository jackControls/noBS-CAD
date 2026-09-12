//! Demonstrate the authored mechanism through its actual screw joint.
use super::*;

pub(super) fn run(a: &mut Author) {
    a.call(
        "vise_demo_home",
        "assembly/joints",
        "assembly_document",
        json!({}),
    );
    a.steps
        .push(json!({"view":"isometric","fit":true,"duration_ms":650}));
    a.note("Turn the screw; the jaw follows", "The 4 mm lead converts twelve turns into 48 mm of jaw travel. The captured guides prevent jaw rotation. These are solved joint positions.");
    for (direction, samples) in [
        ("close", (1..=48).collect::<Vec<_>>()),
        ("return", (0..48).rev().collect::<Vec<_>>()),
    ] {
        if direction == "return" {
            a.note("Reverse to the original opening", "Reverse the same screw joint. The thrust fitting pulls the guided jaw back to its original 90 mm opening.");
        }
        for sample in samples {
            let id = format!("vise_demo_{direction}_{sample:02}");
            a.call(
                &id,
                "assembly/joints",
                "assembly_set_joint_motion",
                json!({
                    "joint_id":reference("screw_drive","/id"),
                    "angle_offset_deg":sample as f64 * 90., "linear_offset_mm":0.
                }),
            );
            // No camera fit during travel: the fixed framing makes displacement readable.
            a.steps
                .push(json!({"view":"current","fit":false,"duration_ms":120}));
        }
        let last = if direction == "close" {
            "vise_demo_close_48"
        } else {
            "vise_demo_return_00"
        };
        let travel = if direction == "close" { 48. } else { 0. };
        a.steps.push(json!({"assert":select(reference(last,""),"/joints",json!({"/id":reference("jaw_guide","/id")}),"/linear_offset_mm"),"equals":travel}));
        let solution = format!("vise_demo_{direction}_solution");
        a.call(&solution, "assembly/joints", "assembly_solution", json!({}));
        a.steps.last_mut().unwrap()["expect"] = json!({"/solved":true,"/diagnostics":[]});
    }
    a.steps.push(json!({"assert":reference("vise_demo_return_00","/joints"),"equals":reference("vise_demo_home","/joints")}));

    a.call(
        "vise_demo_visibility",
        "document/appearance",
        "project_visibility",
        json!({}),
    );
    let hidden: Vec<_> = a
        .bodies
        .keys()
        .filter(|part| part.as_str() != "frame")
        .map(|part| a.body_id(part))
        .collect();
    a.call(
        "vise_demo_reveal_guides",
        "document/appearance",
        "project_set_visibility",
        json!({
            "hidden_body_ids":hidden,
            "hidden_sketch_names":reference("vise_demo_visibility","/hidden_sketch_names"),
            "hidden_datum_plane_ids":reference("vise_demo_visibility","/hidden_datum_plane_ids")
        }),
    );
    a.steps.push(
        json!({"view":"isometric","fit":true,"body_id":a.body_id("frame"),"duration_ms":600}),
    );
    a.note("Inspect the captured guides", "Hide the moving parts to see the two dovetail rails and open rear entry. The keyed bridge is installed after the carriage slides onto these rails.");
    a.steps
        .push(json!({"view":"current","fit":false,"duration_ms":1700}));
    a.call(
        "vise_demo_restore_visibility",
        "document/appearance",
        "project_set_visibility",
        reference("vise_demo_visibility", ""),
    );
    a.steps
        .push(json!({"view":"isometric","fit":true,"duration_ms":600}));
}
