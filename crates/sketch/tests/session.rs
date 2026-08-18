//! Integration tests for the sketch-session API: snap priority, H/V +
//! coincident inference, structural coincident merging,
//! interim drag projection, delete cascades, undo/redo, session lifecycle,
//! and the host JSON envelope.

use nbcad_sketch::host;
use nbcad_sketch::{
    Constraint, DimensionRequest, DragPhase, EditDimensionRequest, EntityDto, Inference,
    LockedSegmentRequest, MovePointRequest, OriginPlane, PlaneRef, SegmentRequest, SketchManager,
    SketchSession, SnapTarget, Vec2,
};

fn v(x: f64, y: f64) -> Vec2 {
    Vec2::new(x, y)
}

const XY: PlaneRef = PlaneRef::OriginPlane {
    plane: OriginPlane::Xy,
};

/// Session with grid snap OFF (deterministic coordinates).
fn session_off_grid() -> SketchSession {
    SketchSession::new("Sketch1", XY, XY.basis().unwrap(), false)
}

/// Session with grid snap ON (10 mm step).
fn session_on_grid() -> SketchSession {
    SketchSession::new("Sketch1", XY, XY.basis().unwrap(), true)
}

fn seg(from: Vec2, to_raw: Vec2, ctrl_held: bool) -> SegmentRequest {
    SegmentRequest {
        from,
        to_raw,
        ctrl_held,
    }
}

fn line_endpoints(session: &SketchSession, dto_id: nbcad_sketch::EntityId) -> (Vec2, Vec2) {
    let dto = session.dto();
    match dto.entities.iter().find(|e| e.id() == dto_id) {
        Some(EntityDto::Line { start, end, .. }) => (*start, *end),
        other => panic!("expected line, got {other:?}"),
    }
}

// --- Snap priority ------------------------------------------------------

#[test]
fn point_snap_beats_grid_snap() {
    let mut s = session_off_grid();
    let r = s.add_line(v(0.0, 0.0), v(8.0, 0.0), false).unwrap(); // endpoint off-grid
    let p = r.end_point_id;
    s.set_grid_snap(true);
    // Grid would round (8.5, 0.4) to (10, 0); the nearby point must win.
    let preview = s.preview_segment(v(0.0, 0.0), v(8.5, 0.4), false);
    assert_eq!(preview.snap, SnapTarget::Point { entity: p });
    assert_eq!(preview.snapped_to, v(8.0, 0.0));
}

#[test]
fn origin_snap_when_no_point_nearby() {
    let s = session_off_grid();
    let preview = s.preview_segment(v(50.0, 50.0), v(0.6, -0.5), false);
    assert_eq!(preview.snap, SnapTarget::Origin);
    assert_eq!(preview.snapped_to, v(0.0, 0.0));
    assert_eq!(preview.inferences, vec![Inference::Coincident]);
}

#[test]
fn grid_snap_rounds_to_intersection_when_on() {
    let s = session_on_grid();
    let preview = s.preview_segment(v(0.0, 0.0), v(12.0, 8.0), true); // ctrl: no H/V projection
    assert_eq!(preview.snap, SnapTarget::Grid);
    assert_eq!(preview.snapped_to, v(10.0, 10.0));
}

#[test]
fn adaptive_grid_step_supports_one_micrometer() {
    let mut s = session_on_grid();
    s.set_grid_step(0.001).unwrap();
    let preview = s.preview_segment(v(20.0, 20.0), v(12.3454, 8.7656), true);
    assert_eq!(preview.snap, SnapTarget::Grid);
    assert!((preview.snapped_to.x - 12.345).abs() < 1e-12);
    assert!((preview.snapped_to.y - 8.766).abs() < 1e-12);
    assert!(s.set_grid_step(0.000_1).is_err());
}

#[test]
fn raw_fallback_when_grid_off_and_nothing_near() {
    let s = session_off_grid();
    let preview = s.preview_segment(v(100.0, 100.0), v(12.3, 8.7), true);
    assert_eq!(preview.snap, SnapTarget::None);
    assert_eq!(preview.snapped_to, v(12.3, 8.7));
}

// --- Inference (D4.1) ----------------------------------------------------

