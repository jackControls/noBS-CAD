use super::super::tests::Fixture;
use super::*;
use crate::native_viewport::{ViewportLineLayer, ViewportPresentation};

fn sketch(fixture: &Fixture) -> DocumentContext {
    let owner = fixture.owner();
    for (operation, arguments) in [
        ("sketch_begin", json!({"type":"origin_plane","plane":"xy"})),
        (
            "sketch_add_rectangle",
            json!({"mode":"two_point","p1":{"x":0.,"y":0.},"p2":{"x":20.,"y":12.},"ctrl_held":false}),
        ),
        ("sketch_finish", json!({})),
    ] {
        fixture
            .bridge
            .apply_native_mutation(&fixture.engine, &owner, operation, &arguments, || Ok(()))
            .unwrap();
    }
    owner
}

fn scene(fixture: &Fixture, owner: &DocumentContext) -> bevy::app::App {
    let mut app = native_viewport::interface_scene_fixture();
    native_viewport::apply_interface_model(app.world_mut(), model_snapshot(&fixture.engine))
        .unwrap();
    let presentation = ViewportPresentation {
        selected_profiles: vec![ProfileRefDto {
            sketch_name: "Sketch1".into(),
            profile_index: 0,
        }],
        ..Default::default()
    };
    native_viewport::apply_interface_view(
        app.world_mut(),
        &owner.document_id,
        None,
        Some(presentation),
    )
    .unwrap();
    app
}

fn exported(fixture: &Fixture) -> Value {
    let exported =
        parse_engine_envelope(fixture.engine.engine_call("project_export_model", "")).unwrap();
    serde_json::from_str(exported.as_str().unwrap()).unwrap()
}

fn open(
    fixture: &Fixture,
    world: &mut World,
    owner: &DocumentContext,
    feature_id: Option<u64>,
) -> u64 {
    reduce(
        &fixture.engine,
        &fixture.bridge,
        world,
        owner,
        &ExtrudeCommand::Open { feature_id },
        &ControlInput::Click,
        || Ok(()),
    )
    .unwrap()["form_id"]
        .as_u64()
        .unwrap()
}

fn action(
    fixture: &Fixture,
    world: &mut World,
    owner: &DocumentContext,
    form_id: u64,
    action: ExtrudeControl,
    input: ControlInput,
) -> Result<Value, String> {
    reduce(
        &fixture.engine,
        &fixture.bridge,
        world,
        owner,
        &ExtrudeCommand::Control { form_id, action },
        &input,
        || Ok(()),
    )
}

fn field(
    fixture: &Fixture,
    world: &mut World,
    owner: &DocumentContext,
    id: u64,
    field: ExtrudeField,
    value: &str,
) {
    action(
        fixture,
        world,
        owner,
        id,
        ExtrudeControl::Field(field),
        ControlInput::SetValue(value.into()),
    )
    .unwrap();
}

fn maximum_z(fixture: &Fixture) -> f32 {
    fixture
        .engine
        .viewport_snapshot()
        .2
        .bodies
        .iter()
        .flat_map(|body| body.mesh.positions.chunks_exact(3).map(|point| point[2]))
        .fold(f32::NEG_INFINITY, f32::max)
}

#[test]
fn actual_preview_and_invalid_fields_never_mutate_the_model_and_cancel_restores_prior_preview() {
    let _lock = super::super::super::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let owner = sketch(&fixture);
    let before = exported(&fixture);
    let mut app = scene(&fixture, &owner);
    let prior = ViewportPreview {
        lines: vec![ViewportLineLayer {
            color: [1., 0., 0., 1.],
            width: 2.,
            segments: vec![0., 0., 0., 2., 3., 4.],
            ..Default::default()
        }],
        ..Default::default()
    };
    native_viewport::apply_interface_preview(app.world_mut(), &owner.document_id, prior.clone())
        .unwrap();
    let id = open(&fixture, app.world_mut(), &owner, None);
    assert!(panel(app.world()).unwrap().can_apply);
    let visible = native_viewport::interface_preview_snapshot(app.world());
    assert!(
        visible.lines[0].segments.len() >= 72,
        "The actual renderer receives the source and extrusion outlines"
    );
    assert_eq!(exported(&fixture), before);
    field(
        &fixture,
        app.world_mut(),
        &owner,
        id,
        ExtrudeField::Distance,
        "2 + (",
    );
    let panel = panel(app.world()).unwrap();
    assert!(!panel.can_apply);
    let distance = panel
        .fields
        .iter()
        .find(|field| field.field == ExtrudeField::Distance)
        .unwrap();
    assert!(distance.error.is_some());
    assert!(matches!(&distance.value, nbcad_interface::Field::Text {value,..} if value == "2 + ("));
    assert!(native_viewport::interface_preview_snapshot(app.world())
        .lines
        .is_empty());
    assert!(action(
        &fixture,
        app.world_mut(),
        &owner,
        id,
        ExtrudeControl::Apply,
        ControlInput::Click
    )
    .is_err());
    assert_eq!(exported(&fixture), before);
    let cancelled = action(
        &fixture,
        app.world_mut(),
        &owner,
        id,
        ExtrudeControl::Cancel,
        ControlInput::Click,
    )
    .unwrap();
    assert_eq!(cancelled["preview_restored"], true);
    assert!(super::panel(app.world()).is_none());
    assert_eq!(
        native_viewport::interface_preview_snapshot(app.world()).lines[0].segments,
        prior.lines[0].segments
    );
    assert_eq!(exported(&fixture), before);
    let next = open(&fixture, app.world_mut(), &owner, None);
    assert_ne!(next, id);
    assert!(action(
        &fixture,
        app.world_mut(),
        &owner,
        id,
        ExtrudeControl::Apply,
        ControlInput::Click
    )
    .is_err());
    assert_eq!(exported(&fixture), before);
}

