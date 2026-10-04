use super::super::*;
use super::*;
use crate::session_bridge::{native_interface::tests::Fixture, parse_engine_envelope};

fn export(f: &Fixture) -> serde_json::Value {
    parse_engine_envelope(f.engine.engine_call("project_export_model", "")).unwrap()
}
fn seed(f: &Fixture) {
    f.bridge
        .apply_native_mutation(
            &f.engine,
            &f.owner(),
            "drawing_set_document",
            &serde_json::to_value(document()).unwrap(),
            || Ok(()),
        )
        .unwrap();
}

#[test]
fn released_sheet_editor_commit_undo_redo_preserve_exact_release_history() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let f = Fixture::new();
    let mut saved = document();
    release(&mut saved);
    f.bridge
        .apply_native_mutation(
            &f.engine,
            &f.owner(),
            "drawing_set_document",
            &serde_json::to_value(&saved).unwrap(),
            || Ok(()),
        )
        .unwrap();
    let before = export(&f);
    let drawing = f.engine.drawing_snapshot();
    let receipt = f
        .bridge
        .native_document_receipt(&f.engine, &f.owner())
        .unwrap();
    let mut draft = Draft::new(&drawing, Selection::Sheet(7)).unwrap();
    edit(&mut draft, "/title_block/title", "Changed after release");
    let next = draft.apply(&drawing).unwrap();
    let mut expected = drawing.clone();
    expected.sheets[6].title_block.title = "Changed after release".into();
    expected.sheets[6].release.status = DrawingReleaseStatus::Draft;
    assert_eq!(next, expected);
    f.bridge
        .apply_native_mutation_at(
            &f.engine,
            &receipt.owner,
            receipt.revision,
            "drawing_set_document",
            &serde_json::to_value(&next).unwrap(),
            || Ok(()),
        )
        .unwrap();
    assert_eq!(f.engine.drawing_snapshot(), expected);
    let after = export(&f);
    assert_ne!(before, after);
    f.bridge
        .apply_native_history(&f.engine, &f.owner(), false, || Ok(()))
        .unwrap();
    assert_eq!(export(&f), before);
    assert_eq!(f.engine.drawing_snapshot(), drawing);
    f.bridge
        .apply_native_history(&f.engine, &f.owner(), true, || Ok(()))
        .unwrap();
    assert_eq!(export(&f), after);
    assert_eq!(f.engine.drawing_snapshot(), expected);
}

#[test]
fn drawing_editor_commits_use_existing_document_command_and_exact_history() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let f = Fixture::new();
    seed(&f);
    let before = export(&f);
    let receipt = f
        .bridge
        .native_document_receipt(&f.engine, &f.owner())
        .unwrap();
    let drawing = f.engine.drawing_snapshot();
    let mut draft = Draft::new(&drawing, Selection::Sheet(7)).unwrap();
    edit(&mut draft, "/title_block/title", "Native drawing title");
    let next = draft.apply(&drawing).unwrap();
    f.bridge
        .apply_native_mutation_at(
            &f.engine,
            &receipt.owner,
            receipt.revision,
            "drawing_set_document",
            &serde_json::to_value(&next).unwrap(),
            || Ok(()),
        )
        .unwrap();
    let after = export(&f);
    assert_ne!(before, after);
    assert_eq!(f.engine.drawing_snapshot(), next);
    f.bridge
        .apply_native_history(&f.engine, &f.owner(), false, || Ok(()))
        .unwrap();
    assert_eq!(export(&f), before);
    f.bridge
        .apply_native_history(&f.engine, &f.owner(), true, || Ok(()))
        .unwrap();
    assert_eq!(export(&f), after);
    let current = f
        .bridge
        .native_document_receipt(&f.engine, &f.owner())
        .unwrap();
    let mut invalid = next.clone();
    invalid.next_sheet_id = 0;
    assert!(
        f.bridge
            .apply_native_mutation_at(
                &f.engine,
                &current.owner,
                current.revision,
                "drawing_set_document",
                &serde_json::to_value(invalid).unwrap(),
                || Ok(()),
            )
            .is_err()
    );
    assert_eq!(export(&f), after);
    assert_eq!(
        f.bridge
            .native_document_receipt(&f.engine, &f.owner())
            .unwrap()
            .revision,
        current.revision
    );
    let error = f
        .bridge
        .apply_native_mutation_at(
            &f.engine,
            &current.owner,
            current.revision,
            "drawing_unregistered_operation",
            &json!({}),
            || Ok(()),
        )
        .unwrap_err();
    assert!(error.contains("unsupported inbox mutate"));
    assert_eq!(export(&f), after);
    assert_eq!(
        f.bridge
            .native_document_receipt(&f.engine, &f.owner())
            .unwrap()
            .revision,
        current.revision
    );
    assert!(
        f.bridge
            .apply_native_mutation_at(
                &f.engine,
                &receipt.owner,
                receipt.revision,
                "drawing_set_document",
                &serde_json::to_value(&drawing).unwrap(),
                || Ok(())
            )
            .is_err()
    );
    assert_eq!(export(&f), after);
    parse_engine_envelope(
        f.bridge
            .with_project_session_transition("main", &f.engine, || {
                f.engine.create_project_session("drawing-tab-b")
            }),
    )
    .unwrap();
    assert!(
        f.bridge
            .apply_native_mutation_at(
                &f.engine,
                &receipt.owner,
                receipt.revision,
                "drawing_set_document",
                &serde_json::to_value(&drawing).unwrap(),
                || Ok(())
            )
            .is_err()
    );
    assert!(f.engine.drawing_snapshot().sheets.is_empty());
}

