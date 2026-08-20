//! Solver test suite: Newton convergence per constraint equation, real DOF
//! counts, over-constraint rejection with
//! conflict reports (D4.2), locked dynamic-input endpoint math, and
//! drag-with-constraints cases.

use nbcad_sketch::{
    CircleMode, Constraint, CurveCrossingRequest, DragPhase, EntityDto, EntityId,
    LineIntersectionRequest, LineTrackingRequest, LockedCircleRequest, LockedSegmentRequest,
    MovePointRequest, OriginPlane, PlaneRef, RectangleMode, SketchSession, SnapTarget,
    TrackingAxis, Vec2,
};

fn v(x: f64, y: f64) -> Vec2 {
    Vec2::new(x, y)
}

fn locked_seg(
    from: Vec2,
    to_hint: Vec2,
    length_mm: Option<f64>,
    angle_deg: Option<f64>,
) -> LockedSegmentRequest {
    LockedSegmentRequest {
        from,
        to_hint,
        from_crossing: None,
        to_crossing: None,
        length_mm,
        angle_deg,
        length_text: None,
        angle_text: None,
        ctrl_held: false,
        tracking: None,
        intersection: None,
    }
}

const XY: PlaneRef = PlaneRef::OriginPlane {
    plane: OriginPlane::Xy,
};

/// Session with grid snap OFF (deterministic coordinates).
fn session() -> SketchSession {
    SketchSession::new("Sketch1", XY, XY.basis().unwrap(), false)
}

fn move_req(point_id: nbcad_sketch::EntityId, to: Vec2) -> MovePointRequest {
    MovePointRequest {
        point_id,
        to_raw: to,
        ctrl_held: false,
        phase: DragPhase::Single,
    }
}

fn line(dto: &nbcad_sketch::SketchDto, id: nbcad_sketch::EntityId) -> (Vec2, Vec2) {
    match dto.entities.iter().find(|e| e.id() == id) {
        Some(EntityDto::Line { start, end, .. }) => (*start, *end),
        other => panic!("expected line, got {other:?}"),
    }
}

fn close(a: Vec2, b: Vec2) -> bool {
    a.distance(b) < 1e-7
}

// --- DOF counting (rank analysis) ----------------------------------------

#[test]
fn dof_counts_free_line_then_h_then_fixed_rectangle() {
    let mut s = session();
    // Free line: 2 points × 2 = 4 DOF.
    let l = s.add_line(v(0.0, 0.0), v(50.0, 30.0), true).unwrap();
    assert_eq!(l.sketch.dof.value, 4);

    // +Horizontal → 3 DOF.
    let r = s.add_constraint(Constraint::Horizontal {
        entity: l.entity_id,
    });
    assert!(r.is_ok(), "H on free line is consistent: {:?}", r.err());
    assert_eq!(s.dto().dof.value, 3);

    // Fixed rectangle: 4 lines + 2H + 2V + one corner Fixed + distance
    // anchors → fully defined.
    let mut s = session();
    let rect = s
        .add_rectangle(RectangleMode::TwoPoint, v(0.0, 0.0), v(40.0, 20.0))
        .unwrap();
    let lines: Vec<_> = rect
        .sketch
        .entities
        .iter()
        .filter(|e| matches!(e, EntityDto::Line { .. }))
        .map(|e| e.id())
        .collect();
    assert_eq!(lines.len(), 4);
    // 8 vars − 4 constraints (2H + 2V) = 4 DOF before Fix.
    assert_eq!(rect.sketch.dof.value, 4);
    let corner = rect.entities[0];
    s.toggle_fix(corner).unwrap(); // Fix point: −2
    assert_eq!(s.dto().dof.value, 2);
    // Fix the opposite corner → 0 DOF, fully defined.
    let opposite = rect.entities[2];
    s.toggle_fix(opposite).unwrap();
    let dto = s.dto();
    assert_eq!(dto.dof.value, 0);
    assert!(dto.dof.fully_defined);
    assert!(dto.entities.iter().all(|e| match e {
        EntityDto::Line { fully_defined, .. } => *fully_defined,
        EntityDto::Point { fully_defined, .. } => *fully_defined,
        _ => true,
    }));
}

// --- Constraint equations --------------------------------------------------

#[test]
fn parallel_and_perpendicular_hold_and_count_dof() {
    let mut s = session();
    let l1 = s.add_line(v(0.0, 0.0), v(50.0, 0.0), true).unwrap();
    let l2 = s.add_line(v(0.0, 20.0), v(50.0, 25.0), true).unwrap();
    s.add_constraint(Constraint::Parallel {
        a: l1.entity_id,
        b: l2.entity_id,
    })
    .unwrap();
    let dto = s.dto();
    let (a0, a1) = line(&dto, l1.entity_id);
    let (b0, b1) = line(&dto, l2.entity_id);
    // Parallel: the solver leveled l2 to l1's direction.
    let da = a1 - a0;
    let db = b1 - b0;
    assert!((da.x * db.y - da.y * db.x).abs() < 1e-7);
    assert_eq!(dto.dof.value, 8 - 1);
}

