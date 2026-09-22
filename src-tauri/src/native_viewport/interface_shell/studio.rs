//! A controlled Bevy 0.20 Feathers number input for view-only studio lighting.
//! CAD expression fields keep their ordered, document-owned text adapter.
use super::*;
use crate::native_viewport::ViewportPalette;
use crate::session_bridge::native_interface::{bind_command, NativeCommand};
use bevy::scene as bevy_scene;
use bevy::{
    feathers::controls::{
        FeathersNumberInput, HardLimit, NumberInputPrecision, NumberInputStep, NumberInputValue,
        SoftLimit,
    },
    input::ButtonState,
    input_focus::InputFocus,
    ui_widgets::{TextInput, ValueChange},
    window::WindowEvent,
};

#[derive(Resource)]
pub(crate) struct StudioLight(pub f64);
impl Default for StudioLight {
    fn default() -> Self {
        Self(1.)
    }
}

#[derive(Component)]
struct StudioControl(DocumentContext);

#[derive(Resource)]
struct StudioWidgets {
    root: Entity,
    input: Entity,
    dragging: bool,
}

fn changed(
    change: On<ValueChange<f64>>,
    controls: Query<&StudioControl>,
    handle: Res<NativeInterfaceHandle>,
) {
    let entity = change.event_target();
    let Ok(control) = controls.get(entity) else {
        return;
    };
    // Resolve now, with the same context and binding checks as MCP. The
    // controller remains the only writer of accepted lighting values.
    if let Ok(action) = handle.resolve_input(
        ControlKey(entity.to_bits()),
        ControlInput::SetValue(change.value.to_string()),
        &control.0,
    ) {
        let _ = handle.enqueue_action(action);
    }
}

pub(crate) fn set_value(world: &mut World, input: &ControlInput) -> Result<f64, String> {
    world.init_resource::<StudioLight>();
    let current = world.resource::<StudioLight>().0;
    let value = match input {
        ControlInput::SetValue(value) => value
            .parse::<f64>()
            .map_err(|_| "Enter a numeric studio light level")?,
        ControlInput::Key(key) => match key.key.as_str() {
            "ArrowLeft" | "ArrowDown" => (current - 0.05).max(0.25),
            "ArrowRight" | "ArrowUp" => (current + 0.05).min(2.),
            "Home" => 0.25,
            "End" => 2.,
            _ => return Err("Unsupported studio light key".into()),
        },
        ControlInput::Click => current,
        _ => return Err("Enter a numeric studio light level".into()),
    };
    if !value.is_finite() || !(0.25..=2.).contains(&value) {
        return Err("Studio light must be between 0.25 and 2.00".into());
    }
    world.resource_mut::<StudioLight>().0 = value;
    Ok(value)
}

