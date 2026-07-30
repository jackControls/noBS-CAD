//! Standalone, dev-only visual regression surface for native Bevy UI.
//!
//! It renders the exact production HUD builders into an offscreen GPU image,
//! captures that image, then exits. Vite serves the resulting PNG so browser
//! automation and human reviewers can compare it with the React reference.

use std::path::PathBuf;

use bevy::{
    app::SubApps,
    asset::RenderAssetUsages,
    camera::RenderTarget,
    image::Image,
    prelude::*,
    render::{
        render_resource::{Extent3d, PollType, TextureDimension, TextureFormat, TextureUsages},
        renderer::RenderDevice,
        view::screenshot::{Screenshot, ScreenshotCaptured},
        RenderPlugin,
    },
    window::{ExitCondition, WindowPlugin},
};

use super::{
    ui::{self, HudAxisLabel, HudAxisMark, NativeHudRoot, ViewportUiAssets, ViewportUiTheme},
    ViewportCamera, ViewportHud, ViewportHudRow, ViewportHudSelection,
};

#[derive(Resource)]
struct CaptureRequest {
    path: PathBuf,
}

#[derive(Resource, Default)]
struct CaptureComplete(bool);

#[derive(Resource, Clone)]
struct LabTarget(Handle<Image>);

#[derive(Resource, Clone, Copy)]
struct LabCamera(ViewportCamera);

#[derive(Resource, Clone, Copy)]
struct LabPalette(super::ViewportPalette);

pub fn run(output: PathBuf) {
    let palette = ui::light_reference_palette();
    let mut app = App::new();
    app.insert_resource(ClearColor(Color::srgb(
        palette.background[0],
        palette.background[1],
        palette.background[2],
    )))
    .insert_resource(CaptureRequest { path: output })
    .init_resource::<CaptureComplete>()
    .insert_resource(LabCamera(ViewportCamera::default()))
    .insert_resource(LabPalette(palette))
    .init_resource::<ViewportUiAssets>()
    .add_plugins(
        DefaultPlugins
            .set(bevy::log::LogPlugin {
                filter: "info,wgpu_core=warn,wgpu_hal=warn".to_string(),
                ..default()
            })
            .set(WindowPlugin {
                primary_window: None,
                exit_condition: ExitCondition::DontExit,
                close_when_requested: false,
                ..default()
            })
            .set(RenderPlugin {
                synchronous_pipeline_compilation: true,
                ..default()
            }),
    )
    .add_systems(Startup, (ui::load_system_font, setup_lab).chain())
    .add_systems(Update, update_lab_orientation);

    app.finish();
    app.cleanup();
    let mut sub_apps = std::mem::take(app.sub_apps_mut());

    // Give font registration, layout, and render pipeline preparation enough
    // deterministic updates before requesting the readback.
    for _ in 0..12 {
        update_and_wait(&mut sub_apps);
    }

    let target = sub_apps.main.world().resource::<LabTarget>().0.clone();
    sub_apps
        .main
        .world_mut()
        .spawn(Screenshot::image(target))
        .observe(save_capture);

    for _ in 0..12 {
        update_and_wait(&mut sub_apps);
        if sub_apps.main.world().resource::<CaptureComplete>().0 {
            return;
        }
    }
    panic!("Bevy UI lab screenshot did not complete");
}

fn update_and_wait(sub_apps: &mut SubApps) {
    sub_apps.update();
    sub_apps
        .main
        .world()
        .resource::<RenderDevice>()
        .wgpu_device()
        .poll(PollType::Wait {
            submission_index: None,
            timeout: None,
        })
        .expect("Bevy UI lab GPU wait failed");
}

