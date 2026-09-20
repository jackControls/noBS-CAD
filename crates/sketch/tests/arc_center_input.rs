//! Center-point-arc input parity: every pick acquires the same references the
//! line tool has (support-face edge midpoints and the projected face
//! boundary), and a typed radius locks the arc's radius while the cursor keeps
//! aiming the two endpoint picks.
use nbcad_core::EdgeId;
use nbcad_sketch::{
    Constraint, EditDimensionRequest, EntityDto, OriginPlane, PlaneRef, ProjectedEdgeDto,
    SketchSession, SnapTarget, Vec2,
};

/// Matches `PROJECTED_EDGE_ID_BASE` in the sketch manager.
const RESERVED_ID_FLOOR: u64 = 1 << 40;

fn v(x: f64, y: f64) -> Vec2 {
    Vec2::new(x, y)
}

const XY: PlaneRef = PlaneRef::OriginPlane {
    plane: OriginPlane::Xy,
};

fn close(a: Vec2, b: Vec2) -> bool {
    a.distance(b) < 1e-7
}

/// Session with grid snap off and one support-edge midpoint plus one projected
/// boundary edge, which is what a sketch on a planar face carries.
fn face_session() -> SketchSession {
    let mut session = SketchSession::new("Sketch1", XY, XY.basis().unwrap(), false);
    session.set_reference_midpoints(vec![(EdgeId(9), v(10.0, 10.0))]);
    session.set_projected_edges(vec![ProjectedEdgeDto {
        id: RESERVED_ID_FLOOR,
        edge_id: EdgeId(7),
        points: vec![v(0.0, 20.0), v(20.0, 20.0)],
        circle: None,
    }]);
    session
}

fn arc_of(session: &SketchSession, id: nbcad_sketch::EntityId) -> (Vec2, f64, f64, f64) {
    match session.dto().entities.iter().find(|e| e.id() == id) {
        Some(EntityDto::Arc {
            center,
            radius,
            start_angle,
            end_angle,
            ..
        }) => (*center, *radius, *start_angle, *end_angle),
        other => panic!("expected arc, got {other:?}"),
    }
}

#[test]
fn arc_picks_acquire_support_edge_midpoints_and_the_projected_boundary() {
    // The acquisition the arc tool shares with the line tool: a support-face
    // edge midpoint (triangle marker) and any point on the projected boundary.
    let session = face_session();
    let midpoint = session.preview_segment(v(0.0, 0.0), v(10.2, 10.1), false);
    assert_eq!(
        midpoint.snap,
        SnapTarget::ReferenceMidpoint { edge: EdgeId(9) }
    );
    assert_eq!(midpoint.snapped_to, v(10.0, 10.0));

    let boundary = session.preview_segment(v(0.0, 0.0), v(8.0, 20.2), false);
    match boundary.snap {
        SnapTarget::ProjectedEdge { edge, position } => {
            assert_eq!(edge, EdgeId(7));
            assert!(close(position, v(8.0, 20.0)), "{position:?}");
        }
        other => panic!("expected a projected-boundary acquisition, got {other:?}"),
    }

    // Every arc pick lands on the acquired reference, so the drawn arc rests
    // exactly on the face edge instead of a fraction of a millimetre away.
    let mut session = face_session();
    let result = session
        .add_arc_center(v(10.2, 10.1), v(8.0, 20.2), v(19.7, 20.1))
        .unwrap();
    let (center, radius, start_angle, _) = arc_of(&session, result.entities[0]);
    assert!(
        close(center, v(10.0, 10.0)),
        "center {} must acquire the midpoint",
        format!("{center:?}")
    );
    let expected_radius = v(8.0, 20.0).distance(v(10.0, 10.0));
    assert!(
        (radius - expected_radius).abs() < 1e-9,
        "start acquired the projected boundary: {radius} vs {expected_radius}"
    );
    // The start pick keeps the projected coordinate, not the raw cursor.
    let start = v(
        center.x + radius * start_angle.cos(),
        center.y + radius * start_angle.sin(),
    );
    assert!(close(start, v(8.0, 20.0)), "start point {start:?}");
}

#[test]
fn a_typed_radius_locks_the_arc_and_adds_a_driving_dimension() {
    let mut session = face_session();
    let result = session
        .add_arc_center_locked(
            v(0.0, 0.0),
            // Hint 7 mm away: the lock must replace the distance and keep the
            // direction.
            v(7.0, 0.0),
            v(0.0, 9.0),
            false,
            None,
            Some("12"),
        )
        .unwrap();
    let (center, radius, start_angle, end_angle) = arc_of(&session, result.entities[0]);
    assert!(close(center, Vec2::ZERO));
    assert!((radius - 12.0).abs() < 1e-9, "locked radius {radius}");
    assert!(start_angle.abs() < 1e-9, "start keeps the hint direction");
    assert!(
        (end_angle - std::f64::consts::FRAC_PI_2).abs() < 1e-9,
        "sweep keeps the third pick's direction: {end_angle}"
    );
    let arc_id = result.entities[0];
    let dto = session.dto();
    let radius_constraint = dto
        .constraints
        .iter()
        .find(|c| matches!(c.constraint, Constraint::Radius { entity, .. } if entity == arc_id));
    assert!(radius_constraint.is_some(), "driving Radius relation");
    let dimensions = dto.dimensions.clone();
    assert_eq!(dimensions.len(), 1);
    assert_eq!(dimensions[0].kind, "radius");
    assert_eq!(dimensions[0].text, "R12.00");
    assert_eq!(dimensions[0].entities, vec![arc_id]);

    // A driving radius stays parametric: editing it re-solves the arc.
    let mut session = session;
    session
        .edit_dimension(EditDimensionRequest {
            constraint_id: dimensions[0].constraint_id,
            text: "20".to_string(),
        })
        .unwrap();
    let (_, radius, _, _) = arc_of(&session, arc_id);
    assert!((radius - 20.0).abs() < 1e-6, "edited radius {radius}");
}

#[test]
fn a_typed_radius_expression_is_evaluated() {
    let mut session = face_session();
    let result = session
        .add_arc_center_locked(
            v(0.0, 0.0),
            v(7.0, 0.0),
            v(0.0, 9.0),
            false,
            None,
            Some("=6*2"),
        )
        .unwrap();
    let (_, radius, _, _) = arc_of(&session, result.entities[0]);
    assert!((radius - 12.0).abs() < 1e-9, "formula radius {radius}");
    let dimension = &session.dto().dimensions[0];
    assert_eq!(dimension.text, "R12.00");
    assert_eq!(dimension.param_expression.as_deref(), Some("6*2"));
    assert!((dimension.value - 12.0).abs() < 1e-9);
}

#[test]
fn one_undo_removes_a_locked_arc_and_its_dimension() {
    let mut session = face_session();
    session
        .add_arc_center_locked(
            v(0.0, 0.0),
            v(7.0, 0.0),
            v(0.0, 9.0),
            false,
            None,
            Some("12"),
        )
        .unwrap();
    assert_eq!(session.dto().dimensions.len(), 1);
    session.undo().unwrap();
    let dto = session.dto();
    assert!(dto.entities.is_empty(), "arc removed: {:?}", dto.entities);
    assert!(dto.dimensions.is_empty(), "dimension removed with it");
}
