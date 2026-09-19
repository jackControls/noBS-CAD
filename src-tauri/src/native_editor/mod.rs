//! Native interaction state over the shared CAD engine. Unfinished gestures
//! are scoped to one document incarnation, engine revision and active sketch.

pub(crate) mod mcp;
mod sketch;

use crate::{
    native_viewport::{
        self,
        interface_shell::{spawn_button, InterfaceCamera, InterfaceControl, NativeInterfaceHandle},
        ui::{ViewportUiAssets, ViewportUiTheme},
        winit_host::NativeHostInput,
        ViewportCamera, ViewportPalette, ViewportPreview,
    },
    session_bridge::{
        native_interface::{
            bind_command,
            controller::{worker, NativeServices},
            finish_mutation, NativeCommand,
        },
        SessionBridgeState,
    },
    state::AppState,
};
use bevy::{ecs::system::SystemState, input::ButtonState, prelude::*, window::WindowEvent};
use nbcad_core::{PlaneBasis, PlaneRef};
use nbcad_interface::{DocumentContext, Rect as InterfaceRect};
use nbcad_sketch::{CircleMode, RectangleMode, SketchDto, SlotMode, Vec2 as SketchPoint};
use serde_json::{json, Value};
pub(crate) use sketch::CreateTool;
use sketch::{Draft, Prepared};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum EditorCommand {
    Begin(PlaneRef),
    Finish,
    Tool(CreateTool),
    Cancel,
    Complete,
}

#[derive(Clone, Debug, PartialEq)]
struct Stamp {
    owner: DocumentContext,
    revision: u64,
    sketch: Option<String>,
    basis: Option<PlaneBasis>,
}

#[derive(Resource, Default)]
struct Editor {
    stamp: Option<Stamp>,
    draft: Draft,
    press: Option<(DocumentContext, Vec2)>,
    controls: HashMap<String, Entity>,
    error: String,
}

fn initialize(world: &mut World) {
    world.init_resource::<Editor>();
}

fn active(engine: &AppState) -> Result<Option<SketchDto>, String> {
    let result: Value = serde_json::from_str(&engine.engine_call("active_sketch", ""))
        .map_err(|e| e.to_string())?;
    if result["ok"] != true {
        return Err(format!("Cannot inspect active sketch: {}", result["error"]));
    }
    serde_json::from_value(result["value"].clone()).map_err(|e| e.to_string())
}

fn stamp(
    engine: &AppState,
    bridge: &SessionBridgeState,
    owner: &DocumentContext,
    prior: Option<&Stamp>,
) -> Result<Stamp, String> {
    bridge.with_native_document_receipt(engine, owner, |revision| {
        if let Some(prior) =
            prior.filter(|prior| prior.owner == *owner && prior.revision == revision)
        {
            return Ok(prior.clone());
        }
        let sketch = active(engine)?;
        Ok(Stamp {
            owner: owner.clone(),
            revision,
            basis: sketch.as_ref().map(|sketch| sketch.basis),
            sketch: sketch.map(|sketch| sketch.name),
        })
    })
}

fn synchronize_stamp(editor: &mut Editor, next: Stamp) -> bool {
    if editor.stamp.as_ref() == Some(&next) {
        return false;
    }
    // Another MCP/user edit, history replacement or tab switch invalidates
    // pending geometric references. Own successful commits adopt their stamp.
    editor.draft.select(None);
    editor.press = None;
    editor.error.clear();
    editor.stamp = Some(next);
    true
}

pub(crate) fn status(world: &World) -> Option<String> {
    let editor = world.get_resource::<Editor>()?;
    if !editor.error.is_empty() {
        Some(editor.error.clone())
    } else if editor.draft.tool.is_some() {
        Some(editor.draft.instruction().into())
    } else {
        None
    }
}

fn clear_preview(
    world: &mut World,
    engine: &AppState,
    bridge: &SessionBridgeState,
    owner: &DocumentContext,
) -> Result<(), String> {
    bridge.with_native_document_owner(engine, owner, || {
        native_viewport::apply_interface_preview(
            world,
            &owner.document_id,
            ViewportPreview::default(),
        )
    })
}

