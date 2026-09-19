//! Main-window host for the in-progress native interface migration.
//!
//! This uses the product's existing CAD scene and typed control reducer. Winit
//! owns the main thread, OS window, input ordering, IME and AccessKit adapter;
//! there is no second document engine or alternative public command mode.

use std::{collections::HashSet, num::NonZeroU32, time::Duration};

use bevy::{
    ecs::message::MessageCursor,
    input::{
        keyboard::{Key, KeyCode, KeyboardInput},
        ButtonState,
    },
    prelude::*,
    window::{ExitCondition, PrimaryWindow, WindowEvent, WindowResolution},
    winit::{EventLoopProxyWrapper, UpdateMode, WinitSettings, WinitUserEvent},
};
use nbcad_interface::{DocumentContext, KeyChord};

use super::{
    interface_shell::{NativeInterfaceAction, NativeInterfaceHandle, PointerButton, PointerPhase},
    platform,
};

mod accessibility;
mod submission;

/// Temporary compile-time host selection for this same executable. Startup
/// has already prepared the always-on stdio worker before entering this loop.
pub fn run() -> std::process::ExitCode {
    use crate::session_bridge::native_interface::controller::{self, NativeServices};
    use std::process::Termination;
    build(|app, handle| {
        controller::install(app, handle, NativeServices::default(), "main".into(), None)
    })
    .run()
    .report()
}