#[test]
fn horizontal_inference_near_axis_projects_endpoint() {
    let s = session_off_grid();
    // dy = 1 over dx = 50 (~1.1°) → Horizontal, y clamped to the start.
    let preview = s.preview_segment(v(0.0, 0.0), v(50.0, 1.0), false);
    assert_eq!(preview.inferences, vec![Inference::Horizontal]);
    assert_eq!(preview.snapped_to, v(50.0, 0.0));
}

#[test]
fn horizontal_is_the_default_until_the_cursor_is_intentionally_diagonal() {
    let s = session_off_grid();
    let nine_degrees = 50.0 * 9.0_f64.to_radians().tan();
    let preview = s.preview_segment(v(0.0, 0.0), v(50.0, nine_degrees), false);
    assert_eq!(preview.inferences, vec![Inference::Horizontal]);
    assert_eq!(preview.snapped_to, v(50.0, 0.0));
}

#[test]
fn horizontal_inference_uses_raw_cursor_before_grid_rounding() {
    let s = session_on_grid();
    // The anchor is intentionally halfway between 10 mm grid lines. The raw
    // cursor is almost horizontal, while independently rounding its Y to 20
    // would make the segment too steep for the inference cone.
    let preview = s.preview_segment(v(0.0, 15.0), v(30.0, 16.0), false);
    assert_eq!(preview.snap, SnapTarget::Grid);
    assert_eq!(preview.inferences, vec![Inference::Horizontal]);
    assert_eq!(preview.snapped_to, v(30.0, 15.0));
}

#[test]
fn vertical_inference_near_axis_projects_endpoint() {
    let s = session_off_grid();
    let preview = s.preview_segment(v(0.0, 0.0), v(1.0, 50.0), false);
    assert_eq!(preview.inferences, vec![Inference::Vertical]);
    assert_eq!(preview.snapped_to, v(0.0, 50.0));
}

#[test]
fn no_inference_outside_the_cone() {
    let s = session_off_grid();
    // dy = 10 over dx = 50 (~11.3°) → too steep for Horizontal.
    let preview = s.preview_segment(v(0.0, 0.0), v(50.0, 10.0), false);
    assert!(preview.inferences.is_empty());
    assert_eq!(preview.snapped_to, v(50.0, 10.0));
}

#[test]
fn ctrl_disables_inference() {
    let s = session_off_grid();
    let preview = s.preview_segment(v(0.0, 0.0), v(50.0, 1.0), true);
    assert!(preview.inferences.is_empty());
    assert_eq!(preview.snapped_to, v(50.0, 1.0));
}

#[test]
fn coincident_snap_wins_over_directional_inference() {
    let mut s = session_off_grid();
    let first = s.add_line(v(0.0, 0.0), v(50.0, 0.0), false).unwrap();
    let p = first.end_point_id;
    // Near the existing point AND near-horizontal: coincident, no H.
    let preview = s.preview_segment(v(0.0, 0.0), v(50.5, 0.5), false);
    assert_eq!(preview.snap, SnapTarget::Point { entity: p });
    assert_eq!(preview.inferences, vec![Inference::Coincident]);
}

// --- Midpoint auto-snap (M1d, D4.1 parity) -------------------------------

#[test]
fn midpoint_snap_reports_midpoint_target_without_inference() {
    let mut s = session_off_grid();
    s.add_line(v(0.0, 0.0), v(60.0, 0.0), false).unwrap(); // midpoint (30, 0)
    let host = s.dto().entities.iter().find_map(|e| match e {
        EntityDto::Line { id, .. } => Some(*id),
        _ => None,
    });
    let preview = s.preview_segment(v(10.0, 10.0), v(30.5, 0.8), false);
    assert_eq!(
        preview.snap,
        SnapTarget::Midpoint {
            entity: host.unwrap()
        }
    );
    assert_eq!(preview.snapped_to, v(30.0, 0.0));
    // No H/V projection on an exact midpoint snap; the triangle marker is
    // the glyph.
    assert!(preview.inferences.is_empty());
}

#[test]
fn midpoint_snap_creates_midpoint_constraint_on_commit() {
    let mut s = session_off_grid();
    let l1 = s.add_line(v(0.0, 0.0), v(60.0, 0.0), false).unwrap();
    let r = s.add_line(v(10.0, 10.0), v(30.5, 0.8), false).unwrap();
    // Endpoint landed exactly on the host line's midpoint.
    let (_, end) = line_endpoints(&s, r.entity_id);
    assert_eq!(end, v(30.0, 0.0));
    // A real Midpoint constraint ties the new endpoint to the host line.
    let expected = nbcad_sketch::Constraint::Midpoint {
        a: r.end_point_id,
        b: l1.entity_id,
    };
    assert!(r
        .created_constraints
        .iter()
        .any(|c| c.constraint == expected));
    assert!(s.dto().constraints.iter().any(|c| c.constraint == expected));
}