fn preview(
    world: &mut World,
    services: &NativeServices,
    owner: &DocumentContext,
    editor: &mut Editor,
    raw: SketchPoint,
    ctrl: bool,
) -> Result<(), String> {
    use native_viewport::{
        ViewportLineLayer, ViewportPointLayer, ViewportSnapKind, ViewportSnapMarker,
    };
    let Some(basis) = editor.stamp.as_ref().and_then(|stamp| stamp.basis) else {
        return Ok(());
    };
    services.bridge.with_native_document_owner(&services.engine, owner, || {
        let mut cursor = raw;
        let mut marker = None;
        if editor.draft.tool == Some(CreateTool::Line) {
            let value:Value = serde_json::from_str(&services.engine.engine_call("preview_segment", &json!({
                "from":editor.draft.points.last().copied().unwrap_or(raw), "to_raw":raw,"ctrl_held":ctrl
            }).to_string())).map_err(|e| e.to_string())?;
            if value["ok"] != true { return Err(format!("Line preview: {}",value["error"])); }
            let value:nbcad_sketch::PreviewDto = serde_json::from_value(value["value"].clone()).map_err(|e| e.to_string())?;
            cursor = value.snapped_to;
            use nbcad_sketch::SnapTarget;
            let kind = match value.snap {
                SnapTarget::None => None,
                SnapTarget::Grid => Some(ViewportSnapKind::Grid),
                SnapTarget::Origin => Some(ViewportSnapKind::Origin),
                SnapTarget::Point { .. } => Some(ViewportSnapKind::Point),
                SnapTarget::Midpoint { .. } => Some(ViewportSnapKind::Midpoint),
                SnapTarget::ReferenceMidpoint { .. } => Some(ViewportSnapKind::ReferenceMidpoint),
                SnapTarget::Curve { .. } | SnapTarget::Intersection { .. } => Some(ViewportSnapKind::Curve),
            };
            marker = kind.map(|kind| ViewportSnapMarker { position:basis.to_3d([cursor.x,cursor.y]).map(|v| v as f32), kind });
        }
        editor.draft.cursor = Some(cursor);
        let color = ViewportPalette::default().preview;
        let color = [color[0],color[1],color[2],1.];
        let segments = editor.draft.outline(cursor).into_iter().flatten()
            .flat_map(|point| basis.to_3d([point.x,point.y]).map(|v| v as f32)).collect();
        let (_,camera,_,size) = native_viewport::interface_view_snapshot(world);
        let distance = Vec3::from_array(camera.position).distance(Vec3::from_array(basis.to_3d([cursor.x,cursor.y]).map(|v| v as f32)));
        let radius = (distance * (camera.vertical_fov_degrees.to_radians()*0.5).tan() * 4. / size[1].max(1.)).max(0.01);
        let positions = editor.draft.points.iter().chain(std::iter::once(&cursor))
            .flat_map(|p| basis.to_3d([p.x,p.y]).map(|v| v as f32)).collect();
        native_viewport::apply_interface_preview(world, &owner.document_id, ViewportPreview {
            lines:vec![ViewportLineLayer { color,width:2.,segments,..default() }],
            points:vec![ViewportPointLayer { color,radius,hollow:true,positions }],
            marker,..default()
        })
    })
}

fn committed_feedback(output: &mut Value, editor: &mut Editor, followup: Result<(), String>) {
    output["committed"] = json!(true);
    if let Err(error) = followup {
        editor.error = error.clone();
        // A lost receipt must never keep an armed geometric gesture.
        editor.stamp = None;
        editor.draft.select(None);
        editor.press = None;
        output["presentation_pending"] = json!(true);
        output["presentation_error"] = json!(error);
    } else {
        // A committed gesture adopts its own stamp, so `synchronize_stamp` will
        // early-return and never clear an earlier rejection. Drop it here or a
        // repaired shape keeps reporting the old failure after it commits.
        editor.error.clear();
    }
}