#[test]
fn drawing_editor_panel_exposes_all_sheets_and_preserves_dirty_draft_until_history_refresh() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let f = Fixture::new();
    seed(&f);
    let before = export(&f);
    let services = NativeServices {
        engine: f.engine.clone(),
        bridge: f.bridge.clone(),
    };
    let mut app = native_viewport::interface_scene_fixture();
    let world = app.world_mut();
    world.init_resource::<Assets<Image>>();
    world.init_resource::<ViewportUiAssets>();
    world.insert_resource(Workbench {
        workspace: Workspace::Drawing,
        ..default()
    });
    let camera = world.spawn(InterfaceCamera).id();
    for height in [600., 860.] {
        synchronize(world, camera, &services, &f.owner(), height, 248., true).unwrap();
        let sheet = world
            .query::<&InterfaceControl>()
            .iter(world)
            .find(|c| c.label == "Sheet")
            .unwrap();
        let nbcad_interface::Field::Choice { options, value } = &sheet.field else {
            panic!("Sheet selector must expose all shared choices")
        };
        assert_eq!(options.len(), 8);
        assert_eq!(options[7].value, "8");
        assert_eq!(value, "1");
        assert_eq!(
            choose(
                options,
                value,
                &ControlInput::Key(nbcad_interface::KeyChord::plain("End"))
            )
            .unwrap(),
            "8"
        );
        assert!(
            world
                .query::<&InterfaceControl>()
                .iter(world)
                .any(|c| c.label == "Sheet name" && c.role == "textbox")
        );
    }
    assert_eq!(
        export(&f),
        before,
        "Painting forms must not write the drawing"
    );
    {
        let mut editor = world.resource_mut::<Editor>();
        edit(editor.draft.as_mut().unwrap(), "/name", "Unapplied text");
    }
    synchronize(world, camera, &services, &f.owner(), 860., 248., true).unwrap();
    assert!(world.resource::<Editor>().draft.as_ref().unwrap().dirty());
    for operation in [
        "drawing_create_sheet",
        "drawing_delete_sheet",
        "drawing_select_sheet",
        "drawing_add_view",
        "drawing_add_note",
    ] {
        assert!(
            guard_ribbon_edit(world, operation).is_err(),
            "Unapplied draft allowed {operation}"
        );
    }
    assert!(guard_ribbon_edit(world, "solid_extrude").is_ok());
    assert_eq!(export(&f), before);
    f.bridge
        .apply_native_history(&f.engine, &f.owner(), false, || Ok(()))
        .unwrap();
    synchronize(world, camera, &services, &f.owner(), 860., 248., true).unwrap();
    assert!(world.resource::<Editor>().draft.is_none());
    f.bridge
        .apply_native_history(&f.engine, &f.owner(), true, || Ok(()))
        .unwrap();
    synchronize(world, camera, &services, &f.owner(), 860., 248., true).unwrap();
    assert!(!world.resource::<Editor>().draft.as_ref().unwrap().dirty());
}
