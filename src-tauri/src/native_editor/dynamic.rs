//! On-canvas drawing dimensions. Typed values use the existing constrained
//! engine operations; these fields hold only one unfinished gesture.
use super::*;
use crate::native_forms::{DimensionKind, MeasurementInput, ParameterValue};
use crate::native_viewport::interface_shell::fields;
use crate::session_bridge::native_interface::controller::chrome::{rect, Widgets};
use nbcad_core::UnitSystem;
use nbcad_interface::Field;
use nbcad_sketch::{
    LockedCircleRequest, LockedRectangleRequest, LockedSegmentRequest, SlotRequest,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum SizeField {
    Length,
    Angle,
    Width,
    Height,
    Diameter,
}
impl SizeField {
    fn label(self) -> &'static str {
        match self {
            Self::Length => "Length",
            Self::Angle => "Angle",
            Self::Width => "Width",
            Self::Height => "Height",
            Self::Diameter => "Diameter",
        }
    }
    fn kind(self) -> DimensionKind {
        if self == Self::Angle {
            DimensionKind::Angle
        } else {
            DimensionKind::Length
        }
    }
}

#[derive(Clone, Debug)]
struct LockedValue {
    text: String,
    resolved: Result<(f64, String), String>,
}
#[derive(Clone, Debug, Default)]
pub(super) struct Sizes {
    values: HashMap<SizeField, LockedValue>,
}

impl Sizes {
    fn set(&mut self, field: SizeField, text: String, units: UnitSystem, sketch: &SketchDto) {
        if text.trim().is_empty() {
            self.values.remove(&field);
            return;
        }
        let parameters: Vec<_> = sketch
            .dimensions
            .iter()
            .filter_map(|d| {
                Some(ParameterValue {
                    name: d.param_name.clone()?,
                    value: d.value,
                    kind: if d.kind == "angle" {
                        DimensionKind::Angle
                    } else {
                        DimensionKind::Length
                    },
                })
            })
            .collect();
        let mut input = MeasurementInput::new(field.kind(), 0., units);
        input.set_text(text.clone());
        let resolved = input.evaluate_expression(units, &parameters).and_then(|v| {
            if field != SizeField::Angle && v.0 <= 0. {
                Err("Enter a positive size".into())
            } else {
                Ok(v)
            }
        });
        self.values.insert(field, LockedValue { text, resolved });
    }
    fn value(&self, field: SizeField) -> Result<Option<(f64, String)>, String> {
        self.values
            .get(&field)
            .map(|v| v.resolved.clone())
            .transpose()
            .map_err(|e| format!("{}: {e}", field.label()))
    }
    fn pair(&self, field: SizeField) -> Result<(Option<f64>, Option<String>), String> {
        Ok(self
            .value(field)?
            .map(|(v, t)| (Some(v), Some(t)))
            .unwrap_or_default())
    }
    pub(super) fn prepare(
        &self,
        tool: CreateTool,
        picks: &[SketchPoint],
        ctrl: bool,
    ) -> Result<Option<Prepared>, String> {
        if self.values.is_empty() {
            return Ok(None);
        }
        self.request(tool, picks, ctrl).map(Some)
    }
    fn request(
        &self,
        tool: CreateTool,
        picks: &[SketchPoint],
        ctrl: bool,
    ) -> Result<Prepared, String> {
        let anchor = *picks.first().ok_or("Pick the first point")?;
        let hint = *picks.get(1).ok_or("Pick the second point")?;
        let (operation, arguments) = match tool {
            CreateTool::Line => {
                let (length_mm, length_text) = self.pair(SizeField::Length)?;
                let (angle_deg, angle_text) = self.pair(SizeField::Angle)?;
                (
                    "sketch_add_line_locked",
                    serde_json::to_value(LockedSegmentRequest {
                        from: anchor,
                        to_hint: hint,
                        length_mm,
                        length_text,
                        angle_deg,
                        angle_text,
                        ctrl_held: ctrl,
                        from_crossing: None,
                        to_crossing: None,
                        tracking: None,
                        intersection: None,
                    }),
                )
            }
            CreateTool::Rectangle(mode) => {
                let (width_mm, width_text) = self.pair(SizeField::Width)?;
                let (height_mm, height_text) = self.pair(SizeField::Height)?;
                (
                    "sketch_add_rectangle_locked",
                    serde_json::to_value(LockedRectangleRequest {
                        mode,
                        anchor,
                        corner_hint: hint,
                        width_mm,
                        width_text,
                        height_mm,
                        height_text,
                        ctrl_held: ctrl,
                    }),
                )
            }
            CreateTool::Circle(mode) => {
                let (diameter_mm, diameter_text) = self.pair(SizeField::Diameter)?;
                (
                    "sketch_add_circle_locked",
                    serde_json::to_value(LockedCircleRequest {
                        mode,
                        anchor,
                        edge_hint: hint,
                        diameter_mm,
                        diameter_text,
                        ctrl_held: ctrl,
                    }),
                )
            }
            CreateTool::Slot(mode) => {
                let (width_mm, width_text) = self.pair(SizeField::Width)?;
                (
                    "sketch_add_slot",
                    serde_json::to_value(SlotRequest {
                        mode,
                        p1: anchor,
                        p2: hint,
                        cursor: *picks.get(2).ok_or("Pick the slot width")?,
                        width_mm,
                        width_text,
                    }),
                )
            }
            _ => return Err("This tool has no typed size fields".into()),
        };
        Ok(Prepared {
            operation,
            arguments: arguments.map_err(|e| e.to_string())?,
        })
    }
}

