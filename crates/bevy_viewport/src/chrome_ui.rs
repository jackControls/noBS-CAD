//! Feathers product chrome — mode / appearance / analysis / telemetry.

use bevy::{
    feathers::{
        containers::{pane, pane_body, pane_header},
        controls::{ColorSwatchValue, FeathersButton, FeathersColorSwatch},
        dark_theme::create_dark_theme,
        display::{label, label_dim},
        theme::{ThemedText, UiTheme},
        FeathersPlugins,
    },
    input_focus::tab_navigation::TabGroup,
    prelude::*,
    ui_widgets::Activate,
};

use crate::session::{
    ApplyAppearance, CadMode, CadSession, SetMode, COLOR_PRESETS,
};
use crate::sim::{
    stress_to_color, SetSimLoad, SetSimSpeed, SimLoad, SimTelemetry, ToggleSimPause,
};

#[derive(Component, Clone, Default)]
struct ModeLabel;

#[derive(Component, Clone, Default)]
struct BodyLabel;

#[derive(Component, Clone, Default)]
struct MaterialLabel;

#[derive(Component, Clone, Default)]
struct SelectionLabel;

#[derive(Component, Clone, Default)]
struct CurrentColorSwatch;

#[derive(Component, Clone, Default)]
struct AppearancePane;

#[derive(Component, Clone, Default)]
struct SimPane;

#[derive(Component, Clone, Default)]
struct TitleLabel;

#[derive(Component, Clone, Default)]
struct SimPeakLabel;

#[derive(Component, Clone, Default)]
struct SimDeflectLabel;

#[derive(Component, Clone, Default)]
struct SimLoadLabel;

#[derive(Component, Clone, Default)]
struct SimStateLabel;

#[derive(Component, Clone, Default)]
struct SimTimeLabel;

pub struct ChromeUiPlugin;

impl Plugin for ChromeUiPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(FeathersPlugins)
            .insert_resource(UiTheme(create_dark_theme()))
            .add_systems(Startup, ui_scene.spawn())
            .add_systems(
                Update,
                (
                    sync_mode_label.run_if(resource_changed::<State<CadMode>>),
                    sync_body_label.run_if(resource_changed::<CadSession>),
                    sync_material_label.run_if(resource_changed::<CadSession>),
                    sync_selection_label.run_if(resource_changed::<CadSession>),
                    sync_current_swatch.run_if(resource_changed::<CadSession>),
                    sync_appearance_visibility,
                    sync_sim_pane_visibility,
                    sync_title,
                    sync_sim_hud,
                ),
            );
    }
}

fn ui_scene() -> impl SceneList {
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
            padding: px(14),
        }
        TabGroup::new(0)
        Pickable::IGNORE
        Children [
            top_bar(),
            mid_row(),
            bottom_bar(),
        ]
    }
}

fn top_bar() -> impl Scene {
    bsn! {
        Node {
            display: Display::Flex,
            flex_direction: FlexDirection::Row,
            justify_content: JustifyContent::SpaceBetween,
            align_items: AlignItems::FlexStart,
            width: percent(100),
            column_gap: px(12),
        }
        Pickable::IGNORE
        Children [
            mode_pane(),
            title_pane(),
        ]
    }
}

fn title_pane() -> impl Scene {
    bsn! {
        (
            pane()
            Node {
                min_width: px(320),
                align_self: AlignSelf::FlexStart,
            }
            Pickable::IGNORE
            Children [
                pane_header() Children [
                    label("noBS CAD"),
                ],
                pane_body() Children [
                    (
                        Text("Simulate") ThemedText TitleLabel
                    ),
                    label_dim("Bevy shell · OCCT remains B-rep truth"),
                ]
            ]
        )
    }
}

