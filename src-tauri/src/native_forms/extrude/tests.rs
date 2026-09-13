use super::*;
use nbcad_core::{Document, FaceId, Feature, UnitSystem};

struct Fixture {
    owner: DocumentContext,
    document: DocumentDto,
    profiles: Vec<ProfileCatalogItemDto>,
    scene: SolidSceneDto,
}
impl Fixture {
    fn new() -> Self {
        let basis = json!({"origin":[0.,0.,0.],"u":[1.,0.,0.],"v":[0.,1.,0.],"normal":[0.,0.,1.]});
        Self {
            owner:DocumentContext {window_id:"main".into(),document_id:"tab-a".into(),epoch:3},
            document:DocumentDto::from(&Document::new("Form test")),
            profiles:serde_json::from_value(json!([{"sketch_name":"Sketch1","feature_id":1,"basis":basis,
                "profiles":[{"index":0,"points":[{"x":0.,"y":0.},{"x":10.,"y":0.},{"x":10.,"y":10.},{"x":0.,"y":10.}],"area":100.,"nesting_depth":0},
                {"index":1,"points":[],"area":1.,"nesting_depth":1,"parent_index":0}]}])).unwrap(),
            scene:serde_json::from_value(json!({"bodies":[{"id":1,"name":"Base","feature_id":2,"mesh":{"positions":[],"normals":[],"indices":[]},"edges":[],
                "faces":[{"id":11,"key":"bottom","first_index":0,"index_count":0,"plane":basis},{"id":12,"key":"top","first_index":0,"index_count":0,"plane":{"origin":[0.,0.,10.],"u":[1.,0.,0.],"v":[0.,1.,0.],"normal":[0.,0.,1.]}}]}],"errors":[]})).unwrap(),
        }
    }
    fn model(&self) -> FormModel<'_> {
        FormModel {
            owner: &self.owner,
            engine_revision: 7,
            document: &self.document,
            profiles: &self.profiles,
            scene: &self.scene,
            parameters: &[],
        }
    }
    fn form(&self) -> ExtrudeForm {
        let model = self.model();
        let mut form = ExtrudeForm::new(&model);
        form.set_source(
            ExtrudeSource::Profiles {
                sketch_name: "Sketch1".into(),
                indices: vec![0],
            },
            &model,
        )
        .unwrap();
        form
    }
}

#[test]
fn typed_measurements_and_field_errors_drive_the_actual_canonical_request() {
    let mut fixture = Fixture::new();
    fixture.document.settings.units = UnitSystem::In;
    let model = fixture.model();
    let mut form = fixture.form();
    assert!(form.can_apply(&model));
    form.set_value(ExtrudeField::Distance, "=1/4 in", &model)
        .unwrap();
    form.set_value(ExtrudeField::Taper, "=sin(30)*10 deg", &model)
        .unwrap();
    let preview = form.prepare_preview(&model).unwrap();
    assert_eq!(
        preview.request().extent,
        ExtrudeExtent::Distance { distance: 6.35 }
    );
    assert!((preview.request().taper_angle_deg - 5.).abs() < 1e-12);
    form.set_value(ExtrudeField::Distance, "1/0", &model)
        .unwrap();
    assert!(!form.can_apply(&model));
    assert!(form.prepare_apply(&model).is_err());
    let fields = form.fields(&model);
    let distance = fields
        .iter()
        .find(|field| field.field == ExtrudeField::Distance)
        .unwrap();
    assert_eq!(distance.label, "Distance (in)");
    assert!(distance
        .error
        .as_ref()
        .unwrap()
        .contains("division by zero"));
    assert!(matches!(&distance.value,Field::Text{value,..} if value=="1/0"));
    assert!(!form.accepts_preview(&preview, &model));
}