#[test]
fn coincident_point_on_line_solves() {
    let mut s = session();
    let l = s.add_line(v(0.0, 0.0), v(50.0, 0.0), true).unwrap();
    let p = s.add_point(v(25.0, 10.0)).unwrap();
    s.add_constraint(Constraint::Coincident {
        a: p.entities[0],
        b: l.entity_id,
    })
    .unwrap();
    let dto = s.dto();
    let point = dto
        .entities
        .iter()
        .find(|e| e.id() == p.entities[0])
        .unwrap();
    match point {
        EntityDto::Point { position, .. } => {
            let (a, b) = line(&dto, l.entity_id);
            let d = (b.x - a.x) * (position.y - a.y) - (b.y - a.y) * (position.x - a.x);
            assert!(d.abs() < 1e-7, "point must lie on the line");
        }
        _ => panic!("expected point"),
    }
}

#[test]
fn midpoint_constraint_moves_point_to_midpoint() {
    let mut s = session();
    let l = s.add_line(v(0.0, 0.0), v(50.0, 20.0), true).unwrap();
    let p = s.add_point(v(30.0, 30.0)).unwrap();
    s.add_constraint(Constraint::Midpoint {
        a: p.entities[0],
        b: l.entity_id,
    })
    .unwrap();
    // Relation must hold (which side moves is the solver's choice).
    let dto = s.dto();
    let (a, b) = line(&dto, l.entity_id);
    match dto
        .entities
        .iter()
        .find(|e| e.id() == p.entities[0])
        .unwrap()
    {
        EntityDto::Point { position, .. } => {
            let mid = v((a.x + b.x) / 2.0, (a.y + b.y) / 2.0);
            assert!(
                close(*position, mid),
                "point {position:?} != midpoint {mid:?}"
            );
        }
        _ => panic!("expected point"),
    }
}

#[test]
fn equal_lines_equalize_lengths() {
    let mut s = session();
    let l1 = s.add_line(v(0.0, 0.0), v(50.0, 0.0), true).unwrap();
    let l2 = s.add_line(v(0.0, 20.0), v(30.0, 20.0), true).unwrap();
    s.add_constraint(Constraint::Equal {
        a: l1.entity_id,
        b: l2.entity_id,
    })
    .unwrap();
    let dto = s.dto();
    let (a0, a1) = line(&dto, l1.entity_id);
    let (b0, b1) = line(&dto, l2.entity_id);
    assert!((a0.distance(a1) - b0.distance(b1)).abs() < 1e-7);
}

#[test]
fn tangent_line_circle_solves() {
    let mut s = session();
    let c = s
        .add_circle(CircleMode::CenterDiameter, v(50.0, 50.0), v(60.0, 50.0))
        .unwrap(); // r = 10
    let l = s.add_line(v(0.0, 30.0), v(80.0, 30.0), true).unwrap();
    s.add_constraint(Constraint::Tangent {
        a: l.entity_id,
        b: c.entities[0],
    })
    .unwrap();
    let dto = s.dto();
    let circle = dto
        .entities
        .iter()
        .find(|e| e.id() == c.entities[0])
        .unwrap();
    let (a, b) = line(&dto, l.entity_id);
    match circle {
        EntityDto::Circle { center, radius, .. } => {
            // Distance from center to line equals radius.
            let d = ((b.x - a.x) * (center.y - a.y) - (b.y - a.y) * (center.x - a.x)).abs()
                / a.distance(b);
            assert!((d - radius).abs() < 1e-6, "d={d} r={radius}");
        }
        _ => panic!("expected circle"),
    }
}

#[test]
fn concentric_circles_share_a_center() {
    let mut s = session();
    let c1 = s
        .add_circle(CircleMode::CenterDiameter, v(10.0, 10.0), v(20.0, 10.0))
        .unwrap();
    let c2 = s
        .add_circle(CircleMode::CenterDiameter, v(40.0, 30.0), v(50.0, 30.0))
        .unwrap();
    s.add_constraint(Constraint::Concentric {
        a: c1.entities[0],
        b: c2.entities[0],
    })
    .unwrap();
    let dto = s.dto();
    let centers: Vec<Vec2> = [c1.entities[0], c2.entities[0]]
        .iter()
        .map(
            |id| match dto.entities.iter().find(|e| e.id() == *id).unwrap() {
                EntityDto::Circle { center, .. } => *center,
                _ => panic!("expected circle"),
            },
        )
        .collect();
    assert!(close(centers[0], centers[1]));
}

