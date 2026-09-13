//! AccessKit projection of the same live native control registry. Proxy entity
//! identities retire when their binding/owner changes, so an old OS action
//! cannot activate a replacement that reuses a retained visual control.

use super::super::interface_shell::{
    InterfaceLayout, NativeInterfaceAction, NativeInterfaceHandle,
};
use accesskit::{Action, Node, Role};
use bevy::{
    a11y::{AccessibilityNode, AccessibilitySystems, ActionRequest},
    input_focus::{FocusCause, InputFocus},
    prelude::*,
    window::PrimaryWindow,
};
use nbcad_interface::{ControlKey, Rect as ControlRect};
use std::collections::HashMap;

#[derive(Component)]
struct AccessibleBinding(Option<NativeInterfaceAction>);

#[derive(Clone, PartialEq)]
struct AccessibleControl {
    key: ControlKey,
    label: String,
    role: String,
    bounds: ControlRect,
    disabled: bool,
    selected: Option<bool>,
    action: Option<NativeInterfaceAction>,
}

#[derive(Resource, Default)]
struct AccessibleControls(HashMap<ControlKey, (Entity, AccessibleControl)>);

pub(super) fn install(app: &mut App) {
    app.init_resource::<InputFocus>()
        .init_resource::<AccessibleControls>()
        .add_systems(
            PostUpdate,
            publish
                .after(InterfaceLayout)
                .before(AccessibilitySystems::Update),
        )
        .add_systems(
            PostUpdate,
            apply_requests.after(AccessibilitySystems::Update),
        );
}

fn publish(world: &mut World) {
    let Some(handle) = world.get_resource::<NativeInterfaceHandle>().cloned() else {
        return;
    };
    let scale = world
        .query_filtered::<&Window, With<PrimaryWindow>>()
        .single(world)
        .map(|window| f64::from(window.scale_factor()))
        .unwrap_or(1.0);
    let snapshot = handle.read_surface(|_, frame| {
        let modal = frame.modal_stack.last();
        (
            frame.focused,
            frame
                .controls
                .iter()
                .filter(|control| {
                    control.visible
                        && modal.is_none_or(|scope| control.modal_scope.as_ref() == Some(scope))
                })
                .map(|control| AccessibleControl {
                    key: control.key,
                    label: control.label.clone(),
                    role: control.role.clone(),
                    bounds: control.bounds,
                    disabled: control.disabled,
                    selected: control.selected,
                    action: None,
                })
                .collect::<Vec<_>>(),
        )
    });
    let (focused, mut controls) = snapshot.unwrap_or_default();
    for control in &mut controls {
        if !control.disabled {
            control.action = handle.resolve_retained(control.key).ok();
        }
    }
    let mut previous = std::mem::take(&mut world.resource_mut::<AccessibleControls>().0);
    let mut current = HashMap::new();
    let mut next_focus = None;
    for control in controls {
        let old = previous.remove(&control.key);
        // Bounds, labels and selection can update in place. A semantic stamp
        // change must retire the proxy NodeId before accepting another action.
        let retained = old
            .as_ref()
            .filter(|(_, old)| old.action == control.action && old.role == control.role);
        let entity = if let Some((entity, _)) = retained {
            *entity
        } else {
            if let Some((entity, _)) = old {
                world.despawn(entity);
            }
            world.spawn_empty().id()
        };
        let mut node = Node::new(match control.role.as_str() {
            "tab" => Role::Tab,
            "treeitem" => Role::TreeItem,
            "checkbox" => Role::CheckBox,
            "slider" => Role::Slider,
            "textbox" => Role::TextInput,
            _ => Role::Button,
        });
        node.set_label(control.label.clone());
        node.set_bounds(accesskit::Rect::new(
            control.bounds.x * scale,
            control.bounds.y * scale,
            (control.bounds.x + control.bounds.width) * scale,
            (control.bounds.y + control.bounds.height) * scale,
        ));
        if control.disabled {
            node.set_disabled();
        }
        if let Some(selected) = control.selected {
            node.set_selected(selected);
        }
        if control.action.is_some() {
            node.add_action(Action::Click);
            node.add_action(Action::Focus);
        }
        let changed = world
            .get::<AccessibilityNode>(entity)
            .is_none_or(|existing| existing.0 != node);
        if changed {
            world.entity_mut(entity).insert(AccessibilityNode(node));
        }
        world
            .entity_mut(entity)
            .insert(AccessibleBinding(control.action.clone()));
        if focused == Some(control.key) && control.action.is_some() {
            next_focus = Some(entity);
        }
        current.insert(control.key, (entity, control));
    }
    for (_, (entity, _)) in previous {
        world.despawn(entity);
    }
    world.resource_mut::<AccessibleControls>().0 = current;
    let mut focus = world.resource_mut::<InputFocus>();
    if focus.get() != next_focus {
        if let Some(entity) = next_focus {
            focus.set(entity, FocusCause::Navigated);
        } else {
            focus.clear();
        }
    }
}

fn apply_requests(
    mut requests: MessageReader<ActionRequest>,
    bindings: Query<&AccessibleBinding>,
    handle: Res<NativeInterfaceHandle>,
) {
    for request in requests.read() {
        if request.target_tree != accesskit::TreeId::ROOT {
            continue;
        }
        let Some(entity) = Entity::try_from_bits(request.target_node.0) else {
            continue;
        };
        let Ok(AccessibleBinding(Some(action))) = bindings.get(entity) else {
            continue;
        };
        let activate = match request.action {
            Action::Click => true,
            Action::Focus => false,
            _ => continue,
        };
        if let Err(error) = handle.assistive_action(action, activate) {
            eprintln!("Native accessibility action rejected: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_viewport::interface_shell::{tests::fixture, InterfaceControl};

    #[test]
    fn assistive_actions_use_live_controls_and_old_proxy_ids_retire_on_rebind() {
        let (mut app, handle, control, _) = fixture();
        app.add_message::<ActionRequest>();
        install(&mut app);
        app.update();
        let key = ControlKey(control.to_bits());
        let proxy = app.world().resource::<AccessibleControls>().0[&key].0;
        let send = |app: &mut App, target: Entity| {
            app.world_mut()
                .write_message(ActionRequest(accesskit::ActionRequest {
                    action: Action::Click,
                    target_tree: accesskit::TreeId::ROOT,
                    target_node: accesskit::NodeId(target.to_bits()),
                    data: None,
                }));
        };
        send(&mut app, proxy);
        app.update();
        let action = handle.take_actions().unwrap().pop().unwrap();
        assert_eq!(action.control.key, key);
        assert_eq!(action.control.binding(), 1);
        // The OS request is already queued when the retained widget rebinds.
        // Publication retires its proxy before the accessibility action runs.
        send(&mut app, proxy);
        app.world_mut()
            .get_mut::<InterfaceControl>(control)
            .unwrap()
            .binding = 2;
        app.update();
        assert!(handle.take_actions().unwrap().is_empty());
        let replacement = app.world().resource::<AccessibleControls>().0[&key].0;
        assert_ne!(proxy, replacement);
        assert!(app.world().get_entity(proxy).is_err());
        send(&mut app, replacement);
        app.update();
        assert_eq!(handle.take_actions().unwrap()[0].control.binding(), 2);
        let retained = app.world().resource::<AccessibleControls>().0[&key].0;
        app.update();
        assert_eq!(
            app.world().resource::<AccessibleControls>().0[&key].0,
            retained
        );
    }
}
