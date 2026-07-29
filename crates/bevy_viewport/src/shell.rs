//! Window / DefaultPlugins / render backends / app exit.

use bevy::prelude::*;
use bevy::render::RenderPlugin;
#[cfg(target_arch = "wasm32")]
use bevy::render::settings::{Backends, RenderCreation, WgpuSettings};

pub struct ShellPlugin;

impl Plugin for ShellPlugin {
    fn build(&self, app: &mut App) {
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

        app.insert_resource(ClearColor(Color::srgb(0.08, 0.09, 0.11)))
            .add_plugins(
                DefaultPlugins
                    .set(WindowPlugin {
                        primary_window: Some(Window {
                            title: "noBS CAD — Bevy shell".into(),
                            resolution: (1600, 960).into(),
                            ..default()
                        }),
                        ..default()
                    })
                    .set(render_plugin),
            );

        #[cfg(not(target_arch = "wasm32"))]
        app.add_systems(Update, quit_on_escape);
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn quit_on_escape(keys: Res<ButtonInput<KeyCode>>, mut exit: MessageWriter<AppExit>) {
    if keys.just_pressed(KeyCode::Escape) {
        exit.write(AppExit::Success);
    }
}
