use super::*;
use crate::session_bridge::native_interface::tests::Fixture;

#[test]
fn finishing_an_existing_sketch_rebuilds_its_solid_without_duplicating_history() {
    use crate::native_editor::{execute, EditorCommand};
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let owner = fixture.owner();
    for (op, args) in [
        ("sketch_begin", json!({"type":"origin_plane","plane":"xy"})),
        (
            "sketch_add_circle",
            json!({"mode":"center_diameter","p1":{"x":5.,"y":5.},"p2":{"x":15.,"y":5.},"ctrl_held":true}),
        ),
        ("sketch_finish", json!({})),
        (
            "solid_extrude",
            json!({"sketch_name":"Sketch1","profile_indices":[0]}),
        ),
    ] {
        fixture
            .bridge
            .apply_native_mutation(&fixture.engine, &owner, op, &args, || Ok(()))
            .unwrap();
    }
    let original = fixture.engine.document_snapshot().features;
    let services = NativeServices {
        engine: fixture.engine.clone(),
        bridge: fixture.bridge.clone(),
    };
    let mut app = native_viewport::interface_scene_fixture();
    refresh_native_model(&fixture.engine, app.world_mut(), true).unwrap();
    worker::install(
        app.world_mut(),
        services.clone(),
        NativeInterfaceHandle::new(|| {}),
    )
    .unwrap();
    let drain = |world: &mut World| {
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        loop {
            if let Some(outcome) = worker::poll(world, &services) {
                let result = outcome.value.unwrap();
                assert!(result["model_error"].is_null(), "{result}");
                if !worker::busy(world) {
                    break;
                }
            }
            assert!(
                std::time::Instant::now() < deadline,
                "Native sketch replay timed out"
            );
            std::thread::sleep(Duration::from_millis(2));
        }
    };
    execute(
        app.world_mut(),
        &fixture.engine,
        &fixture.bridge,
        &owner,
        EditorCommand::Edit("Sketch1".into()),
        || Ok(()),
    )
    .unwrap();
    drain(app.world_mut());
    let active = crate::session_bridge::parse_engine_envelope(
        fixture.engine.engine_call("active_sketch", ""),
    )
    .unwrap();
    let entities = active["entities"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["id"].as_u64())
        .collect::<Vec<_>>();
    fixture
        .bridge
        .apply_native_mutation(
            &fixture.engine,
            &owner,
            "sketch_move_copy",
            &json!({"entity_ids":entities,"dx":25.,"dy":0.,"copy":false}),
            || Ok(()),
        )
        .unwrap();
    execute(
        app.world_mut(),
        &fixture.engine,
        &fixture.bridge,
        &owner,
        EditorCommand::Finish,
        || Ok(()),
    )
    .unwrap();
    drain(app.world_mut());
    assert_eq!(fixture.engine.document_snapshot().features, original);
    let min_x = fixture
        .engine
        .viewport_snapshot()
        .2
        .bodies
        .iter()
        .flat_map(|b| b.mesh.positions.chunks_exact(3).map(|p| p[0]))
        .fold(f32::INFINITY, f32::min);
    assert!(
        (min_x - 20.).abs() < 0.1,
        "Dependent solid was not moved with its sketch: {min_x}"
    );
}

#[test]
fn browser_visibility_preserves_other_targets_and_roundtrips_the_project() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let owner = fixture.owner();
    for (op, args) in [
        ("sketch_begin", json!({"type":"origin_plane","plane":"xy"})),
        (
            "sketch_add_rectangle",
            json!({"mode":"two_point","p1":{"x":0.,"y":0.},"p2":{"x":12.,"y":8.},"ctrl_held":false}),
        ),
        ("sketch_finish", json!({})),
    ] {
        fixture
            .bridge
            .apply_native_mutation(&fixture.engine, &owner, op, &args, || Ok(()))
            .unwrap();
    }
    let document = fixture.engine.document_snapshot();
    let mut flattened = vec![];
    rows(&document.browser, &HashSet::new(), 0, &mut flattened);
    let sketch = flattened
        .iter()
        .find(|(_, node)| node.kind == Kind::Sketch)
        .unwrap()
        .1;
    let name = sketch.name.as_ref().unwrap();
    let first = visibility_arguments(&fixture.engine, sketch).unwrap();
    assert_eq!(first["hidden_sketch_names"], json!([name]));
    fixture
        .bridge
        .apply_native_mutation(
            &fixture.engine,
            &owner,
            "project_set_visibility",
            &first,
            || Ok(()),
        )
        .unwrap();
    let second = visibility_arguments(&fixture.engine, sketch).unwrap();
    assert_eq!(second["hidden_sketch_names"], json!([]));
    assert_eq!(first["hidden_body_ids"], second["hidden_body_ids"]);
    assert_eq!(
        first["hidden_datum_plane_ids"],
        second["hidden_datum_plane_ids"]
    );
    let archive = crate::session_bridge::parse_engine_envelope(
        fixture.engine.engine_call("project_export_model", ""),
    )
    .unwrap();
    fixture
        .bridge
        .apply_native_mutation(
            &fixture.engine,
            &owner,
            "cad_load_project_model",
            &json!({"model_json":archive.as_str().unwrap()}),
            || Ok(()),
        )
        .unwrap();
    let restored = crate::session_bridge::parse_engine_envelope(
        fixture.engine.engine_call("project_visibility", ""),
    )
    .unwrap();
    assert_eq!(restored, first);
}

#[test]
fn collapsed_folders_never_expose_hidden_children_as_rows() {
    let parent = BrowserNode::new(nbcad_core::NodeId(2), Kind::SketchesFolder).with_children(vec![
        BrowserNode::new(nbcad_core::NodeId(3), Kind::Sketch).named("Profile"),
    ]);
    let nodes = [parent];
    let mut visible = vec![];
    rows(&nodes, &HashSet::from([2]), 0, &mut visible);
    assert_eq!(visible.len(), 1);
    visible.clear();
    rows(&nodes, &HashSet::new(), 0, &mut visible);
    assert_eq!(
        visible
            .iter()
            .map(|(depth, n)| (*depth, n.id.0))
            .collect::<Vec<_>>(),
        vec![(0, 2), (1, 3)]
    );
}