#[test]
fn midpoint_snap_at_segment_start_creates_constraint() {
    let mut s = session_off_grid();
    let l1 = s.add_line(v(0.0, 0.0), v(60.0, 0.0), false).unwrap();
    let r = s.add_line(v(30.5, 0.8), v(10.0, 10.0), false).unwrap();
    let (start, _) = line_endpoints(&s, r.entity_id);
    assert_eq!(start, v(30.0, 0.0));
    let expected = nbcad_sketch::Constraint::Midpoint {
        a: r.start_point_id,
        b: l1.entity_id,
    };
    assert!(r
        .created_constraints
        .iter()
        .any(|c| c.constraint == expected));
}

#[test]
fn ctrl_suppresses_midpoint_snap() {
    let mut s = session_off_grid();
    s.add_line(v(0.0, 0.0), v(60.0, 0.0), false).unwrap();
    let preview = s.preview_segment(v(10.0, 10.0), v(30.5, 0.8), true);
    assert_eq!(preview.snap, SnapTarget::None);
    assert_eq!(preview.snapped_to, v(30.5, 0.8));

    let r = s.add_line(v(10.0, 10.0), v(30.5, 0.8), true).unwrap();
    assert!(r.created_constraints.is_empty());
    assert!(!s
        .dto()
        .constraints
        .iter()
        .any(|c| matches!(c.constraint, nbcad_sketch::Constraint::Midpoint { .. })));
}

#[test]
fn point_snap_beats_midpoint_snap() {
    let mut s = session_off_grid();
    s.add_line(v(0.0, 0.0), v(60.0, 0.0), false).unwrap();
    let p = s.add_point(v(30.0, 0.0)).unwrap().entities[0]; // at the midpoint
    let preview = s.preview_segment(v(10.0, 10.0), v(30.5, 0.8), false);
    assert_eq!(preview.snap, SnapTarget::Point { entity: p });
    assert_eq!(preview.inferences, vec![Inference::Coincident]);
}

#[test]
fn point_tool_places_an_atomic_coincident_point_on_a_line() {
    let mut s = session_off_grid();
    let carrier = s
        .add_line(v(0.0, 0.0), v(60.0, 0.0), false)
        .unwrap()
        .entity_id;
    let point = s
        .add_point_on(v(31.0, 2.0), Some(carrier))
        .unwrap()
        .entities[0];
    let dto = s.dto();

    let placed = dto
        .entities
        .iter()
        .find_map(|entity| match entity {
            EntityDto::Point { id, position, .. } if *id == point => Some(*position),
            _ => None,
        })
        .unwrap();
    assert!((placed.x - 31.0).abs() < 1e-8);
    assert!(placed.y.abs() < 1e-8);
    assert!(dto.constraints.iter().any(|constraint| matches!(
        constraint.constraint,
        nbcad_sketch::Constraint::Coincident { a, b }
            if a == point && b == carrier
    )));

    let undone = s.undo().unwrap().sketch;
    assert!(!undone.entities.iter().any(|entity| entity.id() == point));
}

