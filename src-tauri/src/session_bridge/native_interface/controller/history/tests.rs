use super::*;
use crate::session_bridge::native_interface::tests::Fixture;

fn solid(fixture: &Fixture) -> DocumentContext {
    let owner = fixture.owner();
    for (op, args) in [
        ("sketch_begin", json!({"type":"origin_plane","plane":"xy"})),
        (
            "sketch_add_rectangle",
            json!({"mode":"two_point","p1":{"x":0.,"y":0.},"p2":{"x":12.,"y":8.},"ctrl_held":false}),
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
    owner
}
fn drain(world: &mut World, services: &NativeServices) -> Result<Value, String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(outcome) = worker::poll(world, services) {
            return outcome.value;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "History worker timed out"
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}
#[test]
fn rollback_retains_features_and_delete_is_undoable_with_exact_owner_and_revision() {
    let _lock = crate::session_bridge::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let owner = solid(&fixture);
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
    for index in [0, original.len()] {
        let receipt = fixture
            .bridge
            .native_document_receipt(&fixture.engine, &owner)
            .unwrap();
        mutation(
            app.world_mut(),
            receipt,
            "solid_set_rollback",
            json!({"rollback_index":index}),
        )
        .unwrap();
        drain(app.world_mut(), &services).unwrap();
        assert_eq!(fixture.engine.document_snapshot().features, original);
        assert_eq!(fixture.engine.document_snapshot().rollback_index, index);
        assert_eq!(
            fixture.engine.viewport_snapshot().2.bodies.len(),
            usize::from(index > 0)
        );
    }
    let stale = fixture
        .bridge
        .native_document_receipt(&fixture.engine, &owner)
        .unwrap();
    fixture.rename(&owner, "Changed while menu open").unwrap();
    mutation(
        app.world_mut(),
        stale,
        "solid_delete_feature",
        json!({"feature_id":original[1].id.0}),
    )
    .unwrap();
    assert!(drain(app.world_mut(), &services).is_err());
    assert_eq!(fixture.engine.document_snapshot().features, original);
    let receipt = fixture
        .bridge
        .native_document_receipt(&fixture.engine, &owner)
        .unwrap();
    mutation(
        app.world_mut(),
        receipt,
        "solid_delete_feature",
        json!({"feature_id":original[1].id.0}),
    )
    .unwrap();
    drain(app.world_mut(), &services).unwrap();
    assert_eq!(fixture.engine.document_snapshot().features.len(), 1);
    assert!(fixture.engine.viewport_snapshot().2.bodies.is_empty());
    fixture
        .bridge
        .apply_native_history(&fixture.engine, &owner, false, || Ok(()))
        .unwrap();
    assert_eq!(fixture.engine.document_snapshot().features, original);
    assert_eq!(fixture.engine.viewport_snapshot().2.bodies.len(), 1);
    let restored = fixture.owner();
    assert_ne!(
        owner, restored,
        "Undo must retire stale controls and in-flight owners"
    );
    fixture
        .bridge
        .apply_native_history(&fixture.engine, &restored, true, || Ok(()))
        .unwrap();
    assert_eq!(fixture.engine.document_snapshot().features.len(), 1);
    let redone = fixture.owner();
    fixture
        .bridge
        .apply_native_history(&fixture.engine, &redone, false, || Ok(()))
        .unwrap();
    assert_eq!(fixture.engine.document_snapshot().features, original);
}
