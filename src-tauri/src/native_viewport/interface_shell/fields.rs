//! Native field adapters. Parley/Bevy owns Unicode editing and text layout;
//! committed values take the same owned SetValue path as MCP.

use bevy::{
    input::{
        keyboard::{Key, KeyboardInput},
        ButtonState,
    },
    prelude::*,
    text::{EditableText, FontWeight, PreeditCursor, TextEdit},
    ui::{ComputedUiRenderTargetInfo, UiGlobalTransform, UiScale, UiSystems},
    window::{Ime, PrimaryWindow, WindowEvent},
};
use nbcad_interface::{ControlInput, ControlKey, Field};
use std::collections::VecDeque;

use super::{
    InterfaceControl, InterfaceLayout, InterfaceTextRevision, NativeInterfaceAction,
    NativeInterfaceHandle,
};
use crate::native_viewport::{
    ui::{ViewportUiAssets, ViewportUiTheme},
    winit_host::Modifiers,
};

#[derive(Component)]
// TextInputPlugin normally registers these UI requirements. Native fields
// retain ordered input routing while using the same Bevy text layout systems.
#[require(EditableText, Node, bevy::ui::TextNodeFlags, bevy::ui::ContentSize)]
pub(crate) struct NativeTextField {
    baseline: String,
    queued: Option<String>,
    undo: VecDeque<String>,
    redo: VecDeque<String>,
    binding: u64,
    theme: ViewportUiTheme,
}

#[derive(Resource, Default)]
struct EditorSession {
    active: Option<NativeInterfaceAction>,
}

pub(crate) fn install(app: &mut App) {
    app.init_resource::<EditorSession>()
        .add_systems(Update, synchronize_fields.after(super::InterfaceReduction))
        .add_systems(
            PostUpdate,
            update_ime.after(InterfaceLayout).after(UiSystems::Stack),
        );
}

/// Root binds the returned real widget to its typed form field, exactly as it
/// binds buttons. The editable value is not rendered by a hidden proxy.
pub(crate) fn spawn_text_field(
    commands: &mut Commands,
    camera: Entity,
    node: Node,
    mut control: InterfaceControl,
    theme: ViewportUiTheme,
    assets: &ViewportUiAssets,
) -> Result<Entity, String> {
    let Field::Text { value, .. } = &control.field else {
        return Err("Native text widget needs a text field".into());
    };
    let value = value.clone();
    control.text_editing = true;
    control.role = "textbox".into();
    Ok(commands
        .spawn((
            Name::new(format!("Native text: {}", control.label)),
            NativeTextField {
                baseline: value.clone(),
                queued: None,
                undo: VecDeque::new(),
                redo: VecDeque::new(),
                binding: control.binding,
                theme,
            },
            EditableText::new(value),
            TextLayout::no_wrap(),
            InterfaceTextRevision::default(),
            control,
            node,
            UiTargetCamera(camera),
            theme.text(assets, 13.0, FontWeight::NORMAL),
            TextColor(theme.ink),
            BackgroundColor(theme.panel),
            BorderColor::all(theme.edge),
            ZIndex(31),
        ))
        .id())
}

fn active_entity(action: &NativeInterfaceAction) -> Entity {
    Entity::from_bits(action.control.key.0)
}

fn validate_editor(
    world: &World,
    handle: &NativeInterfaceHandle,
    action: &NativeInterfaceAction,
) -> Result<(), String> {
    handle.validate_action(action)?;
    let control = world
        .get::<InterfaceControl>(active_entity(action))
        .ok_or("Native text field was removed")?;
    if control.binding != action.control.binding() || !control.visible || control.disabled {
        return Err("Native text field changed before input could run".into());
    }
    Ok(())
}

fn flush_edits(world: &mut World) -> Result<(), String> {
    world
        .run_system_cached(bevy::text::apply_text_edits)
        .map_err(|error| format!("Native text edit failed: {error}"))
}

fn invalidate_text(world: &mut World, entity: Entity) {
    if let Some(mut revision) = world.get_mut::<InterfaceTextRevision>(entity) {
        revision.0 = revision.0.wrapping_add(1);
    }
}