pub(crate) fn synchronize(
    world: &mut World,
    camera: Entity,
    owner: &DocumentContext,
    width: f32,
    height: f32,
) -> Result<(), String> {
    // Controller unit fixtures intentionally omit the GPU/assets/plugins.
    if !world.contains_resource::<bevy::feathers::theme::UiTheme>() {
        return Ok(());
    }
    world.init_resource::<StudioLight>();
    let value = world.resource::<StudioLight>().0;
    if !world.contains_resource::<StudioWidgets>() {
        let theme = ViewportUiTheme::from_palette(&ViewportPalette::default());
        let assets = world.resource::<ViewportUiAssets>().clone();
        let root = world.spawn_scene(bsn! {
            Node {
                position_type: PositionType::Absolute,
                width: px(158), height: px(40), padding: UiRect::all(px(6)), column_gap: px(8),
                align_items: AlignItems::Center, border: UiRect::all(px(1)), border_radius: BorderRadius::all(px(8)),
            }
            ~{UiTargetCamera(camera)}
            ZIndex(30)
            BackgroundColor({theme.panel})
            ~{BorderColor::all(theme.edge)}
            InterfaceOccluder
            Children [
                Text("Light")
                TextFont { font_size: bevy::text::FontSize::Px(11.) }
                TextColor({theme.mute})
            ]
        }).map_err(|e| e.to_string())?.id();
        let caption = world.get::<Children>(root).unwrap()[0];
        world
            .entity_mut(caption)
            .insert(theme.text(&assets, 11., FontWeight::NORMAL));
        let input = world
            .spawn_scene(bsn! {
                @FeathersNumberInput
                NumberInputValue::F64(value)
                NumberInputPrecision(2)
                NumberInputStep(0.05)
                ~{HardLimit::f64(0.25..=2.)}
                ~{SoftLimit::f64(0.25..=2.)}
                Node { width: px(100), height: px(28), min_width: px(0) }
                on(changed)
            })
            .map_err(|e| e.to_string())?
            .id();
        world.entity_mut(root).add_child(input);
        let mut control = InterfaceControl::button("document/appearance", "Studio light");
        control.role = "slider".into();
        control.field = Field::Range {
            value,
            min: 0.25,
            max: 2.,
            step: 0.05,
        };
        control.owned_keys = [
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
        ]
        .map(KeyChord::plain)
        .into();
        world
            .entity_mut(input)
            .insert((control, StudioControl(owner.clone())));
        bind_command(world, input, NativeCommand::StudioLight)?;
        world.insert_resource(StudioWidgets {
            root,
            input,
            dragging: false,
        });
    }
    let widgets = world.resource::<StudioWidgets>();
    let (root, input) = (widgets.root, widgets.input);
    let mut node = world.get_mut::<Node>(root).unwrap();
    node.left = px(width - 174.);
    node.top = px(height - 125.);
    drop(node);
    if let Some(mut control) = world.get_mut::<InterfaceControl>(input) {
        let next = Field::Range {
            value,
            min: 0.25,
            max: 2.,
            step: 0.05,
        };
        if control.field != next {
            control.field = next;
        }
    }
    if world
        .get::<StudioControl>(input)
        .is_some_and(|c| c.0 != *owner)
    {
        world.entity_mut(input).insert(StudioControl(owner.clone()));
        world.resource_mut::<StudioWidgets>().dragging = false;
    }
    if !matches!(world.get::<NumberInputValue>(input), Some(NumberInputValue::F64(v)) if *v == value)
    {
        world.entity_mut(input).insert(NumberInputValue::F64(value));
    }
    Ok(())
}

pub(crate) fn owns_text_focus(world: &World) -> bool {
    world
        .get_resource::<InputFocus>()
        .and_then(InputFocus::get)
        .is_some_and(|e| world.get::<TextInput>(e).is_some())
}

/// Feathers receives Bevy pointer/focus events. Keep those same events out of
/// the CAD router so dragging the widget cannot also orbit or edit geometry.
pub(crate) fn route_input(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    event: &WindowEvent,
    cursor: Option<Vec2>,
) -> bool {
    let Some(widgets) = world.get_resource::<StudioWidgets>() else {
        return false;
    };
    let dragging = widgets.dragging;
    let inside = cursor
        .and_then(|p| handle.hit_key(p.as_dvec2().to_array()))
        .is_some_and(|key| Entity::from_bits(key.0) == widgets.input);
    let consumed = match event {
        WindowEvent::CursorMoved(_) => inside || dragging,
        WindowEvent::MouseButtonInput(e) => {
            let captured = inside || dragging;
            if e.button == MouseButton::Left {
                world.resource_mut::<StudioWidgets>().dragging =
                    captured && e.state == ButtonState::Pressed;
            }
            if captured {
                handle.blur();
            }
            captured
        }
        WindowEvent::KeyboardInput(_) | WindowEvent::Ime(_) => owns_text_focus(world),
        WindowEvent::WindowFocused(e) if !e.focused => {
            world.resource_mut::<StudioWidgets>().dragging = false;
            false
        }
        _ => false,
    };
    consumed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_viewport::ViewportPalette;
    use bevy::scene as bevy_scene;
    #[test]
    fn studio_light_rejects_non_finite_or_out_of_range_values_without_changing_the_view() {
        let mut world = World::new();
        assert_eq!(
            set_value(&mut world, &ControlInput::SetValue("1.35".into())).unwrap(),
            1.35
        );
        for value in ["NaN", "inf", "-1", "2.01", "bright"] {
            assert!(set_value(&mut world, &ControlInput::SetValue(value.into())).is_err());
            assert_eq!(world.resource::<StudioLight>().0, 1.35);
        }
    }
}
