//! Sketch groups and contextual editors use the same retained controls as
//! the rest of the application. Geometry is never edited through JSON text.
use super::*;
use crate::native_viewport::interface_shell::{self, fields, ribbon::Icon};
use crate::session_bridge::native_interface::controller::chrome::{rect, Widgets};
use nbcad_interface::{Field, KeyChord};

#[derive(Resource, Default)]
struct Panel {
    widgets: Widgets,
    field: Option<Entity>,
    form_fields: HashMap<usize, (Entity, u64)>,
    form_id: Option<u64>,
    scroll: f32,
    max_scroll: f32,
    form_area: Option<InterfaceRect>,
}
pub(super) fn group(command: &EditorCommand) -> &'static str {
    match command {
        EditorCommand::Palette(_) => "sketch/selection",
        EditorCommand::Interaction(
            InteractionCommand::Relation(_)
            | InteractionCommand::ConstraintInfo(_)
            | InteractionCommand::DeleteConstraint,
        ) => "sketch/constrain",
        EditorCommand::Interaction(
            InteractionCommand::Dimension
            | InteractionCommand::EditDimension(_)
            | InteractionCommand::DeleteDimension
            | InteractionCommand::DimensionReference
            | InteractionCommand::RepositionDimension
            | InteractionCommand::DimensionText(_)
            | InteractionCommand::ApplyDimension
            | InteractionCommand::CancelDimension,
        ) => "sketch/dimension",
        EditorCommand::Interaction(InteractionCommand::Select) => "sketch/selection",
        EditorCommand::Interaction(InteractionCommand::Form(kind)) => kind.group(),
        EditorCommand::Interaction(_) => "sketch/edit",
        _ => "sketch/draw",
    }
}
pub(super) fn synchronize(
    world: &mut World,
    camera: Entity,
    editor: &mut Editor,
    area: InterfaceRect,
) -> Result<(), String> {
    let mut panel = world.remove_resource::<Panel>().unwrap_or_default();
    let result = (|| {
        let active = editor.stamp.as_ref().is_some_and(|s| s.sketch.is_some());
        panel.widgets.begin();
        let window_height = world
            .query_filtered::<&Window, With<bevy::window::PrimaryWindow>>()
            .single(world)
            .map(|w| w.height())
            .unwrap_or(860.);
        if active {
            let x = area.x as f32;
            let compact = area.width < 1156.;
            for (index, (key, label, mut left, mut width)) in [
                ("draw", "DRAW", x, 298.),
                ("edit", "EDIT", x + 300., 248.),
                ("repeat", "REPEAT", x + 600., 148.),
                ("constrain", "CONSTRAIN", x + 750., 248.),
            ]
            .into_iter()
            .enumerate()
            {
                if compact {
                    width = ((area.width as f32 - 156.) / 4.).max(72.);
                    left = x + index as f32 * width;
                }
                let mut c =
                    InterfaceControl::button(format!("sketch/{key}"), format!("{label} tools"));
                c.expanded = Some(editor.interaction.menu == Some(key));
                let mut bounds = rect(left, area.y as f32 + 54., width, 18.);
                bounds.justify_content = JustifyContent::Center;
                let entity = panel.widgets.button(
                    world,
                    camera,
                    &format!("group-{key}"),
                    c,
                    Some(label),
                    NativeCommand::Sketch(EditorCommand::Interaction(InteractionCommand::Menu(
                        if editor.interaction.menu == Some(key) {
                            None
                        } else {
                            Some(key)
                        },
                    ))),
                    bounds,
                    Some(Icon::ChevronDown),
                    24,
                )?;
                interface_shell::caption_size(world, entity, 10.);
                interface_shell::center_caption(world, entity);
            }
            if let Some(menu) = editor.interaction.menu {
                let rows: Vec<(String, EditorCommand)> = match menu {
                    "draw" => [
                        CreateTool::Line,
                        CreateTool::MidpointLine,
                        CreateTool::Point,
                        CreateTool::Rectangle(RectangleMode::TwoPoint),
                        CreateTool::Rectangle(RectangleMode::Center),
                        CreateTool::Circle(CircleMode::CenterDiameter),
                        CreateTool::Circle(CircleMode::TwoPoint),
                        CreateTool::Arc3Point,
                        CreateTool::ArcCenter,
                        CreateTool::Slot(SlotMode::CenterToCenter),
                        CreateTool::Slot(SlotMode::Overall),
                        CreateTool::Slot(SlotMode::CenterPoint),
                        CreateTool::Spline,
                    ]
                    .into_iter()
                    .map(|t| (t.label().into(), EditorCommand::Tool(t)))
                    .chain(std::iter::once((
                        "Polygon".into(),
                        EditorCommand::Interaction(InteractionCommand::Form(FormKind::Polygon)),
                    )))
                    .collect(),
                    "constrain" => constraints::Relation::ALL
                        .into_iter()
                        .map(|t| {
                            (
                                t.label().into(),
                                EditorCommand::Interaction(InteractionCommand::Relation(t)),
                            )
                        })
                        .collect(),
                    "repeat" => [
                        FormKind::Mirror,
                        FormKind::RectangularPattern,
                        FormKind::CircularPattern,
                    ]
                    .into_iter()
                    .map(|kind| {
                        (
                            kind.label().into(),
                            EditorCommand::Interaction(InteractionCommand::Form(kind)),
                        )
                    })
                    .collect(),
                    _ => {
                        let mut rows = vec![
                            (
                                "Trim".into(),
                                EditorCommand::Interaction(InteractionCommand::Modify(
                                    ModifyTool::Trim,
                                )),
                            ),
                            (
                                "Extend".into(),
                                EditorCommand::Interaction(InteractionCommand::Modify(
                                    ModifyTool::Extend,
                                )),
                            ),
                            (
                                "Break".into(),
                                EditorCommand::Interaction(InteractionCommand::Modify(
                                    ModifyTool::Break,
                                )),
                            ),
                        ];
                        rows.extend(
                            [
                                FormKind::Fillet,
                                FormKind::Chamfer,
                                FormKind::Offset,
                                FormKind::MoveCopy,
                                FormKind::Scale,
                            ]
                            .into_iter()
                            .map(|kind| {
                                (
                                    kind.label().into(),
                                    EditorCommand::Interaction(InteractionCommand::Form(kind)),
                                )
                            }),
                        );
                        rows.push((
                            "Delete selected".into(),
                            EditorCommand::Interaction(InteractionCommand::Delete),
                        ));
                        rows.push((
                            "Sketch Dimension".into(),
                            EditorCommand::Interaction(InteractionCommand::Dimension),
                        ));
                        rows.push((
                            "Select".into(),
                            EditorCommand::Interaction(InteractionCommand::Select),
                        ));
                        rows
                    }
                };
                let left = (x + match menu {
                    "edit" => 300.,
                    "repeat" => 600.,
                    "constrain" => 750.,
                    _ => 0.,
                })
                .min((area.x + area.width) as f32 - 240.);
                let top = area.y as f32 + 74.;
                let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
                let height = world
                    .query_filtered::<&Window, With<bevy::window::PrimaryWindow>>()
                    .single(world)
                    .map(|w| w.height())
                    .unwrap_or(860.);
                panel.widgets.backdrop(
                    world,
                    camera,
                    "menu-backdrop",
                    "sketch-menu",
                    NativeCommand::Sketch(EditorCommand::Interaction(InteractionCommand::Menu(
                        None,
                    ))),
                    rect(0., 0., (area.x + area.width) as f32, height),
                    59,
                )?;
                panel.widgets.panel(
                    world,
                    camera,
                    "menu",
                    rect(left, top, 240., rows.len() as f32 * 28. + 8.),
                    theme.panel.with_alpha(1.),
                    60,
                );
                for (index, (label, command)) in rows.into_iter().enumerate() {
                    let mut control = InterfaceControl::button(group(&command), &label);
                    control.modal_scope = Some("sketch-menu".into());
                    control.role = "menuitem".into();
                    control.owned_keys = ["ArrowUp", "ArrowDown", "Home", "End"]
                        .map(KeyChord::plain)
                        .into();
                    control.disabled = matches!(
                        command,
                        EditorCommand::Interaction(InteractionCommand::Delete)
                    ) && editor.interaction.selection.is_empty();
                    panel.widgets.button(
                        world,
                        camera,
                        &format!("menu-{menu}-{index}"),
                        control,
                        None,
                        NativeCommand::Sketch(command),
                        rect(left + 4., top + 4. + index as f32 * 28., 232., 28.),
                        None,
                        61,
                    )?;
                }
            }
        }
        let dimension = active && editor.interaction.dimension.is_some();
        if dimension {
            let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
            let left = ((area.x + area.width) as f32 - 280.).max(240.);
            let top = area.y as f32 + 94.;
            panel.widgets.panel(
                world,
                camera,
                "dimension",
                rect(
                    left,
                    top,
                    272.,
                    if editor.interaction.dimension_id.is_some() {
                        252.
                    } else {
                        184.
                    },
                ),
                theme.panel.with_alpha(1.),
                30,
            );
            panel.widgets.text(
                world,
                camera,
                "dim-title",
                rect(left + 12., top + 8., 248., 24.),
                "Sketch Dimension",
                13.,
                31,
            );
            let label = if editor.interaction.dimension_reference {
                "Reference measurement (read only)"
            } else if editor.interaction.dimension_position.is_some() {
                "Value / expression (blank measures)"
            } else {
                "Select geometry, then click to place"
            };
            panel.widgets.text(
                world,
                camera,
                "dim-help",
                rect(left + 12., top + 38., 248., 24.),
                label,
                11.,
                31,
            );
            let mut c = InterfaceControl::button("sketch/dimension", "Dimension value");
            c.field = Field::Text {
                value: editor.interaction.dimension.clone().unwrap(),
                read_only: editor.interaction.dimension_reference,
                selection: None,
            };
            let mut node = rect(left + 12., top + 68., 248., 30.);
            node.border = UiRect::all(px(1.));
            node.padding = UiRect::horizontal(px(6.));
            let field = if let Some(field) = panel.field {
                field
            } else {
                let assets = world.resource::<ViewportUiAssets>().clone();
                let field = fields::spawn_text_field(
                    &mut world.commands(),
                    camera,
                    node.clone(),
                    c.clone(),
                    theme,
                    &assets,
                )?;
                world.flush();
                bind_command(
                    world,
                    field,
                    NativeCommand::Sketch(EditorCommand::Interaction(
                        InteractionCommand::DimensionText(String::new()),
                    )),
                )?;
                panel.field = Some(field);
                field
            };
            let mut previous = world.get::<InterfaceControl>(field).unwrap().clone();
            previous.field = c.field;
            if world.get::<InterfaceControl>(field) != Some(&previous) {
                world.entity_mut(field).insert(previous);
            }
            if world.get::<Node>(field) != Some(&node) {
                world.entity_mut(field).insert(node);
            }
            world.entity_mut(field).insert(ZIndex(31));
            for (key, label, command, offset) in [
                (
                    "dim-cancel",
                    "Cancel Dimension",
                    InteractionCommand::CancelDimension,
                    0.,
                ),
                (
                    "dim-apply",
                    "Apply Dimension",
                    InteractionCommand::ApplyDimension,
                    128.,
                ),
            ] {
                let mut c = InterfaceControl::button("sketch/dimension", label);
                c.disabled = matches!(command, InteractionCommand::ApplyDimension)
                    && (editor.interaction.dimension_reference
                        || editor.interaction.dimension_position.is_none()
                        || editor.interaction.selection.is_empty());
                c.selected = Some(offset != 0.);
                let mut bounds = rect(left + 12. + offset, top + 116., 120., 30.);
                bounds.border = UiRect::all(px(1.));
                bounds.justify_content = JustifyContent::Center;
                panel.widgets.button(
                    world,
                    camera,
                    key,
                    c,
                    Some(if offset == 0. { "Cancel" } else { "Apply" }),
                    NativeCommand::Sketch(EditorCommand::Interaction(command)),
                    bounds,
                    None,
                    31,
                )?;
                if offset != 0. {
                    interface_shell::primary_button(world, panel.widgets.entity(key).unwrap());
                }
            }
            if editor.interaction.dimension_id.is_some() {
                panel.widgets.button(
                    world,
                    camera,
                    "dim-delete",
                    InterfaceControl::button("sketch/dimension", "Delete Dimension"),
                    None,
                    NativeCommand::Sketch(EditorCommand::Interaction(
                        InteractionCommand::DeleteDimension,
                    )),
                    rect(left + 12., top + 150., 248., 26.),
                    None,
                    31,
                )?;
                panel.widgets.button(
                    world,
                    camera,
                    "dim-reference",
                    InterfaceControl::button("sketch/dimension", "Toggle Driving / Reference"),
                    None,
                    NativeCommand::Sketch(EditorCommand::Interaction(
                        InteractionCommand::DimensionReference,
                    )),
                    rect(left + 12., top + 182., 248., 26.),
                    None,
                    31,
                )?;
                panel.widgets.button(
                    world,
                    camera,
                    "dim-reposition",
                    InterfaceControl::button("sketch/dimension", "Reposition Dimension"),
                    None,
                    NativeCommand::Sketch(EditorCommand::Interaction(
                        InteractionCommand::RepositionDimension,
                    )),
                    rect(left + 12., top + 214., 248., 26.),
                    None,
                    31,
                )?;
            }
        } else if let Some(field) = panel.field.take() {
            world.despawn(field);
        }
        let form = editor.interaction.form.as_ref().filter(|_| active);
        if panel.form_id != form.map(|f| f.id) {
            panel.form_id = form.map(|f| f.id);
            panel.scroll = 0.;
        }
        panel.form_area = None;
        if let Some(constraint) = editor.interaction.constraint.as_ref().filter(|_| active) {
            let left = ((area.x + area.width) as f32 - 296.).max(240.);
            let top = area.y as f32 + 94.;
            let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
            panel.widgets.panel(
                world,
                camera,
                "constraint",
                rect(left, top, 288., 150.),
                theme.panel.with_alpha(1.),
                30,
            );
            panel.widgets.text(
                world,
                camera,
                "constraint-title",
                rect(left + 12., top + 8., 264., 24.),
                &constraint.constraint.kind_str().replace('_', " "),
                13.,
                31,
            );
            panel.widgets.text(
                world,
                camera,
                "constraint-entities",
                rect(left + 12., top + 38., 264., 42.),
                &format!(
                    "Geometry: {}",
                    constraint
                        .constraint
                        .referenced_entities()
                        .iter()
                        .map(|id| id.0.to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                11.,
                31,
            );
            panel.widgets.button(
                world,
                camera,
                "constraint-delete",
                InterfaceControl::button("sketch/constrain", "Delete Constraint"),
                None,
                NativeCommand::Sketch(EditorCommand::Interaction(
                    InteractionCommand::DeleteConstraint,
                )),
                rect(left + 12., top + 80., 264., 28.),
                None,
                31,
            )?;
            panel.widgets.button(
                world,
                camera,
                "constraint-close",
                InterfaceControl::button("sketch/constrain", "Close Constraint"),
                None,
                NativeCommand::Sketch(EditorCommand::Interaction(InteractionCommand::Select)),
                rect(left + 12., top + 114., 264., 28.),
                None,
                31,
            )?;
        }
        panel.form_fields.retain(|index, (entity, id)| {
            if form.is_some_and(|f| f.id == *id && *index < f.values.len()) {
                true
            } else {
                world.despawn(*entity);
                false
            }
        });
        if let Some(form) = form {
            let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
            let assets = world.resource::<ViewportUiAssets>().clone();
            let left = ((area.x + area.width) as f32 - 296.).max(240.);
            let top = area.y as f32 + 94.;
            let height =
                (168. + form.values.len() as f32 * 52.).min((window_height - top - 84.).max(220.));
            let body_height = height - 160.;
            panel.max_scroll = (form.values.len() as f32 * 52. - body_height).max(0.);
            panel.scroll = panel.scroll.clamp(0., panel.max_scroll);
            panel.form_area = Some(InterfaceRect {
                x: f64::from(left),
                y: f64::from(top),
                width: 288.,
                height: f64::from(height),
            });
            panel.widgets.panel(
                world,
                camera,
                "form",
                rect(left, top, 288., height),
                theme.panel.with_alpha(1.),
                30,
            );
            panel.widgets.text(
                world,
                camera,
                "form-title",
                rect(left + 12., top + 8., 264., 24.),
                form.kind.label(),
                13.,
                31,
            );
            panel.widgets.text(
                world,
                camera,
                "form-instruction",
                rect(left + 12., top + 34., 264., 42.),
                form.kind.instruction(),
                11.,
                31,
            );
            panel.widgets.panel(
                world,
                camera,
                "form-body",
                rect(left + 12., top + 78., 264., body_height),
                Color::NONE,
                31,
            );
            let body = panel.widgets.entity("form-body").unwrap();
            let mut content_bounds = rect(0., -panel.scroll, 264., form.values.len() as f32 * 52.);
            content_bounds.overflow = Overflow::visible();
            panel.widgets.panel(
                world,
                camera,
                "form-content",
                content_bounds,
                Color::NONE,
                31,
            );
            panel.widgets.parent(world, "form-content", body);
            let content = panel.widgets.entity("form-content").unwrap();
            for (index, ((label, _), value)) in
                form.kind.fields().iter().zip(&form.values).enumerate()
            {
                let y = index as f32 * 52.;
                panel.widgets.text(
                    world,
                    camera,
                    &format!("form-label-{index}"),
                    rect(0., y, 264., 18.),
                    label,
                    11.,
                    31,
                );
                panel
                    .widgets
                    .parent(world, &format!("form-label-{index}"), content);
                let mut control = InterfaceControl::button(form.kind.group(), *label);
                control.field = Field::Text {
                    value: value.clone(),
                    read_only: false,
                    selection: None,
                };
                let mut bounds = rect(0., y + 18., 264., 30.);
                bounds.border = UiRect::all(px(1.));
                bounds.padding = UiRect::horizontal(px(6.));
                let entity = if let Some((entity, _)) = panel.form_fields.get(&index) {
                    *entity
                } else {
                    let entity = fields::spawn_text_field(
                        &mut world.commands(),
                        camera,
                        bounds.clone(),
                        control.clone(),
                        theme,
                        &assets,
                    )?;
                    world.flush();
                    bind_command(
                        world,
                        entity,
                        NativeCommand::Sketch(EditorCommand::Interaction(
                            InteractionCommand::FormValue {
                                id: form.id,
                                index,
                                text: String::new(),
                            },
                        )),
                    )?;
                    panel.form_fields.insert(index, (entity, form.id));
                    entity
                };
                let mut old = world.get::<InterfaceControl>(entity).unwrap().clone();
                old.field = control.field;
                if world.get::<InterfaceControl>(entity) != Some(&old) {
                    world.entity_mut(entity).insert(old);
                }
                if world.get::<Node>(entity) != Some(&bounds) {
                    world.entity_mut(entity).insert(bounds);
                }
                world.entity_mut(entity).insert(ZIndex(31));
                if world.get::<ChildOf>(entity).map(ChildOf::parent) != Some(content) {
                    world.entity_mut(entity).insert(ChildOf(content));
                }
            }
            let y = top + height - 82.;
            if matches!(form.kind, FormKind::MoveCopy | FormKind::Polygon) {
                let label = if form.kind == FormKind::MoveCopy {
                    "Create copy"
                } else {
                    "Circumscribed"
                };
                let mut c = InterfaceControl::button(form.kind.group(), label);
                c.field = Field::Toggle(form.option);
                c.selected = Some(form.option);
                c.role = "checkbox".into();
                panel.widgets.button(
                    world,
                    camera,
                    "form-option",
                    c,
                    None,
                    NativeCommand::Sketch(EditorCommand::Interaction(
                        InteractionCommand::FormOption { id: form.id },
                    )),
                    rect(left + 12., y, 264., 28.),
                    None,
                    31,
                )?;
            } else {
                panel.widgets.text(
                    world,
                    camera,
                    "form-selection",
                    rect(left + 12., y, 264., 28.),
                    &format!("{} selected", editor.interaction.selection.len()),
                    11.,
                    31,
                );
            }
            for (key, label, command, offset) in [
                (
                    "form-cancel",
                    "Cancel",
                    InteractionCommand::CancelForm { id: form.id },
                    0.,
                ),
                (
                    "form-apply",
                    "Apply",
                    InteractionCommand::ApplyForm { id: form.id },
                    136.,
                ),
            ] {
                let mut c = InterfaceControl::button(
                    form.kind.group(),
                    format!("{label} {}", form.kind.label()),
                );
                c.selected = Some(offset != 0.);
                let mut bounds = rect(left + 12. + offset, y + 40., 128., 30.);
                bounds.border = UiRect::all(px(1.));
                bounds.justify_content = JustifyContent::Center;
                panel.widgets.button(
                    world,
                    camera,
                    key,
                    c,
                    Some(label),
                    NativeCommand::Sketch(EditorCommand::Interaction(command)),
                    bounds,
                    None,
                    31,
                )?;
                if offset != 0. {
                    interface_shell::primary_button(world, panel.widgets.entity(key).unwrap());
                }
            }
        }
        panel.widgets.finish(world);
        Ok(())
    })();
    world.insert_resource(panel);
    result
}

pub(crate) fn modal(world: &World) -> Option<&'static str> {
    world
        .get_resource::<Editor>()
        .and_then(|e| e.interaction.menu)
        .map(|_| "sketch-menu")
}
pub(crate) fn scroll_panel(world: &mut World, point: [f32; 2], delta: f32) -> bool {
    if super::palette::scroll(world, point, delta) {
        return true;
    }
    let Some(mut panel) = world.get_resource_mut::<Panel>() else {
        return false;
    };
    let Some(a) = panel.form_area else {
        return false;
    };
    if !delta.is_finite()
        || !point.iter().all(|v| v.is_finite())
        || f64::from(point[0]) < a.x
        || f64::from(point[0]) > a.x + a.width
        || f64::from(point[1]) < a.y
        || f64::from(point[1]) > a.y + a.height
    {
        return false;
    }
    panel.scroll = (panel.scroll - delta).clamp(0., panel.max_scroll);
    true
}
pub(crate) fn escape(world: &mut World) {
    if let Some(mut editor) = world.get_resource_mut::<Editor>() {
        editor.interaction.menu = None;
    }
}
