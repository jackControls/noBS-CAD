//! Parametric history controls use the same replay operations as MCP.
use super::chrome::{rect, Widgets};
use super::*;
use interface_shell::ribbon::Icon;
use nbcad_core::{DocumentDto, Feature, FeatureKind};
use nbcad_interface::{ControlInput, KeyChord};
use workspace::DocumentReceipt;
mod panel;
#[cfg(test)]
mod tests;
pub(super) use panel::synchronize;

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum HistoryCommand {
    Select(u64),
    Edit(u64),
    Rollback(usize),
    Delete(u64),
    ConfirmDelete(u64),
    Cancel,
    Scroll(i32),
}
#[derive(Clone)]
struct Target {
    receipt: DocumentReceipt,
    id: u64,
    anchor: [f32; 2],
}
#[derive(Resource, Default)]
struct History {
    snapshot: Option<(DocumentReceipt, Arc<DocumentDto>)>,
    selected: Option<u64>,
    menu: Option<Target>,
    delete: Option<Target>,
    error: Option<String>,
    scroll: usize,
    widgets: Widgets,
}
pub(super) fn modal(world: &World) -> Option<&'static str> {
    let state = world.get_resource::<History>()?;
    if state.delete.is_some() {
        Some("delete-feature")
    } else if state.menu.is_some() {
        Some("history-menu")
    } else {
        None
    }
}
pub(super) fn escape(world: &mut World) {
    if let Some(mut state) = world.get_resource_mut::<History>() {
        state.menu = None;
        state.delete = None;
        state.error = None;
    }
}
fn feature(document: &DocumentDto, id: u64) -> Result<&Feature, String> {
    document
        .features
        .iter()
        .find(|feature| feature.id.0 == id)
        .ok_or("The history feature no longer exists".into())
}
fn idle(world: &World) -> Result<(), String> {
    if native_viewport::interface_view_snapshot(world).2.mode
        == native_viewport::ViewportMode::Sketch
        || build::panel(world).is_some()
    {
        return Err("Finish or cancel the current edit before changing feature history".into());
    }
    Ok(())
}
fn mutation(
    world: &mut World,
    receipt: DocumentReceipt,
    operation: &str,
    args: Value,
) -> Result<Value, String> {
    let operation = operation.to_owned();
    let completion = operation.clone();
    worker::enqueue_operation(
        world,
        receipt.owner,
        receipt.revision,
        operation,
        args,
        move |world, services, result| match result {
            Ok(result) => {
                escape(world);
                Ok(finish_mutation(
                    &services.engine,
                    &services.bridge,
                    world,
                    &completion,
                    result,
                ))
            }
            Err(error) => {
                if let Some(mut state) = world.get_resource_mut::<History>() {
                    state.error = Some(error.clone());
                }
                Err(error)
            }
        },
    )
}
pub(crate) fn reduce(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    engine: &AppState,
    bridge: &SessionBridgeState,
    action: &NativeInterfaceAction,
    command: &HistoryCommand,
) -> Result<Value, String> {
    bridge
        .with_native_document_owner(engine, &action.context, || handle.validate_action(action))?;
    world.init_resource::<History>();
    let input = &action.control.input;
    if !matches!(command, HistoryCommand::Cancel | HistoryCommand::Select(_))
        && world
            .get::<InterfaceControl>(Entity::from_bits(action.control.key.0))
            .is_some_and(|control| control.modal_scope.as_deref() == Some("history-menu"))
    {
        let current = bridge.native_document_receipt(engine, &action.context)?;
        if world
            .resource::<History>()
            .menu
            .as_ref()
            .is_none_or(|target| target.receipt != current)
        {
            return Err("The design changed; open this history menu again".into());
        }
    }
    let context_menu = matches!(input, ControlInput::ContextMenu)
        || matches!(input,ControlInput::Key(key) if key.key=="ContextMenu" || (key.key=="F10"&&key.shift));
    if let HistoryCommand::Select(id) = *command {
        let receipt = bridge.native_document_receipt(engine, &action.context)?;
        feature(&engine.document_snapshot(), id)?;
        if context_menu {
            let anchor = handle
                .read_surface(|_, frame| {
                    frame
                        .controls
                        .iter()
                        .find(|control| control.key == action.control.key)
                        .map(|c| [c.bounds.x as f32, c.bounds.y as f32])
                })?
                .ok_or("History control has no current layout")?;
            let mut state = world.resource_mut::<History>();
            state.menu = Some(Target {
                receipt,
                id,
                anchor,
            });
            state.selected = Some(id);
            return Ok(json!({"menu_open":true}));
        }
        if matches!(input, ControlInput::DoubleClick) {
            return edit(world, handle, engine, bridge, action, id);
        }
    }
    if !super::super::is_activation(input) {
        return Err("History control requires activation".into());
    }
    match *command {
        HistoryCommand::Select(id) => {
            world.resource_mut::<History>().selected = Some(id);
            Ok(json!({"selected_feature_id":id}))
        }
        HistoryCommand::Edit(id) => edit(world, handle, engine, bridge, action, id),
        HistoryCommand::Cancel => {
            escape(world);
            Ok(json!({"cancelled":true}))
        }
        HistoryCommand::Scroll(delta) => {
            let mut state = world.resource_mut::<History>();
            state.scroll = state.scroll.saturating_add_signed(delta as isize);
            Ok(json!({"scrolled":true}))
        }
        HistoryCommand::Rollback(index) => {
            idle(world)?;
            let receipt = bridge.native_document_receipt(engine, &action.context)?;
            mutation(
                world,
                receipt,
                "solid_set_rollback",
                json!({"rollback_index":index}),
            )
        }
        HistoryCommand::Delete(id) => {
            idle(world)?;
            let receipt = bridge.native_document_receipt(engine, &action.context)?;
            feature(&engine.document_snapshot(), id)?;
            let mut state = world.resource_mut::<History>();
            state.menu = None;
            state.delete = Some(Target {
                receipt,
                id,
                anchor: [0., 0.],
            });
            state.error = None;
            Ok(json!({"awaiting_input":true}))
        }
        HistoryCommand::ConfirmDelete(id) => {
            idle(world)?;
            let target = world
                .resource::<History>()
                .delete
                .clone()
                .ok_or("Delete confirmation was closed")?;
            if target.id != id
                || target.receipt != bridge.native_document_receipt(engine, &action.context)?
            {
                return Err("The design changed; review the deletion again".into());
            }
            mutation(
                world,
                target.receipt,
                "solid_delete_feature",
                json!({"feature_id":id}),
            )
        }
    }
}
fn edit(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    engine: &AppState,
    bridge: &SessionBridgeState,
    action: &NativeInterfaceAction,
    id: u64,
) -> Result<Value, String> {
    idle(world)?;
    let document = engine.document_snapshot();
    let feature = feature(&document, id)?;
    let result = match feature.kind {
        FeatureKind::Sketch => crate::native_editor::execute(
            world,
            engine,
            bridge,
            &action.context,
            crate::native_editor::EditorCommand::Edit(feature.name.clone()),
            || handle.validate_action(action),
        ),
        FeatureKind::Extrude | FeatureKind::Revolve | FeatureKind::Sweep | FeatureKind::Loft | FeatureKind::Rib => build::reduce(
            engine,
            bridge,
            world,
            &action.context,
            &build::BuildCommand::Open {
                kind: match feature.kind {FeatureKind::Revolve=>build::BuildKind::Revolve,FeatureKind::Sweep=>build::BuildKind::Sweep,FeatureKind::Loft=>build::BuildKind::Loft,FeatureKind::Rib=>build::BuildKind::Rib,_=>build::BuildKind::Extrude},
                feature_id: Some(id),
            },
            &ControlInput::Click,
            || handle.validate_action(action),
        ),
        _ => Err("This feature editor has not yet been converted to Bevy".into()),
    };
    if result.is_ok() {
        escape(world);
    }
    result
}
fn control(label: &str, scope: Option<&str>, disabled: bool) -> InterfaceControl {
    let mut c = InterfaceControl::button(scope.unwrap_or("document/history"), label);
    c.modal_scope = scope.map(str::to_owned);
    c.disabled = disabled;
    if scope == Some("history-menu") {
        c.role = "menuitem".into();
        c.owned_keys = ["ArrowUp", "ArrowDown", "Home", "End"]
            .into_iter()
            .map(KeyChord::plain)
            .collect();
    }
    c
}
fn icon(feature: &Feature) -> Icon {
    match feature.kind {
        FeatureKind::Sketch => Icon::PenLine,
        FeatureKind::ConstructionPlane => Icon::Layers,
        _ => Icon::Box,
    }
}
