//! Dimension tests (D9): dimensional solver equations + DOF, parametric
//! re-solve on edit, conflict rejection, auto-dimension on typed input,
//! formula-driven dimensions, lock/snap composition.

use nbcad_core::EdgeId;
use nbcad_sketch::{
    Constraint, DimensionRequest, EditDimensionRequest, LockedRectangleRequest,
    LockedSegmentRequest, MoveDimensionRequest, OriginPlane, PlaneRef, RectangleMode,
    SketchSession, Vec2,
};

fn v(x: f64, y: f64) -> Vec2 {
    Vec2::new(x, y)
}

const XY: PlaneRef = PlaneRef::OriginPlane {
    plane: OriginPlane::Xy,
};

fn session() -> SketchSession {
    SketchSession::new("Sketch1", XY, XY.basis().unwrap(), false)
}

fn locked_seg_text(
    from: Vec2,
    to_hint: Vec2,
    length_text: Option<&str>,
    angle_text: Option<&str>,
) -> LockedSegmentRequest {
    LockedSegmentRequest {
        from,
        to_hint,
        from_crossing: None,
        to_crossing: None,
        length_mm: None,
        angle_deg: None,
        length_text: length_text.map(|t| t.to_string()),
        angle_text: angle_text.map(|t| t.to_string()),
        ctrl_held: false,
        tracking: None,
        intersection: None,
    }
}

fn line(dto: &nbcad_sketch::SketchDto, id: nbcad_sketch::EntityId) -> (Vec2, Vec2) {
    match dto.entities.iter().find(|e| e.id() == id) {
        Some(nbcad_sketch::EntityDto::Line { start, end, .. }) => (*start, *end),
        other => panic!("expected line, got {other:?}"),
    }
}

fn close(a: Vec2, b: Vec2) -> bool {
    a.distance(b) < 1e-7
}

fn point(dto: &nbcad_sketch::SketchDto, id: nbcad_sketch::EntityId) -> Vec2 {
    match dto.entities.iter().find(|entity| entity.id() == id) {
        Some(nbcad_sketch::EntityDto::Point { position, .. }) => *position,
        other => panic!("expected point, got {other:?}"),
    }
}

#[test]
fn support_edge_midpoint_remains_exact_through_dimension_edits_and_history() {
    let mut s = session();
    let edge = EdgeId(77);
    s.set_reference_midpoints(vec![(edge, v(10.0, 0.0))]);

    let line = s.add_line(v(10.2, 0.2), v(20.0, 0.0), false).unwrap();
    assert!(close(
        point(&line.sketch, line.start_point_id),
        v(10.0, 0.0)
    ));
    assert!(s.sketch().constraints().any(|(_, constraint)| matches!(
        constraint,
        Constraint::ReferenceMidpoint {
            point,
            edge: constrained_edge,
            position,
        } if *point == line.start_point_id
            && *constrained_edge == edge
            && close(*position, v(10.0, 0.0))
    )));

    let dimension = s
        .add_dimension(DimensionRequest {
            entities: vec![line.entity_id],
            text_pos: v(15.0, 5.0),
            value_text: None,
        })
        .unwrap();
    let edited = s
        .edit_dimension(EditDimensionRequest {
            constraint_id: dimension.sketch.dimensions[0].constraint_id,
            text: "15".to_string(),
        })
        .unwrap()
        .sketch;
    assert!(close(point(&edited, line.start_point_id), v(10.0, 0.0)));
    assert!(close(point(&edited, line.end_point_id), v(25.0, 0.0)));

    // A recomputed support edge refreshes the authoritative target by its
    // stable id. Undo/redo must retain that new target rather than restoring
    // the old sampled coordinate from a command snapshot.
    s.set_reference_midpoints(vec![(edge, v(12.0, 3.0))]);
    assert!(close(point(&s.dto(), line.start_point_id), v(12.0, 3.0)));
    let undone = s.undo().unwrap().sketch;
    assert!(close(point(&undone, line.start_point_id), v(12.0, 3.0)));
    let redone = s.redo().unwrap().sketch;
    assert!(close(point(&redone, line.start_point_id), v(12.0, 3.0)));
}

// --- Dimensional solver equations + DOF ------------------------------------