/// Flush before changing focus, including background clicks and Tab. This
/// captures the original binding before root reduces the value; stale owners
/// can never be repaired by resolving their field in a replacement document.
fn commit_active(
    world: &mut World,
    handle: &NativeInterfaceHandle,
) -> Result<Option<NativeInterfaceAction>, String> {
    let Some(action) = world.resource::<EditorSession>().active.clone() else {
        return Ok(None);
    };
    // Cancel may retire the entire form between events. Its discarded buffer
    // must not block the next valid button, nor resolve against a new field.
    if world
        .get::<NativeTextField>(active_entity(&action))
        .is_none_or(|field| field.binding != action.control.binding())
        || handle
            .frame()
            .is_none_or(|frame| frame.context != action.context)
    {
        world.resource_mut::<EditorSession>().active = None;
        return Ok(None);
    }
    if let Err(error) = validate_editor(world, handle, &action) {
        world.resource_mut::<EditorSession>().active = None;
        return Err(error);
    }
    flush_edits(world)?;
    let entity = active_entity(&action);
    let value = world
        .get::<EditableText>(entity)
        .ok_or("Native text editor was removed")?
        .value()
        .to_string();
    if world
        .get::<NativeTextField>(entity)
        .is_some_and(|field| field.baseline == value || field.queued.as_ref() == Some(&value))
    {
        return Ok(None);
    }
    let committed = handle.resolve_input(
        action.control.key,
        ControlInput::SetValue(value.clone()),
        &action.context,
    )?;
    world
        .get_mut::<NativeTextField>(entity)
        .ok_or("Native text editor was removed")?
        .queued = Some(value);
    Ok(Some(committed))
}

/// Only accepted SetValue commits advance the editor baseline. A rejected
/// draft stays dirty, so the next Apply cannot use the old accepted value.
pub(crate) fn acknowledge_control_input(
    world: &mut World,
    action: &NativeInterfaceAction,
    accepted: bool,
) {
    let ControlInput::SetValue(value) = &action.control.input else {
        return;
    };
    let entity = active_entity(action);
    if let Some(mut field) = world.get_mut::<NativeTextField>(entity) {
        if field.binding != action.control.binding() {
            return;
        }
        if field.queued.as_ref() == Some(value) {
            field.queued = None;
        }
        if accepted {
            field.baseline.clone_from(value);
        }
        drop(field);
        if accepted {
            if let Some(mut editor) = world.get_mut::<EditableText>(entity) {
                if editor.value().to_string() != *value {
                    editor.editor.set_text(value);
                    editor.pending_edits.clear();
                    editor.pending_paste = None;
                    editor.queue_edit(TextEdit::clear_ime_compose());
                    editor.queue_edit(TextEdit::TextEnd(false));
                }
            }
            invalidate_text(world, entity);
        }
    }
}

#[cfg(test)]
mod tests;

/// The shared reducer applies these preceding commits, checks their results,
/// then revalidates and applies the original target. A failed blur commit must
/// never allow an Apply button to run against the previous value.
pub(crate) fn prepare_control_input(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    action: &NativeInterfaceAction,
) -> Result<Vec<NativeInterfaceAction>, String> {
    handle.validate_action(action)?;
    if !world.contains_resource::<EditorSession>() {
        return Ok(Vec::new());
    }
    // A direct SetValue on the current field replaces its draft; committing
    // that old draft immediately before it would create an unnecessary edit.
    if world
        .resource::<EditorSession>()
        .active
        .as_ref()
        .is_some_and(|active| active.control.key == action.control.key)
    {
        return Ok(Vec::new());
    }
    Ok(commit_active(world, handle)?.into_iter().collect())
}