/// Controls and the native canvas share this exact owner-checked action path.
pub(crate) fn execute(
    world: &mut World,
    engine: &AppState,
    bridge: &SessionBridgeState,
    owner: &DocumentContext,
    command: EditorCommand,
    validate: impl FnOnce() -> Result<(), String>,
) -> Result<Value, String> {
    if worker::busy(world) {
        return Err("Wait for the current modeling operation to finish".into());
    }
    initialize(world);
    let next = stamp(
        engine,
        bridge,
        owner,
        world.resource::<Editor>().stamp.as_ref(),
    )?;
    world.resource_scope(|world, mut editor: Mut<Editor>| {
        synchronize_stamp(&mut editor, next);
        match command {
            EditorCommand::Begin(plane) => {
                if editor
                    .stamp
                    .as_ref()
                    .is_some_and(|stamp| stamp.sketch.is_some())
                {
                    return Err("Finish the current sketch before starting another".into());
                }
                validate()?;
                queue_mutation(
                    world,
                    editor.stamp.as_ref().unwrap().clone(),
                    "sketch_begin",
                    json!({"plane":plane}),
                    Completion::Begin,
                )
            }
            EditorCommand::Finish => {
                if editor
                    .stamp
                    .as_ref()
                    .is_none_or(|stamp| stamp.sketch.is_none())
                {
                    return Err("There is no sketch to finish".into());
                }
                validate()?;
                queue_mutation(
                    world,
                    editor.stamp.as_ref().unwrap().clone(),
                    "sketch_finish",
                    json!({}),
                    Completion::Finish,
                )
            }
            EditorCommand::Tool(tool) => {
                bridge.with_native_document_owner(engine, owner, validate)?;
                if editor
                    .stamp
                    .as_ref()
                    .is_none_or(|stamp| stamp.sketch.is_none())
                {
                    return Err("Start or edit a sketch to draw geometry".into());
                }
                editor.draft.select(Some(tool));
                editor.error.clear();
                clear_preview(world, engine, bridge, owner)?;
                Ok(json!({"active_tool":tool.label(),"instruction":editor.draft.instruction()}))
            }
            EditorCommand::Cancel => {
                bridge.with_native_document_owner(engine, owner, validate)?;
                editor.draft.escape();
                editor.error.clear();
                editor.press = None;
                clear_preview(world, engine, bridge, owner)?;
                Ok(json!({"active_tool":editor.draft.tool.map(CreateTool::label)}))
            }
            EditorCommand::Complete => {
                if let Some(command) = editor.draft.complete()? {
                    commit(world, engine, bridge, &mut editor, command, validate)
                } else {
                    bridge.with_native_document_owner(engine, owner, validate)?;
                    let tool = editor.draft.tool;
                    editor.draft.select(tool);
                    clear_preview(world, engine, bridge, owner)?;
                    Ok(json!({"complete":true}))
                }
            }
        }
    })
}

fn commit(
    world: &mut World,
    _engine: &AppState,
    _bridge: &SessionBridgeState,
    editor: &mut Editor,
    command: Prepared,
    validate: impl FnOnce() -> Result<(), String>,
) -> Result<Value, String> {
    let expected = editor
        .stamp
        .as_ref()
        .ok_or("Sketch gesture has no document owner")?
        .clone();
    validate()?;
    queue_mutation(
        world,
        expected,
        command.operation,
        command.arguments,
        Completion::Primitive,
    )
}

#[derive(Clone, Copy)]
enum Completion {
    Begin,
    Finish,
    Primitive,
}

