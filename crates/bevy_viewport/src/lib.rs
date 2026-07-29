//! Bevy viewport spike (issue #20 / ADR 0002).
//!
//! **Display / ECS only.** OCCT remains solid truth. This crate draws a
//! tessellated triangle soup, orbits a camera, and reports mesh picks.
//! It does not model B-rep, features, or ribbon UI.

use bevy::asset::RenderAssetUsages;
use bevy::color::palettes::tailwind::{CYAN_300, GRAY_300, RED_500, YELLOW_300};
use bevy::input::mouse::{AccumulatedMouseMotion, AccumulatedMouseScroll};
use bevy::picking::pointer::PointerInteraction;
use bevy::prelude::*;
use bevy::render::mesh::Indices;
use bevy::render::render_resource::PrimitiveTopology;
use bevy::render::RenderPlugin;
#[cfg(target_arch = "wasm32")]
use bevy::render::settings::{Backends, RenderCreation, WgpuSettings};
use std::f32::consts::FRAC_PI_2;
use std::ops::Range;

/// Host-neutral tessellation handed to a viewport backend.
#[derive(Debug, Clone, PartialEq)]
pub struct TessellatedTriangleSoup {
    pub name: String,
    /// Flat XYZ positions in millimetres (CAD convention).
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
}

impl TessellatedTriangleSoup {
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    /// Axis-aligned unit cube centered at origin (fixture for the spike).
    pub fn unit_cube() -> Self {
        let positions = vec![
            -0.5, -0.5, -0.5, // 0
            0.5, -0.5, -0.5, // 1
            0.5, 0.5, -0.5, // 2
            -0.5, 0.5, -0.5, // 3
            -0.5, -0.5, 0.5, // 4
            0.5, -0.5, 0.5, // 5
            0.5, 0.5, 0.5, // 6
            -0.5, 0.5, 0.5, // 7
        ];
        let indices = vec![
            0, 2, 1, 0, 3, 2, // -Z
            4, 5, 6, 4, 6, 7, // +Z
            0, 1, 5, 0, 5, 4, // -Y
            3, 7, 6, 3, 6, 2, // +Y
            0, 4, 7, 0, 7, 3, // -X
            1, 2, 6, 1, 6, 5, // +X
        ];
        Self {
            name: "FixtureCube".into(),
            positions,
            indices,
        }
    }
}

#[derive(Debug)]
pub struct ViewportError(pub String);

impl std::fmt::Display for ViewportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for ViewportError {}

/// Trait boundary from ADR 0002: swap backends without touching B-rep.
pub trait ViewportBackend {
    fn name(&self) -> &'static str;
    fn run(&mut self, mesh: TessellatedTriangleSoup) -> Result<(), ViewportError>;
}

/// Bevy 0.19 implementation of [`ViewportBackend`].
#[derive(Debug, Default)]
pub struct BevyViewportBackend;

impl ViewportBackend for BevyViewportBackend {
    fn name(&self) -> &'static str {
        "bevy-0.19"
    }

    fn run(&mut self, mesh: TessellatedTriangleSoup) -> Result<(), ViewportError> {
        run_bevy_app(mesh)
    }
}

/// Entry used by the desktop/wasm binary and the launcher.
pub fn run_desktop() {
    let mut backend = BevyViewportBackend;
    if let Err(error) = backend.run(TessellatedTriangleSoup::unit_cube()) {
        eprintln!("bevy viewport failed: {error}");
        std::process::exit(1);
    }
}

pub fn run_bevy_app(mesh: TessellatedTriangleSoup) -> Result<(), ViewportError> {
    if mesh.positions.len() % 3 != 0 {
        return Err(ViewportError(
            "tessellation positions length must be a multiple of 3".into(),
        ));
    }
    if mesh.indices.len() % 3 != 0 {
        return Err(ViewportError(
            "tessellation indices length must be a multiple of 3".into(),
        ));
    }
    if mesh.triangle_count() == 0 {
        return Err(ViewportError("tessellation has no triangles".into()));
    }

    let mut app = App::new();

    #[cfg(target_arch = "wasm32")]
    let render_plugin = RenderPlugin {
        render_creation: RenderCreation::Automatic(Box::new(WgpuSettings {
            // Prefer WebGL2 in browsers where WebGPU is flaky.
            backends: Some(Backends::BROWSER_WEBGPU | Backends::GL),
            ..default()
        })),
        ..default()
    };
    #[cfg(not(target_arch = "wasm32"))]
    let render_plugin = RenderPlugin::default();

    app.add_plugins((
            DefaultPlugins
                .set(WindowPlugin {
                    primary_window: Some(Window {
                        title: "noBS CAD — Bevy viewport spike (#20)".into(),
                        resolution: (1280, 800).into(),
                        ..default()
                    }),
                    ..default()
                })
                .set(render_plugin),
            MeshPickingPlugin,
        ))
        .insert_resource(ClearColor(Color::srgb(0.12, 0.13, 0.15)))
        .insert_resource(SpikeMesh(mesh))
        .insert_resource(OrbitSettings::default())
        .insert_resource(PickStatus {
            message: "Click the cube to pick. RMB drag orbits. Scroll zooms. Esc quits (desktop)."
                .into(),
        })
        .add_systems(Startup, setup_scene)
        .add_systems(
            Update,
            (
                orbit_camera,
                draw_pick_gizmos,
                sync_status_text,
                #[cfg(not(target_arch = "wasm32"))]
                quit_on_escape,
            ),
        )
        .run();

    Ok(())
}

#[derive(Resource)]
struct SpikeMesh(TessellatedTriangleSoup);

