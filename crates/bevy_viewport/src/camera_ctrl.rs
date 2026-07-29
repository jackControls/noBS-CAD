//! Orbit camera with per-mode bookmarks. Scroll always zooms.

use bevy::input::mouse::{AccumulatedMouseMotion, AccumulatedMouseScroll};
use bevy::prelude::*;
use std::f32::consts::FRAC_PI_2;
use std::ops::Range;

use crate::session::CadMode;

#[derive(Component)]
pub struct OrbitCamera;

#[derive(Clone, Copy, Debug)]
pub struct CameraBookmark {
    pub target: Vec3,
    pub distance: f32,
    pub pitch: f32,
    pub yaw: f32,
}

impl CameraBookmark {
    pub const SOLID: Self = Self {
        target: Vec3::ZERO,
        distance: 4.0,
        pitch: 0.45,
        yaw: 0.7,
    };

    pub const SIMULATE: Self = Self {
        target: Vec3::new(1.4, 0.35, 0.0),
        distance: 6.0,
        pitch: 0.4,
        yaw: 0.9,
    };

    pub const SKETCH: Self = Self {
        target: Vec3::ZERO,
        distance: 5.0,
        pitch: FRAC_PI_2 - 0.15,
        yaw: 0.0,
    };
}

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
        let b = CameraBookmark::SIMULATE;
        Self {
            target: b.target,
            distance: b.distance,
            pitch: b.pitch,
            yaw: b.yaw,
            pitch_range: -limit..limit,
            orbit_speed: 0.005,
            zoom_speed: 0.15,
        }
    }
}

impl OrbitSettings {
    pub fn apply_bookmark(&mut self, bookmark: CameraBookmark) {
        self.target = bookmark.target;
        self.distance = bookmark.distance;
        self.pitch = bookmark.pitch;
        self.yaw = bookmark.yaw;
    }
}

pub struct CameraPlugin;

impl Plugin for CameraPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<OrbitSettings>()
            .add_systems(Startup, spawn_camera)
            .add_systems(Update, orbit_camera)
            .add_systems(OnEnter(CadMode::Solid), |mut o: ResMut<OrbitSettings>| {
                o.apply_bookmark(CameraBookmark::SOLID);
            })
            .add_systems(OnEnter(CadMode::Sketch), |mut o: ResMut<OrbitSettings>| {
                o.apply_bookmark(CameraBookmark::SKETCH);
            })
            .add_systems(OnEnter(CadMode::Simulate), |mut o: ResMut<OrbitSettings>| {
                o.apply_bookmark(CameraBookmark::SIMULATE);
            });
    }
}

fn spawn_camera(mut commands: Commands, orbit: Res<OrbitSettings>) {
    let mut transform = Transform::default();
    apply_orbit(&mut transform, &orbit);
    commands.spawn((
        Camera3d::default(),
        Camera {
            clear_color: ClearColorConfig::Custom(Color::srgb(0.08, 0.09, 0.11)),
            ..default()
        },
        transform,
        OrbitCamera,
        IsDefaultUiCamera,
        AmbientLight {
            color: Color::srgb(0.7, 0.78, 0.95),
            brightness: 180.0,
            ..default()
        },
    ));
}

fn orbit_camera(
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

    // Scroll always zooms (sim load uses [ ] / UI).
    if scroll.delta.y != 0.0 {
        orbit.distance =
            (orbit.distance * (1.0 - scroll.delta.y * orbit.zoom_speed)).clamp(1.2, 40.0);
    }

    apply_orbit(&mut camera, &orbit);
}

pub fn apply_orbit(transform: &mut Transform, orbit: &OrbitSettings) {
    let rotation = Quat::from_euler(EulerRot::YXZ, orbit.yaw, orbit.pitch, 0.0);
    transform.rotation = rotation;
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
        assert!((to_target - *transform.forward()).length() < 1e-4);
    }
}
