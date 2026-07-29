//! Startup scene: fixture soup + lights + camera.
//! HUD chrome lives in `ui` (Feathers); legacy StatusText kept for pick debug.

use bevy::color::palettes::tailwind::{CYAN_300, GRAY_300, YELLOW_300};
use bevy::prelude::*;

use crate::cad_session::CadSession;
use crate::camera::{apply_orbit, OrbitCamera, OrbitSettings};
use crate::mesh_convert::triangle_soup_to_mesh;
use crate::picking::{on_click_report, recolor, FixtureBody, StatusText};
use crate::soup::TessellatedTriangleSoup;

#[derive(Resource)]
pub struct SpikeMesh(pub TessellatedTriangleSoup);

pub fn setup_scene(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    spike: Res<SpikeMesh>,
    orbit: Res<OrbitSettings>,
    session: Res<CadSession>,
) {
    let mesh_handle = meshes.add(triangle_soup_to_mesh(&spike.0));
    let base = materials.add(StandardMaterial {
        base_color: session.color,
        metallic: 0.05,
        perceptual_roughness: 0.55,
        unlit: true,
        ..default()
    });
    let hover = materials.add(StandardMaterial {
        base_color: Color::from(CYAN_300),
        unlit: true,
        ..default()
    });
    let pressed = materials.add(StandardMaterial {
        base_color: Color::from(YELLOW_300),
        unlit: true,
        ..default()
    });

    commands
        .spawn((
            Name::new(spike.0.name.clone()),
            Mesh3d(mesh_handle),
            MeshMaterial3d(base.clone()),
            Transform::default(),
            FixtureBody,
        ))
        .observe(recolor::<Pointer<Over>>(hover.clone()))
        .observe(recolor::<Pointer<Out>>(base.clone()))
        .observe(recolor::<Pointer<Press>>(pressed.clone()))
        .observe(recolor::<Pointer<Release>>(hover.clone()))
        .observe(on_click_report);

    commands.spawn((
        Name::new("BuiltinCuboid"),
        Mesh3d(meshes.add(Cuboid::new(0.6, 0.6, 0.6))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.2, 0.65, 0.9),
            unlit: true,
            ..default()
        })),
        Transform::from_xyz(1.4, 0.0, 0.0),
        Pickable::IGNORE,
    ));

    commands.spawn((
        Mesh3d(meshes.add(Plane3d::default().mesh().size(20.0, 20.0))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::from(GRAY_300),
            unlit: true,
            cull_mode: None,
            ..default()
        })),
        Transform::from_xyz(0.0, -0.51, 0.0),
        Pickable::IGNORE,
    ));

    commands.spawn((
        PointLight {
            intensity: 5_000_000.0,
            range: 40.0,
            shadow_maps_enabled: false,
            ..default()
        },
        Transform::from_xyz(4.0, 8.0, 4.0),
    ));
    commands.spawn((
        DirectionalLight {
            illuminance: 12_000.0,
            shadow_maps_enabled: false,
            ..default()
        },
        Transform::from_xyz(-3.0, 8.0, -2.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
    commands.spawn(AmbientLight {
        color: Color::WHITE,
        brightness: 350.0,
        ..default()
    });

    let mut camera_transform = Transform::default();
    apply_orbit(&mut camera_transform, &orbit);
    commands.spawn((Camera3d::default(), camera_transform, OrbitCamera));

    // Lightweight fallback HUD (Feathers selection panel is primary).
    commands.spawn((
        Text::new("RMB orbit · scroll zoom · Esc quit"),
        Node {
            position_type: PositionType::Absolute,
            bottom: px(12),
            right: px(12),
            ..default()
        },
        StatusText,
    ));
}

/// Push CadSession appearance onto the pickable fixture material.
pub fn apply_session_appearance(
    session: Res<CadSession>,
    bodies: Query<&MeshMaterial3d<StandardMaterial>, With<FixtureBody>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    for handle in &bodies {
        if let Some(mut material) = materials.get_mut(&handle.0) {
            material.base_color = session.color;
        }
    }
}
