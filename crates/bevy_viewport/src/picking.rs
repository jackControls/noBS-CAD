//! Mesh picking observers and status text.

use bevy::color::palettes::tailwind::{CYAN_300, RED_500};
use bevy::picking::pointer::PointerInteraction;
use bevy::prelude::*;

use crate::cad_session::CadSession;

#[derive(Resource, Clone)]
pub struct PickStatus {
    pub message: String,
}

#[derive(Component)]
pub struct StatusText;

#[derive(Component)]
pub struct FixtureBody;

pub fn recolor<E: EntityEvent>(
    new_material: Handle<StandardMaterial>,
) -> impl Fn(On<E>, Query<&mut MeshMaterial3d<StandardMaterial>>) {
    move |event, mut query| {
        if let Ok(mut material) = query.get_mut(event.event_target()) {
            material.0 = new_material.clone();
        }
    }
}

pub fn on_click_report(
    click: On<Pointer<Click>>,
    names: Query<&Name, With<FixtureBody>>,
    mut status: ResMut<PickStatus>,
    mut session: ResMut<CadSession>,
) {
    let label = names
        .get(click.entity)
        .map(|name| name.as_str())
        .unwrap_or("body");
    let hit = click
        .hit
        .position
        .map(|p| format!("({:.2}, {:.2}, {:.2}) mm", p.x, p.y, p.z))
        .unwrap_or_else(|| "—".into());
    status.message = format!("Picked {label} at {hit}");
    session.selection = format!("{label}  ·  hit {hit}  ·  mode {}", session.mode.label());
    session.body_name = label.to_string();
    info!("{}", status.message);
}

pub fn draw_pick_gizmos(pointers: Query<&PointerInteraction>, mut gizmos: Gizmos) {
    for (point, normal) in pointers
        .iter()
        .filter_map(|interaction| interaction.get_nearest_hit())
        .filter_map(|(_entity, hit)| hit.position.zip(hit.normal))
    {
        gizmos.sphere(point, 0.04, RED_500);
        gizmos.arrow(point, point + normal.normalize() * 0.35, CYAN_300);
    }
}

pub fn sync_status_text(status: Res<PickStatus>, mut texts: Query<&mut Text, With<StatusText>>) {
    if !status.is_changed() {
        return;
    }
    for mut text in &mut texts {
        *text = Text::new(status.message.clone());
    }
}
