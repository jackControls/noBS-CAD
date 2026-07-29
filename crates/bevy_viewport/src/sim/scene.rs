//! Readable cantilever: fixed abutment (left), beam segments, tip load dart.

use bevy::prelude::*;

use super::physics::{SimBody, SimLoad, SimStressField};
use super::present::SimPresent;
use super::{SimElapsed, SimTelemetry};

pub const SEGMENT_COUNT: usize = 8;
pub const SEGMENT_LEN: f32 = 0.42;
pub const BEAM_Y: f32 = 0.55;

#[derive(Component)]
pub struct SimRoot;

#[derive(Component)]
pub struct SegmentIndex(pub usize);

#[derive(Component)]
pub struct LoadDart;

pub fn spawn_sim_world(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut body: ResMut<SimBody>,
    mut field: ResMut<SimStressField>,
    mut elapsed: ResMut<SimElapsed>,
    mut telemetry: ResMut<SimTelemetry>,
    load: Res<SimLoad>,
) {
    *body = SimBody::default();
    *field = SimStressField::default();
    elapsed.0.reset();
    elapsed.0.unpause();
    *telemetry = SimTelemetry {
        relative_speed: 1.0,
        ..default()
    };

    let root = commands
        .spawn((
            Name::new("SimWorld"),
            SimRoot,
            Transform::default(),
            Visibility::Visible,
        ))
        .id();

    // Fixed abutment (left).
    commands.spawn((
        Name::new("Abutment"),
        Mesh3d(meshes.add(Cuboid::new(0.55, 1.1, 0.7))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.22, 0.24, 0.28),
            metallic: 0.35,
            perceptual_roughness: 0.55,
            ..default()
        })),
        Transform::from_xyz(-0.15, 0.05, 0.0),
        Pickable::IGNORE,
        ChildOf(root),
    ));

    // Beam segments.
    let seg_mesh = meshes.add(Cuboid::new(SEGMENT_LEN * 0.95, 0.16, 0.28));
    for i in 0..SEGMENT_COUNT {
        let x = SEGMENT_LEN * 0.5 + i as f32 * SEGMENT_LEN;
        commands.spawn((
            Name::new(format!("BeamSeg{i}")),
            Mesh3d(seg_mesh.clone()),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: Color::srgb(0.35, 0.55, 0.7),
                emissive: LinearRgba::rgb(0.05, 0.08, 0.12),
                metallic: 0.15,
                perceptual_roughness: 0.45,
                ..default()
            })),
            Transform::from_xyz(x, BEAM_Y, 0.0),
            SegmentIndex(i),
            SimPresent,
            Pickable::IGNORE,
            ChildOf(root),
        ));
    }

    // Tip load dart (arrow-ish pyramid + shaft).
    let tip_x = SEGMENT_COUNT as f32 * SEGMENT_LEN + 0.05;
    let dart = commands
        .spawn((
            Name::new("LoadDart"),
            LoadDart,
            Transform::from_xyz(tip_x, BEAM_Y - 0.35, 0.0),
            Visibility::Visible,
            Pickable::IGNORE,
            ChildOf(root),
        ))
        .id();

    commands.spawn((
        Mesh3d(meshes.add(Cone::new(0.12, 0.28))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.95, 0.35, 0.2),
            emissive: LinearRgba::rgb(0.8, 0.15, 0.05),
            unlit: true,
            ..default()
        })),
        Transform::from_rotation(Quat::from_rotation_z(std::f32::consts::PI)),
        ChildOf(dart),
        Pickable::IGNORE,
    ));
    commands.spawn((
        Mesh3d(meshes.add(Cylinder::new(0.035, 0.45))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.9, 0.4, 0.25),
            emissive: LinearRgba::rgb(0.5, 0.1, 0.05),
            unlit: true,
            ..default()
        })),
        Transform::from_xyz(0.0, 0.35, 0.0),
        ChildOf(dart),
        Pickable::IGNORE,
    ));

    // Load magnitude label marker (small cube at tip).
    commands.spawn((
        Name::new(format!("Load {:.0}%", load.0 * 100.0)),
        Mesh3d(meshes.add(Cuboid::new(0.08, 0.08, 0.08))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(1.0, 0.85, 0.3),
            unlit: true,
            ..default()
        })),
        Transform::from_xyz(tip_x, BEAM_Y + 0.35, 0.0),
        ChildOf(root),
        Pickable::IGNORE,
    ));
}

pub fn despawn_sim_world(
    mut commands: Commands,
    roots: Query<Entity, With<SimRoot>>,
    mut virtual_time: ResMut<Time<Virtual>>,
) {
    for entity in &roots {
        commands.entity(entity).despawn();
    }
    // Leave Virtual unpaused for next enter; speed stays as user set.
    if virtual_time.is_paused() {
        virtual_time.unpause();
    }
}