#[test]
fn stop_face_and_target_picks_never_overwrite_the_accepted_source() {
    let fixture = Fixture::new();
    let model = fixture.model();
    let mut form = ExtrudeForm::new(&model);
    let source = PlanarFaceSourceDto {
        body_id: BodyId(1),
        face_id: FaceId(11),
    };
    let stop = PlanarFaceSourceDto {
        body_id: BodyId(1),
        face_id: FaceId(12),
    };
    form.set_source(ExtrudeSource::Face(source), &model)
        .unwrap();
    form.set_value(ExtrudeField::Extent, "to_face", &model)
        .unwrap();
    form.set_stop_face(Some(stop), &model).unwrap();
    form.set_targets(vec![BodyId(1)], &model).unwrap();
    let ticket = form.prepare_apply(&model).unwrap();
    assert_eq!(ticket.operation(), "solid_extrude");
    let request: ExtrudeRequest = serde_json::from_value(ticket.arguments().clone()).unwrap();
    assert_eq!(request.source_face, Some(source));
    assert_eq!(
        request.extent,
        ExtrudeExtent::ToFace {
            face_id: stop.face_id
        }
    );
    assert_eq!(request.operation, ExtrudeOperation::Join);
    assert_eq!(request.target_body_ids, vec![BodyId(1)]);
    assert!(request.sketch_name.is_empty() && request.profile_indices.is_empty());
}

#[test]
fn stop_face_feedback_matches_the_kernel_parallel_and_nonzero_extent_contract() {
    let mut fixture = Fixture::new();
    let stop = PlanarFaceSourceDto {
        body_id: BodyId(1),
        face_id: FaceId(12),
    };
    fixture.scene.bodies[0].faces[1]
        .plane
        .as_mut()
        .unwrap()
        .normal = [0., 1., 0.];
    let model = fixture.model();
    let mut form = fixture.form();
    form.set_value(ExtrudeField::Extent, "to_face", &model)
        .unwrap();
    form.set_stop_face(Some(stop), &model).unwrap();
    assert!(!form.can_apply(&model));
    assert!(form
        .fields(&model)
        .into_iter()
        .find(|field| field.field == ExtrudeField::StopFace)
        .unwrap()
        .error
        .unwrap()
        .contains("parallel"));
    fixture.scene.bodies[0].faces[1].plane = fixture.scene.bodies[0].faces[0].plane;
    assert!(!form.can_apply(&fixture.model()));
    assert!(form
        .fields(&fixture.model())
        .into_iter()
        .find(|field| field.field == ExtrudeField::StopFace)
        .unwrap()
        .error
        .unwrap()
        .contains("source plane"));
}

#[test]
fn stale_references_and_invalid_profile_regions_cannot_be_applied() {
    let fixture = Fixture::new();
    let model = fixture.model();
    let mut form = fixture.form();
    for indices in [vec![1], vec![0, 0], vec![99]] {
        assert!(form
            .set_source(
                ExtrudeSource::Profiles {
                    sketch_name: "Sketch1".into(),
                    indices
                },
                &model
            )
            .is_err());
    }
    assert!(form.set_targets(vec![BodyId(999)], &model).is_err());
    assert!(form
        .set_stop_face(
            Some(PlanarFaceSourceDto {
                body_id: BodyId(999),
                face_id: FaceId(12)
            }),
            &model
        )
        .is_err());
    let changed = FormModel {
        engine_revision: 8,
        ..fixture.model()
    };
    assert!(!form.can_apply(&changed));
    assert!(form.prepare_apply(&changed).is_err());
    assert!(
        !form.cancel(&changed).unwrap(),
        "stale Cancel closes without restoring old preview over the new document"
    );
    assert!(!form.is_open());
}