#[test]
fn point_tool_keeps_a_dimensioned_point_on_a_virtual_line_extension() {
    let mut s = session_off_grid();
    let line = s.add_line(v(0.0, 0.0), v(60.0, 0.0), false).unwrap();
    let point = s
        .add_point_on(v(75.0, 2.0), Some(line.entity_id))
        .unwrap()
        .entities[0];

    let placed = s
        .dto()
        .entities
        .iter()
        .find_map(|entity| match entity {
            EntityDto::Point { id, position, .. } if *id == point => Some(*position),
            _ => None,
        })
        .unwrap();
    assert!((placed.x - 75.0).abs() < 1e-8);
    assert!(placed.y.abs() < 1e-8);

    // Lock the carrier so editing a distance can only move the acquired
    // point along its infinite support.
    s.toggle_fix(line.start_point_id).unwrap();
    s.toggle_fix(line.end_point_id).unwrap();
    let dimension = s
        .add_dimension(DimensionRequest {
            entities: vec![point, line.end_point_id],
            text_pos: v(75.0, 10.0),
            value_text: None,
        })
        .unwrap();
    let edited = s
        .edit_dimension(EditDimensionRequest {
            constraint_id: dimension.sketch.dimensions[0].constraint_id,
            text: "30".to_string(),
        })
        .unwrap()
        .sketch;
    let moved = edited
        .entities
        .iter()
        .find_map(|entity| match entity {
            EntityDto::Point { id, position, .. } if *id == point => Some(*position),
            _ => None,
        })
        .unwrap();
    assert!(moved.y.abs() < 1e-8);
    assert!((moved.distance(v(60.0, 0.0)) - 30.0).abs() < 1e-8);
    assert!(edited.constraints.iter().any(|constraint| matches!(
        constraint.constraint,
        nbcad_sketch::Constraint::Coincident { a, b }
            if a == point && b == line.entity_id
    )));
}

#[test]
fn midpoint_snap_respects_point_snap_toggle() {
    let mut s = session_off_grid();
    s.add_line(v(0.0, 0.0), v(60.0, 0.0), false).unwrap();
    s.set_grid_snap(false); // palette "Snap" off disables point snaps too
    let preview = s.preview_segment(v(10.0, 10.0), v(30.5, 0.8), false);
    assert_eq!(preview.snap, SnapTarget::None);
}

// --- add_line ------------------------------------------------------------

#[test]
fn chained_lines_share_the_connecting_point() {
    let mut s = session_off_grid();
    let l1 = s.add_line(v(0.0, 0.0), v(50.0, 0.0), false).unwrap();
    let l2 = s.add_line(v(50.0, 0.0), v(50.0, 50.0), false).unwrap();
    assert_eq!(l2.start_point_id, l1.end_point_id);
    assert_ne!(l2.end_point_id, l1.end_point_id);
    // 3 points + 2 lines.
    assert_eq!(l2.sketch.entities.len(), 5);
}

#[test]
fn snapping_onto_an_existing_point_merges_structurally() {
    let mut s = session_off_grid();
    let l1 = s.add_line(v(0.0, 0.0), v(50.0, 0.0), false).unwrap();
    // End the second line right on the first line's end point.
    let l2 = s.add_line(v(60.0, 10.0), v(50.5, 0.4), false).unwrap();
    assert_eq!(l2.end_point_id, l1.end_point_id);
    // Coincident is structural: no constraint record was created.
    assert!(l2.created_constraints.is_empty());
    // The merge produced no duplicate point.
    assert_eq!(l2.sketch.entities.len(), 5);
}

#[test]
fn add_line_creates_hv_constraints_from_inference() {
    let mut s = session_off_grid();
    let h = s.add_line(v(0.0, 0.0), v(50.0, 1.0), false).unwrap();
    assert_eq!(h.created_constraints.len(), 1);
    assert_eq!(h.created_constraints[0].constraint, {
        nbcad_sketch::Constraint::Horizontal {
            entity: h.entity_id,
        }
    });
    // The endpoint was projected exactly horizontal.
    let (_, end) = line_endpoints(&s, h.entity_id);
    assert_eq!(end, v(50.0, 0.0));

    let vert = s.add_line(v(100.0, 0.0), v(100.5, 50.0), false).unwrap();
    assert_eq!(vert.created_constraints.len(), 1);
}

#[test]
fn a_short_line_does_not_snap_its_endpoint_back_to_its_own_start() {
    let mut s = session_on_grid();
    let line = s.add_line(v(0.0, 0.0), v(0.5, 0.0), false).unwrap();
    let (start, end) = line_endpoints(&s, line.entity_id);
    assert_eq!(start, v(0.0, 0.0));
    assert!((end.distance(start) - 0.5).abs() < 1e-9, "end={end:?}");
}

#[test]
fn a_locked_half_millimeter_line_stays_valid_with_point_snap_enabled() {
    for angle_text in [None, Some("-45")] {
        let mut s = session_on_grid();
        let line = s
            .add_line_locked(&LockedSegmentRequest {
                from: v(0.0, 0.0),
                to_hint: v(1.0, -1.0),
                from_crossing: None,
                to_crossing: None,
                length_mm: None,
                angle_deg: None,
                length_text: Some("0.5".to_string()),
                angle_text: angle_text.map(str::to_string),
                ctrl_held: false,
                tracking: None,
                intersection: None,
            })
            .unwrap();
        let (start, end) = line_endpoints(&s, line.entity_id);
        assert!((end.distance(start) - 0.5).abs() < 1e-8, "end={end:?}");
    }
}

