//! Modify-tool integration tests (M1c-ii): fillet creates arc + trims +
//! coincident, chamfer, offset sign rules, trim/extend/break, mirror
//! winding, polygon, scale in place, single-undo per tool.

use nbcad_sketch::{
    BreakRequest, ChamferRequest, CircularPatternRequest, Constraint, EditDimensionRequest,
    EntityDto, EntityId, ExtendRequest, FilletRequest, MirrorRequest, MoveCopyRequest,
    OffsetRequest, OriginPlane, PlaneRef, PolygonRequest, RectangularPatternRequest, ScaleRequest,
    SketchSession, TrimRequest, Vec2,
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

fn line(dto: &nbcad_sketch::SketchDto, id: nbcad_sketch::EntityId) -> (Vec2, Vec2) {
    match dto.entities.iter().find(|e| e.id() == id) {
        Some(EntityDto::Line { start, end, .. }) => (*start, *end),
        other => panic!("expected line, got {other:?}"),
    }
}

fn close(a: Vec2, b: Vec2) -> bool {
    a.distance(b) < 1e-7
}

/// Two lines sharing the origin corner (L shape): x-axis then y-axis.
fn l_shape(s: &mut SketchSession) -> (nbcad_sketch::EntityId, nbcad_sketch::EntityId) {
    let l1 = s.add_line(v(0.0, 0.0), v(50.0, 0.0), true).unwrap();
    let l2 = s.add_line(v(0.0, 0.0), v(0.0, 50.0), true).unwrap();
    (l1.entity_id, l2.entity_id)
}

#[test]
fn fillet_creates_arc_trims_lines_and_keeps_one_undo() {
    let mut s = session();
    let (l1, l2) = l_shape(&mut s);
    let r = s
        .fillet_lines(&FilletRequest {
            l1,
            l2,
            radius_text: "10".to_string(),
        })
        .unwrap();
    let dto = r.sketch;
    // Arc exists with the right center/radius.
    let arc = dto
        .entities
        .iter()
        .find(|e| matches!(e, EntityDto::Arc { .. }))
        .expect("arc created");
    match arc {
        EntityDto::Arc { center, radius, .. } => {
            assert!(close(*center, v(10.0, 10.0)));
            assert!((radius - 10.0).abs() < 1e-9);
        }
        _ => unreachable!(),
    }
    // Lines trimmed at the tangent points (either endpoint order).
    let (a1, b1) = line(&dto, l1);
    let (a2, b2) = line(&dto, l2);
    assert!(
        (close(a1, v(10.0, 0.0)) && close(b1, v(50.0, 0.0)))
            || (close(b1, v(10.0, 0.0)) && close(a1, v(50.0, 0.0))),
        "l1 {a1:?}-{b1:?}"
    );
    assert!(
        (close(a2, v(0.0, 10.0)) && close(b2, v(0.0, 50.0)))
            || (close(b2, v(0.0, 10.0)) && close(a2, v(0.0, 50.0))),
        "l2 {a2:?}-{b2:?}"
    );
    // Tangent constraints + radius dimension.
    let tangents = dto
        .constraints
        .iter()
        .filter(|c| c.constraint.kind_str() == "tangent")
        .count();
    assert_eq!(tangents, 2);
    assert_eq!(dto.dimensions.len(), 1);
    assert_eq!(dto.dimensions[0].text, "R10.00");
    // One undo restores the L shape exactly.
    let undone = s.undo().unwrap();
    assert!(undone
        .sketch
        .entities
        .iter()
        .all(|e| !matches!(e, EntityDto::Arc { .. })));
    let (_, e1u) = line(&undone.sketch, l1);
    assert!(close(e1u, v(50.0, 0.0)));
    assert!(undone.sketch.dimensions.is_empty());
}

#[test]
fn chamfer_trims_and_connects() {
    let mut s = session();
    let (l1, l2) = l_shape(&mut s);
    let r = s
        .chamfer_lines(&ChamferRequest {
            l1,
            l2,
            distance_text: "10".to_string(),
        })
        .unwrap();
    let dto = r.sketch;
    let (a1, b1) = line(&dto, l1);
    let (a2, b2) = line(&dto, l2);
    assert!(
        (close(a1, v(10.0, 0.0)) && close(b1, v(50.0, 0.0)))
            || (close(b1, v(10.0, 0.0)) && close(a1, v(50.0, 0.0))),
        "l1 {a1:?}-{b1:?}"
    );
    assert!(
        (close(a2, v(0.0, 10.0)) && close(b2, v(0.0, 50.0)))
            || (close(b2, v(0.0, 10.0)) && close(a2, v(0.0, 50.0))),
        "l2 {a2:?}-{b2:?}"
    );
    // The connecting chamfer line links the two trimmed ends.
    let lines: Vec<_> = dto
        .entities
        .iter()
        .filter(|e| matches!(e, EntityDto::Line { .. }))
        .collect();
    assert_eq!(lines.len(), 3);
    let chamfer_line = lines
        .iter()
        .find(|e| {
            matches!(e, EntityDto::Line { start, end, .. } if close(*start, v(10.0,0.0)) || close(*end, v(10.0,0.0)))
                && matches!(e, EntityDto::Line { start, end, .. } if close(*start, v(0.0,10.0)) || close(*end, v(0.0,10.0)))
        })
        .expect("chamfer line exists");
    match chamfer_line {
        EntityDto::Line { start, end, .. } => {
            assert!(
                (close(*start, v(10.0, 0.0)) && close(*end, v(0.0, 10.0)))
                    || (close(*end, v(10.0, 0.0)) && close(*start, v(0.0, 10.0)))
            );
        }
        _ => unreachable!(),
    }
    let undone = s.undo().unwrap();
    let (_, e1u) = line(&undone.sketch, l1);
    assert!(close(e1u, v(50.0, 0.0)));
}

#[test]
fn offset_line_sign_rules_and_circle_collapse() {
    let mut s = session();
    let l = s.add_line(v(0.0, 0.0), v(50.0, 0.0), true).unwrap();
    // Cursor above (+y = left of +x direction) → offset upward.
    let r = s
        .offset_curve_op(&OffsetRequest {
            entity: l.entity_id,
            distance_text: "10".to_string(),
            cursor: v(25.0, 5.0),
        })
        .unwrap();
    let new_line = r
        .sketch
        .entities
        .iter()
        .filter(|e| matches!(e, EntityDto::Line { .. }))
        .last()
        .unwrap()
        .clone();
    match new_line {
        EntityDto::Line { start, end, .. } => {
            assert!(
                close(start, v(0.0, 10.0)) && close(end, v(50.0, 10.0)),
                "{start:?}-{end:?}"
            );
        }
        _ => unreachable!(),
    }
    // Cursor below → downward.
    let l2 = s.add_line(v(0.0, 30.0), v(50.0, 30.0), true).unwrap();
    let r = s
        .offset_curve_op(&OffsetRequest {
            entity: l2.entity_id,
            distance_text: "5".to_string(),
            cursor: v(25.0, 20.0),
        })
        .unwrap();
    let new_line2 = r
        .sketch
        .entities
        .iter()
        .filter(|e| {
            matches!(e, EntityDto::Line { .. }) && e.id() != l2.entity_id && e.id() != l.entity_id
        })
        .last()
        .unwrap()
        .clone();
    match new_line2 {
        EntityDto::Line { start, .. } => assert!(close(start, v(0.0, 25.0)), "{start:?}"),
        _ => unreachable!(),
    }
    // Circle collapsing to zero radius is rejected.
    let c = s
        .add_circle(
            nbcad_sketch::CircleMode::CenterDiameter,
            v(100.0, 100.0),
            v(105.0, 100.0),
        )
        .unwrap();
    let err = s
        .offset_curve_op(&OffsetRequest {
            entity: c.entities[0],
            distance_text: "5".to_string(),
            cursor: v(100.0, 100.0), // inside → inward by 5 → r = 0
        })
        .unwrap_err();
    assert!(err.to_string().contains("collap"), "{err}");
}

#[test]
fn trim_removes_the_clicked_piece() {
    let mut s = session();
    // Horizontal line crossed by two verticals at x=20 and x=40.
    let h = s.add_line(v(0.0, 0.0), v(60.0, 0.0), true).unwrap();
    s.add_line(v(20.0, -10.0), v(20.0, 10.0), true).unwrap();
    s.add_line(v(40.0, -10.0), v(40.0, 10.0), true).unwrap();
    let preview = s
        .trim_preview(&TrimRequest {
            entity: h.entity_id,
            click: v(30.0, 0.0),
        })
        .unwrap();
    assert_eq!(preview.kept.len(), 2, "both outside pieces are previewed");
    // Click between the cuts → middle piece removed, both outside pieces
    // survive as disconnected lines.
    let r = s
        .trim_entity(&TrimRequest {
            entity: h.entity_id,
            click: v(30.0, 0.0),
        })
        .unwrap();
    let horizontal: Vec<_> = r
        .sketch
        .entities
        .iter()
        .filter_map(|entity| match entity {
            EntityDto::Line { start, end, .. } if (start.y.abs() < 1e-7 && end.y.abs() < 1e-7) => {
                Some((*start, *end))
            }
            _ => None,
        })
        .collect();
    assert_eq!(horizontal.len(), 2);
    assert!(horizontal
        .iter()
        .any(|(a, b)| { close(*a, v(0.0, 0.0)) && close(*b, v(20.0, 0.0)) }));
    assert!(horizontal
        .iter()
        .any(|(a, b)| { close(*a, v(40.0, 0.0)) && close(*b, v(60.0, 0.0)) }));
    let undone = s.undo().unwrap();
    let (_, b2) = line(&undone.sketch, h.entity_id);
    assert!(close(b2, v(60.0, 0.0)));
}

#[test]
fn extend_grows_to_nearest_intersection() {
    let mut s = session();
    let l = s.add_line(v(0.0, 0.0), v(30.0, 0.0), true).unwrap();
    s.add_line(v(50.0, -10.0), v(50.0, 10.0), true).unwrap();
    let r = s
        .extend_entity(&ExtendRequest {
            entity: l.entity_id,
            click: v(28.0, 0.0),
        })
        .unwrap();
    let (_, b) = line(&r.sketch, l.entity_id);
    assert!(close(b, v(50.0, 0.0)), "b={b:?}");
}

#[test]
fn break_splits_line_and_arc() {
    let mut s = session();
    let l = s.add_line(v(0.0, 0.0), v(60.0, 0.0), true).unwrap();
    let r = s
        .break_curve(&BreakRequest {
            entity: l.entity_id,
            at: v(25.0, 0.0),
        })
        .unwrap();
    let lines: Vec<_> = r
        .sketch
        .entities
        .iter()
        .filter(|e| matches!(e, EntityDto::Line { .. }))
        .collect();
    assert_eq!(lines.len(), 2);
    // The shared break point connects both pieces structurally.
    let (a1, b1) = line(&r.sketch, l.entity_id);
    assert!(
        close(a1, v(0.0, 0.0)) && close(b1, v(25.0, 0.0)),
        "{a1:?}-{b1:?}"
    );
    let other = lines.iter().find(|e| e.id() != l.entity_id).unwrap();
    match other {
        EntityDto::Line { start, end, .. } => {
            assert!(close(*start, v(25.0, 0.0)) && close(*end, v(60.0, 0.0)));
        }
        _ => unreachable!(),
    }
}

#[test]
fn mirror_flips_arc_winding() {
    let mut s = session();
    let axis = s.add_line(v(0.0, 0.0), v(0.0, 50.0), true).unwrap(); // y-axis
    let l = s.add_line(v(10.0, 10.0), v(30.0, 10.0), true).unwrap();
    let r = s
        .mirror_entities(&MirrorRequest {
            entity_ids: vec![l.entity_id],
            axis_line: axis.entity_id,
        })
        .unwrap();
    let lines: Vec<_> = r
        .sketch
        .entities
        .iter()
        .filter(|e| {
            matches!(e, EntityDto::Line { .. }) && e.id() != l.entity_id && e.id() != axis.entity_id
        })
        .collect();
    assert_eq!(lines.len(), 1);
    match lines[0] {
        EntityDto::Line { start, end, .. } => {
            assert!(
                (close(*start, v(-10.0, 10.0)) && close(*end, v(-30.0, 10.0)))
                    || (close(*start, v(-30.0, 10.0)) && close(*end, v(-10.0, 10.0))),
                "{start:?}-{end:?}"
            );
        }
        _ => unreachable!(),
    }
}

#[test]
fn move_and_copy_variants() {
    let mut s = session();
    let l = s.add_line(v(0.0, 0.0), v(20.0, 0.0), true).unwrap();
    // Move in place.
    let r = s
        .move_copy_entities(&MoveCopyRequest {
            entity_ids: vec![l.entity_id],
            dx: 5.0,
            dy: 7.0,
            copy: false,
        })
        .unwrap();
    let (a, _) = line(&r.sketch, l.entity_id);
    assert!(close(a, v(5.0, 7.0)));
    assert_eq!(
        r.sketch
            .entities
            .iter()
            .filter(|e| matches!(e, EntityDto::Line { .. }))
            .count(),
        1
    );
    // Copy duplicates.
    let r = s
        .move_copy_entities(&MoveCopyRequest {
            entity_ids: vec![l.entity_id],
            dx: 10.0,
            dy: 0.0,
            copy: true,
        })
        .unwrap();
    assert_eq!(
        r.sketch
            .entities
            .iter()
            .filter(|e| matches!(e, EntityDto::Line { .. }))
            .count(),
        2
    );
}

#[test]
fn scale_in_place_about_base_point() {
    let mut s = session();
    let l = s.add_line(v(10.0, 0.0), v(30.0, 0.0), true).unwrap();
    let r = s
        .scale_entities(&ScaleRequest {
            entity_ids: vec![l.entity_id],
            origin: v(10.0, 0.0),
            factor_text: "2".to_string(),
        })
        .unwrap();
    let (a, b) = line(&r.sketch, l.entity_id);
    assert!(
        close(a, v(10.0, 0.0)) && close(b, v(50.0, 0.0)),
        "{a:?}-{b:?}"
    );
    let undone = s.undo().unwrap();
    let (_, b2) = line(&undone.sketch, l.entity_id);
    assert!(close(b2, v(30.0, 0.0)));
}

#[test]
fn polygon_creates_n_lines_with_shared_corners() {
    let mut s = session();
    let r = s
        .polygon_create(&PolygonRequest {
            center: v(50.0, 50.0),
            edge_count: 6,
            radius_text: "20".to_string(),
            rotation_deg: 0.0,
            mode: "inscribed".to_string(),
        })
        .unwrap();
    let dto = r.sketch;
    let lines: Vec<_> = dto
        .entities
        .iter()
        .filter(|e| matches!(e, EntityDto::Line { .. }))
        .collect();
    assert_eq!(lines.len(), 6);
    // 6 shared corner points (structural coincident).
    let points: Vec<_> = dto
        .entities
        .iter()
        .filter(|e| matches!(e, EntityDto::Point { .. }))
        .collect();
    assert_eq!(points.len(), 6);
    // First vertex lies on the radius to the right.
    match lines[0] {
        EntityDto::Line { start, .. } => assert!((start.y - 50.0).abs() < 1e-7),
        _ => unreachable!(),
    }
    // One undo removes everything.
    let undone = s.undo().unwrap();
    assert_eq!(undone.sketch.entities.len(), 0);
}

#[test]
fn fillet_with_formula_radius_evaluates() {
    let mut s = session();
    let (l1, l2) = l_shape(&mut s);
    // Seed a d1=20 via a dimensioned line.
    s.add_line_locked(&nbcad_sketch::LockedSegmentRequest {
        from: v(100.0, 100.0),
        to_hint: v(120.0, 100.0),
        length_mm: None,
        angle_deg: None,
        length_text: Some("20".to_string()),
        angle_text: None,
        ctrl_held: false,
        tracking: None,
    })
    .unwrap();
    let r = s
        .fillet_lines(&FilletRequest {
            l1,
            l2,
            radius_text: "=d1/2".to_string(),
        })
        .unwrap();
    let arc = r
        .sketch
        .entities
        .iter()
        .find(|e| matches!(e, EntityDto::Arc { .. }))
        .unwrap();
    match arc {
        EntityDto::Arc { radius, .. } => assert!((radius - 10.0).abs() < 1e-9),
        _ => unreachable!(),
    }
    // The fillet's radius param stores the formula (index 0 is d1's own dim).
    assert_eq!(
        r.sketch.dimensions[1].param_expression.as_deref(),
        Some("d1/2")
    );
}

#[test]
fn failed_multi_entity_mutation_rolls_back_everything() {
    let mut s = session();
    let l = s.add_line(v(0.0, 0.0), v(20.0, 0.0), true).unwrap();
    let before = s.dto();
    let error = s
        .move_copy_entities(&MoveCopyRequest {
            entity_ids: vec![l.entity_id, EntityId(9_999)],
            dx: 25.0,
            dy: 10.0,
            copy: true,
        })
        .unwrap_err();
    assert!(error.to_string().contains("9999"));
    assert_eq!(
        s.dto(),
        before,
        "a late failure must not leave partial copies"
    );
}

#[test]
fn moving_connected_lines_translates_the_shared_point_once() {
    let mut s = session();
    let (l1, l2) = l_shape(&mut s);
    let r = s
        .move_copy_entities(&MoveCopyRequest {
            entity_ids: vec![l1, l2],
            dx: 5.0,
            dy: 7.0,
            copy: false,
        })
        .unwrap();
    let (a1, b1) = line(&r.sketch, l1);
    let (a2, b2) = line(&r.sketch, l2);
    assert!(
        [a1, b1].iter().any(|p| close(*p, v(5.0, 7.0))),
        "first line lost the once-translated joint"
    );
    assert!(
        [a2, b2].iter().any(|p| close(*p, v(5.0, 7.0))),
        "second line lost the once-translated joint"
    );
    assert!(![a1, b1, a2, b2].iter().any(|p| close(*p, v(10.0, 14.0))));
}

#[test]
fn copy_and_mirror_preserve_shared_line_topology() {
    let mut copied = session();
    let first = copied.add_line(v(0.0, 0.0), v(20.0, 0.0), true).unwrap();
    let second = copied.add_line(v(20.0, 0.0), v(20.0, 20.0), true).unwrap();
    let result = copied
        .move_copy_entities(&MoveCopyRequest {
            entity_ids: vec![first.entity_id, second.entity_id],
            dx: 30.0,
            dy: 5.0,
            copy: true,
        })
        .unwrap();
    let copied_lines: Vec<_> = result
        .sketch
        .entities
        .iter()
        .filter(|entity| {
            matches!(entity, EntityDto::Line { id, .. } if *id != first.entity_id && *id != second.entity_id)
        })
        .collect();
    assert_eq!(copied_lines.len(), 2);
    let endpoints = |entity: &EntityDto| match entity {
        EntityDto::Line {
            start_id, end_id, ..
        } => [*start_id, *end_id],
        _ => unreachable!(),
    };
    let c1 = endpoints(copied_lines[0]);
    let c2 = endpoints(copied_lines[1]);
    assert_eq!(
        c1.iter().filter(|id| c2.contains(id)).count(),
        1,
        "copied connected lines must reuse one copied joint"
    );

    let mut mirrored = session();
    let axis = mirrored
        .add_line(v(0.0, -20.0), v(0.0, 40.0), true)
        .unwrap();
    let first = mirrored.add_line(v(10.0, 0.0), v(30.0, 0.0), true).unwrap();
    let second = mirrored
        .add_line(v(30.0, 0.0), v(30.0, 20.0), true)
        .unwrap();
    let result = mirrored
        .mirror_entities(&MirrorRequest {
            entity_ids: vec![first.entity_id, second.entity_id],
            axis_line: axis.entity_id,
        })
        .unwrap();
    let mirrored_lines: Vec<_> = result
        .sketch
        .entities
        .iter()
        .filter(|entity| {
            matches!(entity, EntityDto::Line { id, .. }
                if *id != axis.entity_id && *id != first.entity_id && *id != second.entity_id)
        })
        .collect();
    assert_eq!(mirrored_lines.len(), 2);
    let m1 = endpoints(mirrored_lines[0]);
    let m2 = endpoints(mirrored_lines[1]);
    assert_eq!(
        m1.iter().filter(|id| m2.contains(id)).count(),
        1,
        "mirrored connected lines must reuse one mirrored joint"
    );
}

#[test]
fn scale_transforms_curve_centers_radii_and_splines() {
    let mut s = session();
    let circle = s
        .add_circle(
            nbcad_sketch::CircleMode::CenterDiameter,
            v(20.0, 10.0),
            v(30.0, 10.0),
        )
        .unwrap();
    let arc = s
        .add_arc_center(v(5.0, 20.0), v(10.0, 20.0), v(5.0, 25.0))
        .unwrap();
    let result = s
        .scale_entities(&ScaleRequest {
            entity_ids: vec![circle.entities[0], arc.entities[0]],
            origin: v(0.0, 0.0),
            factor_text: "2".to_string(),
        })
        .unwrap();
    match result
        .sketch
        .entities
        .iter()
        .find(|entity| entity.id() == circle.entities[0])
        .unwrap()
    {
        EntityDto::Circle { center, radius, .. } => {
            assert!(close(*center, v(40.0, 20.0)));
            assert!((*radius - 20.0).abs() < 1e-7);
        }
        other => panic!("expected circle, got {other:?}"),
    }
    match result
        .sketch
        .entities
        .iter()
        .find(|entity| entity.id() == arc.entities[0])
        .unwrap()
    {
        EntityDto::Arc { center, radius, .. } => {
            assert!(close(*center, v(10.0, 40.0)));
            assert!((*radius - 10.0).abs() < 1e-7);
        }
        other => panic!("expected arc, got {other:?}"),
    }
}

#[test]
fn trim_ignores_non_intersecting_supporting_segments() {
    let mut s = session();
    let target = s.add_line(v(0.0, 0.0), v(60.0, 0.0), true).unwrap();
    // Its infinite supporting line crosses at (20,0), but the rendered
    // segment starts at y=5 and therefore is not a trim boundary.
    s.add_line(v(20.0, 5.0), v(20.0, 15.0), true).unwrap();
    let error = s
        .trim_entity(&TrimRequest {
            entity: target.entity_id,
            click: v(10.0, 0.0),
        })
        .unwrap_err();
    assert!(error.to_string().contains("nothing to trim"));
}

#[test]
fn extend_uses_the_clicked_end_real_segments_and_adds_coincidence() {
    let mut s = session();
    let source = s.add_line(v(0.0, 0.0), v(10.0, 0.0), true).unwrap();
    let left = s.add_line(v(-20.0, -5.0), v(-20.0, 5.0), true).unwrap();
    // Closer supporting line on the right does not actually reach y=0.
    s.add_line(v(20.0, 5.0), v(20.0, 15.0), true).unwrap();
    let right = s.add_line(v(30.0, -5.0), v(30.0, 5.0), true).unwrap();

    let result = s
        .extend_entity(&ExtendRequest {
            entity: source.entity_id,
            click: v(0.5, 0.0),
        })
        .unwrap();
    let (a, b) = line(&result.sketch, source.entity_id);
    assert!(close(a, v(-20.0, 0.0)) && close(b, v(10.0, 0.0)));
    assert!(result.sketch.constraints.iter().any(|constraint| {
        matches!(
            constraint.constraint,
            Constraint::Coincident { b, .. } if b == left.entity_id
        )
    }));

    s.undo().unwrap();
    let result = s
        .extend_entity(&ExtendRequest {
            entity: source.entity_id,
            click: v(9.5, 0.0),
        })
        .unwrap();
    let (a, b) = line(&result.sketch, source.entity_id);
    assert!(close(a, v(0.0, 0.0)) && close(b, v(30.0, 0.0)));
    assert!(result.sketch.constraints.iter().any(|constraint| {
        matches!(
            constraint.constraint,
            Constraint::Coincident { b, .. } if b == right.entity_id
        )
    }));
}

#[test]
fn extend_ignores_intersections_outside_an_arc_sweep() {
    let mut s = session();
    let source = s.add_line(v(0.0, 0.0), v(10.0, 0.0), true).unwrap();
    // Underlying circle hits the source extension at (20,0), but this arc
    // contains only angles 0°..90° around (20,5).
    s.add_arc_center(v(20.0, 5.0), v(25.0, 5.0), v(20.0, 10.0))
        .unwrap();
    s.add_line(v(30.0, -5.0), v(30.0, 5.0), true).unwrap();
    let result = s
        .extend_entity(&ExtendRequest {
            entity: source.entity_id,
            click: v(9.0, 0.0),
        })
        .unwrap();
    let (_, end) = line(&result.sketch, source.entity_id);
    assert!(close(end, v(30.0, 0.0)), "end={end:?}");
}

#[test]
fn offset_is_parametric_and_editable() {
    let mut s = session();
    let source = s.add_line(v(0.0, 0.0), v(50.0, 0.0), true).unwrap();
    s.toggle_fix(source.start_point_id).unwrap();
    s.toggle_fix(source.end_point_id).unwrap();
    let result = s
        .offset_curve_op(&OffsetRequest {
            entity: source.entity_id,
            distance_text: "10".to_string(),
            cursor: v(25.0, 20.0),
        })
        .unwrap();
    let target = result
        .sketch
        .entities
        .iter()
        .find_map(|entity| match entity {
            EntityDto::Line { id, .. } if *id != source.entity_id => Some(*id),
            _ => None,
        })
        .unwrap();
    assert!(result.sketch.constraints.iter().any(|constraint| {
        matches!(
            constraint.constraint,
            Constraint::Parallel { a, b }
                if a == source.entity_id && b == target
        )
    }));
    let dimension = result
        .sketch
        .dimensions
        .iter()
        .find(|dimension| dimension.entities.contains(&source.entity_id))
        .unwrap();
    let edited = s
        .edit_dimension(EditDimensionRequest {
            constraint_id: dimension.constraint_id,
            text: "15".to_string(),
        })
        .unwrap();
    let (a, b) = line(&edited.sketch, source.entity_id);
    let (q, _) = line(&edited.sketch, target);
    let direction = b - a;
    let distance =
        (direction.x * (q.y - a.y) - direction.y * (q.x - a.x)).abs() / direction.length();
    assert!((distance - 15.0).abs() < 1e-6, "distance={distance}");
}

#[test]
fn chamfer_distance_edit_keeps_equal_cutbacks() {
    let mut s = session();
    let first = s.add_line(v(0.0, 0.0), v(50.0, 0.0), true).unwrap();
    let second = s.add_line(v(0.0, 0.0), v(0.0, 50.0), true).unwrap();
    s.toggle_fix(first.end_point_id).unwrap();
    s.toggle_fix(second.end_point_id).unwrap();
    let result = s
        .chamfer_lines(&ChamferRequest {
            l1: first.entity_id,
            l2: second.entity_id,
            distance_text: "10".to_string(),
        })
        .unwrap();
    assert!(result
        .sketch
        .constraints
        .iter()
        .any(|constraint| constraint.constraint.kind_str() == "equal_distance"));
    let edited = s
        .edit_dimension(EditDimensionRequest {
            constraint_id: result.sketch.dimensions[0].constraint_id,
            text: "15".to_string(),
        })
        .unwrap();
    let (a1, b1) = line(&edited.sketch, first.entity_id);
    let (a2, b2) = line(&edited.sketch, second.entity_id);
    let dline1 = b1 - a1;
    let dline2 = b2 - a2;
    let det = dline1.x * dline2.y - dline1.y * dline2.x;
    let t = ((a2.x - a1.x) * dline2.y - (a2.y - a1.y) * dline2.x) / det;
    let corner = a1 + dline1 * t;
    let cut1 = if a1.distance(corner) < b1.distance(corner) {
        a1
    } else {
        b1
    };
    let cut2 = if a2.distance(corner) < b2.distance(corner) {
        a2
    } else {
        b2
    };
    let d1 = cut1.distance(corner);
    let d2 = cut2.distance(corner);
    assert!((d1 - 15.0).abs() < 1e-6, "cut1={cut1:?}, d1={d1}");
    assert!((d2 - 15.0).abs() < 1e-6, "cut2={cut2:?}, d2={d2}");
}

#[test]
fn breaking_a_circle_keeps_a_visible_full_sweep() {
    let mut s = session();
    let circle = s
        .add_circle(
            nbcad_sketch::CircleMode::CenterDiameter,
            v(0.0, 0.0),
            v(10.0, 0.0),
        )
        .unwrap();
    let result = s
        .break_curve(&BreakRequest {
            entity: circle.entities[0],
            at: v(10.0, 0.0),
        })
        .unwrap();
    match result
        .sketch
        .entities
        .iter()
        .find(|entity| entity.id() == circle.entities[0])
        .unwrap()
    {
        EntityDto::Arc {
            start_angle,
            end_angle,
            ..
        } => {
            assert!(
                (end_angle - start_angle - std::f64::consts::TAU).abs() < 1e-9,
                "circle break collapsed to a zero sweep"
            );
        }
        other => panic!("expected opened arc, got {other:?}"),
    }
}

#[test]
fn rectangular_pattern_preserves_occurrence_topology_and_is_one_undo() {
    let mut s = session();
    let source = s.add_line(v(1.0, 2.0), v(4.0, 2.0), true).unwrap();
    let result = s
        .rectangular_pattern(&RectangularPatternRequest {
            entity_ids: vec![source.entity_id],
            direction: v(1.0, 0.0),
            spacing: 10.0,
            count: 3,
            second_direction: None,
            second_spacing: 0.0,
            second_count: 1,
        })
        .unwrap();
    let mut starts = result
        .sketch
        .entities
        .iter()
        .filter_map(|entity| match entity {
            EntityDto::Line { start, end, .. } => Some(start.x.min(end.x)),
            _ => None,
        })
        .collect::<Vec<_>>();
    starts.sort_by(f64::total_cmp);
    assert_eq!(starts, vec![1.0, 11.0, 21.0]);

    let undone = s.undo().unwrap();
    assert_eq!(
        undone
            .sketch
            .entities
            .iter()
            .filter(|entity| matches!(entity, EntityDto::Line { .. }))
            .count(),
        1
    );
}

#[test]
fn circular_pattern_uses_count_as_total_occurrences_and_is_one_undo() {
    let mut s = session();
    let source = s.add_line(v(10.0, 0.0), v(20.0, 0.0), true).unwrap();
    let result = s
        .circular_pattern(&CircularPatternRequest {
            entity_ids: vec![source.entity_id],
            center: Vec2::ZERO,
            count: 4,
            total_angle_deg: 360.0,
        })
        .unwrap();
    let lines = result
        .sketch
        .entities
        .iter()
        .filter(|entity| matches!(entity, EntityDto::Line { .. }))
        .count();
    assert_eq!(lines, 4);
    assert!(result.sketch.entities.iter().any(|entity| {
        matches!(
            entity,
            EntityDto::Line { start, end, .. }
                if close(*start, v(0.0, 10.0)) && close(*end, v(0.0, 20.0))
        )
    }));

    let undone = s.undo().unwrap();
    assert_eq!(
        undone
            .sketch
            .entities
            .iter()
            .filter(|entity| matches!(entity, EntityDto::Line { .. }))
            .count(),
        1
    );
}
