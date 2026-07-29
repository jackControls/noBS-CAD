//! Orbit camera for the spike (RMB drag + scroll zoom).
//!
//! CAD product path should later offer orthographic projection for
//! dimensionally accurate views (Bevy cheatbook / ADR follow-on).

use bevy::input::mouse::{AccumulatedMouseMotion, AccumulatedMouseScroll};
use bevy::prelude::*;
use std::f32::consts::FRAC_PI_2;
use std::ops::Range;

#[derive(Component)]
pub struct OrbitCamera;

#[derive(Resource)]
pub struct OrbitSettings {
    pub target: Vec3,
    pub distance: f32,
    pub pitch: f32,
    pub yaw: f32,
    pub pitch_range: Range<f32>,
    pub orbit_speed: f32,
    pub zoom_speed: f32,
}

impl Default for OrbitSettings {
    fn default() -> Self {
        let limit = FRAC_PI_2 - 0.05;
        Self {
            target: Vec3::ZERO,
            distance: 4.0,
            pitch: 0.45,
            yaw: 0.7,
            pitch_range: -limit..limit,
            orbit_speed: 0.005,
            zoom_speed: 0.15,
        }
    }
}

pub fn orbit_camera(
    mut camera: Single<&mut Transform, With<OrbitCamera>>,
    mut orbit: ResMut<OrbitSettings>,
    mouse_buttons: Res<ButtonInput<MouseButton>>,
    mouse_motion: Res<AccumulatedMouseMotion>,
    scroll: Res<AccumulatedMouseScroll>,
) {
    if mouse_buttons.pressed(MouseButton::Right) {
        let delta = mouse_motion.delta;
        orbit.yaw -= delta.x * orbit.orbit_speed;
        orbit.pitch = (orbit.pitch - delta.y * orbit.orbit_speed)
            .clamp(orbit.pitch_range.start, orbit.pitch_range.end);
    }

    if scroll.delta.y != 0.0 {
        orbit.distance =
            (orbit.distance * (1.0 - scroll.delta.y * orbit.zoom_speed)).clamp(1.0, 40.0);
    }

    apply_orbit(&mut camera, &orbit);
}

pub fn apply_orbit(transform: &mut Transform, orbit: &OrbitSettings) {
    let rotation = Quat::from_euler(EulerRot::YXZ, orbit.yaw, orbit.pitch, 0.0);
    transform.rotation = rotation;
    // Camera looks down local -Z; place it so that direction points at the target.
    transform.translation = orbit.target - transform.forward() * orbit.distance;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orbit_looks_toward_target() {
        let orbit = OrbitSettings::default();
        let mut transform = Transform::default();
        apply_orbit(&mut transform, &orbit);
        let to_target = (orbit.target - transform.translation).normalize();
        assert!(
            (to_target - *transform.forward()).length() < 1e-4,
            "camera forward should face the orbit target"
        );
    }
}
