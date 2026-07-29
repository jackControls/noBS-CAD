//! Update presentation: interpolate Fixed state with overstep.

use bevy::prelude::*;

use super::physics::{stress_to_color, SimBody, SimLoad, SimStressField};
use super::scene::{LoadDart, SegmentIndex, SEGMENT_COUNT, SEGMENT_LEN, BEAM_Y};

#[derive(Component)]
pub struct SimPresent;

pub fn present_sim(
    body: Res<SimBody>,
    load: Res<SimLoad>,
    field: Res<SimStressField>,
    fixed: Res<Time<Fixed>>,
    mut segments: Query<
        (&SegmentIndex, &mut Transform, &MeshMaterial3d<StandardMaterial>),
        With<SimPresent>,
    >,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut dart: Query<&mut Transform, (With<LoadDart>, Without<SegmentIndex>)>,
) {
    let alpha = fixed.overstep_fraction();
    let tip = body.prev_tip_deflection_mm.lerp(body.tip_deflection_mm, alpha);
    // Display scale: mm → world units (readable, not 1:1).
    let tip_world = tip * 0.012;

    for (seg, mut transform, material_handle) in &mut segments {
        let t = seg.0 as f32 / (SEGMENT_COUNT - 1) as f32;
        let bend = tip_world * t * t;
        transform.translation.y = BEAM_Y - bend;
        // Slight pitch so the beam reads as bending.
        let slope = tip_world * 2.0 * t / (SEGMENT_COUNT as f32 * SEGMENT_LEN);
        transform.rotation = Quat::from_rotation_z(-slope.atan());

        let stress = field.segments[seg.0].lerp(
            body.segment_stress[seg.0],
            alpha,
        );
        if let Some(mut mat) = materials.get_mut(&material_handle.0) {
            let color = stress_to_color(stress);
            mat.base_color = color;
            mat.emissive = LinearRgba::from(color) * (0.15 + stress * 0.35);
        }
    }

    if let Ok(mut dart_tf) = dart.single_mut() {
        dart_tf.translation.y = BEAM_Y - tip_world - 0.35;
        // Scale dart with load for readability.
        let s = 0.85 + load.0 * 0.35;
        dart_tf.scale = Vec3::splat(s);
    }
}