#[test]
fn connected_right_angles_prefer_relational_perpendicular_constraints() {
    let mut s = session_off_grid();
    let left = s.add_line(v(0.0, 0.0), v(0.0, 10.0), false).unwrap();
    let top = s.add_line(v(0.0, 10.0), v(17.0, 10.0), false).unwrap();
    let diagonal = s
        .add_line_locked(&LockedSegmentRequest {
            from: v(17.0, 10.0),
            to_hint: v(27.0, 0.0),
            from_crossing: None,
            to_crossing: None,
            length_mm: None,
            angle_deg: None,
            length_text: None,
            angle_text: Some("-45".to_string()),
            ctrl_held: false,
            tracking: None,
            intersection: None,
        })
        .unwrap();
    let bottom = s.add_line(v(27.0, 0.0), v(0.0, 0.0), false).unwrap();

    let dto = s.dto();
    let has_perpendicular = |other| {
        dto.constraints.iter().any(|constraint| {
            matches!(
                constraint.constraint,
                Constraint::Perpendicular { a, b }
                    if (a == left.entity_id && b == other)
                        || (a == other && b == left.entity_id)
            )
        })
    };
    assert!(has_perpendicular(top.entity_id));
    assert!(has_perpendicular(bottom.entity_id));
    assert!(!dto.constraints.iter().any(|constraint| matches!(
        constraint.constraint,
        Constraint::Horizontal { entity }
            if entity == top.entity_id || entity == bottom.entity_id
    )));
    assert!(dto.constraints.iter().any(|constraint| matches!(
        constraint.constraint,
        Constraint::Angle { a, b, value }
            if a == diagonal.entity_id && b.0 == 0 && (value + 45.0).abs() < 1e-7
    )));
}

#[test]
fn add_line_with_ctrl_creates_no_constraints() {
    let mut s = session_off_grid();
    let r = s.add_line(v(0.0, 0.0), v(50.0, 1.0), true).unwrap();
    assert!(r.created_constraints.is_empty());
    assert_eq!(r.sketch.constraints.len(), 0);
}

#[test]
fn degenerate_segments_are_rejected_without_mutating() {
    let mut s = session_off_grid();
    let first = s.add_line(v(10.0, 10.0), v(30.0, 10.0), false).unwrap();
    let before = first.sketch.entities.len();
    // Clicking the same existing point twice → degenerate.
    let err = s.add_line(v(10.0, 10.0), v(10.0, 10.0), false).unwrap_err();
    assert!(err.to_string().contains("zero length"));
    assert_eq!(s.dto().entities.len(), before);
}

// --- move_point (interim projection, TODO(M1b): solver) -------------------

fn move_req(point_id: nbcad_sketch::EntityId, to: Vec2, phase: DragPhase) -> MovePointRequest {
    MovePointRequest {
        point_id,
        to_raw: to,
        ctrl_held: false,
        phase,
    }
}

#[test]
fn dragging_a_horizontal_line_endpoint_translates_the_line_keeping_h() {
    // Solver drag (M1b): the endpoint is pinned to the cursor and the rest
    // of the sketch is re-solved — the Horizontal constraint keeps holding,
    // so the whole line translates vertically (rubber-banding
    // under-constrained geometry, D4.4).
    let mut s = session_off_grid();
    let l = s.add_line(v(0.0, 0.0), v(50.0, 1.0), false).unwrap(); // H inferred
    let r = s
        .move_point(move_req(l.end_point_id, v(70.0, 30.0), DragPhase::Single))
        .unwrap();
    let (start, end) = line_endpoints_dto(&r.sketch, l.entity_id);
    assert_eq!(end, v(70.0, 30.0)); // pinned exactly to the cursor
    assert!((start.y - end.y).abs() < 1e-9, "H must hold after drag");
}

