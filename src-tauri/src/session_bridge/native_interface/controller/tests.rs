use super::super::tests::Fixture;
use super::*;
use std::fs;

fn prepare(fixture: &Fixture) -> (App, NativeInterfaceHandle, Entity) {
    let (mut app, handle, entity, _) = interface_shell::tests::fixture();
    let mut frame = handle.frame().unwrap();
    frame.context = fixture.owner();
    handle.present(frame).unwrap();
    app.update();
    app.insert_resource(NativeServices {
        engine: fixture.engine.clone(),
        bridge: fixture.bridge.clone(),
    });
    let mut controller = Controller::new("main".into(), None, Arc::new(AtomicBool::new(false)));
    controller.initialized = true;
    controller.initial_owner = Some(fixture.owner());
    controller.initial_revision = fixture
        .bridge
        .engine_revision_for_window("main")
        .unwrap()
        .unwrap();
    app.insert_resource(controller);
    (app, handle, entity)
}

fn pending(fixture: &Fixture, app: &mut App, id: &str) -> std::path::PathBuf {
    fixture
        .bridge
        .publish_native_document(&fixture.engine, &fixture.owner(), "solid")
        .unwrap();
    let session = fixture
        .bridge
        .session_id_for_window("main")
        .unwrap()
        .unwrap();
    let controls = crate::session_bridge::session_root()
        .join(&session)
        .join("controls");
    fs::create_dir_all(&controls).unwrap();
    fs::write(
        controls.join(format!("{id}.request.json")),
        json!({"id":id,"expires_ms":now_ms()+30_000,"ui":{"action":"inspect"}}).to_string(),
    )
    .unwrap();
    let request = control_for_window(&fixture.bridge, "main", &fixture.engine, None).unwrap();
    assert_eq!(request["id"], id);
    app.world_mut().resource_mut::<Controller>().pending = Some(PendingControl {
        response: json!({"request_id":id,"session_id":session,"status":"applied"}),
        owner: fixture.owner(),
        presentation_deadline: now_ms() + 2_000,
    });
    controls.join(format!("{id}.result.json"))
}

#[test]
fn visible_receipt_waits_for_scene_submission_and_hidden_or_suppressed_rendering_is_bounded() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let (mut app, handle, _) = prepare(&fixture);
    let mut availability = crate::native_viewport::winit_host::NativeRenderAvailability::default();
    availability.drawable = true;
    app.insert_resource(availability);
    // A previously submitted control layout does not prove a later camera or
    // model change was submitted, even when no control metadata changes.
    handle.submitted().unwrap();
    let old_revision = handle.render_receipt().unwrap().submitted_revision;
    let path = pending(&fixture, &mut app, "10-3");
    handle.invalidate_presentation();
    app.update();
    let target = handle.render_receipt().unwrap().laid_out_revision;
    assert!(target > old_revision);
    complete_control(app.world_mut());
    assert!(
        !path.exists(),
        "The old submitted scene cannot acknowledge this operation"
    );
    handle.submitted_revision(target).unwrap();
    complete_control(app.world_mut());
    let response: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(response["status"], "applied");
    assert_eq!(response["presented"], true);
    assert_eq!(response["render_status"], "submitted");

    let path = pending(&fixture, &mut app, "10-4");
    handle.invalidate_presentation();
    app.update();
    app.world_mut()
        .resource_mut::<Controller>()
        .pending
        .as_mut()
        .unwrap()
        .presentation_deadline = 0;
    complete_control(app.world_mut());
    let response: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(
        response["status"], "applied",
        "A suppressed renderer cannot undo a committed operation"
    );
    assert_eq!(response["presented"], false);
    assert_eq!(response["render_status"], "submission_timeout");

    let path = pending(&fixture, &mut app, "10-5");
    app.world_mut()
        .resource_mut::<crate::native_viewport::winit_host::NativeRenderAvailability>()
        .drawable = false;
    complete_control(app.world_mut());
    let response: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(response["presented"], false);
    assert_eq!(response["render_status"], "unavailable");
    assert!(app.world().resource::<Controller>().pending.is_none());
}