fn queue_mutation(
    world: &mut World,
    expected: Stamp,
    operation: &'static str,
    arguments: Value,
    kind: Completion,
) -> Result<Value, String> {
    worker::enqueue_operation(
        world,
        expected.owner.clone(),
        expected.revision,
        operation.into(),
        arguments,
        move |world, services, result| {
            let engine = &services.engine;
            let bridge = &services.bridge;
            world.resource_scope(|world, mut editor: Mut<Editor>| {
                let result = match result {
                    Ok(result) => result,
                    Err(error) => {
                        // A rejected primitive retains its original picks.
                        editor.error = error.clone();
                        return Err(error);
                    }
                };
                let owner = result.context.clone();
                let same_gesture = editor.stamp.as_ref() == Some(&expected);
                let accepted = if same_gesture {
                    match kind {
                        Completion::Primitive => editor.draft.accepted(&result.value),
                        Completion::Begin | Completion::Finish => {
                            editor.draft.select(None);
                            Ok(())
                        }
                    }
                } else {
                    Err("The sketch interaction changed while modeling finished".into())
                };
                let mut output = finish_mutation(engine, bridge, world, operation, result);
                // Once geometry committed, follow-up failures are presentation
                // feedback. They never become a failed mutation to retry.
                let followup = (|| {
                    accepted?;
                    editor.stamp = Some(stamp(engine, bridge, &owner, None)?);
                    if matches!(kind, Completion::Begin) {
                        look_at_sketch(world, engine, bridge, &owner)?;
                    }
                    clear_preview(world, engine, bridge, &owner)
                })();
                committed_feedback(&mut output, &mut editor, followup);
                Ok(output)
            })
        },
    )
}

fn look_at_sketch(
    world: &mut World,
    engine: &AppState,
    bridge: &SessionBridgeState,
    owner: &DocumentContext,
) -> Result<(), String> {
    bridge.with_native_document_owner(engine, owner, || {
        let Some(sketch) = active(engine)? else {
            return Err("The new sketch is no longer active".into());
        };
        let (_, camera, _, _) = native_viewport::interface_view_snapshot(world);
        let center = Vec3::from_array(sketch.basis.origin.map(|v| v as f32));
        let normal = Vec3::from_array(sketch.basis.normal.map(|v| v as f32));
        let distance = Vec3::from_array(camera.position)
            .distance(Vec3::from_array(camera.target))
            .max(100.);
        let camera = ViewportCamera {
            position: (center + normal * distance).to_array(),
            target: center.to_array(),
            up: sketch.basis.v.map(|v| v as f32),
            ..camera
        };
        native_viewport::apply_interface_view(world, &owner.document_id, Some(camera), None)
    })
}