/// Widget keys use the same edit operations regardless of their transport.
/// Escape belongs to the owning form; arrows merely update caret/selection.
pub(crate) fn adapt_control_input(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    action: &NativeInterfaceAction,
) -> Result<Option<NativeInterfaceAction>, String> {
    let entity = active_entity(action);
    let ControlInput::Key(chord) = &action.control.input else {
        return Ok(Some(action.clone()));
    };
    if world.get::<NativeTextField>(entity).is_none() || chord.key == "Escape" {
        return Ok(Some(action.clone()));
    }
    validate_editor(world, handle, action)?;
    if chord.key == "Enter" {
        let commit = commit_active(world, handle)?;
        if submits_on_enter(world, entity) {
            if commit.is_some() {
                // Commit the visible buffer before invoking the field's submit
                // action, keeping the original owner and binding on both.
                handle.enqueue_action(action.clone())?;
            } else {
                return Ok(Some(action.clone()));
            }
        }
        return Ok(commit);
    }
    let logical_key = match chord.key.as_str() {
        "ArrowLeft" => Key::ArrowLeft,
        "ArrowRight" => Key::ArrowRight,
        "ArrowUp" => Key::ArrowUp,
        "ArrowDown" => Key::ArrowDown,
        "Home" => Key::Home,
        "End" => Key::End,
        "Backspace" => Key::Backspace,
        "Delete" => Key::Delete,
        _ => return Ok(Some(action.clone())),
    };
    let modifiers = Modifiers {
        ctrl: chord.ctrl,
        meta: chord.meta,
        alt: chord.alt,
        shift: chord.shift,
        alt_graph: false,
    };
    if let Some(edit) = logical_edit(&logical_key, None, modifiers) {
        apply_edit(world, entity, edit)?;
    }
    handle.invalidate_presentation();
    commit_active(world, handle)
}

fn submits_on_enter(world: &World, entity: Entity) -> bool {
    world
        .get::<InterfaceControl>(entity)
        .is_some_and(|control| {
            control
                .owned_keys
                .contains(&nbcad_interface::KeyChord::plain("Enter"))
        })
}

fn trim_history(field: &mut NativeTextField) {
    const MAX_HISTORY_BYTES: usize = 8 * 1024 * 1024;
    while field.undo.len() + field.redo.len() > 128
        || field
            .undo
            .iter()
            .chain(&field.redo)
            .map(String::len)
            .sum::<usize>()
            > MAX_HISTORY_BYTES
    {
        if field.undo.pop_front().is_none() {
            field.redo.pop_front();
        }
    }
}

fn apply_edit(world: &mut World, entity: Entity, edit: TextEdit) -> Result<(), String> {
    let read_only = matches!(
        world
            .get::<InterfaceControl>(entity)
            .map(|control| &control.field),
        Some(Field::Text {
            read_only: true,
            ..
        })
    );
    if read_only && edit.is_destructive() {
        return Ok(());
    }
    // Composition is provisional; only its commit gets an undo boundary.
    let records_history = edit.is_destructive() && !matches!(edit, TextEdit::ImeSetCompose { .. });
    let before = records_history.then(|| {
        world
            .get::<EditableText>(entity)
            .unwrap()
            .value()
            .to_string()
    });
    world
        .get_mut::<EditableText>(entity)
        .ok_or("Native text editor was removed")?
        .queue_edit(edit);
    flush_edits(world)?;
    invalidate_text(world, entity);
    if let Some(before) = before {
        if world
            .get::<EditableText>(entity)
            .unwrap()
            .value()
            .to_string()
            != before
        {
            let mut field = world
                .get_mut::<NativeTextField>(entity)
                .ok_or("Native text field was removed")?;
            field.undo.push_back(before);
            field.redo.clear();
            trim_history(&mut field);
        }
    }
    Ok(())
}

fn history_edit(world: &mut World, entity: Entity, redo: bool) -> Result<(), String> {
    if matches!(
        world
            .get::<InterfaceControl>(entity)
            .map(|control| &control.field),
        Some(Field::Text {
            read_only: true,
            ..
        })
    ) {
        return Ok(());
    }
    flush_edits(world)?;
    let current = world
        .get::<EditableText>(entity)
        .ok_or("Native editor was removed")?
        .value()
        .to_string();
    let mut field = world
        .get_mut::<NativeTextField>(entity)
        .ok_or("Native field was removed")?;
    let Some(value) = (if redo {
        &mut field.redo
    } else {
        &mut field.undo
    })
    .pop_back() else {
        return Ok(());
    };
    if redo {
        field.undo.push_back(current);
    } else {
        field.redo.push_back(current);
    }
    trim_history(&mut field);
    drop(field);
    let mut editor = world
        .get_mut::<EditableText>(entity)
        .ok_or("Native editor was removed")?;
    editor.editor.set_text(&value);
    editor.pending_edits.clear();
    editor.queue_edit(TextEdit::TextEnd(false));
    drop(editor);
    flush_edits(world)?;
    invalidate_text(world, entity);
    Ok(())
}