#[test]
fn distance_dim_drives_line_length_and_counts_dof() {
    let mut s = session();
    let l = s.add_line(v(0.0, 0.0), v(40.0, 0.0), true).unwrap();
    assert_eq!(l.sketch.dof.value, 4);
    let d = s
        .add_dimension(DimensionRequest {
            entities: vec![l.entity_id],
            text_pos: v(20.0, 15.0),
            value_text: None,
        })
        .unwrap();
    let dto = d.sketch;
    assert_eq!(dto.dof.value, 3, "one length dim removes one DOF");
    assert_eq!(dto.dimensions.len(), 1);
    assert_eq!(dto.dimensions[0].param_name, "d1");
    assert_eq!(dto.dimensions[0].text, "40.00");

    // Editing the parameter re-solves the geometry. Anchor the start so
    // the direction of travel is deterministic.
    s.toggle_fix(l.start_point_id).unwrap();
    let cid = dto.dimensions[0].constraint_id;
    let r = s
        .edit_dimension(EditDimensionRequest {
            constraint_id: cid,
            text: "65".to_string(),
        })
        .unwrap();
    let (_, end) = line(&r.sketch, l.entity_id);
    assert!(close(end, v(65.0, 0.0)), "end={end:?}");
}

#[test]
fn distance_from_a_free_point_to_the_fixed_origin_can_be_edited() {
    let mut s = SketchSession::new("Sketch1", XY, XY.basis().unwrap(), true);
    let origin = s.add_point(v(0.0, 0.0)).unwrap().entities[0];
    let movable = s.add_point(v(10.0, 0.0)).unwrap().entities[0];
    let dimension = s
        .add_dimension(DimensionRequest {
            entities: vec![movable, origin],
            text_pos: v(5.0, 5.0),
            value_text: None,
        })
        .unwrap();
    let edited = s
        .edit_dimension(EditDimensionRequest {
            constraint_id: dimension.sketch.dimensions[0].constraint_id,
            text: "8".to_string(),
        })
        .unwrap()
        .sketch;

    assert!(close(point(&edited, origin), Vec2::ZERO));
    assert!((point(&edited, movable).distance(Vec2::ZERO) - 8.0).abs() < 1e-7);
}

#[test]
fn point_on_line_distance_to_the_fixed_origin_can_be_edited() {
    let mut s = SketchSession::new("Sketch1", XY, XY.basis().unwrap(), true);
    let carrier = s.add_line(v(0.0, 0.0), v(30.0, 0.0), false).unwrap();
    let movable = s.add_point(v(10.0, 0.0)).unwrap().entities[0];
    s.add_constraint(Constraint::Coincident {
        a: movable,
        b: carrier.entity_id,
    })
    .unwrap();
    let dimension = s
        .add_dimension(DimensionRequest {
            entities: vec![movable, carrier.start_point_id],
            text_pos: v(5.0, 5.0),
            value_text: None,
        })
        .unwrap();
    let edited = s
        .edit_dimension(EditDimensionRequest {
            constraint_id: dimension.sketch.dimensions[0].constraint_id,
            text: "8".to_string(),
        })
        .unwrap()
        .sketch;

    assert!(close(point(&edited, carrier.start_point_id), Vec2::ZERO));
    assert!(close(point(&edited, movable), v(8.0, 0.0)));
}

#[test]
fn origin_anchored_chain_moves_attached_rectangle_outward_on_dimension_edit() {
    let mut s = SketchSession::new("Sketch1", XY, XY.basis().unwrap(), true);
    let first = s
        .add_line_locked(&locked_seg_text(
            v(0.0, 0.0),
            v(15.0, 0.0),
            Some("15"),
            None,
        ))
        .unwrap();
    let second = s
        .add_line_locked(&locked_seg_text(
            v(15.0, 0.0),
            v(15.0, 15.0),
            Some("15"),
            None,
        ))
        .unwrap();
    let vertical_dimension = second
        .sketch
        .dimensions
        .iter()
        .find(|dimension| dimension.entities == vec![second.entity_id])
        .unwrap()
        .constraint_id;

    let rectangle = s
        .add_rectangle_locked(&LockedRectangleRequest {
            mode: RectangleMode::TwoPoint,
            anchor: v(15.0, 15.0),
            width_mm: None,
            height_mm: None,
            width_text: Some("30".to_string()),
            height_text: Some("20".to_string()),
            corner_hint: v(45.0, 35.0),
            ctrl_held: false,
        })
        .unwrap();

    assert_eq!(
        rectangle.entities[0], second.end_point_id,
        "a rectangle started from a line endpoint must share that corner"
    );
    assert!(rectangle.sketch.constraints.iter().any(|constraint| {
        matches!(
            constraint.constraint,
            Constraint::Fix { entity } if entity == first.start_point_id
        )
    }));

    let edited = s
        .edit_dimension(EditDimensionRequest {
            constraint_id: vertical_dimension,
            text: "7.5".to_string(),
        })
        .unwrap()
        .sketch;

    assert!(close(point(&edited, first.start_point_id), v(0.0, 0.0)));
    assert!(close(point(&edited, first.end_point_id), v(15.0, 0.0)));
    assert!(close(point(&edited, second.end_point_id), v(15.0, 7.5)));
    assert!(close(point(&edited, rectangle.entities[1]), v(45.0, 7.5)));
    assert!(close(point(&edited, rectangle.entities[3]), v(15.0, 27.5)));
}

