//! Deterministic tip-load / bend integration (FixedUpdate).

use bevy::prelude::*;

use super::SEGMENT_COUNT;

/// Tip load factor in \[0.2, 1.0\].
#[derive(Resource, Debug, Clone, Copy)]
pub struct SimLoad(pub f32);

impl Default for SimLoad {
    fn default() -> Self {
        Self(0.72)
    }
}

/// Integrated cantilever state (authoritative Fixed step).
#[derive(Resource, Debug, Clone)]
pub struct SimBody {
    /// Normalized bend phase (radians of oscillation envelope).
    pub phase: f32,
    /// Tip deflection in mm (display units match mock FEA HUD).
    pub tip_deflection_mm: f32,
    /// Previous tip deflection for present interpolation.
    pub prev_tip_deflection_mm: f32,
    /// Per-segment stress 0..1 at last fixed step.
    pub segment_stress: [f32; SEGMENT_COUNT],
}

impl Default for SimBody {
    fn default() -> Self {
        Self {
            phase: 0.0,
            tip_deflection_mm: 0.0,
            prev_tip_deflection_mm: 0.0,
            segment_stress: [0.0; SEGMENT_COUNT],
        }
    }
}

#[derive(Resource, Debug, Clone, Default)]
pub struct SimStressField {
    pub segments: [f32; SEGMENT_COUNT],
}

impl SimStressField {
    pub fn peak_mpa(&self, load: f32) -> f32 {
        let peak = self.segments.iter().copied().fold(0.0_f32, f32::max);
        40.0 + peak * load * 180.0
    }
}

/// Pure bend integrator used by FixedUpdate and unit tests.
pub fn bend_step(body: &mut SimBody, load: &SimLoad, dt: f32) {
    body.prev_tip_deflection_mm = body.tip_deflection_mm;
    body.phase += dt * (1.1 + load.0 * 0.9);

    // Soft oscillation around a load-biased tip drop (readable cantilever).
    let envelope = 2.0 + load.0 * 10.0;
    let wiggle = (body.phase.sin() * 0.35 + 0.65) * envelope;
    body.tip_deflection_mm = wiggle;

    for i in 0..SEGMENT_COUNT {
        let t = i as f32 / (SEGMENT_COUNT - 1) as f32;
        // Root high stress, tip lower — classic cantilever colormap.
        let root_bias = 1.0 - t * 0.55;
        let pulse = 0.55 + 0.45 * (body.phase * 1.3 + t * 2.0).sin().abs();
        body.segment_stress[i] = (root_bias * pulse * load.0).clamp(0.0, 1.0);
    }
}

pub fn fixed_bend_step(
    mut body: ResMut<SimBody>,
    load: Res<SimLoad>,
    mut field: ResMut<SimStressField>,
    time: Res<Time<Fixed>>,
) {
    bend_step(&mut body, &load, time.delta_secs());
    field.segments = body.segment_stress;
}

pub fn stress_to_color(stress: f32) -> Color {
    let t = stress.clamp(0.0, 1.0);
    // Cool (teal) → warm (amber) → hot (crimson).
    if t < 0.5 {
        let u = t * 2.0;
        Color::srgb(
            0.15 + u * 0.55,
            0.55 + u * 0.25,
            0.75 - u * 0.45,
        )
    } else {
        let u = (t - 0.5) * 2.0;
        Color::srgb(0.70 + u * 0.25, 0.80 - u * 0.55, 0.30 - u * 0.2)
    }
}