/// Called for every original OS event before general UI/model routing. This
/// preserves typing → Tab → typing order even within one event-loop update.
pub(crate) fn before_window_input(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    event: &WindowEvent,
    cursor: Option<Vec2>,
    modifiers: Modifiers,
) -> Result<bool, String> {
    if !world.contains_resource::<EditorSession>() {
        return Ok(false);
    }
    let Some(action) = world.resource::<EditorSession>().active.clone() else {
        return Ok(false);
    };
    if validate_editor(world, handle, &action).is_err() {
        world.resource_mut::<EditorSession>().active = None;
        // Drop late IME delivery instead of applying it to a new field.
        return Ok(matches!(event, WindowEvent::Ime(_)));
    }
    let entity = active_entity(&action);
    let composing = world
        .get::<EditableText>(entity)
        .is_some_and(EditableText::is_composing);
    let edit = match event {
        WindowEvent::Ime(Ime::Preedit { value, cursor, .. }) => Some(TextEdit::ImeSetCompose {
            value: value.as_str().into(),
            cursor: cursor.map(|(anchor, focus)| PreeditCursor { anchor, focus }),
        }),
        WindowEvent::Ime(Ime::Commit { value, .. }) => Some(TextEdit::ImeCommit {
            value: value.as_str().into(),
        }),
        WindowEvent::Ime(Ime::Enabled { .. } | Ime::Disabled { .. }) => {
            Some(TextEdit::clear_ime_compose())
        }
        WindowEvent::KeyboardInput(input) if input.state == ButtonState::Pressed => {
            if composing {
                return Ok(true);
            }
            let command = !modifiers.alt_graph
                && !modifiers.alt
                && if cfg!(target_os = "macos") {
                    modifiers.meta
                } else {
                    modifiers.ctrl
                };
            if command {
                if let Key::Character(key) = &input.logical_key {
                    if key.eq_ignore_ascii_case("z")
                        || (!cfg!(target_os = "macos") && key.eq_ignore_ascii_case("y"))
                    {
                        history_edit(
                            world,
                            entity,
                            modifiers.shift || key.eq_ignore_ascii_case("y"),
                        )?;
                        handle.invalidate_presentation();
                        return Ok(true);
                    }
                }
            }
            if input.logical_key == Key::Tab || input.logical_key == Key::Enter {
                if let Some(commit) = commit_active(world, handle)? {
                    handle.enqueue_action(commit)?;
                }
                if input.logical_key == Key::Enter && submits_on_enter(world, entity) {
                    handle.key(nbcad_interface::KeyChord::plain("Enter"))?;
                }
                return Ok(input.logical_key == Key::Enter);
            }
            keyboard_edit(input, modifiers)
        }
        WindowEvent::MouseButtonInput(input) if input.state == ButtonState::Pressed => {
            let target = cursor.and_then(|cursor| handle.hit_key(cursor.as_dvec2().to_array()));
            if target != Some(action.control.key) {
                if let Some(commit) = commit_active(world, handle)? {
                    handle.enqueue_action(commit)?;
                }
                world.resource_mut::<EditorSession>().active = None;
                handle.blur();
            }
            None
        }
        WindowEvent::WindowFocused(event) if !event.focused => {
            if let Some(commit) = commit_active(world, handle)? {
                handle.enqueue_action(commit)?;
            }
            world.resource_mut::<EditorSession>().active = None;
            None
        }
        _ => None,
    };
    if let Some(edit) = edit {
        apply_edit(world, entity, edit)?;
        // IME composition state must be current before the next native
        // event in this same batch, especially Tab/Enter.
        handle.invalidate_presentation();
        return Ok(true);
    }
    Ok(false)
}