#[test]
fn mcp_receipt_waits_for_the_changed_native_frame_and_contains_its_actual_controls() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let (mut app, handle, entity) = prepare(&fixture);
    let path = pending(&fixture, &mut app, "10-1");
    app.world_mut()
        .get_mut::<InterfaceControl>(entity)
        .unwrap()
        .label = "Updated after command".into();
    let mut frame = handle.frame().unwrap();
    frame.surfaces[0].text = Some("Changed document state".into());
    handle.present(frame).unwrap();
    complete_control(app.world_mut());
    assert!(
        !path.exists(),
        "No acknowledgement from the old laid-out frame"
    );
    app.update();
    complete_control(app.world_mut());
    let response: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(response["status"], "applied");
    assert_eq!(
        response["ui"]["surfaces"][0]["controls"][0]["label"],
        "Updated after command"
    );
    assert!(response["native_layout_revision"].as_u64().unwrap() > 0);
    assert_eq!(
        response["presented"], false,
        "Semantic layout cannot certify GPU display"
    );
    assert!(app.world().resource::<Controller>().pending.is_none());
}

#[test]
fn delayed_receipt_cannot_inspect_or_invalidate_the_replacement_documents_controls() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let (mut app, handle, _) = prepare(&fixture);
    let path = pending(&fixture, &mut app, "10-2");
    fixture
        .bridge
        .apply_native_mutation(
            &fixture.engine,
            &fixture.owner(),
            "cad_new_project",
            &json!({}),
            || Ok(()),
        )
        .unwrap();
    let current = fixture.owner();
    let mut frame = handle.frame().unwrap();
    frame.context = current.clone();
    handle.present(frame).unwrap();
    app.update();
    let snapshot = handle.inspect().unwrap();
    let request = ControlRequest::Click {
        target: snapshot["surfaces"][0]["controls"][0]["id"]
            .as_str()
            .unwrap()
            .into(),
    };
    complete_control(app.world_mut());
    let response: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(response["status"], "failed");
    assert!(response.get("ui").is_none());
    assert!(
        handle.resolve(&request, &current).is_ok(),
        "Old receipt must leave fresh inspection IDs usable"
    );
}

#[test]
fn queued_command_checks_live_binding_before_a_later_layout_can_publish_the_rebind() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let (mut app, handle, entity) = prepare(&fixture);
    bind_command(
        app.world_mut(),
        entity,
        NativeCommand::Mutation {
            operation: "cad_set_document_name".into(),
            arguments: json!({"name":"Old command"}),
        },
    )
    .unwrap();
    app.update();
    let snapshot = handle.inspect().unwrap();
    let request = ControlRequest::Click {
        target: snapshot["surfaces"][0]["controls"][0]["id"]
            .as_str()
            .unwrap()
            .into(),
    };
    let action = handle.resolve(&request, &fixture.owner()).unwrap();
    bind_command(
        app.world_mut(),
        entity,
        NativeCommand::Mutation {
            operation: "cad_set_document_name".into(),
            arguments: json!({"name":"Rebound command"}),
        },
    )
    .unwrap();
    assert!(reduce_action(
        &fixture.engine,
        &fixture.bridge,
        app.world_mut(),
        &handle,
        &action
    )
    .unwrap_err()
    .contains("changed"));
    assert_eq!(fixture.engine.document_snapshot().name, "Untitled");
}

#[test]
fn close_guard_survives_same_tab_replacement_with_a_reset_revision() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let (mut app, _, _) = prepare(&fixture);
    fixture
        .bridge
        .apply_native_mutation(
            &fixture.engine,
            &fixture.owner(),
            "cad_new_project",
            &json!({}),
            || Ok(()),
        )
        .unwrap();
    let mut state = app.world_mut().resource_mut::<Controller>();
    request_close(&mut state, &fixture.bridge, &fixture.engine).unwrap();
    assert!(state.close_pending);
    assert!(!state.exit_after_receipt);
    apply_host_result(&mut state, &json!({"close_decision":"cancel"}));
    assert!(!state.close_pending);
    assert!(!state.exit_after_receipt);
}
