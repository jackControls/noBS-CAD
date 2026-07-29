//! Bevy App construction for desktop and wasm.

use bevy::prelude::*;
use bevy::render::RenderPlugin;
#[cfg(target_arch = "wasm32")]
use bevy::render::settings::{Backends, RenderCreation, WgpuSettings};

use crate::backend::ViewportError;
use crate::camera::{orbit_camera, OrbitSettings};
use crate::picking::{draw_pick_gizmos, sync_status_text, PickStatus};
use crate::scene::{setup_scene, SpikeMesh};
use crate::soup::TessellatedTriangleSoup;

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

#[cfg(not(target_arch = "wasm32"))]
fn quit_on_escape(keys: Res<ButtonInput<KeyCode>>, mut exit: MessageWriter<AppExit>) {
    if keys.just_pressed(KeyCode::Escape) {
        exit.write(AppExit::Success);
    }
}