fn setup_lab(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
    assets: Res<ViewportUiAssets>,
    palette: Res<LabPalette>,
) {
    let mut target = Image::new_uninit(
        Extent3d {
            width: 1440,
            height: 900,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::RENDER_WORLD,
    );
    target.texture_descriptor.usage |= TextureUsages::RENDER_ATTACHMENT;
    let target = images.add(target);
    commands.insert_resource(LabTarget(target.clone()));
    let render_target: RenderTarget = target.into();

    let camera = commands
        .spawn((
            Name::new("Bevy UI lab camera"),
            Camera3d::default(),
            render_target,
            IsDefaultUiCamera,
            BoxShadowSamples(6),
            Transform::from_xyz(0.0, -8.0, 6.0).looking_at(Vec3::ZERO, Vec3::Z),
        ))
        .id();
    let theme = ViewportUiTheme::from_palette(&palette.0);

    spawn_reference_grid(&mut commands, camera, theme);

    let hud = ViewportHud {
        render_native_chrome: true,
        nav_tool: "orbit".to_string(),
        sketch_mode: true,
        can_undo: true,
        can_redo: false,
        six_dof_state: "connected".to_string(),
        hovered_control: "nav:pan".to_string(),
        pressed_control: String::new(),
        prompt: Some("Select a plane or planar face (Esc to cancel)".to_string()),
        dof_label: Some("DOF 4".to_string()),
        coordinate_readout: None,
        dim_opacity: 0.20,
        selection: Some(ViewportHudSelection {
            title: "SELECTION".to_string(),
            subject: "Body1".to_string(),
            rows: vec![
                ViewportHudRow {
                    label: "Size".to_string(),
                    value: "30 × 30 × 30 mm".to_string(),
                },
                ViewportHudRow {
                    label: "Surface area".to_string(),
                    value: "≈ 5,400 mm²".to_string(),
                },
                ViewportHudRow {
                    label: "Volume".to_string(),
                    value: "≈ 27,000 mm³".to_string(),
                },
            ],
            footer: Some("≈ from display geometry".to_string()),
        }),
    };
    ui::spawn_viewport_hud(&mut commands, camera, &hud, &palette.0, &assets);
    ui::spawn_reference_dialog(&mut commands, camera, theme, &assets);
}

fn spawn_reference_grid(commands: &mut Commands, camera: Entity, theme: ViewportUiTheme) {
    commands
        .spawn((
            Name::new("Bevy UI lab viewport reference"),
            UiTargetCamera(camera),
            NativeHudRoot,
            Node {
                position_type: PositionType::Absolute,
                left: px(0.0),
                top: px(0.0),
                width: percent(100.0),
                height: percent(100.0),
                overflow: Overflow::clip(),
                ..default()
            },
            BackgroundColor(theme.viewport),
            ZIndex(-100),
        ))
        .with_children(|grid| {
            for index in 0..=24 {
                let major = index % 5 == 0;
                grid.spawn((
                    Node {
                        position_type: PositionType::Absolute,
                        left: percent(index as f32 * 100.0 / 24.0),
                        top: px(0.0),
                        width: px(if major { 1.2 } else { 0.7 }),
                        height: percent(100.0),
                        ..default()
                    },
                    BackgroundColor(theme.edge.with_alpha(if major { 0.42 } else { 0.20 })),
                ));
            }
            for index in 0..=15 {
                let major = index % 5 == 0;
                grid.spawn((
                    Node {
                        position_type: PositionType::Absolute,
                        left: px(0.0),
                        top: percent(index as f32 * 100.0 / 15.0),
                        width: percent(100.0),
                        height: px(if major { 1.2 } else { 0.7 }),
                        ..default()
                    },
                    BackgroundColor(theme.edge.with_alpha(if major { 0.42 } else { 0.20 })),
                ));
            }
        });
}

fn update_lab_orientation(
    camera: Res<LabCamera>,
    mut marks: Query<(&HudAxisMark, &mut Node)>,
    mut labels: Query<(&HudAxisLabel, &mut Node), Without<HudAxisMark>>,
) {
    ui::update_orientation_nodes(camera.0, &mut marks, &mut labels);
}

fn save_capture(
    capture: On<ScreenshotCaptured>,
    request: Res<CaptureRequest>,
    mut complete: ResMut<CaptureComplete>,
) {
    let sample = capture
        .image
        .data
        .as_deref()
        .map(|bytes| &bytes[..bytes.len().min(16)]);
    eprintln!(
        "Captured {:?} {:?}; first bytes: {sample:?}",
        capture.image.texture_descriptor.size, capture.image.texture_descriptor.format
    );
    match capture.image.clone().try_into_dynamic() {
        Ok(image) => {
            if let Err(error) = image.to_rgb8().save(&request.path) {
                eprintln!(
                    "Could not save Bevy UI lab capture to {}: {error}",
                    request.path.display()
                );
            }
        }
        Err(error) => eprintln!("Could not convert Bevy UI lab capture: {error}"),
    }
    complete.0 = true;
}