fn fields_for(draft: &Draft) -> &'static [SizeField] {
    if draft.points.is_empty() {
        return &[];
    }
    match draft.tool {
        Some(CreateTool::Line) => &[SizeField::Length, SizeField::Angle],
        Some(CreateTool::Rectangle(_)) => &[SizeField::Width, SizeField::Height],
        Some(CreateTool::Circle(_)) => &[SizeField::Diameter],
        Some(CreateTool::Slot(_)) if draft.points.len() == 2 => &[SizeField::Width],
        _ => &[],
    }
}

pub(super) fn set(
    world: &mut World,
    engine: &AppState,
    bridge: &SessionBridgeState,
    owner: &DocumentContext,
    editor: &mut Editor,
    generation: u64,
    field: SizeField,
    text: String,
    validate: impl FnOnce() -> Result<(), String>,
) -> Result<Value, String> {
    bridge.with_native_document_owner(engine, owner, validate)?;
    if editor.draft.generation != generation || !fields_for(&editor.draft).contains(&field) {
        return Err("This drawing gesture changed".into());
    }
    let sketch = active(engine)?.ok_or("There is no active sketch")?;
    editor.draft.sizes.set(
        field,
        text,
        engine.document_snapshot().settings.units,
        &sketch,
    );
    editor.error = fields_for(&editor.draft)
        .iter()
        .find_map(|field| editor.draft.sizes.value(*field).err())
        .unwrap_or_default();
    // Never leave a last-valid outline on screen after an invalid edit.
    clear_preview(world, engine, bridge, owner)?;
    if editor.error.is_empty() {
        if let Some(raw) = editor.draft.cursor {
            preview(world, engine, bridge, owner, editor, raw, false)?;
        }
    }
    Ok(
        json!({"edited":true,"valid":editor.error.is_empty(),"locked":editor.draft.sizes.values.contains_key(&field)}),
    )
}

/// Query the engine's exact locked construction without changing history.
/// Return resolved points for the existing lightweight outline renderer.
pub(super) fn preview_points(
    engine: &AppState,
    draft: &Draft,
    raw: SketchPoint,
    ctrl: bool,
) -> Result<Option<Vec<SketchPoint>>, String> {
    let Some(tool) = draft.tool else {
        return Ok(None);
    };
    if draft.points.is_empty()
        || draft.sizes.values.is_empty()
        || !matches!(tool, CreateTool::Rectangle(_) | CreateTool::Circle(_))
    {
        return Ok(None);
    }
    let request = draft.sizes.request(tool, &[draft.points[0], raw], ctrl)?;
    let method = if matches!(tool, CreateTool::Rectangle(_)) {
        "preview_rectangle_locked"
    } else {
        "preview_circle_locked"
    };
    let value = crate::session_bridge::parse_engine_envelope(
        engine.engine_call(method, &request.arguments.to_string()),
    )?;
    serde_json::from_value(value)
        .map(Some)
        .map_err(|e| e.to_string())
}
pub(super) fn line_preview(
    engine: &AppState,
    draft: &Draft,
    raw: SketchPoint,
    ctrl: bool,
) -> Result<nbcad_sketch::PreviewDto, String> {
    let request = draft.sizes.request(
        CreateTool::Line,
        &[draft.points.last().copied().unwrap_or(raw), raw],
        ctrl,
    )?;
    let value = crate::session_bridge::parse_engine_envelope(
        engine.engine_call("preview_segment_locked", &request.arguments.to_string()),
    )?;
    serde_json::from_value(value).map_err(|e| e.to_string())
}