/// Called by the central controller in original OS event order, interleaved
/// with the exact native control actions generated by those events.
pub(crate) fn process_one(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    services: &NativeServices,
    event: &NativeHostInput,
) -> Result<Value, String> {
    if worker::busy(world) {
        return Err("Wait for the current modeling operation to finish".into());
    }
    initialize(world);
    let Some(frame) = handle.frame() else {
        return Ok(json!({"handled":false}));
    };
    let next = stamp(
        &services.engine,
        &services.bridge,
        &frame.context,
        world.resource::<Editor>().stamp.as_ref(),
    )?;
    world.resource_scope(|world, mut editor: Mut<Editor>| {
        synchronize_stamp(&mut editor, next);
        let mut result = json!({"handled":false});
        if !frame.modal_stack.is_empty() {
            editor.press = None;
            return Ok(result);
        }
        if event.context.as_ref() != Some(&frame.context) {
            editor.press = None;
            return Ok(result);
        }
        match &event.event {
            WindowEvent::WindowFocused(event) if !event.focused => {
                editor.press = None;
                clear_preview(world, &services.engine, &services.bridge, &frame.context)?;
            }
            WindowEvent::CursorLeft(_) => {
                editor.press = None;
                clear_preview(world, &services.engine, &services.bridge, &frame.context)?;
            }
            WindowEvent::CursorMoved(moved) if editor.draft.tool.is_some() => {
                let Some(basis) = editor.stamp.as_ref().and_then(|stamp| stamp.basis) else { return Ok(result); };
                let Some(canvas) = frame.canvases.iter().find(|canvas| canvas.name == "viewport") else { return Ok(result); };
                let cursor = moved.position;
                if f64::from(cursor.x) < canvas.bounds.x || f64::from(cursor.x) >= canvas.bounds.x+canvas.bounds.width
                    || f64::from(cursor.y) < canvas.bounds.y || f64::from(cursor.y) >= canvas.bounds.y+canvas.bounds.height {
                    clear_preview(world, &services.engine, &services.bridge, &frame.context)?;
                    return Ok(result);
                }
                if let Some(point) = native_viewport::interface_sketch_point(world, &frame.context.document_id,
                    [cursor.x-canvas.bounds.x as f32,cursor.y-canvas.bounds.y as f32],basis)? {
                    preview(world,services,&frame.context,&mut editor,point,event.modifiers.ctrl)?;
                    result = json!({"handled":true,"preview":true,"instruction":editor.draft.instruction()});
                }
            }
            WindowEvent::KeyboardInput(key)
                if key.state == ButtonState::Pressed
                    && !key.repeat
                    && !event.modifiers.ctrl
                    && !event.modifiers.meta
                    && !event.modifiers.alt =>
            {
                match key.key_code {
                    KeyCode::Escape => {
                        editor.draft.escape();
                        editor.error.clear();
                        editor.press = None;
                        clear_preview(world, &services.engine, &services.bridge, &frame.context)?;
                        result = json!({"handled":true,"cancelled":true});
                    }
                    KeyCode::Enter | KeyCode::NumpadEnter => match editor.draft.complete() {
                        Ok(Some(command)) => {
                            match commit(
                                world,
                                &services.engine,
                                &services.bridge,
                                &mut editor,
                                command,
                                || Ok(()),
                            ) {
                                Ok(value) => result = value,
                                Err(error) => { editor.error = error.clone(); return Err(error); }
                            }
                        }
                        Err(error) => { editor.error = error.clone(); return Err(error); }
                        _ => {}
                    },
                    _ => {}
                }
            }
            WindowEvent::MouseButtonInput(button) if button.button == MouseButton::Left => {
                let Some(cursor) = event.cursor else {
                    editor.press = None;
                    return Ok(result);
                };
                let Some(canvas) = frame
                    .canvases
                    .iter()
                    .find(|canvas| canvas.name == "viewport")
                else {
                    return Ok(result);
                };
                let in_canvas = f64::from(cursor.x) >= canvas.bounds.x
                    && f64::from(cursor.x) < canvas.bounds.x + canvas.bounds.width
                    && f64::from(cursor.y) >= canvas.bounds.y
                    && f64::from(cursor.y) < canvas.bounds.y + canvas.bounds.height;
                if button.state == ButtonState::Pressed {
                    editor.press = in_canvas.then(|| (frame.context.clone(), cursor));
                } else {
                    let Some((owner, start)) = editor.press.take() else {
                        return Ok(result);
                    };
                    if owner != frame.context || !in_canvas || start.distance(cursor) > 3. {
                        return Ok(result);
                    }
                    if let Some(value) = crate::session_bridge::native_interface::extrude::handle_canvas_pick(
                        world, services, &owner,
                        [cursor.x-canvas.bounds.x as f32,cursor.y-canvas.bounds.y as f32],
                    )? {
                        return Ok(value);
                    }
                    let Some(basis) = editor.stamp.as_ref().and_then(|stamp| stamp.basis) else {
                        return Ok(result);
                    };
                    if editor.draft.tool.is_none() {
                        return Ok(result);
                    }
                    let point = native_viewport::interface_sketch_point(
                        world,
                        &owner.document_id,
                        [
                            cursor.x - canvas.bounds.x as f32,
                            cursor.y - canvas.bounds.y as f32,
                        ],
                        basis,
                    )?;
                    if let Some(point) = point {
                        match editor.draft.prepare(point, event.modifiers.ctrl) {
                            Ok(Some(command)) => {
                                match commit(
                                    world,
                                    &services.engine,
                                    &services.bridge,
                                    &mut editor,
                                    command,
                                    || Ok(()),
                                ) {
                                    Ok(value) => result = value,
                                    Err(error) => { editor.error = error.clone(); return Err(error); }
                                }
                            }
                            Ok(None) => {
                                editor.error.clear();
                                preview(world,services,&owner,&mut editor,point,event.modifiers.ctrl)?;
                                result = json!({"handled":true,"picks":editor.draft.points.len(),"instruction":editor.draft.instruction()});
                            }
                            Err(error) => { editor.error = error.clone(); return Err(error); }
                        }
                    }
                }
            }
            _ => {}
        }
        Ok(result)
    })
}