pub(crate) fn after_window_input(
    world: &mut World,
    handle: &NativeInterfaceHandle,
) -> Result<(), String> {
    if !world.contains_resource::<EditorSession>() {
        return Ok(());
    }
    let next = handle.focused_key().filter(|key| {
        world
            .get::<NativeTextField>(Entity::from_bits(key.0))
            .is_some()
    });
    let current = world
        .resource::<EditorSession>()
        .active
        .as_ref()
        .map(|active| active.control.key);
    if current == next {
        return Ok(());
    }
    if let Some(commit) = commit_active(world, handle)? {
        handle.enqueue_action(commit)?;
    }
    let action = next.map(|key| handle.resolve_retained(key)).transpose()?;
    world.resource_mut::<EditorSession>().active = action;
    Ok(())
}

pub(crate) fn after_pointer_input(
    world: &mut World,
    handle: &NativeInterfaceHandle,
    event: &WindowEvent,
    cursor: Option<Vec2>,
    modifiers: Modifiers,
) -> Result<(), String> {
    let Some(action) = world
        .get_resource::<EditorSession>()
        .and_then(|state| state.active.clone())
    else {
        return Ok(());
    };
    let Some(cursor) = cursor else {
        return Ok(());
    };
    let press = matches!(event, WindowEvent::MouseButtonInput(input) if input.button == MouseButton::Left && input.state == ButtonState::Pressed);
    let drag = matches!(event, WindowEvent::CursorMoved(_)) && handle.has_capture();
    if !press && !drag {
        return Ok(());
    }
    validate_editor(world, handle, &action)?;
    let entity = active_entity(&action);
    let Some(node) = world.get::<ComputedNode>(entity) else {
        return Ok(());
    };
    let Some(transform) = world
        .get::<UiGlobalTransform>(entity)
        .and_then(UiGlobalTransform::try_inverse)
    else {
        return Ok(());
    };
    let Some(target) = world.get::<ComputedUiRenderTargetInfo>(entity) else {
        return Ok(());
    };
    let scale = world.resource::<UiScale>().0;
    let scroll = world
        .get::<EditableText>(entity)
        .map_or(Vec2::ZERO, |editor| editor.viewport.offset);
    let point = transform.transform_point2(cursor * target.scale_factor() / scale)
        - node.content_box().min
        + scroll;
    let edit = if drag {
        TextEdit::ExtendSelectionToPoint(point)
    } else if modifiers.shift {
        TextEdit::ShiftClickExtension(point)
    } else {
        TextEdit::MoveToPoint(point)
    };
    world
        .get_mut::<EditableText>(entity)
        .ok_or("Native text editor was removed")?
        .queue_edit(edit);
    flush_edits(world)?;
    invalidate_text(world, entity);
    Ok(())
}

fn keyboard_edit(input: &KeyboardInput, modifiers: Modifiers) -> Option<TextEdit> {
    logical_edit(&input.logical_key, input.text.as_deref(), modifiers)
}