#[test]
fn diameter_dim_drives_circle_radius() {
    let mut s = session();
    let c = s
        .add_circle(
            nbcad_sketch::CircleMode::CenterDiameter,
            v(50.0, 50.0),
            v(60.0, 50.0),
        )
        .unwrap();
    let d = s
        .add_dimension(DimensionRequest {
            entities: vec![c.entities[0]],
            text_pos: v(80.0, 80.0),
            value_text: None,
        })
        .unwrap();
    assert_eq!(d.sketch.dimensions[0].text, "Ø20.00");
    let r = s
        .edit_dimension(EditDimensionRequest {
            constraint_id: d.sketch.dimensions[0].constraint_id,
            text: "35".to_string(),
        })
        .unwrap();
    match r
        .sketch
        .entities
        .iter()
        .find(|e| e.id() == c.entities[0])
        .unwrap()
    {
        nbcad_sketch::EntityDto::Circle { radius, .. } => {
            assert!((radius - 17.5).abs() < 1e-9)
        }
        _ => panic!("expected circle"),
    }
}

#[test]
fn angle_dim_drives_line_direction() {
    let mut s = session();
    // ctrl=true: no H inference — l2 starts at ~1.15°.
    let l1 = s.add_line(v(0.0, 0.0), v(50.0, 0.0), true).unwrap();
    let l2 = s.add_line(v(0.0, 0.0), v(50.0, 5.0), true).unwrap();
    let d = s
        .add_dimension(DimensionRequest {
            entities: vec![l1.entity_id, l2.entity_id],
            text_pos: v(20.0, 20.0),
            value_text: None,
        })
        .unwrap();
    assert_eq!(d.sketch.dimensions[0].kind, "angle");
    assert!(d.sketch.dimensions[0].text.ends_with('°'));
    // Anchor l1 fully (start is shared with l2's start, so l1's direction
    // and both starts are pinned); l2 rotates about the shared start.
    s.toggle_fix(l1.start_point_id).unwrap();
    s.toggle_fix(l1.end_point_id).unwrap();
    let r = s
        .edit_dimension(EditDimensionRequest {
            constraint_id: d.sketch.dimensions[0].constraint_id,
            text: "30".to_string(),
        })
        .unwrap();
    let (a, b) = line(&r.sketch, l2.entity_id);
    let ang = ((b.y - a.y).atan2(b.x - a.x)).to_degrees();
    assert!((ang - 30.0).abs() < 1e-6, "angle={ang}");
}

#[test]
fn fully_dimensioned_rectangle_is_fully_defined() {
    let mut s = session();
    let rect = s
        .add_rectangle(
            nbcad_sketch::RectangleMode::TwoPoint,
            v(0.0, 0.0),
            v(40.0, 20.0),
        )
        .unwrap();
    let lines = &rect.entities[4..8];
    // Width + height dims.
    s.add_dimension(DimensionRequest {
        entities: vec![lines[0]],
        text_pos: v(20.0, -15.0),
        value_text: None,
    })
    .unwrap();
    s.add_dimension(DimensionRequest {
        entities: vec![lines[3]],
        text_pos: v(-15.0, 10.0),
        value_text: None,
    })
    .unwrap();
    assert_eq!(s.dto().dof.value, 2, "w+h dims leave only position free");
    // Anchor one corner → fully defined.
    s.toggle_fix(rect.entities[0]).unwrap();
    let dto = s.dto();
    assert_eq!(dto.dof.value, 0);
    assert!(dto.dof.fully_defined);
}

#[test]
fn duplicate_distance_dims_conflict_and_name_both() {
    let mut s = session();
    let l = s.add_line(v(0.0, 0.0), v(40.0, 0.0), true).unwrap();
    s.add_dimension(DimensionRequest {
        entities: vec![l.entity_id],
        text_pos: v(20.0, 15.0),
        value_text: None,
    })
    .unwrap();
    // A second, different distance on the same line must be rejected.
    let err = s
        .add_dimension(DimensionRequest {
            entities: vec![l.entity_id],
            text_pos: v(20.0, 25.0),
            value_text: Some("55".to_string()),
        })
        .unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("conflicts with"), "{msg}");
    // Only the first dimension survived.
    assert_eq!(s.dto().dimensions.len(), 1);
}