#[test]
fn symmetry_of_two_points_about_a_line() {
    let mut s = session();
    let axis = s.add_line(v(0.0, 0.0), v(0.0, 50.0), true).unwrap(); // x = 0
                                                                     // Fix the axis so the POINTS must adjust (otherwise the blue axis
                                                                     // would simply move onto the segment midpoint — also valid).
    s.toggle_fix(axis.start_point_id).unwrap();
    s.toggle_fix(axis.end_point_id).unwrap();
    let p1 = s.add_point(v(10.0, 20.0)).unwrap();
    let p2 = s.add_point(v(-8.0, 20.0)).unwrap();
    s.add_constraint(Constraint::Symmetry {
        a: p1.entities[0],
        b: p2.entities[0],
        axis: axis.entity_id,
    })
    .unwrap();
    let dto = s.dto();
    let pos = |id| match dto.entities.iter().find(|e| e.id() == id).unwrap() {
        EntityDto::Point { position, .. } => *position,
        _ => panic!("expected point"),
    };
    let (a, b) = (pos(p1.entities[0]), pos(p2.entities[0]));
    // Midpoint on the axis (x = 0) and segment perpendicular to it.
    assert!(
        ((a.x + b.x) / 2.0).abs() < 1e-7,
        "midpoint x = {}",
        (a.x + b.x) / 2.0
    );
    assert!((a.y - b.y).abs() < 1e-7, "segment perpendicular to axis");
}

#[test]
fn fix_pins_geometry_and_blocks_conflicting_moves() {
    let mut s = session();
    let l = s.add_line(v(0.0, 0.0), v(50.0, 0.0), true).unwrap();
    s.toggle_fix(l.start_point_id).unwrap();
    // Dragging the fixed point is rejected (clamped to last good state).
    let r = s
        .move_point(move_req(l.start_point_id, v(10.0, 10.0)))
        .unwrap();
    let (start, _) = line(&r.sketch, l.entity_id);
    assert!(close(start, v(0.0, 0.0)), "fixed point must not move");
    // Unfix frees it again.
    s.toggle_fix(l.start_point_id).unwrap();
    let r = s
        .move_point(move_req(l.start_point_id, v(10.0, 10.0)))
        .unwrap();
    let (start, _) = line(&r.sketch, l.entity_id);
    assert!(close(start, v(10.0, 10.0)));
}

// --- Over-constraint rejection (D4.2) ---------------------------------------

#[test]
fn perpendicular_conflicting_with_parallel_is_rejected_and_named() {
    let mut s = session();
    let l1 = s.add_line(v(0.0, 0.0), v(50.0, 0.0), true).unwrap();
    let l2 = s.add_line(v(0.0, 20.0), v(50.0, 20.0), true).unwrap();
    s.add_constraint(Constraint::Parallel {
        a: l1.entity_id,
        b: l2.entity_id,
    })
    .unwrap();

    let err = s
        .add_constraint(Constraint::Perpendicular {
            a: l1.entity_id,
            b: l2.entity_id,
        })
        .unwrap_err();
    let msg = err.to_string();
    match err {
        nbcad_sketch::SessionError::OverConstrained {
            rejected,
            conflicts_with,
        } => {
            assert_eq!(rejected.kind, "perpendicular");
            assert!(
                conflicts_with.iter().any(|c| c.kind == "parallel"),
                "conflicts: {conflicts_with:?}"
            );
            assert!(msg.contains("conflicts with"), "{msg}");
        }
        other => panic!("expected OverConstrained, got {other:?}"),
    }
    // The sketch is untouched by the rejection.
    let dto = s.dto();
    assert_eq!(dto.constraints.len(), 1);
    assert_eq!(dto.constraints[0].constraint.kind_str(), "parallel");
}

#[test]
fn duplicate_horizontal_is_accepted_as_consistent_redundancy() {
    let mut s = session();
    let l = s.add_line(v(0.0, 0.0), v(50.0, 0.0), true).unwrap();
    s.add_constraint(Constraint::Horizontal {
        entity: l.entity_id,
    })
    .unwrap();
    // Same constraint again: consistent (no new equation rank) but not
    // inconsistent → accepted (harmless redundancy).
    let r = s.add_constraint(Constraint::Horizontal {
        entity: l.entity_id,
    });
    assert!(
        r.is_ok(),
        "redundant-but-consistent should pass: {:?}",
        r.err()
    );
}

#[test]
fn conflicting_fix_is_rejected() {
    // Two fully-fixed lines of different lengths: Equal cannot be satisfied
    // (nothing may move) → reject (D4.2).
    let mut s = session();
    let l1 = s.add_line(v(0.0, 0.0), v(50.0, 0.0), true).unwrap();
    let l2 = s.add_line(v(0.0, 20.0), v(30.0, 20.0), true).unwrap();
    for pid in [
        l1.start_point_id,
        l1.end_point_id,
        l2.start_point_id,
        l2.end_point_id,
    ] {
        s.toggle_fix(pid).unwrap();
    }
    assert_eq!(s.dto().dof.value, 0);
    let err = s
        .add_constraint(Constraint::Equal {
            a: l1.entity_id,
            b: l2.entity_id,
        })
        .unwrap_err();
    assert!(
        matches!(err, nbcad_sketch::SessionError::OverConstrained { .. }),
        "got {err:?}"
    );
}

// --- Locked dynamic-input endpoint math -------------------------------------

