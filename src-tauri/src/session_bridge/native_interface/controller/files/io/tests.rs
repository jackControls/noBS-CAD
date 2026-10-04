use super::super::tests::{drain, path, setup};
use super::*;
use crate::session_bridge::native_interface::tests::Fixture;

fn solid(fixture: &Fixture) {
    for (operation, arguments) in [
        (
            "sketch_begin",
            json!({"plane":{"type":"origin_plane","plane":"xy"}}),
        ),
        (
            "sketch_add_rectangle",
            json!({"mode":"two_point","p1":{"x":0.,"y":0.},"p2":{"x":40.,"y":25.},"ctrl_held":true}),
        ),
        ("sketch_finish", json!({})),
        (
            "solid_extrude",
            json!({"sketch_name":"Sketch1","profile_indices":[0],"extent":{"type":"distance","distance":6.}}),
        ),
    ] {
        fixture
            .bridge
            .apply_native_mutation(
                &fixture.engine,
                &fixture.owner(),
                operation,
                &arguments,
                || Ok(()),
            )
            .unwrap();
    }
}
fn model(fixture: &Fixture) -> Value {
    parse_engine_envelope(fixture.engine.engine_call("project_export_model", "")).unwrap()
}

#[test]
fn exchange_exports_and_embedded_step_import_preserve_project_destination_and_undo() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    solid(&fixture);
    let (mut app, services, handle) = setup(&fixture);
    refresh_native_model(&fixture.engine, app.world_mut(), true).unwrap();
    let project = path("exchange-project.nbcad");
    request(
        app.world_mut(),
        &handle,
        &services,
        &fixture.owner(),
        &json!({"command":"save","path":project}),
    )
    .unwrap();
    drain(app.world_mut(), &services).unwrap();
    let before = model(&fixture);
    let receipt = current(app.world(), &services, &fixture.owner()).unwrap();
    for format in [Format::Step, Format::ThreeMf, Format::Stl] {
        let mut intent = capture(app.world(), &services, &receipt, format, false).unwrap();
        intent.scope = MeshExportScope::Definition;
        let destination = path(&format!("exchange.{}", format.extension()));
        export(
            app.world_mut(),
            receipt.clone(),
            intent,
            destination.clone(),
            false,
        )
        .unwrap();
        assert_eq!(drain(app.world_mut(), &services).unwrap()["exported"], true);
        let bytes = std::fs::read(destination).unwrap();
        match format {
            Format::Step => assert!(bytes.starts_with(b"ISO-10303-21")),
            Format::ThreeMf => assert!(bytes.starts_with(b"PK")),
            Format::Stl => assert!(bytes.len() > 84),
        }
        assert_eq!(model(&fixture), before);
        assert_eq!(
            current(app.world(), &services, &fixture.owner()).unwrap(),
            receipt
        );
        let tab = tabs(app.world(), &services, &fixture.owner())
            .unwrap()
            .remove(0);
        assert_eq!(tab.path, Some(project.clone()));
        assert!(!tab.dirty);
    }
    import(app.world_mut(), receipt, path("exchange.step")).unwrap();
    drain(app.world_mut(), &services).unwrap();
    let imported = model(&fixture);
    assert_ne!(imported, before);
    assert_eq!(fixture.engine.viewport_snapshot().2.bodies.len(), 2);
    let definitions: Value =
        parse_engine_envelope(fixture.engine.engine_call("body_feature_definitions", "")).unwrap();
    let source = definitions
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["type"] == "import_step")
        .unwrap();
    assert_eq!(source["file_name"], "exchange.step");
    assert_eq!(
        STANDARD
            .decode(source["data_base64"].as_str().unwrap())
            .unwrap(),
        std::fs::read(path("exchange.step")).unwrap()
    );
    assert_eq!(
        native_viewport::interface_view_snapshot(app.world())
            .2
            .selected_body_ids,
        vec![2]
    );
    let tab = tabs(app.world(), &services, &fixture.owner())
        .unwrap()
        .remove(0);
    assert_eq!(tab.path, Some(project));
    assert!(tab.dirty);
    fixture
        .bridge
        .apply_native_history(&fixture.engine, &fixture.owner(), false, || Ok(()))
        .unwrap();
    assert_eq!(model(&fixture), before);
    fixture
        .bridge
        .apply_native_history(&fixture.engine, &fixture.owner(), true, || Ok(()))
        .unwrap();
    assert_eq!(model(&fixture), imported);
}

