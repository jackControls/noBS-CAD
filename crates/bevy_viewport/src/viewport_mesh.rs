//! Solid fixture soup lifecycle + shared stage (grid / lights).

use bevy::color::palettes::tailwind::{CYAN_300, YELLOW_300};
use bevy::prelude::*;

use crate::mesh_convert::triangle_soup_to_mesh;
use crate::picking_bridge::{on_solid_click, recolor, FixtureBody, FixtureMaterials};
use crate::session::{CadMode, CadSession};
use crate::soup::TessellatedTriangleSoup;

#[derive(Resource)]
pub struct SpikeMesh(pub TessellatedTriangleSoup);

#[derive(Component)]
pub struct SolidLayer;

pub struct ViewportMeshPlugin;

impl Plugin for ViewportMeshPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, (spawn_stage, spawn_solid_fixture).chain())
            .add_systems(OnEnter(CadMode::Solid), show_solid)
            .add_systems(OnEnter(CadMode::Sketch), hide_solid)
            .add_systems(OnEnter(CadMode::Simulate), hide_solid)
            .add_systems(
                Update,
                (
                    draw_reference_grid,
                    apply_session_appearance
                        .run_if(in_state(CadMode::Solid))
                        .run_if(resource_changed::<CadSession>),
                ),
            );
    }
}

fn spawn_stage(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    // Ground plane.
    commands.spawn((
        Mesh3d(meshes.add(Plane3d::default().mesh().size(24.0, 24.0))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.18, 0.19, 0.21),
            perceptual_roughness: 0.95,
            ..default()
        })),
        Transform::from_xyz(0.0, -0.51, 0.0),
        Pickable::IGNORE,
    ));

    commands.spawn((
        PointLight {
            intensity: 3_500_000.0,
            range: 40.0,
            color: Color::srgb(1.0, 0.96, 0.9),
            shadow_maps_enabled: false,
            ..default()
        },
        Transform::from_xyz(4.0, 8.0, 4.0),
    ));
    commands.spawn((
        DirectionalLight {
            illuminance: 8_000.0,
            shadow_maps_enabled: false,
            ..default()
        },
        Transform::from_xyz(-3.0, 8.0, -2.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}

fn spawn_solid_fixture(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    spike: Res<SpikeMesh>,
    session: Res<CadSession>,
    mode: Res<State<CadMode>>,
) {
    let mesh_handle = meshes.add(triangle_soup_to_mesh(&spike.0));
    let base = materials.add(StandardMaterial {
        base_color: session.color,
        metallic: 0.08,
        perceptual_roughness: 0.48,
        ..default()
    });
    let hover = materials.add(StandardMaterial {
        base_color: Color::from(CYAN_300),
        emissive: LinearRgba::rgb(0.15, 0.8, 1.0),
        unlit: true,
        ..default()
    });
    let pressed = materials.add(StandardMaterial {
        base_color: Color::from(YELLOW_300),
        emissive: LinearRgba::rgb(1.5, 1.0, 0.2),
        unlit: true,
        ..default()
    });

    let visible = matches!(*mode.get(), CadMode::Solid);
    commands
        .spawn((
            Name::new(spike.0.name.clone()),
            Mesh3d(mesh_handle),
            MeshMaterial3d(base.clone()),
            Transform::default(),
            FixtureBody,
            FixtureMaterials { base: base.clone() },
            SolidLayer,
            if visible {
                Visibility::Visible
            } else {
                Visibility::Hidden
            },
        ))
        .observe(recolor::<Pointer<Over>>(hover.clone()))
        .observe(recolor::<Pointer<Out>>(base.clone()))
        .observe(recolor::<Pointer<Press>>(pressed.clone()))
        .observe(recolor::<Pointer<Release>>(hover))
        .observe(on_solid_click);

    commands.spawn((
        Name::new("BuiltinCuboid"),
        Mesh3d(meshes.add(Cuboid::new(0.55, 0.55, 0.55))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.25, 0.55, 0.85),
            metallic: 0.25,
            perceptual_roughness: 0.4,
            ..default()
        })),
        Transform::from_xyz(1.35, 0.0, 0.0),
        Pickable::IGNORE,
        SolidLayer,
        if visible {
            Visibility::Visible
        } else {
            Visibility::Hidden
        },
    ));
}

fn show_solid(mut q: Query<&mut Visibility, With<SolidLayer>>) {
    for mut v in &mut q {
        *v = Visibility::Visible;
    }
}

fn hide_solid(mut q: Query<&mut Visibility, With<SolidLayer>>) {
    for mut v in &mut q {
        *v = Visibility::Hidden;
    }
}

fn apply_session_appearance(
    session: Res<CadSession>,
    bodies: Query<(&FixtureMaterials, &mut MeshMaterial3d<StandardMaterial>), With<FixtureBody>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    for (fixture, mut mesh_material) in bodies {
        if let Some(mut material) = materials.get_mut(&fixture.base) {
            material.base_color = session.color;
        }
        mesh_material.0 = fixture.base.clone();
    }
}

fn draw_reference_grid(mut gizmos: Gizmos) {
    let half = 8;
    let step = 0.5_f32;
    let y = -0.505;
    let color = Color::srgba(0.45, 0.5, 0.58, 0.35);
    let axis_x = Color::srgba(0.75, 0.35, 0.3, 0.55);
    let axis_z = Color::srgba(0.3, 0.55, 0.8, 0.55);
    for i in -half..=half {
        let t = i as f32 * step;
        let major = i == 0;
        let c = if major { axis_z } else { color };
        gizmos.line(
            Vec3::new(t, y, -half as f32 * step),
            Vec3::new(t, y, half as f32 * step),
            c,
        );
        let c = if major { axis_x } else { color };
        gizmos.line(
            Vec3::new(-half as f32 * step, y, t),
            Vec3::new(half as f32 * step, y, t),
            c,
        );
    }
}