#[test]
fn locked_length_and_angle_produce_an_exact_point() {
    let mut s = session();
    let r = s
        .add_line_locked(&locked_seg(
            v(0.0, 0.0),
            v(99.0, 99.0),
            Some(50.0),
            Some(30.0),
        ))
        .unwrap();
    let (_, end) = line(&r.sketch, r.entity_id);
    let expect = v(50.0 * 30f64.cos().to_radians().cos(), 0.0); // placeholder replaced below
    let _ = expect;
    let want = v(
        50.0 * (30.0_f64.to_radians()).cos(),
        50.0 * (30.0_f64.to_radians()).sin(),
    );
    assert!(close(end, want), "end={end:?} want={want:?}");
}

#[test]
fn locked_length_only_projects_onto_the_circle() {
    let mut s = session();
    // Cursor at (10, 40): direction ≈ 76°; length locked to 50.
    let r = s
        .add_line_locked(&locked_seg(v(0.0, 0.0), v(10.0, 40.0), Some(50.0), None))
        .unwrap();
    let (_, end) = line(&r.sketch, r.entity_id);
    assert!((end.length() - 50.0).abs() < 1e-7);
    // Direction preserved from the cursor.
    let d = v(10.0, 40.0);
    assert!((end.x * d.y - end.y * d.x).abs() < 1e-7);
}

#[test]
fn locked_angle_only_projects_onto_the_ray() {
    let mut s = session();
    let r = s
        .add_line_locked(&locked_seg(v(0.0, 0.0), v(40.0, 33.0), None, Some(90.0)))
        .unwrap();
    let (_, end) = line(&r.sketch, r.entity_id);
    assert!(close(end, v(0.0, 33.0)));
}

#[test]
fn locked_endpoint_overrides_grid_snap_and_hv_inference() {
    let mut s = SketchSession::new("Sketch1", XY, XY.basis().unwrap(), true); // grid ON
    let r = s
        .add_line_locked(&locked_seg(
            v(0.0, 0.0),
            v(40.0, 5.0),
            Some(37.5),
            Some(10.0),
        ))
        .unwrap();
    let (_, end) = line(&r.sketch, r.entity_id);
    let want = v(
        37.5 * (10.0_f64.to_radians()).cos(),
        37.5 * (10.0_f64.to_radians()).sin(),
    );
    assert!(close(end, want), "locks must beat grid snap");
    // No H/V constraint was inferred (angle 10° is outside the cone, and
    // the lock suppresses inference regardless). The typed value DID
    // auto-create a driving dimension (D9): one Distance + one Angle dim.
    let kinds: Vec<_> = r
        .sketch
        .constraints
        .iter()
        .map(|c| c.constraint.kind_str())
        .collect();
    assert_eq!(kinds.iter().filter(|k| **k == "distance").count(), 1);
    assert_eq!(kinds.iter().filter(|k| **k == "angle").count(), 1);
    assert!(!kinds.iter().any(|k| *k == "horizontal" || *k == "vertical"));
}

// --- Drag with constraints (D4.4) ---------------------------------------------

/// Rectangle with H/V reshapes when a corner is dragged; adjacent corners
/// follow so all four constraints keep holding.
#[test]
fn dragging_a_rectangle_corner_keeps_it_rectangle_shaped() {
    let mut s = session();
    let rect = s
        .add_rectangle(RectangleMode::TwoPoint, v(0.0, 0.0), v(40.0, 20.0))
        .unwrap();
    let lines: Vec<_> = rect
        .sketch
        .entities
        .iter()
        .filter_map(|e| match e {
            EntityDto::Line { id, .. } => Some(*id),
            _ => None,
        })
        .collect();
    // Corner (40, 20) = third point.
    let corner = rect.entities[2];
    let r = s.move_point(move_req(corner, v(55.0, 35.0))).unwrap();
    let dto = r.sketch;
    for id in lines {
        let (a, b) = line(&dto, id);
        let axis_aligned = (a.x - b.x).abs() < 1e-7 || (a.y - b.y).abs() < 1e-7;
        assert!(
            axis_aligned,
            "line {id:?} must stay axis-aligned: {a:?}-{b:?}"
        );
    }
    // The dragged corner reached the cursor.
    let c = dto.entities.iter().find(|e| e.id() == corner).unwrap();
    match c {
        EntityDto::Point { position, .. } => assert!(close(*position, v(55.0, 35.0))),
        _ => panic!("expected point"),
    }
}

/// Coincident chains stay connected through a solver drag.
#[test]
fn dragging_a_chain_joint_keeps_both_lines_connected() {
    let mut s = session();
    let l1 = s.add_line(v(0.0, 0.0), v(30.0, 0.0), true).unwrap();
    let l2 = s.add_line(v(30.0, 0.0), v(30.0, 30.0), true).unwrap();
    s.add_constraint(Constraint::Horizontal {
        entity: l1.entity_id,
    })
    .unwrap();
    let joint = l1.end_point_id;
    let r = s.move_point(move_req(joint, v(45.0, 25.0))).unwrap();
    let (a, b) = line(&r.sketch, l1.entity_id);
    let (c, d) = line(&r.sketch, l2.entity_id);
    assert!(close(b, c), "shared joint must stay shared");
    assert!(close(b, v(45.0, 25.0)));
    assert!((a.y - b.y).abs() < 1e-7, "H must hold on l1");
    let _ = d;
}