fn mode_pane() -> impl Scene {
    bsn! {
        (
            pane()
            Node {
                min_width: px(280),
            }
            Pickable::default()
            Children [
                pane_header() Children [
                    label("Mode"),
                    ( Text("Simulate") ThemedText ModeLabel ),
                ],
                pane_body() Children [
                    (
                        Node {
                            display: Display::Flex,
                            flex_direction: FlexDirection::Row,
                            column_gap: px(8),
                            margin: UiRect::top(px(4)),
                            flex_wrap: FlexWrap::Wrap,
                        }
                        Children [
                            (
                                @FeathersButton {
                                    @caption: bsn! { Text("Sketch") ThemedText }
                                }
                                on(|_a: On<Activate>, mut modes: MessageWriter<SetMode>| {
                                    modes.write(SetMode(CadMode::Sketch));
                                })
                            ),
                            (
                                @FeathersButton {
                                    @caption: bsn! { Text("Solid") ThemedText }
                                }
                                on(|_a: On<Activate>, mut modes: MessageWriter<SetMode>| {
                                    modes.write(SetMode(CadMode::Solid));
                                })
                            ),
                            (
                                @FeathersButton {
                                    @caption: bsn! { Text("Simulate") ThemedText }
                                }
                                on(|_a: On<Activate>, mut modes: MessageWriter<SetMode>| {
                                    modes.write(SetMode(CadMode::Simulate));
                                })
                            ),
                        ]
                    ),
                ]
            ]
        )
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
            column_gap: px(10),
        }
        Pickable::IGNORE
        Children [
            appearance_pane(),
            sim_pane(),
        ]
    }
}

fn appearance_pane() -> impl Scene {
    bsn! {
        (
            pane()
            AppearancePane
            Node {
                width: px(240),
                margin: UiRect::top(px(8)),
            }
            Visibility::Hidden
            Pickable::default()
            Children [
                pane_header() Children [
                    label("Appearance"),
                ],
                pane_body() Children [
                    ( Text("FixtureCube") ThemedText BodyLabel ),
                    ( Text("PLA Red") ThemedText MaterialLabel ),
                    (
                        Node {
                            display: Display::Flex,
                            flex_direction: FlexDirection::Row,
                            align_items: AlignItems::Center,
                            column_gap: px(8),
                            margin: UiRect::vertical(px(4)),
                        }
                        Children [
                            label_dim("Current"),
                            (
                                @FeathersColorSwatch
                                ColorSwatchValue(Color::srgb(0.85, 0.35, 0.2))
                                CurrentColorSwatch
                                Node { width: px(36), height: px(24) }
                            ),
                        ]
                    ),
                    (
                        Node {
                            display: Display::Flex,
                            flex_direction: FlexDirection::Column,
                            row_gap: px(6),
                        }
                        Children [
                            preset_row(0),
                            preset_row(1),
                            preset_row(2),
                            preset_row(3),
                        ]
                    ),
                ]
            ]
        )
    }
}

fn preset_row(index: usize) -> impl Scene {
    let (name, hint, r, g, b) = COLOR_PRESETS[index];
    let color = Color::srgb(r, g, b);
    let caption = name.to_string();
    bsn! {
        Node {
            display: Display::Flex,
            flex_direction: FlexDirection::Row,
            align_items: AlignItems::Center,
            column_gap: px(8),
        }
        Children [
            (
                @FeathersColorSwatch
                ColorSwatchValue(color)
                Node { width: px(28), height: px(22) }
            ),
            (
                @FeathersButton {
                    @caption: bsn! { Text(caption) ThemedText }
                }
                on(move |_a: On<Activate>, mut appearance: MessageWriter<ApplyAppearance>| {
                    appearance.write(ApplyAppearance { preset_index: index });
                })
            ),
            label_dim(hint),
        ]
    }
}