#[test]
fn native_apply_and_edit_recompute_the_real_parametric_extrusion_and_cancel_preserves_it() {
    let _lock = super::super::super::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let owner = sketch(&fixture);
    let mut app = scene(&fixture, &owner);
    let id = open(&fixture, app.world_mut(), &owner, None);
    field(
        &fixture,
        app.world_mut(),
        &owner,
        id,
        ExtrudeField::Distance,
        "=(2 + 3) * 5 mm",
    );
    let result = action(
        &fixture,
        app.world_mut(),
        &owner,
        id,
        ExtrudeControl::Apply,
        ControlInput::Click,
    )
    .unwrap();
    assert!(result["render_error"].is_null(), "{result}");
    assert!(result["form_error"].is_null(), "{result}");
    assert!(panel(app.world()).is_none());
    assert_eq!(fixture.engine.document_snapshot().features.len(), 2);
    assert_eq!(fixture.engine.viewport_snapshot().2.bodies.len(), 1);
    assert!((maximum_z(&fixture) - 25.).abs() < 1e-4);
    let feature_id = fixture
        .engine
        .document_snapshot()
        .features
        .last()
        .unwrap()
        .id
        .0;
    let before = exported(&fixture);
    let edit_id = open(&fixture, app.world_mut(), &owner, Some(feature_id));
    field(
        &fixture,
        app.world_mut(),
        &owner,
        edit_id,
        ExtrudeField::Distance,
        "35 mm",
    );
    assert_eq!(
        exported(&fixture),
        before,
        "An edit preview must not stage changes in the live history"
    );
    action(
        &fixture,
        app.world_mut(),
        &owner,
        edit_id,
        ExtrudeControl::Cancel,
        ControlInput::Click,
    )
    .unwrap();
    assert_eq!(exported(&fixture), before);
    let edit_id = open(&fixture, app.world_mut(), &owner, Some(feature_id));
    field(
        &fixture,
        app.world_mut(),
        &owner,
        edit_id,
        ExtrudeField::Distance,
        "35 mm",
    );
    let result = action(
        &fixture,
        app.world_mut(),
        &owner,
        edit_id,
        ExtrudeControl::Apply,
        ControlInput::Click,
    )
    .unwrap();
    assert_eq!(result["operation"], "solid_edit_extrude");
    assert!(result["render_error"].is_null(), "{result}");
    assert_eq!(fixture.engine.document_snapshot().features.len(), 2);
    assert_eq!(
        fixture
            .engine
            .document_snapshot()
            .features
            .last()
            .unwrap()
            .id
            .0,
        feature_id
    );
    assert!((maximum_z(&fixture) - 35.).abs() < 1e-4);
    assert_ne!(exported(&fixture), before);
    assert!(fixture.engine.viewport_snapshot().2.errors.is_empty());
}

#[test]
fn stale_owner_revision_and_cancelled_activation_cannot_commit_or_repaint_old_work() {
    let _lock = super::super::super::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let owner = sketch(&fixture);
    let mut app = scene(&fixture, &owner);
    let id = open(&fixture, app.world_mut(), &owner, None);
    let before = exported(&fixture);
    let rejected = reduce(
        &fixture.engine,
        &fixture.bridge,
        app.world_mut(),
        &owner,
        &ExtrudeCommand::Control {
            form_id: id,
            action: ExtrudeControl::Apply,
        },
        &ControlInput::Click,
        || Err("Control binding changed".into()),
    );
    assert!(rejected.is_err());
    assert_eq!(exported(&fixture), before);
    assert!(
        panel(app.world()).unwrap().can_apply,
        "Unchanged failed Apply retains a corrected, retryable draft"
    );
    fixture.rename(&owner, "External edit").unwrap();
    let changed = exported(&fixture);
    assert!(action(
        &fixture,
        app.world_mut(),
        &owner,
        id,
        ExtrudeControl::Apply,
        ControlInput::Click
    )
    .is_err());
    assert_eq!(exported(&fixture), changed);
    native_viewport::apply_interface_model(app.world_mut(), model_snapshot(&fixture.engine))
        .unwrap();
    synchronize(&fixture.engine, &fixture.bridge, app.world_mut(), &owner).unwrap();
    assert!(panel(app.world()).is_none());
    assert!(native_viewport::interface_preview_snapshot(app.world())
        .lines
        .is_empty());
    let id = open(&fixture, app.world_mut(), &owner, None);
    let replacement = fixture
        .bridge
        .apply_native_mutation(
            &fixture.engine,
            &owner,
            "cad_new_project",
            &json!({}),
            || Ok(()),
        )
        .unwrap();
    native_viewport::apply_interface_model(app.world_mut(), model_snapshot(&fixture.engine))
        .unwrap();
    synchronize(
        &fixture.engine,
        &fixture.bridge,
        app.world_mut(),
        &replacement.context,
    )
    .unwrap();
    assert!(panel(app.world()).is_none());
    assert!(action(
        &fixture,
        app.world_mut(),
        &owner,
        id,
        ExtrudeControl::Cancel,
        ControlInput::Click
    )
    .is_err());
    assert!(fixture.engine.document_snapshot().features.is_empty());
}