pub(crate) fn synchronize_controls(
    world: &mut World,
    _handle: &NativeInterfaceHandle,
    services: &NativeServices,
    owner: &DocumentContext,
    area: InterfaceRect,
) -> Result<(), String> {
    if worker::busy(world) {
        return Ok(());
    }
    initialize(world);
    let next = stamp(
        &services.engine,
        &services.bridge,
        owner,
        world.resource::<Editor>().stamp.as_ref(),
    )?;
    let mut cameras = world.query_filtered::<Entity, With<InterfaceCamera>>();
    let Ok(camera) = cameras.single(world) else {
        return Ok(());
    };
    let assets = world.resource::<ViewportUiAssets>().clone();
    let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
    world.resource_scope(|world, mut editor: Mut<Editor>| {
        synchronize_stamp(&mut editor, next);
        let rows: Vec<(String, EditorCommand)> =
            if editor.stamp.as_ref().is_some_and(|s| s.sketch.is_some()) {
                let mut rows = [
                    CreateTool::Line,
                    CreateTool::Rectangle(RectangleMode::TwoPoint),
                    CreateTool::Circle(CircleMode::CenterDiameter),
                    CreateTool::Arc3Point,
                    CreateTool::Slot(SlotMode::CenterToCenter),
                    CreateTool::Spline,
                    CreateTool::Point,
                    CreateTool::MidpointLine,
                    CreateTool::Rectangle(RectangleMode::Center),
                    CreateTool::Circle(CircleMode::TwoPoint),
                    CreateTool::ArcCenter,
                    CreateTool::Slot(SlotMode::Overall),
                    CreateTool::Slot(SlotMode::CenterPoint),
                ]
                .into_iter()
                .map(|tool| (tool.label().to_owned(), EditorCommand::Tool(tool)))
                .collect::<Vec<_>>();
                rows.push(("Finish sketch".into(), EditorCommand::Finish));
                if editor.draft.tool.is_some() {
                    rows.push(("Cancel tool".into(), EditorCommand::Cancel));
                }
                if editor.draft.tool == Some(CreateTool::Spline) {
                    rows.push(("Finish spline".into(), EditorCommand::Complete));
                }
                rows
            } else {
                PlaneRef::ORIGIN_PLANES
                    .into_iter()
                    .zip(["Sketch on XY", "Sketch on XZ", "Sketch on YZ"])
                    .map(|(plane, label)| (label.into(), EditorCommand::Begin(plane)))
                    .collect()
            };
        editor.controls.retain(|label, entity| {
            if rows.iter().any(|row| &row.0 == label) {
                true
            } else {
                world.despawn(*entity);
                false
            }
        });
        let mut x = area.x as f32;
        let mut y = area.y as f32;
        for (label, command) in rows {
            let finish = matches!(command, EditorCommand::Finish | EditorCommand::Complete);
            let width = 48.;
            if x + width > (area.x + area.width) as f32 && x > area.x as f32 {
                x = area.x as f32;
                y += 54.;
            }
            let visible = finish
                || (x + width <= (area.x + area.width - 156.) as f32
                    && y + 52. <= (area.y + area.height) as f32);
            use crate::native_viewport::interface_shell::ribbon::{self, Icon};
            let node = if finish {
                // Finish stays docked at the right, as in the original ribbon.
                // Complete spline is a separate action immediately to its left.
                ribbon::finish_node(
                    (area.x + area.width
                        - if matches!(command, EditorCommand::Complete) {
                            296.
                        } else {
                            148.
                        })
                    .max(area.x) as f32,
                    area.y as f32 + 20.,
                )
            } else {
                ribbon::node(x, y, width)
            };
            let entity = if let Some(entity) = editor.controls.get(&label) {
                *entity
            } else {
                let mut system = SystemState::<Commands>::new(world);
                let entity = {
                    let mut commands = system.get_mut(world).map_err(|e| e.to_string())?;
                    spawn_button(
                        &mut commands,
                        camera,
                        node.clone(),
                        InterfaceControl::button("sketch/draw", &label),
                        theme,
                        &assets,
                    )
                };
                system.apply(world);
                let icon = match &command {
                    EditorCommand::Begin(_) => Icon::Sketch,
                    EditorCommand::Finish | EditorCommand::Complete => Icon::Finish,
                    EditorCommand::Cancel => Icon::Cancel,
                    EditorCommand::Tool(tool) => match tool {
                        CreateTool::Line => Icon::Line,
                        CreateTool::MidpointLine => Icon::MidpointLine,
                        CreateTool::Rectangle(_) => Icon::Rectangle,
                        CreateTool::Circle(_) => Icon::Circle,
                        CreateTool::Arc3Point | CreateTool::ArcCenter => Icon::Arc,
                        CreateTool::Slot(_) => Icon::Slot,
                        CreateTool::Point => Icon::Point,
                        CreateTool::Spline => Icon::Spline,
                    },
                };
                ribbon::decorate(world, entity, icon);
                bind_command(world, entity, NativeCommand::Sketch(command.clone()))?;
                editor.controls.insert(label.clone(), entity);
                entity
            };
            if world.get::<Node>(entity) != Some(&node) {
                world.entity_mut(entity).insert(node);
            }
            let mut control = world
                .get_mut::<InterfaceControl>(entity)
                .ok_or("Sketch control was removed")?;
            control.visible = visible;
            control.selected = match command {
                EditorCommand::Tool(tool) => Some(editor.draft.tool == Some(tool)),
                _ => None,
            };
            control.disabled =
                matches!(command, EditorCommand::Complete) && editor.draft.points.len() < 2;
            x += width + 2.;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_successful_commit_clears_a_stale_gesture_error() {
        let owner = DocumentContext {
            window_id: "main".into(),
            document_id: "a".into(),
            epoch: 1,
        };
        let mut editor = Editor::default();
        let current = Stamp {
            owner,
            revision: 2,
            sketch: Some("Sketch1".into()),
            basis: None,
        };
        synchronize_stamp(&mut editor, current.clone());
        // A rejected commit reports its failure without advancing the stamp,
        // so the document still matches and synchronize_stamp cannot clear it.
        editor.error = "This segment has no length".into();
        assert!(!synchronize_stamp(&mut editor, current.clone()));
        assert!(!editor.error.is_empty());

        let mut output = json!({});
        committed_feedback(&mut output, &mut editor, Ok(()));
        assert_eq!(output["committed"], json!(true));
        assert!(
            editor.error.is_empty(),
            "a committed gesture must not keep reporting an earlier failure"
        );
    }

    #[test]
    fn replacing_or_mutating_a_document_retires_unfinished_gestures() {
        let owner = DocumentContext {
            window_id: "main".into(),
            document_id: "a".into(),
            epoch: 1,
        };
        let mut editor = Editor::default();
        let original = Stamp {
            owner: owner.clone(),
            revision: 2,
            sketch: Some("Sketch1".into()),
            basis: None,
        };
        synchronize_stamp(&mut editor, original.clone());
        editor.draft.select(Some(CreateTool::Line));
        editor.draft.prepare(SketchPoint::ZERO, false).unwrap();
        assert!(!synchronize_stamp(&mut editor, original.clone()));
        assert_eq!(editor.draft.points.len(), 1);
        let newer = Stamp {
            revision: 3,
            ..original.clone()
        };
        assert!(synchronize_stamp(&mut editor, newer));
        assert!(editor.draft.points.is_empty());
        assert!(editor.draft.tool.is_none());
        let replaced = Stamp {
            owner: DocumentContext { epoch: 2, ..owner },
            ..original
        };
        assert!(synchronize_stamp(&mut editor, replaced));
    }
}
