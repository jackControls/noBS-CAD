//! Optional byte bound for large source fields, before Parley shapes an edit.
//! Clipboard data still comes from Bevy's existing native clipboard resource.
use super::*;

#[derive(Component)]
pub(crate) struct ByteLimit {
    pub maximum: usize,
    pub rejected: Option<String>,
}

pub(crate) fn enable(world: &mut World, entity: Entity, maximum: usize) {
    if let Some(mut limit) = world.get_mut::<ByteLimit>(entity) {
        limit.maximum = maximum;
    } else {
        world.entity_mut(entity).insert(ByteLimit {
            maximum,
            rejected: None,
        });
    }
}

/// Clear only after a successful committed-buffer change, or an explicitly
/// validated full SetValue/file replacement. Preflight, IME preedit/cleanup,
/// and no-op edits must not make an older accepted source runnable again.
pub(crate) fn clear(world: &mut World, entity: Entity) {
    if let Some(mut limit) = world.get_mut::<ByteLimit>(entity) {
        limit.rejected = None;
    }
}

pub(crate) fn error(world: &World, entity: Entity) -> Option<&str> {
    world.get::<ByteLimit>(entity)?.rejected.as_deref()
}

pub(super) fn before_edit(
    world: &mut World,
    entity: Entity,
    edit: TextEdit,
) -> Result<TextEdit, String> {
    let Some(maximum) = world.get::<ByteLimit>(entity).map(|limit| limit.maximum) else {
        return Ok(edit);
    };
    let edit = if matches!(edit, TextEdit::Paste) {
        // Native reads resolve synchronously in this pinned Bevy version.
        // Read once, validate once, then send one ordinary undoable Insert.
        let mut read = world
            .get_resource_mut::<bevy::clipboard::Clipboard>()
            .ok_or("The native clipboard is unavailable")?
            .fetch_text();
        let text = read
            .poll_result()
            .ok_or("The clipboard has not finished reading")?
            .map_err(|error| format!("Cannot paste source text: {error:?}"))?;
        TextEdit::Insert(text.into())
    } else {
        edit
    };
    let incoming = match &edit {
        TextEdit::Insert(text) => Some(text.len()),
        TextEdit::ImeCommit { value } => Some(value.len()),
        TextEdit::ImeSetCompose { value, .. } if !value.is_empty() => Some(value.len()),
        _ => None,
    };
    if let Some(incoming) = incoming {
        let editor = world
            .get::<EditableText>(entity)
            .ok_or("Source editor was removed")?;
        // value() excludes the current preedit. A replacement preedit must
        // be counted once; only the initial composition replaces a selected
        // region of committed text. Parley has already removed that region
        // when a later composition/commit arrives.
        let bytes = editor.value().into_iter().map(str::len).sum::<usize>();
        let selected = if editor.is_composing() {
            0
        } else {
            editor.editor.selected_text().map_or(0, str::len)
        };
        if bytes.saturating_sub(selected).saturating_add(incoming) > maximum {
            let message = format!("Source text exceeds {maximum} bytes; the edit was not inserted");
            world.get_mut::<ByteLimit>(entity).unwrap().rejected = Some(message.clone());
            return Err(message);
        }
    }
    // apply_edit clears only inside its records_history branch after the
    // committed value actually changes. Merely accepting an edit says
    // nothing about whether it changed text or was provisional IME input.
    Ok(edit)
}

#[cfg(test)]
mod tests {
    use super::super::tests::editor_fixture;
    use super::*;

    #[test]
    fn byte_bound_rejects_before_layout_and_counts_utf8_and_selected_replacement() {
        let (mut app, _, entity) = editor_fixture();
        enable(app.world_mut(), entity, 8);
        // The fixture starts with "12" and a caret at the end.
        let before = app
            .world()
            .get::<EditableText>(entity)
            .unwrap()
            .value()
            .to_string();
        assert!(apply_edit(
            app.world_mut(),
            entity,
            TextEdit::Insert("\u{96f6}\u{4ef6}x".into())
        )
        .is_err());
        assert_eq!(
            app.world()
                .get::<EditableText>(entity)
                .unwrap()
                .value()
                .to_string(),
            before
        );
        assert!(error(app.world(), entity).unwrap().contains("8 bytes"));
        let edit = before_edit(
            app.world_mut(),
            entity,
            TextEdit::Insert("\u{96f6}\u{4ef6}".into()),
        )
        .unwrap();
        apply_edit(app.world_mut(), entity, edit).unwrap();
        assert_eq!(
            app.world()
                .get::<EditableText>(entity)
                .unwrap()
                .value()
                .to_string(),
            "12\u{96f6}\u{4ef6}"
        );
        apply_edit(app.world_mut(), entity, TextEdit::SelectAll).unwrap();
        let edit = before_edit(app.world_mut(), entity, TextEdit::Insert("G1 X20".into())).unwrap();
        apply_edit(app.world_mut(), entity, edit).unwrap();
        assert_eq!(
            app.world()
                .get::<EditableText>(entity)
                .unwrap()
                .value()
                .to_string(),
            "G1 X20"
        );
        assert!(error(app.world(), entity).is_none());
    }

