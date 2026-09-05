//! Redundant/conflicting constraint admission regressions.
//!
//! The pairwise permutation matrix proves order safety for every public
//! operation. These tests cover dependency circuits, which need three or more
//! relations and therefore cannot be exposed by pairwise tests alone.

use nbcad_sketch::{
    CircleMode, Constraint, DimensionMode, DimensionRequest, EntityId, OriginPlane, PlaneRef,
    SessionError, SketchSession, Vec2,
};

const XY: PlaneRef = PlaneRef::OriginPlane {
    plane: OriginPlane::Xy,
};

fn v(x: f64, y: f64) -> Vec2 {
    Vec2::new(x, y)
}

fn session() -> SketchSession {
    SketchSession::new("overconstraint hardening", XY, XY.basis().unwrap(), false)
}

fn line(session: &mut SketchSession, a: Vec2, b: Vec2) -> EntityId {
    session.add_line(a, b, true).unwrap().entity_id
}

fn point(session: &mut SketchSession, at: Vec2) -> EntityId {
    session.add_point(at).unwrap().entities[0]
}

fn circle(session: &mut SketchSession, center: Vec2, radius: f64) -> EntityId {
    session
        .add_circle(CircleMode::CenterDiameter, center, center + v(radius, 0.0))
        .unwrap()
        .entities[0]
}

fn assert_redundant(
    session: &mut SketchSession,
    constraint: Constraint,
    expected_dependencies: &[&str],
) {
    let before = session.dto();
    let error = session.add_constraint(constraint).unwrap_err();
    match error {
        SessionError::RedundantConstraint {
            rejected,
            implied_by,
        } => {
            assert_eq!(rejected.kind, constraint.kind_str());
            for expected in expected_dependencies {
                assert!(
                    implied_by
                        .iter()
                        .any(|dependency| dependency.kind == *expected),
                    "expected {expected} in dependencies {implied_by:?}"
                );
            }
        }
        other => panic!("expected redundant constraint, got {other:?}"),
    }
    assert_eq!(session.dto(), before, "redundant rejection must be atomic");
}

#[test]
fn parallel_and_perpendicular_dependency_rejects_the_implied_right_angle() {
    let mut s = session();
    let bottom = line(&mut s, v(0.0, 0.0), v(40.0, 0.0));
    let right = line(&mut s, v(40.0, 0.0), v(40.0, 25.0));
    let top = line(&mut s, v(0.0, 25.0), v(40.0, 25.0));

    s.add_constraint(Constraint::Parallel { a: bottom, b: top })
        .unwrap();
    s.add_constraint(Constraint::Perpendicular {
        a: bottom,
        b: right,
    })
    .unwrap();

    assert_redundant(
        &mut s,
        Constraint::Perpendicular { a: top, b: right },
        &["parallel", "perpendicular"],
    );
}

#[test]
fn two_right_angles_reject_the_implied_parallel_relation() {
    let mut s = session();
    let a = line(&mut s, v(0.0, 0.0), v(30.0, 0.0));
    let b = line(&mut s, v(45.0, 0.0), v(45.0, 20.0));
    let c = line(&mut s, v(0.0, 35.0), v(30.0, 35.0));
    s.add_constraint(Constraint::Perpendicular { a, b })
        .unwrap();
    s.add_constraint(Constraint::Perpendicular { a: b, b: c })
        .unwrap();

    assert_redundant(&mut s, Constraint::Parallel { a, b: c }, &["perpendicular"]);
}

#[test]
fn transitive_relation_families_reject_the_closing_edge() {
    // Parallel transitivity.
    let mut s = session();
    let a = line(&mut s, v(0.0, 0.0), v(20.0, 0.0));
    let b = line(&mut s, v(0.0, 10.0), v(20.0, 10.0));
    let c = line(&mut s, v(0.0, 20.0), v(20.0, 20.0));
    s.add_constraint(Constraint::Parallel { a, b }).unwrap();
    s.add_constraint(Constraint::Parallel { a: b, b: c })
        .unwrap();
    assert_redundant(&mut s, Constraint::Parallel { a, b: c }, &["parallel"]);

    // Equal-length transitivity.
    let mut s = session();
    let a = line(&mut s, v(0.0, 0.0), v(10.0, 0.0));
    let b = line(&mut s, v(0.0, 10.0), v(10.0, 10.0));
    let c = line(&mut s, v(0.0, 20.0), v(10.0, 20.0));
    s.add_constraint(Constraint::Equal { a, b }).unwrap();
    s.add_constraint(Constraint::Equal { a: b, b: c }).unwrap();
    assert_redundant(&mut s, Constraint::Equal { a, b: c }, &["equal"]);

    // Collinear transitivity.
    let mut s = session();
    let a = line(&mut s, v(0.0, 0.0), v(10.0, 0.0));
    let b = line(&mut s, v(15.0, 0.0), v(25.0, 0.0));
    let c = line(&mut s, v(30.0, 0.0), v(40.0, 0.0));
    s.add_constraint(Constraint::Collinear { a, b }).unwrap();
    s.add_constraint(Constraint::Collinear { a: b, b: c })
        .unwrap();
    assert_redundant(&mut s, Constraint::Collinear { a, b: c }, &["collinear"]);

    // Coincident-point transitivity.
    let mut s = session();
    let a = point(&mut s, v(0.0, 0.0));
    let b = point(&mut s, v(10.0, 3.0));
    let c = point(&mut s, v(20.0, -2.0));
    s.add_constraint(Constraint::Coincident { a, b }).unwrap();
    s.add_constraint(Constraint::Coincident { a: b, b: c })
        .unwrap();
    assert_redundant(&mut s, Constraint::Coincident { a, b: c }, &["coincident"]);

    // Concentric-curve transitivity.
    let mut s = session();
    let a = circle(&mut s, v(0.0, 0.0), 4.0);
    let b = circle(&mut s, v(15.0, 2.0), 6.0);
    let c = circle(&mut s, v(30.0, -3.0), 8.0);
    s.add_constraint(Constraint::Concentric { a, b }).unwrap();
    s.add_constraint(Constraint::Concentric { a: b, b: c })
        .unwrap();
    assert_redundant(&mut s, Constraint::Concentric { a, b: c }, &["concentric"]);
}