fn sim_pane() -> impl Scene {
    let cool = stress_to_color(0.08);
    let mid = stress_to_color(0.55);
    let hot = stress_to_color(0.95);
    bsn! {
        (
            pane()
            SimPane
            Node {
                width: px(280),
                margin: UiRect::top(px(8)),
            }
            Pickable::default()
            Children [
                pane_header() Children [
                    label("Analysis"),
                ],
                pane_body() Children [
                    (
                        Text("Running") ThemedText SimStateLabel
                    ),
                    (
                        Text("σ  — MPa") ThemedText SimPeakLabel
                    ),
                    (
                        Text("δ  — mm") ThemedText SimDeflectLabel
                    ),
                    (
                        Text("Load  —%") ThemedText SimLoadLabel
                    ),
                    (
                        Text("t  0.0 s") ThemedText SimTimeLabel
                    ),
                    (
                        Node {
                            display: Display::Flex,
                            flex_direction: FlexDirection::Row,
                            column_gap: px(6),
                            margin: UiRect::top(px(8)),
                            flex_wrap: FlexWrap::Wrap,
                        }
                        Children [
                            (
                                @FeathersButton {
                                    @caption: bsn! { Text("Pause") ThemedText }
                                }
                                on(|_a: On<Activate>, mut pause: MessageWriter<ToggleSimPause>| {
                                    pause.write(ToggleSimPause);
                                })
                            ),
                            (
                                @FeathersButton {
                                    @caption: bsn! { Text("0.5×") ThemedText }
                                }
                                on(|_a: On<Activate>, mut speed: MessageWriter<SetSimSpeed>| {
                                    speed.write(SetSimSpeed(0.5));
                                })
                            ),
                            (
                                @FeathersButton {
                                    @caption: bsn! { Text("1×") ThemedText }
                                }
                                on(|_a: On<Activate>, mut speed: MessageWriter<SetSimSpeed>| {
                                    speed.write(SetSimSpeed(1.0));
                                })
                            ),
                            (
                                @FeathersButton {
                                    @caption: bsn! { Text("2×") ThemedText }
                                }
                                on(|_a: On<Activate>, mut speed: MessageWriter<SetSimSpeed>| {
                                    speed.write(SetSimSpeed(2.0));
                                })
                            ),
                        ]
                    ),
                    (
                        Node {
                            display: Display::Flex,
                            flex_direction: FlexDirection::Row,
                            column_gap: px(6),
                            margin: UiRect::top(px(6)),
                            flex_wrap: FlexWrap::Wrap,
                        }
                        Children [
                            (
                                @FeathersButton {
                                    @caption: bsn! { Text("Low") ThemedText }
                                }
                                on(|_a: On<Activate>, mut load: MessageWriter<SetSimLoad>| {
                                    load.write(SetSimLoad(0.3));
                                })
                            ),
                            (
                                @FeathersButton {
                                    @caption: bsn! { Text("Med") ThemedText }
                                }
                                on(|_a: On<Activate>, mut load: MessageWriter<SetSimLoad>| {
                                    load.write(SetSimLoad(0.65));
                                })
                            ),
                            (
                                @FeathersButton {
                                    @caption: bsn! { Text("High") ThemedText }
                                }
                                on(|_a: On<Activate>, mut load: MessageWriter<SetSimLoad>| {
                                    load.write(SetSimLoad(1.0));
                                })
                            ),
                        ]
                    ),
                    label_dim("Space pause · [ ] load · , . / speed"),
                    (
                        Node {
                            display: Display::Flex,
                            flex_direction: FlexDirection::Row,
                            column_gap: px(6),
                            align_items: AlignItems::Center,
                            margin: UiRect::top(px(6)),
                        }
                        Children [
                            (
                                @FeathersColorSwatch
                                ColorSwatchValue(cool)
                                Node { width: px(32), height: px(16) }
                            ),
                            (
                                @FeathersColorSwatch
                                ColorSwatchValue(mid)
                                Node { width: px(32), height: px(16) }
                            ),
                            (
                                @FeathersColorSwatch
                                ColorSwatchValue(hot)
                                Node { width: px(32), height: px(16) }
                            ),
                            label_dim("cool → hot"),
                        ]
                    ),
                ]
            ]
        )
    }
}

fn bottom_bar() -> impl Scene {
    bsn! {
        (
            pane()
            Node {
                align_self: AlignSelf::Stretch,
                width: percent(100),
            }
            Pickable::default()
            Children [
                pane_header() Children [
                    label("Telemetry"),
                ],
                pane_body() Children [
                    (
                        Text("Ready") ThemedText SelectionLabel
                    ),
                    label_dim("RMB orbit · scroll zoom · Esc quit"),
                ]
            ]
        )
    }
}