fn logical_edit(key: &Key, text: Option<&str>, modifiers: Modifiers) -> Option<TextEdit> {
    let command = !modifiers.alt_graph
        && !modifiers.alt
        && if cfg!(target_os = "macos") {
            modifiers.meta
        } else {
            modifiers.ctrl
        };
    let word = if cfg!(target_os = "macos") {
        modifiers.alt
    } else {
        modifiers.ctrl
    };
    let shift = modifiers.shift;
    match key {
        Key::Character(value) if command && value.eq_ignore_ascii_case("a") => {
            Some(TextEdit::SelectAll)
        }
        Key::Character(value) if command && value.eq_ignore_ascii_case("c") => Some(TextEdit::Copy),
        Key::Character(value) if command && value.eq_ignore_ascii_case("x") => Some(TextEdit::Cut),
        Key::Character(value) if command && value.eq_ignore_ascii_case("v") => {
            Some(TextEdit::Paste)
        }
        Key::Copy => Some(TextEdit::Copy),
        Key::Cut => Some(TextEdit::Cut),
        Key::Paste => Some(TextEdit::Paste),
        Key::Backspace => Some(if word {
            TextEdit::BackspaceWord
        } else {
            TextEdit::Backspace
        }),
        Key::Delete => Some(if word {
            TextEdit::DeleteWord
        } else {
            TextEdit::Delete
        }),
        Key::ArrowLeft => Some(if cfg!(target_os = "macos") && command {
            TextEdit::HardLineStart(shift)
        } else if word {
            TextEdit::WordLeft(shift)
        } else {
            TextEdit::Left(shift)
        }),
        Key::ArrowRight => Some(if cfg!(target_os = "macos") && command {
            TextEdit::HardLineEnd(shift)
        } else if word {
            TextEdit::WordRight(shift)
        } else {
            TextEdit::Right(shift)
        }),
        Key::ArrowUp => Some(if command {
            TextEdit::TextStart(shift)
        } else {
            TextEdit::Up(shift)
        }),
        Key::ArrowDown => Some(if command {
            TextEdit::TextEnd(shift)
        } else {
            TextEdit::Down(shift)
        }),
        Key::Home => Some(if command {
            TextEdit::TextStart(shift)
        } else {
            TextEdit::LineStart(shift)
        }),
        Key::End => Some(if command {
            TextEdit::TextEnd(shift)
        } else {
            TextEdit::LineEnd(shift)
        }),
        Key::Character(_) | Key::Space
            if modifiers.alt_graph
                || (!modifiers.ctrl
                    && !modifiers.meta
                    && (!modifiers.alt || cfg!(target_os = "macos"))) =>
        {
            text.map(|value| TextEdit::Insert(value.into()))
        }
        _ => None,
    }
}

fn synchronize_fields(
    handle: Res<NativeInterfaceHandle>,
    mut focus: ResMut<bevy::input_focus::InputFocus>,
    mut fields: Query<(
        Entity,
        &InterfaceControl,
        &mut NativeTextField,
        &mut EditableText,
        &mut InterfaceTextRevision,
        &mut Node,
        &mut BorderColor,
    )>,
) {
    let focused = handle.focused_key();
    // Text layout needs the actual editable entity. AccessKit maps this same
    // focus to its guarded proxy after layout, before publishing its tree.
    let editor_focus = focused.filter(|key| fields.get(Entity::from_bits(key.0)).is_ok());
    if let Some(key) = editor_focus {
        focus.set(
            Entity::from_bits(key.0),
            bevy::input_focus::FocusCause::Navigated,
        );
    }
    for (entity, control, mut field, mut editor, mut revision, mut node, mut border) in &mut fields
    {
        let Field::Text { value, .. } = &control.field else {
            continue;
        };
        if field.binding != control.binding || field.baseline != *value {
            editor.editor.set_text(value);
            editor.pending_edits.clear();
            editor.queue_edit(TextEdit::TextEnd(false));
            field.baseline.clone_from(value);
            field.binding = control.binding;
            field.queued = None;
            field.undo.clear();
            field.redo.clear();
            revision.0 = revision.0.wrapping_add(1);
        }
        let display = if control.visible {
            Display::Flex
        } else {
            Display::None
        };
        if node.display != display {
            node.display = display;
        }
        let edge = BorderColor::all(if focused == Some(ControlKey(entity.to_bits())) {
            field.theme.accent
        } else {
            field.theme.edge
        });
        if *border != edge {
            *border = edge;
        }
    }
}

fn update_ime(
    handle: Res<NativeInterfaceHandle>,
    fields: Query<
        (
            &EditableText,
            &ComputedNode,
            &UiGlobalTransform,
            &ComputedUiRenderTargetInfo,
        ),
        With<NativeTextField>,
    >,
    mut windows: Query<&mut Window, With<PrimaryWindow>>,
    scale: Res<UiScale>,
) {
    let Ok(mut window) = windows.single_mut() else {
        return;
    };
    let focused = handle
        .focused_key()
        .and_then(|key| fields.get(Entity::from_bits(key.0)).ok());
    window.ime_enabled = focused.is_some();
    if let Some((editor, node, transform, target)) = focused {
        let area = editor.editor.ime_cursor_area();
        let local = Vec2::new(area.x0 as f32, area.y1 as f32) + node.content_box().min
            - editor.viewport.offset;
        window.ime_position =
            transform.affine().transform_point2(local) * scale.0 / target.scale_factor();
    }
}