#[test]
fn preview_and_apply_receipts_cannot_complete_newer_edits_or_retry_attempts() {
    let fixture = Fixture::new();
    let model = fixture.model();
    let mut form = fixture.form();
    let preview = form.prepare_preview(&model).unwrap();
    assert!(form.accepts_preview(&preview, &model));
    let first = form.prepare_apply(&model).unwrap();
    assert!(form.is_busy());
    assert!(!form.accepts_preview(&preview, &model));
    assert!(form
        .set_value(ExtrudeField::Distance, "20", &model)
        .is_err());
    assert!(form.cancel(&model).is_err());
    form.apply_failed(&first, &model, "Exact kernel failure".into())
        .unwrap();
    assert_eq!(form.engine_error(), Some("Exact kernel failure"));
    assert!(form.can_apply(&model));
    let retry = form.prepare_apply(&model).unwrap();
    assert!(form
        .apply_failed(&first, &model, "Late failure from the old attempt".into())
        .is_err());
    assert!(form.is_busy());
    assert_eq!(retry.owner(), &fixture.owner);
    assert_eq!(retry.model_revision(), 7);
    form.apply_succeeded(&retry, &fixture.owner, 8).unwrap();
    assert!(!form.is_open());
    assert!(form.apply_succeeded(&retry, &fixture.owner, 9).is_err());
    let mut cancelled = fixture.form();
    let ticket = cancelled.prepare_preview(&model).unwrap();
    assert!(cancelled.cancel(&model).unwrap());
    assert!(!cancelled.accepts_preview(&ticket, &model));
    assert!(
        !fixture.form().accepts_preview(&ticket, &model),
        "new forms never inherit old preview identity"
    );
}

#[test]
fn extent_specific_validation_ignores_hidden_inputs_and_validates_both_sides() {
    let fixture = Fixture::new();
    let model = fixture.model();
    let mut form = fixture.form();
    form.set_value(ExtrudeField::Extent, "two_sides", &model)
        .unwrap();
    form.set_value(ExtrudeField::SecondDistance, "-2", &model)
        .unwrap();
    assert!(!form.can_apply(&model));
    let fields = form.fields(&model);
    assert!(fields
        .iter()
        .find(|field| field.field == ExtrudeField::SecondDistance)
        .unwrap()
        .error
        .is_some());
    form.set_value(ExtrudeField::Extent, "through_all", &model)
        .unwrap();
    form.set_value(ExtrudeField::Distance, "incomplete+", &model)
        .unwrap();
    assert!(
        form.can_apply(&model),
        "hidden distance input does not block Through All"
    );
    assert!(
        !form
            .fields(&model)
            .iter()
            .find(|field| field.field == ExtrudeField::Distance)
            .unwrap()
            .visible
    );
    form.set_value(ExtrudeField::Taper, "90", &model).unwrap();
    assert!(!form.can_apply(&model));
    form.set_value(ExtrudeField::Taper, "2 mm", &model).unwrap();
    assert!(!form.can_apply(&model));
}

#[test]
fn editing_preserves_the_existing_feature_id_and_explicit_operation() {
    let mut fixture = Fixture::new();
    fixture
        .document
        .features
        .push(Feature::new(FeatureId(9), "Extrude", FeatureKind::Extrude));
    let model = fixture.model();
    let definition:ExtrudeDefinitionDto=serde_json::from_value(json!({"feature_id":9,"name":"Extrude","source_face":null,"sketch_name":"Sketch1","profile_indices":[0],"operation":"cut","extent":{"type":"distance","distance":12.},"taper_angle_deg":0.,"flip":true,"target_body_ids":[1],"new_body_ids":[]})).unwrap();
    let mut form = ExtrudeForm::edit(&definition, &model).unwrap();
    let apply = form.prepare_apply(&model).unwrap();
    assert_eq!(apply.operation(), "solid_edit_extrude");
    let request: EditExtrudeRequest = serde_json::from_value(apply.arguments().clone()).unwrap();
    assert_eq!(request.feature_id, FeatureId(9));
    assert_eq!(request.extrude.operation, ExtrudeOperation::Cut);
    assert!(request.extrude.flip);
    assert_eq!(
        request.extrude.extent,
        ExtrudeExtent::Distance { distance: 12. }
    );
}