#[test]
fn mixed_relations_reject_equivalent_direction_and_incidence() {
    // Horizontal + Vertical already establishes a right angle.
    let mut s = session();
    let horizontal = line(&mut s, v(0.0, 0.0), v(20.0, 0.0));
    let vertical = line(&mut s, v(30.0, 0.0), v(30.0, 20.0));
    s.add_constraint(Constraint::Horizontal { entity: horizontal })
        .unwrap();
    s.add_constraint(Constraint::Vertical { entity: vertical })
        .unwrap();
    assert_redundant(
        &mut s,
        Constraint::Perpendicular {
            a: horizontal,
            b: vertical,
        },
        &["horizontal", "vertical"],
    );

    // A parallel follower of a horizontal carrier is already horizontal.
    let mut s = session();
    let reference = line(&mut s, v(0.0, 0.0), v(20.0, 0.0));
    let follower = line(&mut s, v(0.0, 10.0), v(20.0, 10.0));
    s.add_constraint(Constraint::Horizontal { entity: reference })
        .unwrap();
    s.add_constraint(Constraint::Parallel {
        a: reference,
        b: follower,
    })
    .unwrap();
    assert_redundant(
        &mut s,
        Constraint::Horizontal { entity: follower },
        &["horizontal", "parallel"],
    );

    // Midpoint already includes point-on-line incidence.
    let mut s = session();
    let carrier = line(&mut s, v(0.0, 0.0), v(20.0, 0.0));
    let midpoint = point(&mut s, v(8.0, 5.0));
    s.add_constraint(Constraint::Midpoint {
        a: midpoint,
        b: carrier,
    })
    .unwrap();
    assert_redundant(
        &mut s,
        Constraint::Coincident {
            a: midpoint,
            b: carrier,
        },
        &["midpoint"],
    );
}

#[test]
fn symmetry_rejects_relations_already_carried_by_the_mirror_equations() {
    // Mirrored lines necessarily have equal length.
    let mut s = session();
    let axis = line(&mut s, v(0.0, -20.0), v(0.0, 30.0));
    let a = line(&mut s, v(8.0, 2.0), v(15.0, 18.0));
    let b = line(&mut s, v(-6.0, 3.0), v(-16.0, 20.0));
    s.add_constraint(Constraint::Symmetry { a, b, axis })
        .unwrap();
    assert_redundant(&mut s, Constraint::Equal { a, b }, &["symmetry"]);

    // Mirrored endpoints make their carrier perpendicular to the mirror axis.
    let mut s = session();
    let axis = line(&mut s, v(0.0, -20.0), v(0.0, 30.0));
    let carrier = s.add_line(v(-8.0, 5.0), v(11.0, 7.0), true).unwrap();
    s.add_constraint(Constraint::Symmetry {
        a: carrier.start_point_id,
        b: carrier.end_point_id,
        axis,
    })
    .unwrap();
    assert_redundant(
        &mut s,
        Constraint::Perpendicular {
            a: carrier.entity_id,
            b: axis,
        },
        &["symmetry"],
    );
}

