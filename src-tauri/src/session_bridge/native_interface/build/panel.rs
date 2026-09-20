//! The retained native profile-feature panel. Every field comes from the typed form;
//! its actual widget is the control inspected and driven by MCP.

use super::{BuildCommand, BuildControl};
use crate::native_viewport::{
    interface_shell::{
        self, fields, InterfaceCamera, InterfaceControl, InterfaceOccluder, NativeInterfaceHandle,
    },
    ui::{ViewportUiAssets, ViewportUiTheme},
    ViewportPalette,
};
use crate::session_bridge::native_interface::{bind_command, NativeCommand};
use bevy::{ecs::system::SystemState, prelude::*, text::FontWeight};
use nbcad_interface::{DocumentContext, Field, KeyChord, Rect as Area};
use std::collections::{HashMap, HashSet};

#[derive(Resource, Default)]
struct PanelWidgets {
    owner: Option<DocumentContext>,
    form_id: u64,
    root: Option<Entity>,
    body: Option<Entity>,
    controls: HashMap<String, (Entity, BuildCommand)>,
    labels: HashMap<String, Entity>,
    area: Area,
    scroll: f32,
    max_scroll: f32,
}

fn node(x: f32, y: f32, width: f32, height: f32) -> Node {
    Node {
        position_type: PositionType::Absolute,
        left: px(x),
        top: px(y),
        width: px(width),
        height: px(height),
        align_items: AlignItems::Center,
        justify_content: JustifyContent::Center,
        ..default()
    }
}

/// Wheel coordinates are logical window pixels, just like the published
/// panel. The controller must call this before orbit/zoom or canvas gestures.
pub(crate) fn scroll_panel(world: &mut World, point: [f32; 2], delta: f32) -> bool {
    let Some(mut state) = world.get_resource_mut::<PanelWidgets>() else {
        return false;
    };
    if state.root.is_none() || !delta.is_finite() || !point.iter().all(|v| v.is_finite()) {
        return false;
    }
    let a = state.area;
    if f64::from(point[0]) < a.x
        || f64::from(point[0]) > a.x + a.width
        || f64::from(point[1]) < a.y
        || f64::from(point[1]) > a.y + a.height
    {
        return false;
    }
    state.scroll = (state.scroll - delta).clamp(0., state.max_scroll);
    true
}

pub(crate) fn synchronize_panel(
    world: &mut World,
    _handle: &NativeInterfaceHandle,
    owner: &DocumentContext,
    area: Area,
) -> Result<(), String> {
    let mut state = world.remove_resource::<PanelWidgets>().unwrap_or_default();
    let result = synchronize_owned(world, owner, area, &mut state);
    world.insert_resource(state);
    result
}