// --- Auto-dimension on typed input (D9) ---------------------------------------

#[test]
fn typed_length_and_angle_create_dimensions_with_annotations() {
    let mut s = session();
    let r = s
        .add_line_locked(&locked_seg_text(
            v(0.0, 0.0),
            v(99.0, 99.0),
            Some("=25*2"),
            Some("30"),
        ))
        .unwrap();
    let dto = r.sketch;
    assert_eq!(dto.dimensions.len(), 2);
    let dist = dto
        .dimensions
        .iter()
        .find(|d| d.kind == "distance")
        .unwrap();
    assert_eq!(dist.text, "50.00");
    assert_eq!(dist.param_expression.as_deref(), Some("25*2"));
    let ang = dto.dimensions.iter().find(|d| d.kind == "angle").unwrap();
    assert_eq!(ang.text, "30.00°");
    // Names auto-assigned in creation order.
    assert_eq!(dist.param_name, "d1");
    assert_eq!(ang.param_name, "d2");
    // One undo removes line + both dimensions.
    let undone = s.undo().unwrap();
    assert_eq!(undone.sketch.entities.len(), 0);
    assert_eq!(undone.sketch.dimensions.len(), 0);
    assert!(undone.sketch.constraints.is_empty());
}

#[test]
fn formula_dimensions_chain_and_edit_reevaluates_dependents() {
    let mut s = session();
    let l1 = s
        .add_line_locked(&locked_seg_text(
            v(0.0, 0.0),
            v(99.0, 0.0),
            Some("50"),
            None,
        ))
        .unwrap();
    let l2 = s
        .add_line_locked(&locked_seg_text(
            v(0.0, 30.0),
            v(99.0, 30.0),
            Some("=d1/2"),
            None,
        ))
        .unwrap();
    let dto = s.dto();
    assert_eq!(dto.dimensions.len(), 2);
    assert_eq!(dto.dimensions[1].text, "25.00");
    assert_eq!(dto.dimensions[1].param_expression.as_deref(), Some("d1/2"));

    // Edit d1 → both lines update (starts anchored for determinism).
    s.toggle_fix(l1.start_point_id).unwrap();
    s.toggle_fix(l2.start_point_id).unwrap();
    let cid = dto.dimensions[0].constraint_id;
    let r = s
        .edit_dimension(EditDimensionRequest {
            constraint_id: cid,
            text: "60".to_string(),
        })
        .unwrap();
    let (_, e1) = line(&r.sketch, l1.entity_id);
    let (_, e2) = line(&r.sketch, l2.entity_id);
    assert!(close(e1, v(60.0, 0.0)), "e1={e1:?}");
    assert!(close(e2, v(30.0, 30.0)), "e2={e2:?}");
    assert_eq!(r.sketch.dimensions[1].text, "30.00");
}

#[test]
fn cycle_through_dimension_edit_surfaces_a_clear_error() {
    let mut s = session();
    s.add_line_locked(&locked_seg_text(
        v(0.0, 0.0),
        v(50.0, 0.0),
        Some("50"),
        None,
    ))
    .unwrap();
    s.add_line_locked(&locked_seg_text(
        v(0.0, 30.0),
        v(50.0, 30.0),
        Some("=d1"),
        None,
    ))
    .unwrap();
    let dto = s.dto();
    // Point d1 at d2 → cycle d1 → d2 → d1 (d2 = d1).
    let err = s
        .edit_dimension(EditDimensionRequest {
            constraint_id: dto.dimensions[0].constraint_id,
            text: "=d2".to_string(),
        })
        .unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("circular reference"), "{msg}");
    assert!(msg.contains("d1") && msg.contains("d2"), "{msg}");
    // Rolled back: the parameter value is unchanged.
    assert_eq!(s.dto().dimensions[0].value, 50.0);
}

#[test]
fn contradictory_dimension_edit_rolls_back_parameter_and_geometry() {
    let mut s = session();
    let line_result = s.add_line(v(0.0, 0.0), v(40.0, 0.0), true).unwrap();
    s.toggle_fix(line_result.start_point_id).unwrap();
    s.toggle_fix(line_result.end_point_id).unwrap();
    let dimension = s
        .add_dimension(DimensionRequest {
            entities: vec![line_result.entity_id],
            text_pos: v(20.0, 10.0),
            value_text: None,
        })
        .unwrap();
    let cid = dimension.sketch.dimensions[0].constraint_id;
    let before = s.dto();
    let error = s
        .edit_dimension(EditDimensionRequest {
            constraint_id: cid,
            text: "55".to_string(),
        })
        .unwrap_err();
    assert!(error.to_string().contains("conflict"), "{error}");
    let after = s.dto();
    assert_eq!(after.dimensions[0].value, 40.0);
    assert_eq!(
        line(&after, line_result.entity_id),
        line(&before, line_result.entity_id)
    );
}

