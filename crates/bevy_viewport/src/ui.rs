//! Three ported CAD UI surfaces on Bevy Feathers (editor tooling toolkit).
//!
//! 1. Mode bar — Sketch / Solid (from app mode / ribbon)
//! 2. Appearance panel — material swatches (from BodyAppearancePanel)
//! 3. Selection readout — pick summary (from SelectionReadout)
//!
//! Feathers is Bevy's opinionated tooling UI (0.19); intended for editors, not games.

use bevy::{
    feathers::{
        controls::FeathersButton,
        dark_theme::create_dark_theme,
        theme::{ThemeBackgroundColor, ThemedText, UiTheme},
        tokens, FeathersPlugins,
    },
    prelude::*,
    ui_widgets::Activate,
};

use crate::cad_session::{CadMode, CadSession, COLOR_PRESETS};

#[derive(Component, Clone, Default)]
pub struct ModeLabel;

#[derive(Component, Clone, Default)]
pub struct MaterialLabel;

#[derive(Component, Clone, Default)]
pub struct SelectionLabel;

pub struct CadUiPlugin;

impl Plugin for CadUiPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(FeathersPlugins)
            .insert_resource(UiTheme(create_dark_theme()))
            .add_systems(Startup, ui_scene.spawn())
            .add_systems(
                Update,
                (
                    sync_mode_label.run_if(resource_changed::<CadSession>),
                    sync_material_label.run_if(resource_changed::<CadSession>),
                    sync_selection_label.run_if(resource_changed::<CadSession>),
                ),
            );
    }
}

fn ui_scene() -> impl SceneList {
    // No Camera2d — Camera3d from the viewport owns the window; UI overlays it.
    bsn_list![shell_root()]
}

fn shell_root() -> impl Scene {
    bsn! {
        Node {
            width: percent(100),
            height: percent(100),
            display: Display::Flex,
            flex_direction: FlexDirection::Column,
            justify_content: JustifyContent::SpaceBetween,
            align_items: AlignItems::Stretch,
            padding: px(12),
        }
        Pickable::IGNORE
        Children [
            mode_bar(),
            mid_row(),
            selection_readout(),
        ]
    }
}

/// Port 1 — mode switcher (Sketch / Solid).
fn mode_bar() -> impl Scene {
    bsn! {
        Node {
            display: Display::Flex,
            flex_direction: FlexDirection::Row,
            align_items: AlignItems::Center,
            column_gap: px(8),
            padding: px(8),
            align_self: AlignSelf::FlexStart,
        }
        ThemeBackgroundColor(tokens::PANE_BODY_BG)
        Children [
            (
                Text("Mode") ThemedText
                Node { margin: UiRect::right(px(4)) }
            ),
            (
                @FeathersButton {
                    @caption: bsn! { Text("Sketch") ThemedText }
                }
                on(|_a: On<Activate>, mut session: ResMut<CadSession>| {
                    session.mode = CadMode::Sketch;
                    info!("CadSession.mode -> Sketch");
                })
            ),
            (
                @FeathersButton {
                    @caption: bsn! { Text("Solid") ThemedText }
                }
                on(|_a: On<Activate>, mut session: ResMut<CadSession>| {
                    session.mode = CadMode::Solid;
                    info!("CadSession.mode -> Solid");
                })
            ),
            (
                Text("Solid") ThemedText ModeLabel
                Node { margin: UiRect::left(px(8)) }
            ),
        ]
    }
}

fn mid_row() -> impl Scene {
    bsn! {
        Node {
            display: Display::Flex,
            flex_direction: FlexDirection::Row,
            justify_content: JustifyContent::FlexEnd,
            align_items: AlignItems::FlexStart,
            flex_grow: 1.0,
            width: percent(100),
        }
        Pickable::IGNORE
        Children [ appearance_panel() ]
    }
}

/// Port 2 — body appearance swatches (color + material name).
fn appearance_panel() -> impl Scene {
    bsn! {
        Node {
            display: Display::Flex,
            flex_direction: FlexDirection::Column,
            row_gap: px(8),
            padding: px(12),
            width: px(220),
            margin: UiRect::top(px(8)),
        }
        ThemeBackgroundColor(tokens::PANE_BODY_BG)
        Children [
            ( Text("Appearance") ThemedText ),
            ( Text("FixtureCube") ThemedText ),
            ( Text("PLA Red") ThemedText MaterialLabel ),
            (
                Node {
                    display: Display::Flex,
                    flex_direction: FlexDirection::Row,
                    flex_wrap: FlexWrap::Wrap,
                    column_gap: px(6),
                    row_gap: px(6),
                }
                Children [
                    (
                        @FeathersButton {
                            @caption: bsn! { Text("PLA Red") ThemedText }
                        }
                        on(|_a: On<Activate>, mut session: ResMut<CadSession>| {
                            apply_preset(&mut session, 0);
                        })
                    ),
                    (
                        @FeathersButton {
                            @caption: bsn! { Text("PLA White") ThemedText }
                        }
                        on(|_a: On<Activate>, mut session: ResMut<CadSession>| {
                            apply_preset(&mut session, 1);
                        })
                    ),
                    (
                        @FeathersButton {
                            @caption: bsn! { Text("PETG Blue") ThemedText }
                        }
                        on(|_a: On<Activate>, mut session: ResMut<CadSession>| {
                            apply_preset(&mut session, 2);
                        })
                    ),
                    (
                        @FeathersButton {
                            @caption: bsn! { Text("ABS Black") ThemedText }
                        }
                        on(|_a: On<Activate>, mut session: ResMut<CadSession>| {
                            apply_preset(&mut session, 3);
                        })
                    ),
                ]
            ),
        ]
    }
}

fn apply_preset(session: &mut CadSession, index: usize) {
    let (name, _hint, r, g, b) = COLOR_PRESETS[index];
    session.material_name = name.to_string();
    session.color = Color::srgb(r, g, b);
    info!("CadSession appearance -> {name}");
}

/// Port 3 — selection readout (bottom status).
fn selection_readout() -> impl Scene {
    bsn! {
        Node {
            display: Display::Flex,
            flex_direction: FlexDirection::Column,
            row_gap: px(4),
            padding: px(10),
            align_self: AlignSelf::FlexStart,
            max_width: percent(70),
        }
        ThemeBackgroundColor(tokens::PANE_BODY_BG)
        Children [
            ( Text("Selection") ThemedText ),
            (
                Text("Nothing selected — click the orange body.") ThemedText SelectionLabel
            ),
        ]
    }
}

fn sync_mode_label(session: Res<CadSession>, mut label: Query<&mut Text, With<ModeLabel>>) {
    for mut text in &mut label {
        *text = Text::new(session.mode.label());
    }
}

fn sync_material_label(
    session: Res<CadSession>,
    mut label: Query<&mut Text, With<MaterialLabel>>,
) {
    for mut text in &mut label {
        *text = Text::new(session.material_name.clone());
    }
}

fn sync_selection_label(
    session: Res<CadSession>,
    mut label: Query<&mut Text, With<SelectionLabel>>,
) {
    for mut text in &mut label {
        *text = Text::new(session.selection.clone());
    }
}