/// Unhandled model/editor/lifecycle events retain OS ordering, their cursor
/// position and document ownership at receipt. A controller must check that
/// ownership before applying an event after a project transition. IME preedit
/// and commit remain distinct original events, never synthesized key presses.
#[derive(Message, Clone, Debug)]
pub(crate) struct NativeHostInput {
    pub context: Option<DocumentContext>,
    pub cursor: Option<Vec2>,
    pub modifiers: Modifiers,
    pub event: WindowEvent,
    pub consumed: bool,
    pub actions: Vec<NativeInterfaceAction>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Modifiers {
    pub ctrl: bool,
    pub meta: bool,
    pub alt: bool,
    pub shift: bool,
    pub alt_graph: bool,
}

#[derive(Resource, Default)]
struct HostInputState {
    cursor: Option<Vec2>,
    pressed: HashSet<KeyCode>,
    model_drag: HashSet<MouseButton>,
    alt_graph: bool,
}

#[derive(Resource, Default)]
struct HostCaptureState {
    events: MessageCursor<WindowEvent>,
    cursor: Option<Vec2>,
    modifiers: HostInputState,
}

#[derive(Resource, Default)]
pub(crate) struct NativeRenderAvailability {
    pub drawable: bool,
    pub focused: bool,
    occluded: bool,
}

impl HostInputState {
    fn modifiers(&self) -> Modifiers {
        Modifiers {
            ctrl: self.pressed.contains(&KeyCode::ControlLeft)
                || self.pressed.contains(&KeyCode::ControlRight),
            meta: self.pressed.contains(&KeyCode::SuperLeft)
                || self.pressed.contains(&KeyCode::SuperRight),
            alt: self.pressed.contains(&KeyCode::AltLeft)
                || self.pressed.contains(&KeyCode::AltRight),
            shift: self.pressed.contains(&KeyCode::ShiftLeft)
                || self.pressed.contains(&KeyCode::ShiftRight),
            alt_graph: self.alt_graph,
        }
    }
}

/// Clear a completed/rejected atomic gesture without synthesizing a release
/// that could activate a control under its last cursor position.
pub(crate) fn cancel_native_pointer(world: &mut World, handle: &NativeInterfaceHandle) {
    if let Some(mut state) = world.get_resource_mut::<HostInputState>() {
        state.model_drag.clear();
    }
    handle.cancel_pointer();
}

/// Configure the controller before starting this one product's native runner.
/// Keeping document services outside the host also permits deterministic
/// controller tests without initializing an OS event loop or GPU.
pub(crate) fn build(configure: impl FnOnce(&mut App, NativeInterfaceHandle)) -> App {
    let mut app = App::new();
    let plugins = DefaultPlugins
        .set(WindowPlugin {
            primary_window: Some(Window {
                title: "noBS CAD".into(),
                resolution: WindowResolution::new(1360, 860),
                present_mode: bevy::window::PresentMode::Fifo,
                desired_maximum_frame_latency: NonZeroU32::new(2),
                // The controller enables IME only while a real native text
                // editor owns focus and supplies the caret position.
                ime_enabled: false,
                ..default()
            }),
            exit_condition: ExitCondition::DontExit,
            // Unsaved-document and in-flight MCP shutdown guards belong to
            // the shared controller, not an unconditional OS close handler.
            close_when_requested: false,
            ..default()
        })
        .set(platform::cad_render_plugin());
    #[cfg(target_os = "linux")]
    let plugins = plugins.disable::<bevy::render::pipelined_rendering::PipelinedRenderingPlugin>();
    app.add_plugins(plugins);
    let wake = (**app.world().resource::<EventLoopProxyWrapper>()).clone();
    let handle = NativeInterfaceHandle::new(move || {
        let _ = wake.send_event(WinitUserEvent::WakeUp);
    });
    // Ignore global mouse movement while idle. File/inbox watchers explicitly
    // wake this loop when work exists; a quiet document needs no GPU polling.
    app.insert_resource(WinitSettings {
        focused_mode: UpdateMode::reactive_low_power(Duration::MAX),
        unfocused_mode: UpdateMode::reactive_low_power(Duration::MAX),
    });
    platform::install_native_scene(&mut app);
    app.init_resource::<HostInputState>()
        .init_resource::<HostCaptureState>()
        .init_resource::<NativeRenderAvailability>()
        .add_message::<NativeHostInput>()
        .add_systems(PreUpdate, route_window_input);
    accessibility::install(&mut app);
    submission::install(&mut app);
    configure(&mut app, handle);
    super::interface_shell::fields::install(&mut app);
    app
}

fn key_chord(input: &KeyboardInput, modifiers: Modifiers) -> KeyChord {
    let key = match &input.logical_key {
        Key::Character(value) => value.to_string(),
        Key::Space => " ".into(),
        other => format!("{other:?}"),
    };
    KeyChord {
        key,
        ctrl: modifiers.ctrl,
        meta: modifiers.meta,
        alt: modifiers.alt,
        shift: modifiers.shift,
    }
}

fn input_window(event: &WindowEvent) -> Option<Entity> {
    match event {
        WindowEvent::CursorMoved(event) => Some(event.window),
        WindowEvent::CursorEntered(event) => Some(event.window),
        WindowEvent::CursorLeft(event) => Some(event.window),
        WindowEvent::MouseButtonInput(event) => Some(event.window),
        WindowEvent::MouseWheel(event) => Some(event.window),
        WindowEvent::KeyboardInput(event) => Some(event.window),
        WindowEvent::WindowFocused(event) => Some(event.window),
        WindowEvent::WindowCloseRequested(event) => Some(event.window),
        WindowEvent::WindowDestroyed(event) => Some(event.window),
        WindowEvent::WindowResized(event) => Some(event.window),
        WindowEvent::WindowScaleFactorChanged(event) => Some(event.window),
        WindowEvent::WindowOccluded(event) => Some(event.window),
        WindowEvent::Ime(
            bevy::window::Ime::Preedit { window, .. }
            | bevy::window::Ime::Commit { window, .. }
            | bevy::window::Ime::Enabled { window }
            | bevy::window::Ime::Disabled { window },
        ) => Some(*window),
        WindowEvent::FileDragAndDrop(
            bevy::window::FileDragAndDrop::DroppedFile { window, .. }
            | bevy::window::FileDragAndDrop::HoveredFile { window, .. }
            | bevy::window::FileDragAndDrop::HoveredFileCanceled { window },
        ) => Some(*window),
        _ => None,
    }
}

fn route_window_input(world: &mut World) {
    let Ok(window) = world
        .query_filtered::<Entity, With<PrimaryWindow>>()
        .single(world)
    else {
        return;
    };
    let handle = world.resource::<NativeInterfaceHandle>().clone();
    world.resource_scope(|world, mut state: Mut<HostCaptureState>| {
        let events: Vec<_> = state
            .events
            .read(world.resource::<Messages<WindowEvent>>())
            .cloned()
            .collect();
        // WindowEvent is the combined Bevy stream, preserving move/down/up and
        // modifier/key ordering even when several events arrive in one update.
        for event in &events {
            if input_window(event).is_some_and(|target| target != window) {
                continue;
            }
            if let WindowEvent::KeyboardInput(input) = event {
                if input.logical_key == Key::AltGraph {
                    state.modifiers.alt_graph = input.state == ButtonState::Pressed;
                }
                if input.state == ButtonState::Pressed {
                    state.modifiers.pressed.insert(input.key_code);
                } else {
                    state.modifiers.pressed.remove(&input.key_code);
                }
            }
            if let WindowEvent::WindowOccluded(event) = event {
                world.resource_mut::<NativeRenderAvailability>().occluded = event.occluded;
            }
            if let WindowEvent::WindowFocused(event) = event {
                world.resource_mut::<NativeRenderAvailability>().focused = event.focused;
            }
            match event {
                WindowEvent::CursorMoved(event) => state.cursor = Some(event.position),
                WindowEvent::CursorLeft(_) => state.cursor = None,
                WindowEvent::WindowFocused(event) if !event.focused => {
                    state.modifiers.pressed.clear();
                    state.modifiers.alt_graph = false;
                }
                WindowEvent::KeyboardFocusLost(_) => {
                    state.modifiers.pressed.clear();
                    state.modifiers.alt_graph = false;
                }
                _ => (),
            }
            world.write_message(NativeHostInput {
                context: handle.frame().map(|frame| frame.context),
                cursor: state.cursor,
                modifiers: state.modifiers.modifiers(),
                event: event.clone(),
                consumed: false,
                actions: Vec::new(),
            });
        }
    });
    if let Some(window) = world.get::<Window>(window) {
        let visible = window.visible && window.physical_width() > 0 && window.physical_height() > 0;
        let mut availability = world.resource_mut::<NativeRenderAvailability>();
        availability.drawable = visible && !availability.occluded;
    }
}

/// Run from the controller's single ordered loop, immediately before reducing
/// this event. Editing later field buffers before earlier model actions is
/// forbidden, even when the OS delivers an entire gesture in one update.
pub(crate) fn prepare_native_input(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    input: &mut NativeHostInput,
) -> Result<(), String> {
    if input.context != handle.frame().map(|frame| frame.context) {
        input.consumed = true;
        return Err("Native input belongs to a retired document".into());
    }
    world.resource_scope(|world, mut state: Mut<HostInputState>| {
        state.cursor = input.cursor;
        state.alt_graph = input.modifiers.alt_graph;
        state.pressed.clear();
        for (pressed, key) in [
            (input.modifiers.ctrl, KeyCode::ControlLeft),
            (input.modifiers.meta, KeyCode::SuperLeft),
            (input.modifiers.alt, KeyCode::AltLeft),
            (input.modifiers.shift, KeyCode::ShiftLeft),
        ] {
            if pressed {
                state.pressed.insert(key);
            }
        }
        input.consumed = super::interface_shell::fields::before_window_input(
            world,
            handle,
            &input.event,
            input.cursor,
            input.modifiers,
        )?;
        if !input.consumed {
            input.consumed = route_one(handle, &mut state, &input.event)?;
        }
        super::interface_shell::fields::after_window_input(world, handle)?;
        super::interface_shell::fields::after_pointer_input(
            world,
            handle,
            &input.event,
            input.cursor,
            input.modifiers,
        )?;
        input.actions = handle.take_actions()?;
        Ok(())
    })
}

fn route_one(
    handle: &NativeInterfaceHandle,
    state: &mut HostInputState,
    event: &WindowEvent,
) -> Result<bool, String> {
    match event {
        WindowEvent::CursorMoved(event) => {
            state.cursor = Some(event.position);
            if !state.model_drag.is_empty() && !handle.has_capture() {
                return Ok(false);
            }
            handle.pointer(
                PointerPhase::Move,
                event.position.as_dvec2().to_array(),
                PointerButton::Primary,
            )
        }
        WindowEvent::CursorLeft(_) => {
            let point = state
                .cursor
                .map(|point| point.as_dvec2().to_array())
                .unwrap_or([-1.0; 2]);
            state.cursor = None;
            handle.pointer(PointerPhase::Leave, point, PointerButton::Primary)
        }
        WindowEvent::MouseButtonInput(event) => {
            if event.state == ButtonState::Released && state.model_drag.remove(&event.button) {
                return Ok(false);
            }
            let button = match event.button {
                MouseButton::Left => PointerButton::Primary,
                MouseButton::Right => PointerButton::Secondary,
                _ => {
                    if event.state == ButtonState::Pressed {
                        state.model_drag.insert(event.button);
                    }
                    return Ok(false);
                }
            };
            let point = state
                .cursor
                .map(|point| point.as_dvec2().to_array())
                .unwrap_or([-1.0; 2]);
            let phase = if event.state == ButtonState::Pressed {
                PointerPhase::Down
            } else {
                PointerPhase::Up
            };
            let consumed = handle.pointer(phase, point, button)?;
            if !consumed && event.state == ButtonState::Pressed {
                state.model_drag.insert(event.button);
            }
            Ok(consumed)
        }
        WindowEvent::KeyboardInput(input) => {
            if input.state == ButtonState::Pressed {
                state.pressed.insert(input.key_code);
            } else {
                state.pressed.remove(&input.key_code);
                return Ok(false);
            }
            let chord = key_chord(input, state.modifiers());
            if chord.key == "Tab" && !chord.ctrl && !chord.meta && !chord.alt {
                return handle.focus_next(chord.shift);
            }
            handle.key(chord)
        }
        WindowEvent::WindowFocused(event) if !event.focused => {
            state.pressed.clear();
            state.model_drag.clear();
            state.cursor = None;
            handle.blur();
            Ok(false)
        }
        WindowEvent::KeyboardFocusLost(_) => {
            state.pressed.clear();
            state.model_drag.clear();
            handle.blur();
            Ok(false)
        }
        _ => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(window: Entity, code: KeyCode, logical: Key, state: ButtonState) -> WindowEvent {
        WindowEvent::KeyboardInput(KeyboardInput {
            key_code: code,
            logical_key: logical,
            state,
            text: None,
            repeat: false,
            window,
        })
    }

    #[test]
    fn modifier_state_is_ordered_and_focus_loss_cancels_it() {
        let handle = NativeInterfaceHandle::new(|| {});
        let mut state = HostInputState::default();
        let window = Entity::from_bits(1);
        route_one(
            &handle,
            &mut state,
            &key(
                window,
                KeyCode::ControlLeft,
                Key::Control,
                ButtonState::Pressed,
            ),
        )
        .unwrap();
        route_one(
            &handle,
            &mut state,
            &key(
                window,
                KeyCode::ControlRight,
                Key::Control,
                ButtonState::Pressed,
            ),
        )
        .unwrap();
        route_one(
            &handle,
            &mut state,
            &key(
                window,
                KeyCode::ControlLeft,
                Key::Control,
                ButtonState::Released,
            ),
        )
        .unwrap();
        assert!(state.modifiers().ctrl);
        let input = KeyboardInput {
            key_code: KeyCode::KeyZ,
            logical_key: Key::Character("z".into()),
            state: ButtonState::Pressed,
            text: Some("z".into()),
            repeat: false,
            window,
        };
        assert_eq!(
            key_chord(&input, state.modifiers()),
            KeyChord {
                key: "z".into(),
                ctrl: true,
                meta: false,
                alt: false,
                shift: false
            }
        );
        route_one(
            &handle,
            &mut state,
            &WindowEvent::WindowFocused(bevy::window::WindowFocused {
                window,
                focused: false,
            }),
        )
        .unwrap();
        assert_eq!(state.modifiers(), Modifiers::default());
    }

    #[test]
    fn ime_and_close_are_delivered_to_the_controller_without_synthetic_keys() {
        let mut app = App::new();
        app.add_message::<WindowEvent>()
            .add_message::<NativeHostInput>()
            .insert_resource(NativeInterfaceHandle::new(|| {}))
            .init_resource::<HostInputState>()
            .init_resource::<HostCaptureState>()
            .init_resource::<NativeRenderAvailability>()
            .add_systems(Update, route_window_input);
        let window = app.world_mut().spawn(PrimaryWindow).id();
        let foreign = app.world_mut().spawn_empty().id();
        let expected = [
            WindowEvent::Ime(bevy::window::Ime::Preedit {
                window,
                value: "日本".into(),
                cursor: Some((0, 6)),
            }),
            WindowEvent::Ime(bevy::window::Ime::Commit {
                window,
                value: "日本語".into(),
            }),
            WindowEvent::WindowCloseRequested(bevy::window::WindowCloseRequested { window }),
        ];
        for event in &expected {
            app.world_mut().write_message(event.clone());
        }
        app.world_mut()
            .write_message(WindowEvent::Ime(bevy::window::Ime::Commit {
                window: foreign,
                value: "foreign".into(),
            }));
        app.update();
        let events: Vec<_> = app
            .world_mut()
            .resource_mut::<Messages<NativeHostInput>>()
            .drain()
            .collect();
        assert_eq!(
            events
                .iter()
                .map(|input| input.event.clone())
                .collect::<Vec<_>>(),
            expected
        );
    }

    #[test]
    fn crossing_chrome_during_a_model_drag_preserves_model_input_and_leave_clears_hover() {
        use crate::native_viewport::interface_shell::tests::fixture;
        let (_app, handle, _, wakes) = fixture();
        let window = Entity::from_bits(1);
        let mut state = HostInputState::default();
        let move_to = |x, y| {
            WindowEvent::CursorMoved(bevy::window::CursorMoved {
                window,
                position: Vec2::new(x, y),
                delta: None,
            })
        };
        assert!(!route_one(&handle, &mut state, &move_to(800.0, 600.0)).unwrap());
        assert!(!route_one(
            &handle,
            &mut state,
            &WindowEvent::MouseButtonInput(bevy::input::mouse::MouseButtonInput {
                window,
                button: MouseButton::Left,
                state: ButtonState::Pressed
            })
        )
        .unwrap());
        assert!(!route_one(&handle, &mut state, &move_to(140.0, 140.0)).unwrap());
        assert!(!route_one(
            &handle,
            &mut state,
            &WindowEvent::MouseButtonInput(bevy::input::mouse::MouseButtonInput {
                window,
                button: MouseButton::Left,
                state: ButtonState::Released
            })
        )
        .unwrap());
        assert!(handle.take_actions().unwrap().is_empty());
        assert!(route_one(&handle, &mut state, &move_to(140.0, 140.0)).unwrap());
        let before = wakes.load(std::sync::atomic::Ordering::Relaxed);
        assert!(route_one(
            &handle,
            &mut state,
            &WindowEvent::CursorLeft(bevy::window::CursorLeft { window })
        )
        .unwrap());
        assert!(wakes.load(std::sync::atomic::Ordering::Relaxed) > before);
        assert_eq!(state.cursor, None);
    }
}