    #[test]
    fn preedit_is_bounded_before_mutation_and_replaces_selection_or_previous_preedit_once() {
        let (mut app, handle, entity) = editor_fixture();
        enable(app.world_mut(), entity, 8);
        let compose = |value: &str| TextEdit::ImeSetCompose {
            value: value.into(),
            cursor: None,
        };
        let event = WindowEvent::Ime(Ime::Preedit {
            window: Entity::PLACEHOLDER,
            value: "\u{96f6}\u{4ef6}x".into(),
            cursor: None,
        });
        assert!(
            before_window_input(app.world_mut(), &handle, &event, None, Modifiers::default())
                .is_err()
        );
        let editor = app.world().get::<EditableText>(entity).unwrap();
        assert_eq!(editor.editor.raw_text(), "12");
        assert!(!editor.is_composing());
        let rejected = error(app.world(), entity).unwrap().to_owned();

        apply_edit(app.world_mut(), entity, TextEdit::SelectAll).unwrap();
        // Seven UTF-8 bytes fit when replacing the two selected bytes.
        let edit = before_edit(app.world_mut(), entity, compose("\u{96f6}\u{4ef6}x")).unwrap();
        apply_edit(app.world_mut(), entity, edit).unwrap();
        let editor = app.world().get::<EditableText>(entity).unwrap();
        assert_eq!(editor.value().to_string(), "");
        assert_eq!(editor.editor.raw_text(), "\u{96f6}\u{4ef6}x");
        assert!(editor.is_composing());
        assert_eq!(error(app.world(), entity), Some(rejected.as_str()));

        // A subsequent preedit replaces the previous seven bytes, rather
        // than appending to them or deducting a selected preedit fragment.
        let edit = before_edit(app.world_mut(), entity, compose("\u{96f6}\u{4ef6}xy")).unwrap();
        apply_edit(app.world_mut(), entity, edit).unwrap();
        assert_eq!(
            app.world()
                .get::<EditableText>(entity)
                .unwrap()
                .editor
                .raw_text(),
            "\u{96f6}\u{4ef6}xy"
        );
        assert!(before_edit(app.world_mut(), entity, compose("\u{96f6}\u{4ef6}xyz")).is_err());
        assert_eq!(
            app.world()
                .get::<EditableText>(entity)
                .unwrap()
                .editor
                .raw_text(),
            "\u{96f6}\u{4ef6}xy"
        );
        assert!(error(app.world(), entity).is_some());

        let edit = before_edit(
            app.world_mut(),
            entity,
            TextEdit::ImeCommit {
                value: "\u{96f6}\u{4ef6}xy".into(),
            },
        )
        .unwrap();
        // Preflight still cannot clear the rejection; the committed edit can.
        assert!(error(app.world(), entity).is_some());
        apply_edit(app.world_mut(), entity, edit).unwrap();
        let editor = app.world().get::<EditableText>(entity).unwrap();
        assert_eq!(editor.value().to_string(), "\u{96f6}\u{4ef6}xy");
        assert!(!editor.is_composing());
        assert!(error(app.world(), entity).is_none());
    }

    #[test]
    fn provisional_cleanup_and_no_op_edits_cannot_clear_a_rejected_source() {
        let (mut app, _, entity) = editor_fixture();
        enable(app.world_mut(), entity, 8);
        assert!(before_edit(app.world_mut(), entity, TextEdit::Insert("1234567".into())).is_err());
        let rejected = error(app.world(), entity).unwrap().to_owned();
        for edit in [
            TextEdit::Insert(String::new().into()),
            TextEdit::Delete,
            TextEdit::TextStart(false),
            TextEdit::Backspace,
            TextEdit::TextEnd(false),
            TextEdit::ImeSetCompose {
                value: "\u{96f6}".into(),
                cursor: None,
            },
            TextEdit::clear_ime_compose(),
            TextEdit::ImeSetCompose {
                value: "\u{4ef6}".into(),
                cursor: None,
            },
            TextEdit::ImeCommit { value: "".into() },
            TextEdit::clear_ime_compose(),
        ] {
            let edit = before_edit(app.world_mut(), entity, edit).unwrap();
            assert_eq!(error(app.world(), entity), Some(rejected.as_str()));
            apply_edit(app.world_mut(), entity, edit).unwrap();
            assert_eq!(
                app.world()
                    .get::<EditableText>(entity)
                    .unwrap()
                    .value()
                    .to_string(),
                "12"
            );
            assert_eq!(error(app.world(), entity), Some(rejected.as_str()));
        }
    }

