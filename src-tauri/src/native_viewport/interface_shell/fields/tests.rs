use super::*;
use crate::native_viewport::interface_shell::tests::fixture;

fn editor_fixture() -> (App, NativeInterfaceHandle, Entity) {
    let (mut app, handle, entity, _) = fixture();
    app.add_plugins((
        MinimalPlugins,
        AssetPlugin::default(),
        bevy::text::TextPlugin,
    ))
    .init_resource::<EditorSession>();
    let value = "12".to_owned();
    let mut control = app.world_mut().get_mut::<InterfaceControl>(entity).unwrap();
    control.field = Field::Text {
        value: value.clone(),
        read_only: false,
        selection: None,
    };
    control.text_editing = true;
    control.role = "textbox".into();
    drop(control);
    app.world_mut().entity_mut(entity).insert((
        EditableText::new(&value),
        ComputedUiRenderTargetInfo::default(),
        NativeTextField {
            baseline: value,
            queued: None,
            binding: 1,
            theme: ViewportUiTheme::from_palette(&default()),
        },
    ));
    app.update();
    // Editing is layout based: use the production Bevy UI style adapter,
    // rather than an unstyled PlainEditor with no resolved font family.
    app.world_mut()
        .run_system_cached(bevy::ui::widget::update_editable_text_styles)
        .unwrap();
    let action = handle
        .resolve_retained(ControlKey(entity.to_bits()))
        .unwrap();
    handle.prepare_activation(&action).unwrap();
    after_window_input(app.world_mut(), &handle).unwrap();
    (app, handle, entity)
}

#[test]
fn a_direct_mcp_value_updates_the_visible_editor_and_is_not_reverted_on_blur() {
    let (mut app, handle, entity) = editor_fixture();
    let owner = handle.frame().unwrap().context;
    let action = handle
        .resolve_input(
            ControlKey(entity.to_bits()),
            ControlInput::SetValue("36 mm".into()),
            &owner,
        )
        .unwrap();
    assert!(prepare_control_input(app.world_mut(), &handle, &action)
        .unwrap()
        .is_empty());
    acknowledge_control_input(app.world_mut(), &action, true);
    assert_eq!(
        app.world()
            .get::<EditableText>(entity)
            .unwrap()
            .value()
            .to_string(),
        "36 mm"
    );
    assert!(commit_active(app.world_mut(), &handle).unwrap().is_none());
    handle.blur();
    after_window_input(app.world_mut(), &handle).unwrap();
    assert!(handle.take_actions().unwrap().is_empty());
}

#[test]
fn rejected_commit_stays_dirty_and_duplicate_queued_blur_is_not_accepted_early() {
    let (mut app, handle, entity) = editor_fixture();
    app.world_mut()
        .get_mut::<EditableText>(entity)
        .unwrap()
        .queue_edit(TextEdit::Insert("bad".into()));
    let commit = commit_active(app.world_mut(), &handle).unwrap().unwrap();
    assert_eq!(
        app.world().get::<NativeTextField>(entity).unwrap().baseline,
        "12"
    );
    assert!(commit_active(app.world_mut(), &handle).unwrap().is_none());
    acknowledge_control_input(app.world_mut(), &commit, false);
    let retry = commit_active(app.world_mut(), &handle).unwrap().unwrap();
    assert_eq!(retry.control.input, commit.control.input);
    acknowledge_control_input(app.world_mut(), &retry, true);
    assert!(commit_active(app.world_mut(), &handle).unwrap().is_none());
}

#[test]
fn unicode_editing_and_ime_commit_precede_enter_without_synthetic_keys() {
    let (mut app, handle, entity) = editor_fixture();
    let window = Entity::from_bits(900);
    let event = WindowEvent::Ime(Ime::Commit {
        window,
        value: "日本".into(),
    });
    assert!(
        before_window_input(app.world_mut(), &handle, &event, None, Modifiers::default()).unwrap()
    );
    let value = app
        .world()
        .get::<EditableText>(entity)
        .unwrap()
        .value()
        .to_string();
    assert_eq!(value, "12日本");
    app.world_mut()
        .get_mut::<EditableText>(entity)
        .unwrap()
        .queue_edit(TextEdit::Backspace);
    let commit = commit_active(app.world_mut(), &handle).unwrap().unwrap();
    assert_eq!(commit.control.input, ControlInput::SetValue("12日".into()));
}
