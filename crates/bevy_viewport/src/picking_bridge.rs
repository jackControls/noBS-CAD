//! Mesh picks → session selection.

use bevy::color::palettes::tailwind::{CYAN_300, RED_500};
use bevy::picking::pointer::PointerInteraction;
use bevy::prelude::*;

use crate::session::{CadMode, SetSelection};

#[derive(Component, Clone)]
pub struct FixtureMaterials {
    pub base: Handle<StandardMaterial>,
}

#[derive(Component)]
pub struct FixtureBody;

pub struct PickingBridgePlugin;

impl Plugin for PickingBridgePlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(MeshPickingPlugin)
            .add_systems(Update, draw_pick_gizmos.run_if(in_state(CadMode::Solid)));
    }
}

pub fn recolor<E: EntityEvent>(
    new_material: Handle<StandardMaterial>,
) -> impl Fn(On<E>, Query<&mut MeshMaterial3d<StandardMaterial>>) {
    move |event, mut query| {
        if let Ok(mut material) = query.get_mut(event.event_target()) {
            material.0 = new_material.clone();
        }
    }
}

pub fn on_solid_click(
    click: On<Pointer<Click>>,
    names: Query<&Name, With<FixtureBody>>,
    mode: Res<State<CadMode>>,
    mut selection: MessageWriter<SetSelection>,
) {
    if *mode.get() != CadMode::Solid {
        return;
    }
    let label = names
        .get(click.entity)
        .map(|name| name.as_str())
        .unwrap_or("body");
    let hit = click
        .hit
        .position
        .map(|p| format!("({:.2}, {:.2}, {:.2}) mm", p.x, p.y, p.z))
        .unwrap_or_else(|| "—".into());
    selection.write(SetSelection {
        text: format!("Picked {label} at {hit}"),
        body_name: Some(label.to_string()),
    });
    info!("Picked {label} at {hit}");
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