#[test]
fn dragging_a_vertical_line_endpoint_translates_the_line_keeping_v() {
    let mut s = session_off_grid();
    let l = s.add_line(v(0.0, 0.0), v(1.0, 50.0), false).unwrap(); // V inferred
    let r = s
        .move_point(move_req(l.end_point_id, v(30.0, 70.0), DragPhase::Single))
        .unwrap();
    let (start, end) = line_endpoints_dto(&r.sketch, l.entity_id);
    assert_eq!(end, v(30.0, 70.0)); // pinned exactly to the cursor
    assert!((start.x - end.x).abs() < 1e-9, "V must hold after drag");
}

#[test]
fn unconstrained_points_drag_freely() {
    let mut s = session_off_grid();
    let l = s.add_line(v(0.0, 0.0), v(50.0, 30.0), true).unwrap(); // ctrl: no H/V
    let r = s
        .move_point(move_req(l.end_point_id, v(61.0, 42.0), DragPhase::Single))
        .unwrap();
    let (_, end) = line_endpoints_dto(&r.sketch, l.entity_id);
    assert_eq!(end, v(61.0, 42.0));
}

#[test]
fn moving_a_shared_point_moves_both_connected_lines() {
    let mut s = session_off_grid();
    let l1 = s.add_line(v(0.0, 0.0), v(50.0, 30.0), true).unwrap();
    let l2 = s.add_line(v(50.0, 30.0), v(90.0, 10.0), true).unwrap();
    let shared = l1.end_point_id;
    let r = s
        .move_point(move_req(shared, v(55.0, 35.0), DragPhase::Single))
        .unwrap();
    let (_, end1) = line_endpoints_dto(&r.sketch, l1.entity_id);
    let (start2, _) = line_endpoints_dto(&r.sketch, l2.entity_id);
    assert_eq!(end1, v(55.0, 35.0));
    assert_eq!(start2, v(55.0, 35.0));
}

fn line_endpoints_dto(dto: &nbcad_sketch::SketchDto, id: nbcad_sketch::EntityId) -> (Vec2, Vec2) {
    match dto.entities.iter().find(|e| e.id() == id) {
        Some(EntityDto::Line { start, end, .. }) => (*start, *end),
        other => panic!("expected line, got {other:?}"),
    }
}

#[test]
fn a_rubber_band_drag_is_one_undoable_command() {
    let mut s = session_off_grid();
    let l = s.add_line(v(0.0, 0.0), v(50.0, 30.0), true).unwrap();
    let p = l.end_point_id;
    s.move_point(move_req(p, v(51.0, 31.0), DragPhase::Begin))
        .unwrap();
    s.move_point(move_req(p, v(55.0, 33.0), DragPhase::Update))
        .unwrap();
    s.move_point(move_req(p, v(60.0, 40.0), DragPhase::End))
        .unwrap();

    let before_undo = s.undo().unwrap();
    // One undo restores the pre-drag position (not intermediate updates).
    let (_, end) = line_endpoints_dto(&before_undo.sketch, l.entity_id);
    assert_eq!(end, v(50.0, 30.0));
    let redone = s.redo().unwrap();
    let (_, end) = line_endpoints_dto(&redone.sketch, l.entity_id);
    assert_eq!(end, v(60.0, 40.0));
}

// --- delete ---------------------------------------------------------------

#[test]
fn deleting_a_point_deletes_connected_lines_and_constraints() {
    let mut s = session_off_grid();
    let l1 = s.add_line(v(0.0, 0.0), v(50.0, 1.0), false).unwrap(); // H inferred
    let l2 = s.add_line(v(50.0, 0.0), v(90.0, 30.0), true).unwrap();
    let shared = l1.end_point_id;

    let r = s.delete_entity(shared).unwrap();
    assert!(r.removed.contains(&shared));
    assert!(r.removed.contains(&l1.entity_id));
    assert!(r.removed.contains(&l2.entity_id));
    assert_eq!(r.sketch.constraints.len(), 0);
    // Only the two outer endpoints survive.
    assert_eq!(r.sketch.entities.len(), 2);
}

#[test]
fn deleting_a_line_keeps_its_points() {
    let mut s = session_off_grid();
    let l = s.add_line(v(0.0, 0.0), v(50.0, 0.0), false).unwrap();
    let r = s.delete_entity(l.entity_id).unwrap();
    assert_eq!(r.removed, vec![l.entity_id]);
    assert_eq!(r.sketch.entities.len(), 2); // the two endpoints
}

// --- undo / redo ----------------------------------------------------------