fn sync_mode_label(mode: Res<State<CadMode>>, mut label: Query<&mut Text, With<ModeLabel>>) {
    for mut text in &mut label {
        *text = Text::new(mode.get().label());
    }
}

fn sync_body_label(session: Res<CadSession>, mut label: Query<&mut Text, With<BodyLabel>>) {
    for mut text in &mut label {
        *text = Text::new(session.body_name.clone());
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

fn sync_current_swatch(
    session: Res<CadSession>,
    mut swatches: Query<&mut ColorSwatchValue, With<CurrentColorSwatch>>,
) {
    for mut value in &mut swatches {
        value.0 = session.color;
    }
}

fn sync_appearance_visibility(
    mode: Res<State<CadMode>>,
    mut panes: Query<&mut Visibility, With<AppearancePane>>,
) {
    let visible = *mode.get() == CadMode::Solid;
    for mut visibility in &mut panes {
        *visibility = if visible {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }
}

fn sync_sim_pane_visibility(
    mode: Res<State<CadMode>>,
    mut panes: Query<&mut Visibility, With<SimPane>>,
) {
    let visible = *mode.get() == CadMode::Simulate;
    for mut visibility in &mut panes {
        *visibility = if visible {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
    }
}

fn sync_title(mode: Res<State<CadMode>>, mut label: Query<&mut Text, With<TitleLabel>>) {
    let title = match mode.get() {
        CadMode::Simulate => "Cantilever (mock)",
        CadMode::Solid => "Solid fixture",
        CadMode::Sketch => "Sketch layout",
    };
    for mut text in &mut label {
        *text = Text::new(title);
    }
}

fn sync_sim_hud(
    telemetry: Res<SimTelemetry>,
    load: Res<SimLoad>,
    mut peak: Query<
        &mut Text,
        (
            With<SimPeakLabel>,
            Without<SimDeflectLabel>,
            Without<SimLoadLabel>,
            Without<SimStateLabel>,
            Without<SimTimeLabel>,
        ),
    >,
    mut deflect: Query<
        &mut Text,
        (
            With<SimDeflectLabel>,
            Without<SimPeakLabel>,
            Without<SimLoadLabel>,
            Without<SimStateLabel>,
            Without<SimTimeLabel>,
        ),
    >,
    mut load_label: Query<
        &mut Text,
        (
            With<SimLoadLabel>,
            Without<SimPeakLabel>,
            Without<SimDeflectLabel>,
            Without<SimStateLabel>,
            Without<SimTimeLabel>,
        ),
    >,
    mut state: Query<
        &mut Text,
        (
            With<SimStateLabel>,
            Without<SimPeakLabel>,
            Without<SimDeflectLabel>,
            Without<SimLoadLabel>,
            Without<SimTimeLabel>,
        ),
    >,
    mut time_label: Query<
        &mut Text,
        (
            With<SimTimeLabel>,
            Without<SimPeakLabel>,
            Without<SimDeflectLabel>,
            Without<SimLoadLabel>,
            Without<SimStateLabel>,
        ),
    >,
) {
    if !telemetry.is_changed() && !load.is_changed() {
        return;
    }
    for mut text in &mut peak {
        *text = Text::new(format!("σ  {:.0} MPa", telemetry.peak_mpa));
    }
    for mut text in &mut deflect {
        *text = Text::new(format!("δ  {:.1} mm", telemetry.tip_deflection_mm));
    }
    for mut text in &mut load_label {
        *text = Text::new(format!("Load  {:.0}%", load.0 * 100.0));
    }
    for mut text in &mut state {
        let label = if telemetry.paused {
            format!("Paused · {:.1}×", telemetry.relative_speed)
        } else {
            format!("Running · {:.1}×", telemetry.relative_speed)
        };
        *text = Text::new(label);
    }
    for mut text in &mut time_label {
        *text = Text::new(format!("t  {:.1} s", telemetry.elapsed_secs));
    }
}