fn synchronize_owned(
    world: &mut World,
    owner: &DocumentContext,
    area: Area,
    state: &mut PanelWidgets,
) -> Result<(), String> {
    let panel = super::panel(world);
    if state.owner.as_ref() != Some(owner)
        || panel.as_ref().map(|p| p.form_id) != Some(state.form_id)
    {
        if let Some(root) = state.root {
            world.despawn(root);
        }
        *state = PanelWidgets::default();
    }
    let Some(panel) = panel else {
        return Ok(());
    };
    if [area.x, area.y, area.width, area.height]
        .iter()
        .any(|v| !v.is_finite())
        || area.width < 120.
        || area.height < 120.
    {
        return Err("The native feature panel needs usable window bounds".into());
    }
    let mut cameras = world.query_filtered::<Entity, With<InterfaceCamera>>();
    let camera = cameras
        .single(world)
        .map_err(|_| "Native interface camera is unavailable")?;
    let assets = world
        .get_resource::<ViewportUiAssets>()
        .cloned()
        .unwrap_or_default();
    let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
    let width = area.width as f32;
    let height = (area.height as f32).min(content_height(&panel) + 92.);
    let body_height = height - 92.;
    let root = *state.root.get_or_insert_with(|| {
        world
            .spawn((
                Name::new("Build feature panel"),
                Node::default(),
                BackgroundColor(theme.panel),
                BorderColor::all(theme.accent),
                UiTargetCamera(camera),
                InterfaceOccluder,
                ZIndex(40),
            ))
            .id()
    });
    let mut root_node = node(area.x as f32, area.y as f32, width, height);
    root_node.border = UiRect::all(px(1.));
    root_node.border_radius = BorderRadius::all(px(12.));
    if world.get::<Node>(root) != Some(&root_node) {
        world.entity_mut(root).insert(root_node);
    }
    let body = *state.body.get_or_insert_with(|| {
        let body = world
            .spawn((
                Name::new("feature fields"),
                Node::default(),
                UiTargetCamera(camera),
                ZIndex(41),
            ))
            .id();
        world.entity_mut(root).add_child(body);
        body
    });
    let mut body_node = node(12., 40., width - 24., body_height);
    body_node.overflow = Overflow::clip();
    if world.get::<Node>(body) != Some(&body_node) {
        world.entity_mut(body).insert(body_node);
    }
    state.owner = Some(owner.clone());
    state.form_id = panel.form_id;
    state.area = Area {
        height: f64::from(height),
        ..area
    };
    let mut live_controls = HashSet::new();
    let mut live_labels = HashSet::new();
    label(
        world,
        state,
        &mut live_labels,
        "title",
        root,
        camera,
        panel.kind.label(),
        node(14., 8., width - 28., 24.),
        theme,
        &assets,
        true,
    );
    let mut y = 0.;
    let inner = width - 24.;
    let mut close =
        InterfaceControl::button("solid/build", format!("Close {}", panel.kind.label()));
    close.disabled = panel.busy;
    widget(
        world,
        state,
        &mut live_controls,
        "close",
        root,
        camera,
        close,
        node(width - 34., 7., 26., 26.),
        BuildCommand::Control {
            form_id: panel.form_id,
            action: BuildControl::Cancel,
        },
        theme,
        &assets,
    )?;
    for row in panel.fields.iter().filter(|row| row.visible) {
        let key = format!("{:?}", row.field);
        if row.field == super::BuildField::Axis {
            if let Field::Choice { value, options } = &row.value {
                label(
                    world,
                    state,
                    &mut live_labels,
                    "axis-label",
                    body,
                    camera,
                    "AXIS",
                    node(0., y - state.scroll, inner, 18.),
                    theme,
                    &assets,
                    false,
                );
                y += 20.;
                for (index, option) in options.iter().enumerate() {
                    let mut c = InterfaceControl::button("solid/build", &option.label);
                    c.role = "radio".into();
                    c.selected = Some(option.value == *value);
                    c.disabled = !row.enabled || option.disabled;
                    widget(
                        world,
                        state,
                        &mut live_controls,
                        &format!("axis-{}", option.value),
                        body,
                        camera,
                        c,
                        node(
                            (index % 2) as f32 * (inner + 6.) * 0.5,
                            y + (index / 2) as f32 * 36. - state.scroll,
                            (inner - 6.) * 0.5,
                            30.,
                        ),
                        BuildCommand::Control {
                            form_id: panel.form_id,
                            action: BuildControl::Choose {
                                field: row.field,
                                option: index,
                            },
                        },
                        theme,
                        &assets,
                    )?;
                }
                y += 76.;
                continue;
            }
        }
        let mut control = InterfaceControl::button(
            nbcad_interface::catalog::group_for(panel.kind.operation()).unwrap_or("solid/build"),
            &row.label,
        );
        control.disabled = !row.enabled;
        control.field = row.value.clone();
        let action;
        match &row.value {
            Field::Text { .. } | Field::Choice { .. } => {
                label(
                    world,
                    state,
                    &mut live_labels,
                    &format!("{key}-label"),
                    body,
                    camera,
                    &row.label,
                    node(0., y - state.scroll, inner, 18.),
                    theme,
                    &assets,
                    false,
                );
                y += 20.;
                action = BuildControl::Field(row.field);
                if let Field::Choice { value, options } = &row.value {
                    let selected = options
                        .iter()
                        .find(|option| &option.value == value)
                        .map(|option| option.label.as_str())
                        .unwrap_or(value);
                    control.label = format!("{}: {}", row.label, selected);
                    control.role = "combobox".into();
                    control.expanded = Some(panel.choice_field == Some(row.field));
                    control.owned_keys = ["ArrowUp", "ArrowDown", "Home", "End"]
                        .map(KeyChord::plain)
                        .into();
                }
            }
            Field::Toggle(value) => {
                action = BuildControl::Field(row.field);
                control.role = "checkbox".into();
                control.selected = Some(*value);
            }
            Field::None => {
                let label_text = match row.field {
                    super::BuildField::Source if panel.kind == super::BuildKind::Loft => "SECTIONS",
                    super::BuildField::Source => "PROFILES",
                    super::BuildField::AxisLine => "AXIS LINE",
                    super::BuildField::Targets => "TARGET BODIES",
                    super::BuildField::StopFace => "STOP FACE",
                    super::BuildField::Path => {
                        if matches!(panel.kind, super::BuildKind::Loft | super::BuildKind::Rib) {
                            "CENTERLINE"
                        } else {
                            "PATH"
                        }
                    }
                    super::BuildField::Guide => "GUIDE RAIL",
                    _ => "REFERENCE",
                };
                label(
                    world,
                    state,
                    &mut live_labels,
                    &format!("{key}-label"),
                    body,
                    camera,
                    label_text,
                    node(0., y - state.scroll, inner, 18.),
                    theme,
                    &assets,
                    false,
                );
                y += 20.;
                action = BuildControl::Pick(row.field);
                control.selected = Some(panel.pick_target == Some(row.field));
            }
        }
        let reference = matches!(row.value, Field::None);
        widget(
            world,
            state,
            &mut live_controls,
            &key,
            body,
            camera,
            control,
            node(
                0.,
                y - state.scroll,
                inner,
                if reference { 62. } else { 30. },
            ),
            BuildCommand::Control {
                form_id: panel.form_id,
                action,
            },
            theme,
            &assets,
        )?;
        if reference {
            interface_shell::reference_caption(world, state.controls[&key].0);
            label(
                world,
                state,
                &mut live_labels,
                &format!("{key}-hint"),
                body,
                camera,
                match row.field {
                    super::BuildField::Source if panel.kind == super::BuildKind::Loft => {
                        "Click sections in order; click again to remove."
                    }
                    super::BuildField::Source => "Click a profile in the viewport.",
                    super::BuildField::AxisLine => "Click a straight line on the profile plane.",
                    super::BuildField::Path if panel.kind == super::BuildKind::Rib => {
                        "Click centerline curves to add or remove."
                    }
                    super::BuildField::Path | super::BuildField::Guide => {
                        "Click connected curves to add or remove."
                    }
                    super::BuildField::Targets => "Click bodies to add or remove.",
                    _ => "Click a planar face in the viewport.",
                },
                node(8., y + 32. - state.scroll, inner - 16., 24.),
                theme,
                &assets,
                false,
            );
            let mut clear = InterfaceControl::button(
                "solid/build",
                match row.field {
                    super::BuildField::Source => "Clear source profiles",
                    super::BuildField::AxisLine => "Clear axis line",
                    super::BuildField::Targets => "Clear target bodies",
                    super::BuildField::StopFace => "Clear stop face",
                    super::BuildField::Path => "Clear path curves",
                    super::BuildField::Guide => "Clear guide curves",
                    _ => "Clear reference",
                },
            );
            clear.disabled = !row.enabled;
            widget(
                world,
                state,
                &mut live_controls,
                &format!("{key}-clear"),
                body,
                camera,
                clear,
                node(inner - 54., y + 5. - state.scroll, 48., 22.),
                BuildCommand::Control {
                    form_id: panel.form_id,
                    action: BuildControl::Clear(row.field),
                },
                theme,
                &assets,
            )?;
        }
        y += if reference { 68. } else { 36. };
        if panel.choice_field == Some(row.field) {
            if let Field::Choice { value, options } = &row.value {
                for (index, option) in options.iter().enumerate() {
                    let mut choice = InterfaceControl::button("solid/build", &option.label);
                    choice.disabled = option.disabled || !row.enabled;
                    choice.role = "option".into();
                    choice.selected = Some(&option.value == value);
                    widget(
                        world,
                        state,
                        &mut live_controls,
                        &format!("{key}-option-{}", option.value),
                        body,
                        camera,
                        choice,
                        node(8., y - state.scroll, inner - 8., 28.),
                        BuildCommand::Control {
                            form_id: panel.form_id,
                            action: BuildControl::Choose {
                                field: row.field,
                                option: index,
                            },
                        },
                        theme,
                        &assets,
                    )?;
                    y += 30.;
                }
            }
        }
        if let Some(error) = &row.error {
            label(
                world,
                state,
                &mut live_labels,
                &format!("{key}-error"),
                body,
                camera,
                error,
                node(0., y - state.scroll, inner, 38.),
                theme,
                &assets,
                false,
            );
            y += 42.;
        }
    }
    for (key, message) in [
        ("engine-error", panel.error.as_deref()),
        ("preview-notice", panel.preview_notice.as_deref()),
    ] {
        if let Some(message) = message {
            label(
                world,
                state,
                &mut live_labels,
                key,
                body,
                camera,
                message,
                node(0., y - state.scroll, inner, 52.),
                theme,
                &assets,
                false,
            );
            y += 56.;
        }
    }
    state.max_scroll = (y - body_height).max(0.);
    state.scroll = state.scroll.min(state.max_scroll);
    let mut cancel =
        InterfaceControl::button("solid/build", format!("Cancel {}", panel.kind.label()));
    cancel.disabled = panel.busy;
    widget(
        world,
        state,
        &mut live_controls,
        "cancel",
        root,
        camera,
        cancel,
        node(12., height - 42., (inner - 8.) * 0.5, 30.),
        BuildCommand::Control {
            form_id: panel.form_id,
            action: BuildControl::Cancel,
        },
        theme,
        &assets,
    )?;
    let mut apply = InterfaceControl::button(
        "solid/build",
        if panel.busy {
            "Applying…".to_owned()
        } else {
            format!("Apply {}", panel.kind.label())
        },
    );
    apply.disabled = !panel.can_apply;
    apply.selected = Some(true);
    widget(
        world,
        state,
        &mut live_controls,
        "apply",
        root,
        camera,
        apply,
        node(16. + inner * 0.5, height - 42., (inner - 8.) * 0.5, 30.),
        BuildCommand::Control {
            form_id: panel.form_id,
            action: BuildControl::Apply,
        },
        theme,
        &assets,
    )?;
    state.controls.retain(|key, (entity, _)| {
        if live_controls.contains(key) {
            true
        } else {
            world.despawn(*entity);
            false
        }
    });
    state.labels.retain(|key, entity| {
        if live_labels.contains(key) {
            true
        } else {
            world.despawn(*entity);
            false
        }
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn widget(
    world: &mut World,
    state: &mut PanelWidgets,
    live: &mut HashSet<String>,
    key: &str,
    parent: Entity,
    camera: Entity,
    mut control: InterfaceControl,
    mut node: Node,
    command: BuildCommand,
    theme: ViewportUiTheme,
    assets: &ViewportUiAssets,
) -> Result<(), String> {
    live.insert(key.into());
    node.border = UiRect::all(px(1.));
    node.padding = UiRect::axes(px(7.), px(3.));
    let entity = if let Some((entity, _)) = state.controls.get(key) {
        *entity
    } else {
        let mut system = SystemState::<Commands>::new(world);
        let entity = {
            let mut commands = system.get_mut(world).map_err(|e| e.to_string())?;
            if matches!(control.field, Field::Text { .. }) {
                fields::spawn_text_field(
                    &mut commands,
                    camera,
                    node.clone(),
                    control.clone(),
                    theme,
                    assets,
                )?
            } else {
                interface_shell::spawn_button(
                    &mut commands,
                    camera,
                    node.clone(),
                    control.clone(),
                    theme,
                    assets,
                )
            }
        };
        system.apply(world);
        world.entity_mut(parent).add_child(entity);
        if matches!(control.field, Field::Choice { .. }) {
            let glyph = interface_shell::ribbon::compact_glyph(
                world,
                entity,
                interface_shell::ribbon::Icon::Chevron,
                0.,
                10.,
            );
            let mut bounds = world.get::<Node>(glyph).unwrap().clone();
            bounds.left = Val::Auto;
            bounds.right = px(8.);
            bounds.top = px(10.);
            world.entity_mut(glyph).insert(bounds);
        }
        bind_command(world, entity, NativeCommand::Build(command.clone()))?;
        state.controls.insert(key.into(), (entity, command.clone()));
        entity
    };
    if state.controls[key].1 != command {
        bind_command(world, entity, NativeCommand::Build(command.clone()))?;
        state.controls.get_mut(key).unwrap().1 = command;
    }
    control.binding = world
        .get::<InterfaceControl>(entity)
        .ok_or("Feature widget was removed")?
        .binding;
    if matches!(control.field, Field::Text { .. }) {
        control.text_editing = true;
        control.role = "textbox".into();
    }
    if world.get::<InterfaceControl>(entity) != Some(&control) {
        world.entity_mut(entity).insert(control);
    }
    if world.get::<Node>(entity) != Some(&node) {
        world.entity_mut(entity).insert(node);
    }
    if world.get::<ZIndex>(entity) != Some(&ZIndex(42)) {
        world.entity_mut(entity).insert(ZIndex(42));
    }
    let caption = if key == "close" {
        Some("×")
    } else if key == "apply" {
        Some("OK")
    } else if key == "cancel" {
        Some("Cancel")
    } else if key.ends_with("-clear") {
        Some("Clear")
    } else {
        None
    };
    if let Some(text) = caption {
        let caption = interface_shell::InterfaceCaption(text.into());
        if world.get::<interface_shell::InterfaceCaption>(entity) != Some(&caption) {
            world.entity_mut(entity).insert(caption);
        }
    }
    if key == "apply" {
        interface_shell::primary_button(world, entity);
    }
    if let Some(control) = world.get::<InterfaceControl>(entity) {
        if let Field::Toggle(checked) = control.field {
            let checked = checked;
            interface_shell::checkbox_button(world, entity, camera, checked);
            let mut bounds = world.get::<Node>(entity).unwrap().clone();
            bounds.justify_content = JustifyContent::Start;
            bounds.border = UiRect::default();
            world.entity_mut(entity).insert(bounds);
        } else if let Field::Choice { value, options } = &control.field {
            let selected = options
                .iter()
                .find(|option| option.value == *value)
                .map(|option| option.label.as_str())
                .unwrap_or(value);
            let caption = interface_shell::InterfaceCaption(selected.into());
            if world.get::<interface_shell::InterfaceCaption>(entity) != Some(&caption) {
                world.entity_mut(entity).insert(caption);
            }
        }
    }
    Ok(())
}

fn content_height(panel: &super::BuildPanel) -> f32 {
    let mut height = 0.;
    for row in panel.fields.iter().filter(|row| row.visible) {
        if row.field == super::BuildField::Axis {
            height += 96.;
            continue;
        }
        height += match row.value {
            Field::Toggle(_) => 36.,
            Field::None => 88.,
            _ => 56.,
        };
        if panel.choice_field == Some(row.field) {
            if let Field::Choice { options, .. } = &row.value {
                height += options.len() as f32 * 30.;
            }
        }
        if row.error.is_some() {
            height += 42.;
        }
    }
    if panel.error.is_some() {
        height += 56.;
    }
    if panel.preview_notice.is_some() {
        height += 56.;
    }
    height
}

#[allow(clippy::too_many_arguments)]
fn label(
    world: &mut World,
    state: &mut PanelWidgets,
    live: &mut HashSet<String>,
    key: &str,
    parent: Entity,
    camera: Entity,
    text: &str,
    node: Node,
    theme: ViewportUiTheme,
    assets: &ViewportUiAssets,
    strong: bool,
) {
    live.insert(key.into());
    let entity = *state.labels.entry(key.into()).or_insert_with(|| {
        let entity = world
            .spawn((
                Text::new(text),
                theme.text(
                    assets,
                    if strong { 16. } else { 12. },
                    if strong {
                        FontWeight::SEMIBOLD
                    } else {
                        FontWeight::NORMAL
                    },
                ),
                TextColor(if strong { theme.ink } else { theme.mute }),
                node.clone(),
                UiTargetCamera(camera),
                ZIndex(42),
            ))
            .id();
        world.entity_mut(parent).add_child(entity);
        entity
    });
    if world
        .get::<Text>(entity)
        .is_some_and(|current| current.0 != text)
    {
        world.get_mut::<Text>(entity).unwrap().0 = text.into();
    }
    if world.get::<Node>(entity) != Some(&node) {
        world.entity_mut(entity).insert(node);
    }
}