/// WASM smoke sequence: chained H then inferred right-angle. #47 prefers a
/// relational Perpendicular over world-axis Vertical; the shared corner must
/// still follow the remaining free axis. A raw mm2 Perp residual used to
/// stall the drag so move_point reverted.
#[test]
fn dragging_a_chained_right_angle_follows_the_free_axis() {
    let mut s = SketchSession::new("Sketch1", XY, XY.basis().unwrap(), true);
    let l1 = s.add_line(v(0.0, 0.0), v(50.0, 1.0), false).unwrap();
    let l2 = s.add_line(v(50.0, 0.0), v(51.0, 50.0), false).unwrap();
    assert!(
        l2.created_constraints.iter().any(|c| matches!(
            c.constraint,
            Constraint::Perpendicular { a, b }
                if (a == l1.entity_id && b == l2.entity_id)
                    || (a == l2.entity_id && b == l1.entity_id)
        )),
        "chained right angle should persist as Perpendicular: {:?}",
        l2.created_constraints
    );
    let _l3 = s.add_line(v(50.0, 50.0), v(0.5, 0.4), false).unwrap();
    let dragged = s
        .move_point(move_req(l2.start_point_id, v(80.0, 0.0)))
        .unwrap();
    let (s1, e1) = line(&dragged.sketch, l1.entity_id);
    let (s2, e2) = line(&dragged.sketch, l2.entity_id);
    assert!((s1.y - e1.y).abs() < 1e-9, "H must hold");
    assert!((s2.x - e2.x).abs() < 1e-6, "right angle must stay vertical");
    assert!(s1.x.abs() < 1e-6 && s1.y.abs() < 1e-6, "origin must stay fixed");
    assert!(
        close(e1, v(80.0, 0.0)),
        "corner should follow the free axis, got {e1:?}"
    );
}

// --- New tool ops --------------------------------------------------------------

#[test]
fn rectangle_creates_four_hv_constrained_lines_in_one_undo_step() {
    let mut s = session();
    let r = s
        .add_rectangle(RectangleMode::TwoPoint, v(10.0, 10.0), v(50.0, 30.0))
        .unwrap();
    let kinds: Vec<_> = r
        .sketch
        .constraints
        .iter()
        .map(|c| c.constraint.kind_str())
        .collect();
    assert_eq!(kinds.iter().filter(|k| **k == "horizontal").count(), 2);
    assert_eq!(kinds.iter().filter(|k| **k == "vertical").count(), 2);
    assert_eq!(r.sketch.entities.len(), 8);
    let undone = s.undo().unwrap();
    assert_eq!(undone.sketch.entities.len(), 0);
}

#[test]
fn center_rectangle_uses_half_extents() {
    let mut s = session();
    let r = s
        .add_rectangle(RectangleMode::Center, v(50.0, 50.0), v(60.0, 60.0))
        .unwrap();
    let xs: Vec<f64> = r
        .sketch
        .entities
        .iter()
        .filter_map(|e| match e {
            EntityDto::Point { position, .. } => Some(position.x),
            _ => None,
        })
        .collect();
    assert!(xs.contains(&40.0) && xs.contains(&60.0));
}

#[test]
fn circle_modes_and_locked_diameter() {
    let mut s = session();
    let r = s
        .add_circle_locked(&LockedCircleRequest {
            mode: CircleMode::CenterDiameter,
            anchor: v(20.0, 20.0),
            diameter_mm: Some(30.0),
            diameter_text: None,
            edge_hint: v(99.0, 99.0),
            ctrl_held: false,
        })
        .unwrap();
    match r
        .sketch
        .entities
        .iter()
        .find(|e| e.id() == r.entities[0])
        .unwrap()
    {
        EntityDto::Circle { center, radius, .. } => {
            assert!(close(*center, v(20.0, 20.0)));
            assert!((radius - 15.0).abs() < 1e-9);
        }
        _ => panic!("expected circle"),
    }
    // 2-Point: diameter endpoints define center + radius.
    let r2 = s
        .add_circle(CircleMode::TwoPoint, v(0.0, 0.0), v(40.0, 0.0))
        .unwrap();
    match r2
        .sketch
        .entities
        .iter()
        .find(|e| e.id() == r2.entities[0])
        .unwrap()
    {
        EntityDto::Circle { center, radius, .. } => {
            assert!(close(*center, v(20.0, 0.0)));
            assert!((radius - 20.0).abs() < 1e-9);
        }
        _ => panic!("expected circle"),
    }
}