#[test]
fn undo_redo_add_line_roundtrip_with_stable_ids() {
    let mut s = session_off_grid();
    let l = s.add_line(v(0.0, 0.0), v(50.0, 0.0), false).unwrap();
    assert!(l.sketch.can_undo);
    assert!(!l.sketch.can_redo);

    let undone = s.undo().unwrap();
    assert_eq!(undone.sketch.entities.len(), 0);
    assert!(!undone.sketch.can_undo);
    assert!(undone.sketch.can_redo);

    let redone = s.redo().unwrap();
    assert_eq!(redone.sketch.entities.len(), 3);
    assert!(redone.sketch.entities.iter().any(|e| e.id() == l.entity_id));
}

#[test]
fn delete_is_undoable_with_full_cascade_restore() {
    let mut s = session_off_grid();
    let l1 = s.add_line(v(0.0, 0.0), v(50.0, 1.0), false).unwrap(); // H inferred
    s.add_line(v(50.0, 0.0), v(90.0, 30.0), true).unwrap();
    s.delete_entity(l1.end_point_id).unwrap();
    assert_eq!(s.dto().entities.len(), 2);

    let restored = s.undo().unwrap();
    assert_eq!(restored.sketch.entities.len(), 5);
    assert_eq!(restored.sketch.constraints.len(), 1);
}

#[test]
fn a_new_mutation_clears_the_redo_stack() {
    let mut s = session_off_grid();
    s.add_line(v(0.0, 0.0), v(50.0, 0.0), false).unwrap();
    s.undo().unwrap();
    assert!(s.dto().can_redo);
    let r = s.add_line(v(0.0, 0.0), v(0.0, 50.0), false).unwrap();
    assert!(!r.sketch.can_redo);
    assert!(s.redo().is_err());
}

// --- Session lifecycle (manager) -----------------------------------------

#[test]
fn begin_sketch_names_and_registers_in_browser_tree() {
    let mut m = SketchManager::new();
    let dto = m.begin_sketch(XY).unwrap();
    assert_eq!(dto.name, "Sketch1");
    let doc = m.document_dto();
    let sketches = doc
        .browser
        .iter()
        .find(|n| n.kind == nbcad_core::BrowserNodeKind::SketchesFolder)
        .unwrap();
    assert_eq!(sketches.children.len(), 1);
    assert_eq!(sketches.children[0].name.as_deref(), Some("Sketch1"));

    m.end_sketch().unwrap();
    let dto2 = m.begin_sketch(XY).unwrap();
    assert_eq!(dto2.name, "Sketch2");
    let doc = m.document_dto();
    let sketches = doc
        .browser
        .iter()
        .find(|n| n.kind == nbcad_core::BrowserNodeKind::SketchesFolder)
        .unwrap();
    assert_eq!(sketches.children.len(), 2);
}

#[test]
fn lifecycle_errors_are_explicit() {
    let mut m = SketchManager::new();
    assert!(m
        .preview_segment(seg(v(0.0, 0.0), v(1.0, 1.0), false))
        .is_err());
    assert!(m.end_sketch().is_err());
    m.begin_sketch(XY).unwrap();
    assert!(m.begin_sketch(XY).is_err()); // already active
    assert!(m.active_snapshot().is_some());
    m.end_sketch().unwrap();
    assert!(m.active_snapshot().is_none());
}

#[test]
fn edit_sketch_round_trip_preserves_session_and_undo() {
    let mut m = SketchManager::new();
    m.begin_sketch(XY).unwrap();
    m.add_line(seg(v(0.0, 0.0), v(50.0, 0.0), false)).unwrap();
    m.add_line(seg(v(50.0, 0.0), v(50.0, 50.0), false)).unwrap();
    m.end_sketch().unwrap();

    // Finished list carries the full snapshot (3 points + 2 lines + H constraint).
    let finished = m.finished_sketches();
    assert_eq!(finished.len(), 1);
    assert_eq!(finished[0].name, "Sketch1");
    assert_eq!(finished[0].entities.len(), 5);

    // Re-enter: entities survive; the session-scoped undo stack survives too.
    let dto = m.edit_sketch("Sketch1").unwrap();
    assert_eq!(dto.entities.len(), 5);
    assert!(dto.can_undo);
    assert!(m.finished_sketches().is_empty());

    // Undo still reaches back into the pre-finish edits.
    m.undo().unwrap();
    assert_eq!(m.active_snapshot().unwrap().entities.len(), 3);
    m.end_sketch().unwrap();
    assert_eq!(m.finished_sketches().len(), 1);

    // Unknown names are explicit errors; editing while active is rejected.
    assert!(m.edit_sketch("Nope").is_err());
    m.begin_sketch(XY).unwrap();
    assert!(m.edit_sketch("Sketch1").is_err());
}

