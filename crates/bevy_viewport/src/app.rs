//! Bevy App construction for desktop and wasm.

use bevy::prelude::*;
use bevy::render::RenderPlugin;
#[cfg(target_arch = "wasm32")]
use bevy::render::settings::{Backends, RenderCreation, WgpuSettings};

use crate::backend::ViewportError;
use crate::cad_session::CadSession;
use crate::camera::{orbit_camera, OrbitSettings};
use crate::picking::{draw_pick_gizmos, sync_status_text, PickStatus};
use crate::scene::{apply_session_appearance, setup_scene, SpikeMesh};
use crate::soup::TessellatedTriangleSoup;
use crate::ui::CadUiPlugin;

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
                    title: "noBS CAD — Bevy shell (viz + UI + bridge)".into(),
                    resolution: (1440, 900).into(),
                    ..default()
                }),
                ..default()
            })
            .set(render_plugin),
        MeshPickingPlugin,
        CadUiPlugin,
    ))
    .insert_resource(ClearColor(Color::srgb(0.10, 0.11, 0.13)))
    .insert_resource(SpikeMesh(mesh))
    .insert_resource(OrbitSettings::default())
    .insert_resource(CadSession::default())
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
            apply_session_appearance.run_if(resource_changed::<CadSession>),
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
