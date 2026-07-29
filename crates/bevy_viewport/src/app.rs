//! Bevy App construction — plugin registration only.

use bevy::prelude::*;

use crate::backend::ViewportError;
use crate::camera_ctrl::CameraPlugin;
use crate::chrome_ui::ChromeUiPlugin;
use crate::input_map::InputMapPlugin;
use crate::picking_bridge::PickingBridgePlugin;
use crate::session::SessionPlugin;
use crate::shell::ShellPlugin;
use crate::sim::SimPlugin;
use crate::soup::TessellatedTriangleSoup;
use crate::viewport_mesh::{SpikeMesh, ViewportMeshPlugin};

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

    App::new()
        .add_plugins((
            ShellPlugin,
            SessionPlugin,
            ViewportMeshPlugin,
            CameraPlugin,
            PickingBridgePlugin,
            ChromeUiPlugin,
            InputMapPlugin,
            SimPlugin,
        ))
        .insert_resource(SpikeMesh(mesh))
        .run();

    Ok(())
}