#[test]
fn tangent_and_center_acquisition_circuits_reject_their_implied_relations() {
    // Collinear carriers share an infinite support line, so tangency of one
    // carrier to a circle determines tangency of the other.
    let mut s = session();
    let a = line(&mut s, v(-15.0, 8.0), v(15.0, 8.0));
    let b = line(&mut s, v(-10.0, 14.0), v(12.0, 14.0));
    let curve = circle(&mut s, v(0.0, 0.0), 5.0);
    s.add_constraint(Constraint::Collinear { a, b }).unwrap();
    s.add_constraint(Constraint::Tangent { a, b: curve })
        .unwrap();
    assert_redundant(
        &mut s,
        Constraint::Tangent { a: b, b: curve },
        &["collinear", "tangent"],
    );

    // Two curves acquired to the same center point are already concentric.
    let mut s = session();
    let _center = point(&mut s, v(3.0, 4.0));
    let a = circle(&mut s, v(3.0, 4.0), 5.0);
    let b = circle(&mut s, v(3.0, 4.0), 8.0);
    assert_eq!(
        s.dto()
            .constraints
            .iter()
            .filter(|constraint| constraint.constraint.kind_str() == "center_coincident")
            .count(),
        2,
        "both authored centers should stay associated with the selected point"
    );
    assert_redundant(
        &mut s,
        Constraint::Concentric { a, b },
        &["center_coincident"],
    );

    // Fixing a point already tied to the origin contributes no information.
    let mut s = session();
    let at_origin = point(&mut s, Vec2::ZERO);
    assert_redundant(
        &mut s,
        Constraint::Fix { entity: at_origin },
        &["origin_coincident"],
    );
}

#[test]
fn a_satisfied_relation_on_fixed_geometry_is_redundant_but_fixing_partial_geometry_is_valid() {
    let mut s = session();
    let horizontal = line(&mut s, v(0.0, 0.0), v(20.0, 0.0));
    s.add_constraint(Constraint::Fix { entity: horizontal })
        .unwrap();
    assert_redundant(
        &mut s,
        Constraint::Horizontal { entity: horizontal },
        &["fix"],
    );

    let mut s = session();
    let horizontal = line(&mut s, v(0.0, 0.0), v(20.0, 0.0));
    s.add_constraint(Constraint::Horizontal { entity: horizontal })
        .unwrap();
    s.add_constraint(Constraint::Fix { entity: horizontal })
        .expect("Fix still contributes placement and length after Horizontal");
}

#[test]
fn redundant_batch_is_rejected_as_one_atomic_command() {
    let mut s = session();
    let a = line(&mut s, v(0.0, 0.0), v(20.0, 0.0));
    let b = line(&mut s, v(0.0, 10.0), v(20.0, 10.0));
    let c = line(&mut s, v(0.0, 20.0), v(20.0, 20.0));
    let before = s.dto();
    let error = s
        .add_constraints(vec![
            Constraint::Parallel { a, b },
            Constraint::Parallel { a: b, b: c },
            Constraint::Parallel { a, b: c },
        ])
        .unwrap_err();
    assert!(matches!(error, SessionError::RedundantConstraint { .. }));
    assert_eq!(s.dto(), before);
}

#[test]
fn implied_dimensions_become_reference_instead_of_adding_solver_rows() {
    // Equal line lengths: one driving length determines the peer length.
    let mut s = session();
    let a = line(&mut s, v(0.0, 0.0), v(20.0, 0.0));
    let b = line(&mut s, v(0.0, 10.0), v(20.0, 10.0));
    s.add_constraint(Constraint::Equal { a, b }).unwrap();
    s.add_dimension(DimensionRequest {
        entities: vec![a],
        text_pos: v(10.0, -5.0),
        value_text: None,
    })
    .unwrap();
    let result = s
        .add_dimension(DimensionRequest {
            entities: vec![b],
            text_pos: v(10.0, 15.0),
            value_text: None,
        })
        .unwrap()
        .sketch;
    assert_eq!(result.dimensions.len(), 2);
    assert_eq!(result.dimensions[0].mode, DimensionMode::Driving);
    assert_eq!(result.dimensions[1].mode, DimensionMode::Reference);

    // A 90-degree angle is already driven by Perpendicular.
    let mut s = session();
    let a = line(&mut s, v(0.0, 0.0), v(20.0, 0.0));
    let b = line(&mut s, v(30.0, 0.0), v(30.0, 20.0));
    s.add_constraint(Constraint::Perpendicular { a, b })
        .unwrap();
    let result = s
        .add_dimension(DimensionRequest {
            entities: vec![a, b],
            text_pos: v(25.0, 5.0),
            value_text: None,
        })
        .unwrap()
        .sketch;
    assert_eq!(result.dimensions.len(), 1);
    assert_eq!(result.dimensions[0].mode, DimensionMode::Reference);

    // Equal curve radii: one driving diameter determines the peer diameter.
    let mut s = session();
    let a = circle(&mut s, v(0.0, 0.0), 6.0);
    let b = circle(&mut s, v(20.0, 0.0), 9.0);
    s.add_constraint(Constraint::Equal { a, b }).unwrap();
    s.add_dimension(DimensionRequest {
        entities: vec![a],
        text_pos: v(0.0, -10.0),
        value_text: None,
    })
    .unwrap();
    let result = s
        .add_dimension(DimensionRequest {
            entities: vec![b],
            text_pos: v(20.0, -10.0),
            value_text: None,
        })
        .unwrap()
        .sketch;
    assert_eq!(result.dimensions.len(), 2);
    assert_eq!(result.dimensions[0].mode, DimensionMode::Driving);
    assert_eq!(result.dimensions[1].mode, DimensionMode::Reference);
}