    #[test]
    fn undo_redo_clear_rejection_only_when_the_committed_text_changes() {
        let (mut app, _, entity) = editor_fixture();
        enable(app.world_mut(), entity, 8);
        assert!(apply_edit(app.world_mut(), entity, TextEdit::Insert("1234567".into())).is_err());
        history_edit(app.world_mut(), entity, false).unwrap();
        assert!(
            error(app.world(), entity).is_some(),
            "Empty Undo must retain rejection"
        );
        apply_edit(app.world_mut(), entity, TextEdit::Insert("3".into())).unwrap();
        assert!(error(app.world(), entity).is_none());
        assert!(apply_edit(app.world_mut(), entity, TextEdit::Insert("123456".into())).is_err());
        history_edit(app.world_mut(), entity, false).unwrap();
        assert_eq!(
            app.world()
                .get::<EditableText>(entity)
                .unwrap()
                .value()
                .to_string(),
            "12"
        );
        assert!(error(app.world(), entity).is_none());
        assert!(apply_edit(app.world_mut(), entity, TextEdit::Insert("1234567".into())).is_err());
        history_edit(app.world_mut(), entity, true).unwrap();
        assert_eq!(
            app.world()
                .get::<EditableText>(entity)
                .unwrap()
                .value()
                .to_string(),
            "123"
        );
        assert!(error(app.world(), entity).is_none());
    }

    #[test]
    fn rejected_insertion_cannot_blur_an_older_dirty_buffer_into_a_successful_run() {
        use bevy::input::mouse::MouseButtonInput;
        let (mut app, handle, entity) = editor_fixture();
        enable(app.world_mut(), entity, 8);
        apply_edit(app.world_mut(), entity, TextEdit::Insert("3".into())).unwrap();
        assert_eq!(
            app.world()
                .get::<EditableText>(entity)
                .unwrap()
                .value()
                .to_string(),
            "123"
        );
        assert_eq!(
            app.world().get::<NativeTextField>(entity).unwrap().baseline,
            "12"
        );
        assert!(apply_edit(app.world_mut(), entity, TextEdit::Insert("123456".into())).is_err());
        let rejected = error(app.world(), entity).unwrap().to_owned();
        // The first mouse press outside this source editor is exactly the
        // blur that precedes a Run click in the native input route.
        let press = WindowEvent::MouseButtonInput(MouseButtonInput {
            button: MouseButton::Left,
            state: ButtonState::Pressed,
            window: Entity::PLACEHOLDER,
        });
        assert!(
            !before_window_input(app.world_mut(), &handle, &press, None, Modifiers::default())
                .unwrap()
        );
        assert!(
            handle.take_actions().unwrap().is_empty(),
            "No older Source SetValue may precede Run"
        );
        let field = app.world().get::<NativeTextField>(entity).unwrap();
        assert_eq!(field.baseline, "12");
        assert!(field.queued.is_none());
        assert!(commit_active(app.world_mut(), &handle).unwrap().is_none());
        assert_eq!(error(app.world(), entity), Some(rejected.as_str()));
        app.init_resource::<bevy::input_focus::InputFocus>();
        app.world_mut()
            .entity_mut(entity)
            .insert(BorderColor::default());
        app.world_mut()
            .run_system_cached(synchronize_fields)
            .unwrap();
        assert_eq!(
            app.world()
                .get::<EditableText>(entity)
                .unwrap()
                .value()
                .to_string(),
            "123",
            "Repainting after blur must retain the rejected older draft"
        );
        assert_eq!(error(app.world(), entity), Some(rejected.as_str()));

        // Explicit direct full-source replacement remains reachable, without
        // first committing the rejected editor's older buffer.
        let owner = handle.frame().unwrap().context;
        let replacement = handle
            .resolve_input(
                ControlKey(entity.to_bits()),
                ControlInput::SetValue("new".into()),
                &owner,
            )
            .unwrap();
        assert!(
            prepare_control_input(app.world_mut(), &handle, &replacement)
                .unwrap()
                .is_empty()
        );
        assert_eq!(error(app.world(), entity), Some(rejected.as_str()));
        // A genuine local correction also unblocks the ordinary blur path.
        handle.prepare_activation(&replacement).unwrap();
        after_window_input(app.world_mut(), &handle).unwrap();
        apply_edit(app.world_mut(), entity, TextEdit::Insert("4".into())).unwrap();
        let committed = commit_active(app.world_mut(), &handle).unwrap().unwrap();
        assert_eq!(
            committed.control.input,
            ControlInput::SetValue("1234".into())
        );
        assert!(error(app.world(), entity).is_none());
    }
}