#[test]
fn focused_escape_closes_its_form_without_overwriting_a_newer_preview() {
    let _lock = super::super::super::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let owner = sketch(&fixture);
    let before = exported(&fixture);
    let mut app = scene(&fixture, &owner);
    let id = open(&fixture, app.world_mut(), &owner, None);
    let newer = ViewportPreview {
        lines: vec![ViewportLineLayer {
            color: [0., 1., 0., 1.],
            width: 2.,
            segments: vec![4., 5., 6., 7., 8., 9.],
            ..Default::default()
        }],
        ..Default::default()
    };
    native_viewport::apply_interface_preview(app.world_mut(), &owner.document_id, newer.clone())
        .unwrap();
    let cancelled = action(
        &fixture,
        app.world_mut(),
        &owner,
        id,
        ExtrudeControl::Field(ExtrudeField::Distance),
        ControlInput::Key(nbcad_interface::KeyChord::plain("Escape")),
    )
    .unwrap();
    assert_eq!(cancelled["cancelled"], true);
    assert_eq!(cancelled["preview_restored"], false);
    assert!(panel(app.world()).is_none());
    assert_eq!(
        native_viewport::interface_preview_snapshot(app.world()).lines[0].segments,
        newer.lines[0].segments
    );
    assert_eq!(exported(&fixture), before);
}

#[test]
fn native_apply_enqueues_once_and_completes_the_original_form_with_real_geometry() {
    use crate::native_viewport::interface_shell::NativeInterfaceHandle;
    use crate::session_bridge::native_interface::controller::{worker, NativeServices};
    let _lock = super::super::super::tests::TEST_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let owner = sketch(&fixture);
    let mut app = scene(&fixture, &owner);
    let services = NativeServices {
        engine: fixture.engine.clone(),
        bridge: fixture.bridge.clone(),
    };
    worker::install(
        app.world_mut(),
        services.clone(),
        NativeInterfaceHandle::new(|| {}),
    )
    .unwrap();
    let id = open(&fixture, app.world_mut(), &owner, None);
    field(
        &fixture,
        app.world_mut(),
        &owner,
        id,
        ExtrudeField::Distance,
        "25 mm",
    );
    let pending = action(
        &fixture,
        app.world_mut(),
        &owner,
        id,
        ExtrudeControl::Apply,
        ControlInput::Click,
    )
    .unwrap();
    assert_eq!(pending["mutation_pending"], true);
    assert!(worker::busy(app.world()));
    assert!(panel(app.world()).unwrap().busy);
    assert!(!panel(app.world()).unwrap().can_apply);
    assert!(action(
        &fixture,
        app.world_mut(),
        &owner,
        id,
        ExtrudeControl::Apply,
        ControlInput::Click
    )
    .unwrap_err()
    .contains("still applying"));
    // Pending work does not own the Bevy world. Cached presentation remains
    // mutable while the engine thread recomputes, with no model lock here.
    let (_, mut camera, _, _) = native_viewport::interface_view_snapshot(app.world());
    camera.position[0] += 5.;
    native_viewport::apply_interface_view(app.world_mut(), &owner.document_id, Some(camera), None)
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    let outcome = loop {
        if let Some(outcome) = worker::poll(app.world_mut(), &services) {
            break outcome;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "Native extrusion worker did not complete"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    };
    let completed = outcome.value.unwrap();
    assert_eq!(completed["operation"], "solid_extrude");
    assert!(completed["render_error"].is_null(), "{completed}");
    assert!(!worker::busy(app.world()));
    assert!(panel(app.world()).is_none());
    assert_eq!(fixture.engine.document_snapshot().features.len(), 2);
    assert_eq!(fixture.engine.viewport_snapshot().2.bodies.len(), 1);
    assert!((maximum_z(&fixture) - 25.).abs() < 1e-4);
}