#[test]
fn three_point_arc_passes_through_all_three_points() {
    let mut s = session();
    let r = s
        .add_arc_3pt(v(20.0, 0.0), v(0.0, 20.0), v(-20.0, 0.0))
        .unwrap();
    match r
        .sketch
        .entities
        .iter()
        .find(|e| e.id() == r.entities[0])
        .unwrap()
    {
        EntityDto::Arc { center, radius, .. } => {
            assert!(close(*center, v(0.0, 0.0)), "center={center:?}");
            assert!((radius - 20.0).abs() < 1e-7);
        }
        _ => panic!("expected arc"),
    }
}

#[test]
fn midpoint_line_mirrors_endpoints_and_adds_midpoint_constraint() {
    let mut s = session();
    let r = s
        .add_line_midpoint(v(50.0, 50.0), v(80.0, 70.0), false)
        .unwrap();
    let line_id = r.entities[3];
    let (a, b) = line(&r.sketch, line_id);
    let mid = v((a.x + b.x) / 2.0, (a.y + b.y) / 2.0);
    assert!(close(mid, v(50.0, 50.0)));
    assert!(r
        .sketch
        .constraints
        .iter()
        .any(|c| c.constraint.kind_str() == "midpoint"));
}

#[test]
fn midpoint_line_reuses_snapped_midpoint_and_keeps_axis_inference() {
    let mut s = session();
    s.add_line(v(0.0, 0.0), v(60.0, 0.0), true).unwrap();
    let midpoint = s.add_point(v(30.0, 0.0)).unwrap().entities[0];
    let before_points = s
        .dto()
        .entities
        .iter()
        .filter(|entity| matches!(entity, EntityDto::Point { .. }))
        .count();
    let result = s
        .add_line_midpoint(v(30.7, 0.5), v(50.0, 0.6), false)
        .unwrap();
    assert_eq!(
        result.entities[0], midpoint,
        "midpoint snap must reuse the point"
    );
    assert_eq!(
        result
            .sketch
            .entities
            .iter()
            .filter(|entity| matches!(entity, EntityDto::Point { .. }))
            .count(),
        before_points + 2,
        "only the two mirrored endpoints should be new"
    );
    let line_id = result.entities[3];
    let (a, b) = line(&result.sketch, line_id);
    assert!((a.y - b.y).abs() < 1e-9);
    assert!(result.sketch.constraints.iter().any(|constraint| {
        matches!(
            constraint.constraint,
            Constraint::Horizontal { entity } if entity == line_id
        )
    }));
}

#[test]
fn unlocked_circle_edge_and_center_arc_sweep_snap_to_existing_points() {
    let mut s = session();
    s.add_point(v(12.0, 0.0)).unwrap();
    let circle = s
        .add_circle_locked(&LockedCircleRequest {
            mode: CircleMode::CenterDiameter,
            anchor: v(0.0, 0.0),
            diameter_mm: None,
            diameter_text: None,
            edge_hint: v(11.2, 0.5),
            ctrl_held: false,
        })
        .unwrap();
    match circle
        .sketch
        .entities
        .iter()
        .find(|entity| entity.id() == circle.entities[0])
        .unwrap()
    {
        EntityDto::Circle { radius, .. } => assert!((*radius - 12.0).abs() < 1e-9),
        other => panic!("expected circle, got {other:?}"),
    }

    s.add_point(v(0.0, 10.0)).unwrap();
    let arc = s
        .add_arc_center(v(0.0, 0.0), v(10.0, 0.0), v(0.7, 9.2))
        .unwrap();
    match arc
        .sketch
        .entities
        .iter()
        .find(|entity| entity.id() == arc.entities[0])
        .unwrap()
    {
        EntityDto::Arc { end_angle, .. } => {
            assert!((*end_angle - std::f64::consts::FRAC_PI_2).abs() < 1e-9)
        }
        other => panic!("expected arc, got {other:?}"),
    }
}

#[test]
fn bulk_constraints_and_fix_toggle_are_atomic_single_undo_actions() {
    let mut s = session();
    let first = s.add_line(v(0.0, 0.0), v(20.0, 0.5), true).unwrap();
    let second = s.add_line(v(30.0, 0.0), v(30.5, 20.0), true).unwrap();
    let before_batch = s.dto();
    let applied = s
        .add_constraints(vec![
            Constraint::Horizontal {
                entity: first.entity_id,
            },
            Constraint::Vertical {
                entity: second.entity_id,
            },
        ])
        .unwrap();
    assert_eq!(
        applied
            .sketch
            .constraints
            .iter()
            .filter(|constraint| matches!(
                constraint.constraint,
                Constraint::Horizontal { .. } | Constraint::Vertical { .. }
            ))
            .count(),
        2
    );
    let undone = s.undo().unwrap().sketch;
    assert_eq!(undone.entities, before_batch.entities);
    assert_eq!(undone.constraints, before_batch.constraints);

    let before_error = s.dto();
    s.add_constraints(vec![
        Constraint::Horizontal {
            entity: first.entity_id,
        },
        Constraint::Horizontal {
            entity: EntityId(9_999),
        },
    ])
    .unwrap_err();
    assert_eq!(
        s.dto(),
        before_error,
        "invalid late item must roll back the batch"
    );

    let fixed = s
        .toggle_fix_entities(vec![first.start_point_id, first.end_point_id])
        .unwrap();
    assert_eq!(
        fixed
            .sketch
            .constraints
            .iter()
            .filter(|constraint| matches!(constraint.constraint, Constraint::Fix { .. }))
            .count(),
        2
    );
    let undone = s.undo().unwrap().sketch;
    assert_eq!(undone.entities, before_error.entities);
    assert_eq!(undone.constraints, before_error.constraints);
}