pub(super) fn slot_cursor(draft: &Draft, raw: SketchPoint) -> Result<SketchPoint, String> {
    if !matches!(draft.tool, Some(CreateTool::Slot(_))) || draft.points.len() != 2 {
        return Ok(raw);
    }
    let Some((width, _)) = draft.sizes.value(SizeField::Width)? else {
        return Ok(raw);
    };
    let axis = draft.points[1] - draft.points[0];
    let length = axis.length();
    if length < 1e-9 {
        return Ok(raw);
    }
    let delta = raw - draft.points[0];
    let sign = if axis.x * delta.y - axis.y * delta.x >= 0. {
        1.
    } else {
        -1.
    };
    Ok(draft.points[0]
        + axis * (delta.dot(axis) / (length * length))
        + SketchPoint::new(-axis.y, axis.x) * (sign * width / (2. * length)))
}

#[derive(Resource, Default)]
struct DynamicPanel {
    generation: Option<u64>,
    owner: Option<DocumentContext>,
    fields: HashMap<SizeField, Entity>,
    widgets: Widgets,
}

pub(super) fn synchronize(
    world: &mut World,
    camera: Entity,
    engine: &AppState,
    owner: &DocumentContext,
    editor: &Editor,
    canvas: InterfaceRect,
) -> Result<(), String> {
    let mut panel = world.remove_resource::<DynamicPanel>().unwrap_or_default();
    let result = (|| {
        let visible = fields_for(&editor.draft);
        if panel.generation != Some(editor.draft.generation) || panel.owner.as_ref() != Some(owner)
        {
            for (_, entity) in panel.fields.drain() {
                world.despawn(entity);
            }
            panel.generation = Some(editor.draft.generation);
            panel.owner = Some(owner.clone());
        }
        panel.fields.retain(|key, entity| {
            if visible.contains(key) {
                true
            } else {
                world.despawn(*entity);
                false
            }
        });
        panel.widgets.begin();
        if !visible.is_empty() {
            let cursor = editor.draft.cursor.unwrap_or(editor.draft.points[0]);
            let basis = editor
                .stamp
                .as_ref()
                .and_then(|s| s.basis)
                .ok_or("Sketch plane changed")?;
            let screen = native_viewport::interface_world_point(
                world,
                &owner.document_id,
                basis.to_3d([cursor.x, cursor.y]),
            )?
            .unwrap_or([0., 0.]);
            let width = visible.len() as f32 * 154.;
            let left = (canvas.x as f32 + screen[0] + 18.).clamp(
                canvas.x as f32 + 8.,
                // The Sketch Palette occupies the rightmost 240 logical
                // pixels. Keep drawing fields in the unobstructed canvas.
                (canvas.x as f32 + canvas.width as f32 - 240. - width - 8.)
                    .max(canvas.x as f32 + 8.),
            );
            let top = (canvas.y as f32 + screen[1] + 22.).clamp(
                canvas.y as f32 + 8.,
                (canvas.y as f32 + canvas.height as f32 - 68.).max(canvas.y as f32 + 8.),
            );
            let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
            let assets = world.resource::<ViewportUiAssets>().clone();
            let units = engine.document_snapshot().settings.units;
            for (index, &field) in visible.iter().enumerate() {
                let x = left + index as f32 * 154.;
                let locked = editor.draft.sizes.values.get(&field);
                let value = locked.map(|v| v.text.clone()).unwrap_or_else(|| {
                    let d = cursor - editor.draft.points[0];
                    let full = if matches!(
                        editor.draft.tool,
                        Some(CreateTool::Rectangle(RectangleMode::Center))
                    ) {
                        2.
                    } else {
                        1.
                    };
                    let value = match field {
                        SizeField::Length => d.length(),
                        SizeField::Angle => d.y.atan2(d.x).to_degrees(),
                        SizeField::Width
                            if matches!(editor.draft.tool, Some(CreateTool::Slot(_))) =>
                        {
                            let axis = editor.draft.points[1] - editor.draft.points[0];
                            2. * (axis.x * d.y - axis.y * d.x).abs() / axis.length().max(1e-9)
                        }
                        SizeField::Width => d.x.abs() * full,
                        SizeField::Height => d.y.abs() * full,
                        SizeField::Diameter => {
                            d.length()
                                * if editor.draft.tool
                                    == Some(CreateTool::Circle(CircleMode::CenterDiameter))
                                {
                                    2.
                                } else {
                                    1.
                                }
                        }
                    };
                    let scale = if field == SizeField::Angle {
                        1.
                    } else {
                        match units {
                            UnitSystem::Mm => 1.,
                            UnitSystem::Cm => 10.,
                            UnitSystem::In => 25.4,
                        }
                    };
                    format!("{:.3}", value / scale)
                });
                panel.widgets.panel(
                    world,
                    camera,
                    &format!("size-bg-{index}"),
                    rect(x, top, 150., 54.),
                    theme.panel,
                    34,
                );
                panel.widgets.text(
                    world,
                    camera,
                    &format!("size-label-{index}"),
                    rect(x + 6., top + 2., 138., 18.),
                    &format!(
                        "{}{}",
                        field.label(),
                        if locked.is_some() { " · locked" } else { "" }
                    ),
                    10.,
                    35,
                );
                let mut c = InterfaceControl::button(
                    "sketch/draw",
                    format!("Drawing {}", field.label().to_lowercase()),
                );
                c.field = Field::Text {
                    value,
                    read_only: false,
                    selection: None,
                };
                let mut bounds = rect(x + 4., top + 21., 142., 28.);
                bounds.border = UiRect::all(px(1.));
                bounds.padding = UiRect::horizontal(px(5.));
                let entity = if let Some(entity) = panel.fields.get(&field) {
                    *entity
                } else {
                    let entity = fields::spawn_text_field(
                        &mut world.commands(),
                        camera,
                        bounds.clone(),
                        c.clone(),
                        theme,
                        &assets,
                    )?;
                    world.flush();
                    bind_command(
                        world,
                        entity,
                        NativeCommand::Sketch(EditorCommand::Size {
                            generation: editor.draft.generation,
                            field,
                            text: String::new(),
                        }),
                    )?;
                    panel.fields.insert(field, entity);
                    entity
                };
                let mut old = world.get::<InterfaceControl>(entity).unwrap().clone();
                old.field = c.field;
                if world.get::<InterfaceControl>(entity) != Some(&old) {
                    world.entity_mut(entity).insert(old);
                }
                if world.get::<Node>(entity) != Some(&bounds) {
                    world.entity_mut(entity).insert(bounds);
                }
                let border = BorderColor::all(if locked.is_some_and(|v| v.resolved.is_err()) {
                    Color::srgb(0.95, 0.3, 0.3)
                } else if locked.is_some() {
                    theme.accent
                } else {
                    theme.edge
                });
                if world.get::<BorderColor>(entity) != Some(&border) {
                    world.entity_mut(entity).insert(border);
                }
                world.entity_mut(entity).insert(ZIndex(35));
            }
        }
        panel.widgets.finish(world);
        Ok(())
    })();
    world.insert_resource(panel);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn call(engine: &AppState, method: &str, args: Value) -> Value {
        crate::session_bridge::parse_engine_envelope(engine.engine_call(method, &args.to_string()))
            .unwrap()
    }
    fn blank() -> AppState {
        let engine = AppState::new();
        call(
            &engine,
            "begin_sketch",
            json!({"type":"origin_plane","plane":"xy"}),
        );
        engine
    }
    fn apply(engine: &AppState, command: Prepared) -> Value {
        let spec = nbcad_mcp_mutate::lookup_mutate(command.operation).unwrap();
        let payload = nbcad_mcp_mutate::encode_payload(spec.payload, &command.arguments).unwrap();
        crate::session_bridge::parse_engine_envelope(
            engine.engine_call(spec.engine_method, &payload),
        )
        .unwrap()
    }
    #[test]
    fn typed_creation_drives_geometry_preview_and_single_undo() {
        for (tool, fields) in [
            (
                CreateTool::Line,
                vec![(SizeField::Length, "25.4"), (SizeField::Angle, "30")],
            ),
            (
                CreateTool::Rectangle(RectangleMode::TwoPoint),
                vec![(SizeField::Width, "25.4"), (SizeField::Height, "12.7")],
            ),
            (
                CreateTool::Rectangle(RectangleMode::Center),
                vec![(SizeField::Width, "25.4"), (SizeField::Height, "12.7")],
            ),
            (
                CreateTool::Circle(CircleMode::CenterDiameter),
                vec![(SizeField::Diameter, "25.4")],
            ),
            (
                CreateTool::Circle(CircleMode::TwoPoint),
                vec![(SizeField::Diameter, "25.4")],
            ),
            (
                CreateTool::Slot(SlotMode::CenterToCenter),
                vec![(SizeField::Width, "12.7")],
            ),
            (
                CreateTool::Slot(SlotMode::Overall),
                vec![(SizeField::Width, "12.7")],
            ),
            (
                CreateTool::Slot(SlotMode::CenterPoint),
                vec![(SizeField::Width, "12.7")],
            ),
        ] {
            let engine = blank();
            let initial = active(&engine).unwrap().unwrap();
            let mut draft = Draft::default();
            draft.select(Some(tool));
            draft.prepare(SketchPoint::ZERO, true).unwrap();
            if matches!(tool, CreateTool::Slot(_)) {
                draft.prepare(SketchPoint::new(40., 0.), true).unwrap();
            }
            for (field, text) in &fields {
                draft
                    .sizes
                    .set(*field, (*text).into(), UnitSystem::Mm, &initial);
            }
            let raw = SketchPoint::new(40., 20.);
            let preview = preview_points(&engine, &draft, raw, true).unwrap();
            assert_eq!(
                active(&engine).unwrap().unwrap(),
                initial,
                "Preview mutated {tool:?}"
            );
            let result = apply(&engine, draft.prepare(raw, true).unwrap().unwrap());
            let after = active(&engine).unwrap().unwrap();
            assert_eq!(after.dimensions.len(), fields.len(), "{tool:?}");
            for (field, text) in &fields {
                let expected: f64 = text.parse().unwrap();
                assert!(
                    after
                        .dimensions
                        .iter()
                        .any(|d| (d.value - expected).abs() < 1e-6),
                    "{tool:?} {field:?}: {:?}",
                    after.dimensions
                );
            }
            if let Some(points) = preview {
                let mut resolved = draft.clone();
                resolved.points = vec![points[0]];
                let outline = resolved.outline(points[1]);
                for e in &after.entities {
                    match e {
                        nbcad_sketch::EntityDto::Point { position, .. } => assert!(outline
                            .iter()
                            .flatten()
                            .any(|p| p.distance(*position) < 1e-6)),
                        nbcad_sketch::EntityDto::Circle { center, radius, .. } => assert!(outline
                            .iter()
                            .flatten()
                            .all(|p| (p.distance(*center) - radius).abs() < 1e-6)),
                        _ => (),
                    }
                }
            }
            draft.accepted(&result).unwrap();
            assert!(draft.sizes.values.is_empty());
            call(&engine, "undo", json!({}));
            assert_eq!(
                active(&engine).unwrap().unwrap().entities,
                initial.entities,
                "{tool:?}"
            );
        }
    }
    #[test]
    fn invalid_sizes_block_commit_and_clearing_restores_free_drawing() {
        let engine = blank();
        let sketch = active(&engine).unwrap().unwrap();
        let mut draft = Draft::default();
        draft.select(Some(CreateTool::Rectangle(RectangleMode::TwoPoint)));
        draft.prepare(SketchPoint::ZERO, true).unwrap();
        for text in ["0", "-3", "missing+1", "4/"] {
            draft
                .sizes
                .set(SizeField::Width, text.into(), UnitSystem::Mm, &sketch);
            assert!(draft.prepare(SketchPoint::new(30., 20.), true).is_err());
            assert_eq!(draft.points, vec![SketchPoint::ZERO]);
            assert_eq!(active(&engine).unwrap().unwrap(), sketch);
        }
        draft
            .sizes
            .set(SizeField::Width, "1 in".into(), UnitSystem::Mm, &sketch);
        let request = draft
            .prepare(SketchPoint::new(30., 20.), true)
            .unwrap()
            .unwrap();
        assert_eq!(request.arguments["width_mm"], 25.4);
        draft
            .sizes
            .set(SizeField::Width, "".into(), UnitSystem::Mm, &sketch);
        assert_eq!(
            draft
                .prepare(SketchPoint::new(30., 20.), true)
                .unwrap()
                .unwrap()
                .operation,
            "sketch_add_rectangle"
        );
        let old = draft.generation;
        draft.escape();
        assert!(draft.generation > old);
    }
}
