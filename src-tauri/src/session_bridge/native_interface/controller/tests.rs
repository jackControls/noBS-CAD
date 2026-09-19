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

#[test]
fn blocked_kernel_keeps_native_update_and_busy_replies_responsive_without_replaying_input() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let (mut app, handle, entity) = prepare(&fixture);
    app.init_resource::<Messages<NativeHostInput>>();
    let services = app.world().resource::<NativeServices>().clone();
    worker::install(app.world_mut(), services.clone(), handle.clone()).unwrap();
    let receipt = fixture
        .bridge
        .native_document_receipt(&fixture.engine, &fixture.owner())
        .unwrap();
    let pending_path = pending(&fixture, &mut app, "20-1");
    let session = fixture
        .bridge
        .session_id_for_window("main")
        .unwrap()
        .unwrap();
    app.world_mut().resource_mut::<Controller>().cached_session = Some(session.clone());
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let timed_out = Arc::new(AtomicBool::new(false));
    let timeout_flag = timed_out.clone();
    worker::enqueue_transaction(
        app.world_mut(),
        "cad_set_document_name".into(),
        move |services, guard| {
            services.bridge.apply_native_mutation_at(
                &services.engine,
                &receipt.owner,
                receipt.revision,
                "cad_set_document_name",
                &json!({"name":"Built without blocking the window"}),
                || {
                    guard.validate()?;
                    started_tx.send(()).unwrap();
                    if release_rx.recv_timeout(Duration::from_secs(5)).is_err() {
                        timeout_flag.store(true, Ordering::Release);
                        return Err("Native update waited on the blocked kernel".into());
                    }
                    Ok(())
                },
            )
        },
        |_, _, result| Ok(result?.value),
    )
    .unwrap();
    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(matches!(
        fixture.bridge.publishers.try_lock(),
        Err(std::sync::TryLockError::WouldBlock)
    ));
    let controls = crate::session_bridge::session_root()
        .join(&session)
        .join("controls");
    fs::write(
        controls.join("20-2.request.json"),
        json!({"id":"20-2","expires_ms":now_ms()+30_000,"ui":{"action":"inspect"}}).to_string(),
    )
    .unwrap();
    app.world_mut().write_message(NativeHostInput {
        context: handle.frame().map(|frame| frame.context),
        cursor: None,
        modifiers: crate::native_viewport::winit_host::Modifiers::default(),
        event: WindowEvent::WindowCloseRequested(bevy::window::WindowCloseRequested {
            window: Entity::PLACEHOLDER,
        }),
        consumed: false,
        actions: vec![],
    });
    app.world_mut()
        .resource_scope(|world, mut state: Mut<Controller>| {
            update_inner(world, &handle, &services, &mut state).unwrap();
            assert!(state.close_after_worker);
            assert!(!state.exit_after_receipt);
        });
    complete_control(app.world_mut());
    assert!(
        !timed_out.load(Ordering::Acquire),
        "Rendering must not wait for the engine/publisher fence"
    );
    assert!(
        app.world()
            .get::<InterfaceControl>(entity)
            .unwrap()
            .disabled
    );
    assert!(
        !pending_path.exists(),
        "The in-flight MCP request must wait for its real result"
    );
    assert!(controls.join("20-1.request.json").exists());
    let rejected: Value =
        serde_json::from_str(&fs::read_to_string(controls.join("20-2.result.json")).unwrap())
            .unwrap();
    assert_eq!(rejected["code"], "native_busy");
    assert_eq!(rejected["mutation_applied"], false);
    assert!(!controls.join("20-2.request.json").exists());
    release_tx.send(()).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(outcome) = worker::poll(app.world_mut(), &services) {
            outcome.value.unwrap();
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(
        fixture.engine.document_snapshot().name,
        "Built without blocking the window"
    );
}

#[test]
fn worker_revalidates_a_queued_control_after_waiting_for_the_owner_fence() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let (mut app, handle, entity) = prepare(&fixture);
    let services = app.world().resource::<NativeServices>().clone();
    worker::install(app.world_mut(), services.clone(), handle.clone()).unwrap();
    let receipt = fixture
        .bridge
        .native_document_receipt(&fixture.engine, &fixture.owner())
        .unwrap();
    bind_command(
        app.world_mut(),
        entity,
        NativeCommand::Mutation {
            operation: "cad_set_document_name".into(),
            arguments: json!({"name":"Old target"}),
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
    app.world_mut()
        .insert_resource(worker::ActiveControl(action));
    let held = fixture.bridge.publishers.lock().unwrap();
    worker::enqueue_operation(
        app.world_mut(),
        receipt.owner.clone(),
        receipt.revision,
        "cad_set_document_name".into(),
        json!({"name":"Old target"}),
        |_, _, result| Ok(result?.value),
    )
    .unwrap();
    app.world_mut().remove_resource::<worker::ActiveControl>();
    bind_command(
        app.world_mut(),
        entity,
        NativeCommand::Mutation {
            operation: "cad_set_document_name".into(),
            arguments: json!({"name":"New target"}),
        },
    )
    .unwrap();
    app.update();
    drop(held);
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let error = loop {
        if let Some(outcome) = worker::poll(app.world_mut(), &services) {
            break outcome.value.unwrap_err();
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    };
    assert!(error.contains("changed"), "{error}");
    assert_eq!(fixture.engine.document_snapshot().name, "Untitled");
    assert_eq!(
        fixture
            .bridge
            .native_document_receipt(&fixture.engine, &fixture.owner())
            .unwrap(),
        receipt
    );
}