#[derive(Resource)]
struct OrbitSettings {
    target: Vec3,
    distance: f32,
    pitch: f32,
    yaw: f32,
    pitch_range: Range<f32>,
    orbit_speed: f32,
    zoom_speed: f32,
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

#[derive(Resource, Clone)]
struct PickStatus {
    message: String,
}

#[derive(Component)]
struct StatusText;

#[derive(Component)]
struct FixtureBody;

#[derive(Component)]
struct OrbitCamera;

fn setup_scene(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    spike: Res<SpikeMesh>,
    orbit: Res<OrbitSettings>,
) {
    let mesh_handle = meshes.add(triangle_soup_to_mesh(&spike.0));
    let base = materials.add(StandardMaterial {
        base_color: Color::srgb(0.85, 0.35, 0.2),
        metallic: 0.05,
        perceptual_roughness: 0.55,
        // Unlit keeps the fixture visible even if lights fail on a given backend.
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

    // Built-in mesh as a second visual sanity check (offset so both are visible).
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

    commands.spawn((
        Text::new(
            "Click the cube to pick. RMB drag orbits. Scroll zooms. Esc quits (desktop).",
        ),
        Node {
            position_type: PositionType::Absolute,
            top: px(12),
            left: px(12),
            ..default()
        },
        StatusText,
    ));
}

fn triangle_soup_to_mesh(soup: &TessellatedTriangleSoup) -> Mesh {
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::default(),
    );

    let mut positions: Vec<[f32; 3]> = Vec::with_capacity(soup.positions.len() / 3);
    for chunk in soup.positions.chunks_exact(3) {
        positions.push([chunk[0], chunk[1], chunk[2]]);
    }

    let mut normals = vec![[0.0_f32, 0.0, 0.0]; positions.len()];
    for tri in soup.indices.chunks_exact(3) {
        let (i0, i1, i2) = (tri[0] as usize, tri[1] as usize, tri[2] as usize);
        let a = Vec3::from(positions[i0]);
        let b = Vec3::from(positions[i1]);
        let c = Vec3::from(positions[i2]);
        let n = (b - a).cross(c - a).normalize_or_zero();
        for index in [i0, i1, i2] {
            normals[index][0] += n.x;
            normals[index][1] += n.y;
            normals[index][2] += n.z;
        }
    }
    for normal in &mut normals {
        let v = Vec3::from(*normal).normalize_or_zero();
        *normal = [v.x, v.y, v.z];
    }

    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_indices(Indices::U32(soup.indices.clone()));
    mesh
}

fn recolor<E: EntityEvent>(
    new_material: Handle<StandardMaterial>,
) -> impl Fn(On<E>, Query<&mut MeshMaterial3d<StandardMaterial>>) {
    move |event, mut query| {
        if let Ok(mut material) = query.get_mut(event.event_target()) {
            material.0 = new_material.clone();
        }
    }
}

fn on_click_report(
    click: On<Pointer<Click>>,
    names: Query<&Name, With<FixtureBody>>,
    mut status: ResMut<PickStatus>,
) {
    let label = names
        .get(click.entity)
        .map(|name| name.as_str())
        .unwrap_or("body");
    let hit = click
        .hit
        .position
        .map(|p| format!(" at ({:.2}, {:.2}, {:.2})", p.x, p.y, p.z))
        .unwrap_or_default();
    status.message = format!("Picked {label}{hit}");
    info!("{}", status.message);
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
        orbit.pitch =
            (orbit.pitch - delta.y * orbit.orbit_speed).clamp(orbit.pitch_range.start, orbit.pitch_range.end);
    }

    if scroll.delta.y != 0.0 {
        orbit.distance = (orbit.distance * (1.0 - scroll.delta.y * orbit.zoom_speed)).clamp(1.0, 40.0);
    }

    apply_orbit(&mut camera, &orbit);
}

fn apply_orbit(transform: &mut Transform, orbit: &OrbitSettings) {
    let rotation = Quat::from_euler(EulerRot::YXZ, orbit.yaw, orbit.pitch, 0.0);
    transform.rotation = rotation;
    // Camera looks down local -Z; place it so that direction points at the target.
    transform.translation = orbit.target - transform.forward() * orbit.distance;
}

fn draw_pick_gizmos(pointers: Query<&PointerInteraction>, mut gizmos: Gizmos) {
    for (point, normal) in pointers
        .iter()
        .filter_map(|interaction| interaction.get_nearest_hit())
        .filter_map(|(_entity, hit)| hit.position.zip(hit.normal))
    {
        gizmos.sphere(point, 0.04, RED_500);
        gizmos.arrow(point, point + normal.normalize() * 0.35, CYAN_300);
    }
}

fn sync_status_text(status: Res<PickStatus>, mut texts: Query<&mut Text, With<StatusText>>) {
    if !status.is_changed() {
        return;
    }
    for mut text in &mut texts {
        *text = Text::new(status.message.clone());
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn quit_on_escape(
    keys: Res<ButtonInput<KeyCode>>,
    mut exit: MessageWriter<AppExit>,
) {
    if keys.just_pressed(KeyCode::Escape) {
        exit.write(AppExit::Success);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_cube_has_twelve_triangles() {
        let cube = TessellatedTriangleSoup::unit_cube();
        assert_eq!(cube.triangle_count(), 12);
        assert_eq!(cube.positions.len(), 24);
        assert_eq!(cube.indices.len(), 36);
    }

    #[test]
    fn backend_name_is_bevy_019() {
        assert_eq!(BevyViewportBackend.name(), "bevy-0.19");
    }

    #[test]
    fn empty_mesh_is_rejected() {
        let err = run_bevy_app(TessellatedTriangleSoup {
            name: "empty".into(),
            positions: vec![],
            indices: vec![],
        })
        .unwrap_err();
        assert!(err.0.contains("no triangles"));
    }
}