// --- Lock/snap composition (D9 bug fix) ----------------------------------------

#[test]
fn locked_length_still_snaps_to_points_on_the_circle() {
    let mut s = session();
    // A reference point exactly 50 mm from the origin.
    let p = s.add_point(v(50.0, 0.0)).unwrap();
    // Cursor near the point (direction off by ~2°) — without composition
    // the endpoint would land next to the point, not on it.
    let r = s
        .add_line_locked(&locked_seg_text(
            v(0.0, 0.0),
            v(49.0, 2.0),
            Some("50"),
            None,
        ))
        .unwrap();
    assert_eq!(
        r.end_point_id, p.entities[0],
        "must merge onto the snapped point"
    );
    let (_, end) = line(&r.sketch, r.entity_id);
    assert!(close(end, v(50.0, 0.0)));
}

#[test]
fn locked_length_axis_inference_still_works() {
    let mut s = session();
    // Cursor near-horizontal: H inference on the remaining freedom.
    let r = s
        .add_line_locked(&locked_seg_text(
            v(10.0, 10.0),
            v(50.0, 10.4),
            Some("35"),
            None,
        ))
        .unwrap();
    let (_, end) = line(&r.sketch, r.entity_id);
    assert!(close(end, v(45.0, 10.0)), "end={end:?}");
    assert!(r
        .created_constraints
        .iter()
        .any(|c| c.constraint.kind_str() == "horizontal"));
}

#[test]
fn locked_angle_still_snaps_to_points_on_the_ray() {
    let mut s = session();
    let p = s.add_point(v(30.0, 30.0)).unwrap(); // on the 45° ray
    let r = s
        .add_line_locked(&locked_seg_text(
            v(0.0, 0.0),
            v(31.0, 29.0),
            None,
            Some("45"),
        ))
        .unwrap();
    assert_eq!(r.end_point_id, p.entities[0]);
}

#[test]
fn dimension_move_and_delete() {
    let mut s = session();
    let l = s.add_line(v(0.0, 0.0), v(40.0, 0.0), true).unwrap();
    let d = s
        .add_dimension(DimensionRequest {
            entities: vec![l.entity_id],
            text_pos: v(20.0, 15.0),
            value_text: None,
        })
        .unwrap();
    let cid = d.sketch.dimensions[0].constraint_id;
    let pid = d.sketch.dimensions[0].param_id;
    s.move_dimension(MoveDimensionRequest {
        constraint_id: cid,
        text_pos: v(5.0, 40.0),
    })
    .unwrap();
    assert_eq!(s.dto().dimensions[0].text_pos, v(5.0, 40.0));
    s.delete_dimension(cid).unwrap();
    let dto = s.dto();
    assert!(dto.dimensions.is_empty());
    assert!(
        s.sketch().params().get(pid).is_none(),
        "orphan param removed"
    );
    // Undo restores constraint + parameter + placement.
    let undone = s.undo().unwrap();
    assert_eq!(undone.sketch.dimensions.len(), 1);
    assert_eq!(undone.sketch.dimensions[0].text_pos, v(5.0, 40.0));
}

#[test]
fn typed_dimension_default_offset_scales_with_the_measured_feature() {
    let mut small = session();
    let small_line = small
        .add_line_locked(&locked_seg_text(
            v(0.0, 0.0),
            v(0.5, 0.0),
            Some("0.5"),
            None,
        ))
        .unwrap();
    let small_dim = small_line
        .sketch
        .dimensions
        .first()
        .expect("typed length should create a dimension");
    assert!(
        (small_dim.text_pos.y - 1.5).abs() < 1e-9,
        "sub-millimetre geometry should receive a compact readable offset"
    );

    let mut large = session();
    let large_line = large
        .add_line_locked(&locked_seg_text(
            v(0.0, 0.0),
            v(100.0, 0.0),
            Some("100"),
            None,
        ))
        .unwrap();
    let large_dim = large_line
        .sketch
        .dimensions
        .first()
        .expect("typed length should create a dimension");
    assert!(
        (large_dim.text_pos.y - 10.0).abs() < 1e-9,
        "large geometry should cap the initial extension-line offset"
    );
}