// --- Undo covers solver motion --------------------------------------------------

#[test]
fn undo_restores_pre_constraint_state_including_solver_motion() {
    let mut s = session();
    let l1 = s.add_line(v(0.0, 0.0), v(50.0, 0.0), true).unwrap();
    let l2 = s.add_line(v(0.0, 20.0), v(50.0, 25.0), true).unwrap();
    s.add_constraint(Constraint::Parallel {
        a: l1.entity_id,
        b: l2.entity_id,
    })
    .unwrap();
    let solved = s.dto();
    // Parallelism must hold (which line moves is the solver's choice).
    let (a0, a1) = line(&solved, l1.entity_id);
    let (b0, b1) = line(&solved, l2.entity_id);
    let da = a1 - a0;
    let db = b1 - b0;
    assert!((da.x * db.y - da.y * db.x).abs() < 1e-7, "must be parallel");

    let undone = s.undo().unwrap();
    let (_, b1u) = line(&undone.sketch, l2.entity_id);
    assert!(
        close(b1u, v(50.0, 25.0)),
        "undo restores pre-solve geometry"
    );
    assert_eq!(undone.sketch.constraints.len(), 0);
}

#[test]
fn typed_angle_snaps_its_free_distance_to_the_active_grid() {
    let mut s = SketchSession::new("Sketch1", XY, XY.basis().unwrap(), true);
    s.set_grid_step(5.0).unwrap();
    let preview = s.preview_segment_locked(
        v(5.0, 10.0),
        None,
        Some(-45.0),
        v(15.16, -0.16),
        false,
        None,
        None,
        None,
        None,
    );
    assert_eq!(preview.snap, SnapTarget::Grid);
    assert!(close(preview.snapped_to, v(15.0, 0.0)));
    let delta = preview.snapped_to - v(5.0, 10.0);
    assert!((delta.y / delta.x + 1.0).abs() < 1e-9);
}

#[test]
fn line_tracking_is_exact_and_persists_as_a_point_relation() {
    let mut s = session();
    let reference = s.add_point(v(0.0, 5.0)).unwrap().entities[0];
    let result = s
        .add_line_locked(&LockedSegmentRequest {
            from: v(5.0, 15.0),
            to_hint: v(15.1, 4.9),
            from_crossing: None,
            to_crossing: None,
            length_mm: None,
            angle_deg: Some(-45.0),
            length_text: None,
            angle_text: None,
            ctrl_held: false,
            tracking: Some(LineTrackingRequest {
                point: reference,
                axis: TrackingAxis::Horizontal,
            }),
            intersection: None,
        })
        .unwrap();
    let (_, endpoint) = line(&result.sketch, result.entity_id);
    assert!(close(endpoint, v(15.0, 5.0)));
    assert!(result.sketch.constraints.iter().any(|constraint| matches!(
        constraint.constraint,
        Constraint::HorizontalPoints { a, b }
            if a == reference && b == result.end_point_id
    )));

    let moved = s
        .move_point(move_req(reference, v(0.0, 7.0)))
        .unwrap()
        .sketch;
    let reference_position = moved
        .entities
        .iter()
        .find_map(|entity| match entity {
            EntityDto::Point { id, position, .. } if *id == reference => Some(*position),
            _ => None,
        })
        .unwrap();
    let (_, moved_endpoint) = line(&moved, result.entity_id);
    assert!((moved_endpoint.y - reference_position.y).abs() < 1e-7);
}