#[test]
fn exchange_receipts_reject_changes_and_picker_cancellation_never_writes() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    solid(&fixture);
    let (mut app, services, _) = setup(&fixture);
    refresh_native_model(&fixture.engine, app.world_mut(), true).unwrap();
    let receipt = current(app.world(), &services, &fixture.owner()).unwrap();
    let intent = capture(app.world(), &services, &receipt, Format::Step, false).unwrap();
    for kind in [PickerKind::ImportStep, PickerKind::Export(intent.clone())] {
        let (send, receive) = mpsc::channel();
        app.world_mut().resource_mut::<Files>().picker = Some(Picker {
            receipt: receipt.clone(),
            kind,
            result: Mutex::new(receive),
        });
        send.send(None).unwrap();
        poll(app.world_mut(), &services).unwrap();
        assert!(!awaiting(app.world()));
        assert!(!worker::busy(app.world()));
    }
    fixture.rename(&fixture.owner(), "Newer model").unwrap();
    let current_model = model(&fixture);
    let destination = path("obsolete.step");
    export(
        app.world_mut(),
        receipt.clone(),
        intent,
        destination.clone(),
        false,
    )
    .unwrap();
    assert!(drain(app.world_mut(), &services)
        .unwrap_err()
        .contains("document changed"));
    assert!(!destination.exists());
    import(app.world_mut(), receipt, destination).unwrap();
    assert!(drain(app.world_mut(), &services)
        .unwrap_err()
        .contains("document changed"));
    assert_eq!(model(&fixture), current_model);
    let receipt = current(app.world(), &services, &fixture.owner()).unwrap();
    assert!(import(
        app.world_mut(),
        receipt.clone(),
        PathBuf::from("relative.step")
    )
    .is_err());
    let intent = capture(app.world(), &services, &receipt, Format::Step, false).unwrap();
    let existing = path("existing.step");
    std::fs::write(&existing, b"Keep these bytes").unwrap();
    export(
        app.world_mut(),
        receipt.clone(),
        intent,
        existing.clone(),
        false,
    )
    .unwrap();
    assert!(drain(app.world_mut(), &services).is_err());
    assert_eq!(std::fs::read(existing).unwrap(), b"Keep these bytes");
    let invalid = path("invalid.step");
    std::fs::write(&invalid, b"not a STEP file").unwrap();
    import(app.world_mut(), receipt, invalid).unwrap();
    assert!(drain(app.world_mut(), &services).is_err());
    assert_eq!(model(&fixture), current_model);
}

#[test]
fn selected_step_retains_occurrence_and_mesh_scope_retains_repeats() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    solid(&fixture);
    let solution: nbcad_sketch::AssemblySolutionDto = serde_json::from_value(
        parse_engine_envelope(fixture.engine.engine_call("assembly_solution", "")).unwrap(),
    )
    .unwrap();
    let occurrence = solution.instance_body_poses[0].occurrence_id.0;
    fixture
        .bridge
        .apply_native_mutation(
            &fixture.engine,
            &fixture.owner(),
            "assembly_duplicate_occurrence",
            &json!({"occurrence_id":occurrence}),
            || Ok(()),
        )
        .unwrap();
    let (mut app, services, _) = setup(&fixture);
    refresh_native_model(&fixture.engine, app.world_mut(), true).unwrap();
    let (_, _, mut view, _) = native_viewport::interface_view_snapshot(app.world());
    view.selected_body_ids = vec![1];
    view.selected_occurrence_id = Some(occurrence);
    native_viewport::apply_interface_view(
        app.world_mut(),
        &fixture.owner().document_id,
        None,
        Some(view),
    )
    .unwrap();
    let receipt = current(app.world(), &services, &fixture.owner()).unwrap();
    let selected = capture(app.world(), &services, &receipt, Format::Step, true).unwrap();
    let all = capture(app.world(), &services, &receipt, Format::Step, false).unwrap();
    assert_eq!(
        step_request(
            &fixture.engine,
            &selected,
            model(&fixture).as_str().unwrap().into()
        )
        .unwrap()
        .occurrences
        .iter()
        .map(|p| p.occurrence_id)
        .collect::<Vec<_>>(),
        vec![occurrence]
    );
    assert_eq!(
        step_request(
            &fixture.engine,
            &all,
            model(&fixture).as_str().unwrap().into()
        )
        .unwrap()
        .occurrences
        .len(),
        2
    );
    let mut lengths = Vec::new();
    for scope in [MeshExportScope::Definition, MeshExportScope::Assembly] {
        let mut intent = capture(app.world(), &services, &receipt, Format::Stl, true).unwrap();
        intent.scope = scope;
        let file = path(if scope == MeshExportScope::Assembly {
            "placed.stl"
        } else {
            "definition.stl"
        });
        export(
            app.world_mut(),
            receipt.clone(),
            intent,
            file.clone(),
            false,
        )
        .unwrap();
        drain(app.world_mut(), &services).unwrap();
        lengths.push(std::fs::metadata(file).unwrap().len() - 84);
    }
    assert_eq!(lengths[1], 2 * lengths[0]);
}