#[test]
fn unsupported_plane_kinds_are_rejected() {
    let mut m = SketchManager::new();
    let face = PlaneRef::PlanarFace {
        face_id: nbcad_sketch::FaceId(1),
    };
    assert!(m.begin_sketch(face).is_err());
}

#[test]
fn grid_snap_preference_applies_to_sessions() {
    let mut m = SketchManager::new();
    m.begin_sketch(XY).unwrap();
    // Default on: (12, 8) snaps to (10, 10) even with ctrl held.
    let p = m
        .preview_segment(seg(v(0.0, 0.0), v(12.0, 8.0), true))
        .unwrap();
    assert_eq!(p.snapped_to, v(10.0, 10.0));
    m.set_grid_snap(nbcad_sketch::SetGridSnapRequest { enabled: false })
        .unwrap();
    let p = m
        .preview_segment(seg(v(0.0, 0.0), v(12.0, 8.0), true))
        .unwrap();
    assert_eq!(p.snapped_to, v(12.0, 8.0));
}

#[test]
fn adaptive_grid_preference_applies_to_new_sessions() {
    let mut m = SketchManager::new();
    m.set_grid_step(nbcad_sketch::SetGridStepRequest { step_mm: 0.001 })
        .unwrap();
    m.begin_sketch(XY).unwrap();
    let p = m
        .preview_segment(seg(v(20.0, 20.0), v(12.3454, 8.7656), true))
        .unwrap();
    assert!((p.snapped_to.x - 12.345).abs() < 1e-12);
    assert!((p.snapped_to.y - 8.766).abs() < 1e-12);
}

// --- Host dispatch / JSON envelope (D8) -----------------------------------

#[test]
fn host_envelope_ok_and_error_shapes() {
    let mut m = SketchManager::new();
    let doc = host::handle(&mut m, "document", "");
    let v_doc: serde_json::Value = serde_json::from_str(&doc).unwrap();
    assert_eq!(v_doc["ok"], true);
    assert_eq!(v_doc["value"]["settings"]["units"], "mm");

    let bad = host::handle(&mut m, "begin_sketch", "{not json");
    let v_bad: serde_json::Value = serde_json::from_str(&bad).unwrap();
    assert_eq!(v_bad["ok"], false);
    assert!(v_bad["error"].as_str().unwrap().contains("bad request"));

    let unknown = host::handle(&mut m, "explode", "");
    let v_unknown: serde_json::Value = serde_json::from_str(&unknown).unwrap();
    assert_eq!(v_unknown["ok"], false);
    assert!(v_unknown["error"]
        .as_str()
        .unwrap()
        .contains("unknown engine method"));
}

#[test]
fn host_roundtrip_begin_add_undo() {
    let mut m = SketchManager::new();
    let r = host::handle(
        &mut m,
        "begin_sketch",
        r#"{"type":"origin_plane","plane":"xy"}"#,
    );
    let v: serde_json::Value = serde_json::from_str(&r).unwrap();
    assert_eq!(v["ok"], true);
    assert_eq!(v["value"]["name"], "Sketch1");
    assert_eq!(
        v["value"]["basis"]["normal"],
        serde_json::json!([0.0, 0.0, 1.0])
    );

    let r = host::handle(
        &mut m,
        "add_line",
        r#"{"from":{"x":0.0,"y":0.0},"to_raw":{"x":50.0,"y":1.0},"ctrl_held":false}"#,
    );
    let v: serde_json::Value = serde_json::from_str(&r).unwrap();
    assert_eq!(v["ok"], true);
    assert_eq!(v["value"]["created_constraints"][0]["type"], "horizontal");
    assert_eq!(v["value"]["sketch"]["can_undo"], true);

    let r = host::handle(&mut m, "undo", "");
    let v: serde_json::Value = serde_json::from_str(&r).unwrap();
    assert_eq!(
        v["value"]["sketch"]["entities"].as_array().unwrap().len(),
        0
    );
}