#[test]
fn vertical_curve_intersection_beats_grid_and_persists_on_the_carrier() {
    let mut s = session();
    let diagonal = s.add_line(v(17.0, 8.0), v(25.0, 0.0), true).unwrap();
    s.set_grid_step(2.5).unwrap();
    s.set_grid_snap(true);
    let short_bottom = s
        .add_line_locked(&LockedSegmentRequest {
            from: v(25.0, 0.0),
            to_hint: v(24.5, 0.0),
            from_crossing: None,
            to_crossing: None,
            length_mm: None,
            angle_deg: None,
            length_text: Some("0.5".to_string()),
            angle_text: Some("180".to_string()),
            ctrl_held: false,
            tracking: None,
            intersection: None,
        })
        .unwrap();
    let (_, anchor) = line(&short_bottom.sketch, short_bottom.entity_id);
    assert!(close(anchor, v(24.5, 0.0)));

    let request = LineIntersectionRequest {
        curve: diagonal.entity_id,
        axis: TrackingAxis::Vertical,
    };
    let preview = s.preview_segment_locked(
        v(24.5, 0.0),
        None,
        None,
        v(24.48, 0.54),
        false,
        None,
        Some(request),
        None,
        None,
    );
    assert_eq!(
        preview.snap,
        SnapTarget::Curve {
            entity: diagonal.entity_id
        }
    );
    assert!(close(preview.snapped_to, v(24.5, 0.5)));
    assert!(preview
        .inferences
        .contains(&nbcad_sketch::Inference::Vertical));
    assert!(preview
        .inferences
        .contains(&nbcad_sketch::Inference::Coincident));

    let result = s
        .add_line_locked(&LockedSegmentRequest {
            from: v(24.5, 0.0),
            to_hint: v(24.48, 0.54),
            from_crossing: None,
            to_crossing: None,
            length_mm: None,
            angle_deg: None,
            length_text: None,
            angle_text: None,
            ctrl_held: false,
            tracking: None,
            intersection: Some(request),
        })
        .unwrap();
    let (start, end) = line(&result.sketch, result.entity_id);
    assert!(close(start, v(24.5, 0.0)), "start={start:?}, end={end:?}");
    assert!(close(end, v(24.5, 0.5)), "start={start:?}, end={end:?}");
    assert!((end.x - start.x).abs() < 1e-7);
    assert!(result.sketch.constraints.iter().any(|constraint| matches!(
        constraint.constraint,
        Constraint::Vertical { entity } if entity == result.entity_id
    ) || matches!(
        constraint.constraint,
        Constraint::Perpendicular { a, b }
            if (a == result.entity_id && b == short_bottom.entity_id)
                || (b == result.entity_id && a == short_bottom.entity_id)
    )));
    assert!(result.sketch.constraints.iter().any(|constraint| matches!(
        constraint.constraint,
        Constraint::Coincident { a, b }
            if a == result.end_point_id && b == diagonal.entity_id
    )));
}

#[test]
fn exact_crossing_start_survives_a_half_mm_chain_and_vertical_turn() {
    let mut s = session();
    let horizontal = s.add_line(v(0.0, 0.0), v(30.0, 0.0), true).unwrap();
    let diagonal = s.add_line(v(15.0, -5.0), v(25.0, 5.0), true).unwrap();
    let crossing = CurveCrossingRequest {
        first: horizontal.entity_id,
        second: diagonal.entity_id,
    };
    s.set_grid_step(10.0).unwrap();
    s.set_grid_snap(true);

    let short = s
        .add_line_locked(&LockedSegmentRequest {
            // Both hints are deliberately off the exact crossing/grid. The
            // stable carrier ids, not either approximate coordinate, own the
            // start location.
            from: v(20.17, -0.13),
            to_hint: v(19.4, 0.2),
            from_crossing: Some(crossing),
            to_crossing: None,
            length_mm: None,
            angle_deg: None,
            length_text: Some("0.5".to_string()),
            angle_text: Some("180".to_string()),
            ctrl_held: false,
            tracking: None,
            intersection: None,
        })
        .unwrap();
    let (start, end) = line(&short.sketch, short.entity_id);
    assert!(close(start, v(20.0, 0.0)), "start={start:?}");
    assert!(close(end, v(19.5, 0.0)), "end={end:?}");
    assert!((start.distance(end) - 0.5).abs() < 1e-9);

    for carrier in [horizontal.entity_id, diagonal.entity_id] {
        assert!(
            short.sketch.constraints.iter().any(|constraint| matches!(
                constraint.constraint,
                Constraint::Coincident { a, b }
                    if a == short.start_point_id && b == carrier
            )),
            "crossing point should remain attached to {carrier:?}"
        );
    }

    let vertical_preview = s.preview_segment_locked(
        end,
        None,
        None,
        v(19.53, 4.7),
        false,
        None,
        None,
        None,
        None,
    );
    assert!(vertical_preview
        .inferences
        .contains(&nbcad_sketch::Inference::Vertical));
    assert!((vertical_preview.snapped_to.x - 19.5).abs() < 1e-9);

    let upright = s
        .add_line_locked(&LockedSegmentRequest {
            from: end,
            to_hint: v(19.53, 4.7),
            from_crossing: None,
            to_crossing: None,
            length_mm: None,
            angle_deg: None,
            length_text: None,
            angle_text: None,
            ctrl_held: false,
            tracking: None,
            intersection: None,
        })
        .unwrap();
    let (turn_start, turn_end) = line(&upright.sketch, upright.entity_id);
    assert!(close(turn_start, end));
    assert!((turn_end.x - turn_start.x).abs() < 1e-9);
    assert!(upright.sketch.constraints.iter().any(|constraint| matches!(
        constraint.constraint,
        Constraint::Perpendicular { a, b }
            if (a == short.entity_id && b == upright.entity_id)
                || (a == upright.entity_id && b == short.entity_id)
    )));
}
