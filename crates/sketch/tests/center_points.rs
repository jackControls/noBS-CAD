//! Issue #151: circle and center-rectangle centers are selectable,
//! constrainable, and keep their shape symmetric about that center.
use nbcad_sketch::{
    CircleMode, Constraint, DragPhase, EntityDto, EntityId, MoveCopyRequest, MovePointRequest,
    OriginPlane, PlaneRef, RectangleMode, ScaleRequest, SketchDto, SketchSession, SnapTarget, Vec2,
};

fn v(x: f64, y: f64) -> Vec2 {
    Vec2::new(x, y)
}

fn session() -> SketchSession {
    let plane = PlaneRef::OriginPlane {
        plane: OriginPlane::Xy,
    };
    SketchSession::new("Centers", plane, plane.basis().unwrap(), false)
}

fn point(dto: &SketchDto, id: EntityId) -> Vec2 {
    match dto
        .entities
        .iter()
        .find(|entity| entity.id() == id)
        .expect("point entity")
    {
        EntityDto::Point { position, .. } => *position,
        other => panic!("expected a point, got {other:?}"),
    }
}

fn circle_center_of(dto: &SketchDto, id: EntityId) -> Vec2 {
    match dto
        .entities
        .iter()
        .find(|entity| entity.id() == id)
        .expect("circle entity")
    {
        EntityDto::Circle { center, .. } => *center,
        other => panic!("expected a circle, got {other:?}"),
    }
}

/// The generated handle a curve owns through `CenterCoincident`.
fn center_handles(dto: &SketchDto, curve: EntityId) -> Vec<EntityId> {
    dto.constraints
        .iter()
        .filter_map(|constraint| match constraint.constraint {
            Constraint::CenterCoincident {
                point,
                curve: owner,
            } if owner == curve => Some(point),
            _ => None,
        })
        .collect()
}

/// The center a center rectangle owns through a span midpoint.
fn rectangle_center(dto: &SketchDto) -> EntityId {
    dto.constraints
        .iter()
        .find_map(|constraint| match constraint.constraint {
            Constraint::SpanMidpoint { point, .. } => Some(point),
            _ => None,
        })
        .expect("a center rectangle must own a midpoint-bound center")
}

fn drag(session: &mut SketchSession, point_id: EntityId, to: Vec2) {
    session
        .move_point(MovePointRequest {
            point_id,
            to_raw: to,
            ctrl_held: true,
            phase: DragPhase::Single,
        })
        .unwrap();
}

#[test]
fn a_circle_exposes_one_selectable_center_without_adding_degrees_of_freedom() {
    for mode in [CircleMode::CenterDiameter, CircleMode::TwoPoint] {
        let mut s = session();
        let circle = s
            .add_circle(mode, v(20.0, 10.0), v(30.0, 10.0))
            .unwrap()
            .entities[0];
        let dto = s.dto();
        let handles = center_handles(&dto, circle);
        assert_eq!(handles.len(), 1, "{mode:?}: exactly one center handle");
        let handle = handles[0];
        assert!(
            point(&dto, handle).distance(circle_center_of(&dto, circle)) < 1e-6,
            "{mode:?}: the handle must sit on the circle center"
        );
        // A handle is determined by the curve center, so it adds no freedom.
        assert_eq!(dto.dof.value, 3, "{mode:?}: circle keeps its 3 DOF");

        // The handle is a real point entity, so the viewport can pick it and
        // the engine can snap a later line onto it.
        let preview = s.preview_segment(v(60.0, 60.0), point(&dto, handle) + v(0.1, 0.1), false);
        assert_eq!(preview.snap, SnapTarget::Point { entity: handle });

        // Undo then redo round-trips the handle with the sketch.
        assert!(s.undo().unwrap().sketch.entities.is_empty());
        let redone = s.redo().unwrap().sketch;
        assert_eq!(center_handles(&redone, circle).len(), 1);

        // Dragging the handle moves the whole circle, radius untouched.
        drag(&mut s, handle, v(26.0, 14.0));
        let after = s.dto();
        assert!(circle_center_of(&after, circle).distance(v(26.0, 14.0)) < 1e-6);
        assert_eq!(after.dof.value, 3);
    }
}

#[test]
fn a_circle_center_can_be_constrained_to_rectangle_geometry() {
    // The issue's first reproduction: draw a circle and a free rectangle, then
    // pin the circle's center to a rectangle corner.
    let mut s = session();
    let circle = s
        .add_circle(CircleMode::CenterDiameter, v(70.0, 70.0), v(78.0, 70.0))
        .unwrap()
        .entities[0];
    let rectangle = s
        .add_rectangle(RectangleMode::TwoPoint, v(10.0, 10.0), v(40.0, 30.0))
        .unwrap();
    let corner = rectangle.entities[1];
    let handle = center_handles(&s.dto(), circle)[0];

    s.add_constraint(Constraint::Coincident {
        a: handle,
        b: corner,
    })
    .unwrap();

    let dto = s.dto();
    let center = circle_center_of(&dto, circle);
    assert!(
        center.distance(point(&dto, corner)) < 1e-6,
        "the circle center must land on the rectangle corner, got {center:?}"
    );
    // The relation binds the center only: the circle stays a circle.
    match dto.entities.iter().find(|e| e.id() == circle).unwrap() {
        EntityDto::Circle { radius, .. } => assert!((*radius - 8.0).abs() < 1e-6),
        other => panic!("expected a circle, got {other:?}"),
    }

    // Moving the corner carries the constrained circle center with it.
    let corner_target = v(5.0, 25.0);
    drag(&mut s, corner, corner_target);
    let dto = s.dto();
    assert!(circle_center_of(&dto, circle).distance(corner_target) < 1e-6);
}

#[test]
fn an_acquired_circle_center_reuses_the_users_point() {
    // Snapping the center onto an existing point reuses that point as the
    // handle, so no redundant second point appears at the same spot.
    let mut s = session();
    let anchor = s.add_point(v(30.0, 30.0)).unwrap().entities[0];
    let circle = s
        .add_circle_selective(
            CircleMode::CenterDiameter,
            v(30.0, 30.0),
            v(38.0, 30.0),
            false,
        )
        .unwrap()
        .entities[0];
    let dto = s.dto();
    let handles = center_handles(&dto, circle);
    assert_eq!(handles, vec![anchor], "the acquired point is the handle");
    assert_eq!(
        dto.entities
            .iter()
            .filter(|e| matches!(e, EntityDto::Point { .. }))
            .count(),
        1,
        "no duplicate handle is created for an acquired center"
    );

    // Transforming the curve carries its center attachment, so the relation
    // stays exactly satisfied instead of the solver splitting the difference.
    s.scale_entities(&ScaleRequest {
        entity_ids: vec![circle],
        origin: v(0.0, 0.0),
        factor_text: "2".to_string(),
    })
    .unwrap();
    let after = s.dto();
    assert!(
        circle_center_of(&after, circle).distance(point(&after, anchor)) < 1e-6,
        "the center must stay on the point it was snapped to"
    );
    match after.entities.iter().find(|e| e.id() == circle).unwrap() {
        EntityDto::Circle { radius, .. } => assert!((*radius - 16.0).abs() < 1e-6),
        other => panic!("expected a circle, got {other:?}"),
    }
}

#[test]
fn a_center_rectangle_exposes_its_center_and_stays_symmetric() {
    let mut s = session();
    let created = s
        .add_rectangle(RectangleMode::Center, v(50.0, 50.0), v(60.0, 60.0))
        .unwrap();
    let [bl, br, tr, tl] = [
        created.entities[0],
        created.entities[1],
        created.entities[2],
        created.entities[3],
    ];
    let dto = s.dto();
    let center = rectangle_center(&dto);
    assert!(
        point(&dto, center).distance(v(50.0, 50.0)) < 1e-6,
        "the center rectangle owns its center as a real point"
    );
    // The center is bound to a diagonal, which is what makes the shape
    // symmetric rather than merely rectangular.
    assert!(matches!(
        dto.constraints
            .iter()
            .find(|c| matches!(c.constraint, Constraint::SpanMidpoint { .. }))
            .map(|c| c.constraint),
        Some(Constraint::SpanMidpoint { point, start, end })
            if point == center && [start, end] == [bl, tr]
    ));
    // A center is determined by the diagonal, so it adds no freedom.
    assert_eq!(dto.dof.value, 4, "center rectangle keeps its 4 DOF");

    // Drag one corner: the opposite corner follows so the center stays the
    // true midpoint of both diagonals.
    drag(&mut s, bl, v(30.0, 30.0));
    let after = s.dto();
    let center_at = point(&after, center);
    assert!(point(&after, bl).distance(v(30.0, 30.0)) < 1e-6);
    for (a, b) in [(bl, tr), (br, tl)] {
        let (a, b) = (point(&after, a), point(&after, b));
        assert!(
            ((a + b) * 0.5).distance(center_at) < 1e-6,
            "the center must stay the midpoint of its diagonals"
        );
    }
    assert_eq!(after.dof.value, 4, "the drag must not add freedom");
}

#[test]
fn a_center_on_the_origin_resizes_symmetrically_about_it() {
    // The issue's second reproduction: place the center rectangle's center on
    // the sketch origin, then resize it by a corner.
    let mut s = session();
    let created = s
        .add_rectangle(RectangleMode::Center, Vec2::ZERO, v(10.0, 10.0))
        .unwrap();
    let [bl, br, tr, tl] = [
        created.entities[0],
        created.entities[1],
        created.entities[2],
        created.entities[3],
    ];
    let dto = s.dto();
    let center = rectangle_center(&dto);
    assert!(
        dto.constraints.iter().any(|c| matches!(
            c.constraint,
            Constraint::OriginCoincident { entity } if entity == center
        )),
        "a center dropped on the origin is pinned there"
    );

    drag(&mut s, tr, v(25.0, 15.0));
    let after = s.dto();
    let center_at = point(&after, center);
    assert!(
        center_at.distance(Vec2::ZERO) < 1e-6,
        "the pinned center must not move, got {center_at:?}"
    );
    // Resizing stays symmetric: every corner is mirrored through the origin.
    for corner in [bl, br, tr, tl] {
        let p = point(&after, corner);
        assert!(p.distance(Vec2::ZERO) > 1e-6);
        let mirrored = [
            point(&after, bl),
            point(&after, br),
            point(&after, tr),
            point(&after, tl),
        ]
        .into_iter()
        .any(|q| q.distance(Vec2::ZERO - p) < 1e-6);
        assert!(
            mirrored,
            "corner {p:?} has no mirror image through the origin"
        );
    }
    assert!((point(&after, tr).distance(v(25.0, 15.0))) < 1e-6);
}

#[test]
fn a_two_point_rectangle_does_not_invent_a_center() {
    let mut s = session();
    let created = s
        .add_rectangle(RectangleMode::TwoPoint, v(10.0, 10.0), v(40.0, 30.0))
        .unwrap();
    let dto = s.dto();
    assert_eq!(created.entities.len(), 8, "corners plus lines only");
    assert!(!dto
        .constraints
        .iter()
        .any(|c| matches!(c.constraint, Constraint::SpanMidpoint { .. })));
}

#[test]
fn deleting_a_center_rectangles_carriers_collects_its_center() {
    let mut s = session();
    let created = s
        .add_rectangle(RectangleMode::Center, v(20.0, 20.0), v(30.0, 24.0))
        .unwrap();
    let center = rectangle_center(&s.dto());
    let lines: Vec<EntityId> = created
        .sketch
        .entities
        .iter()
        .filter(|e| matches!(e, EntityDto::Line { .. }))
        .map(|e| e.id())
        .collect();
    let removed = s.delete_entities(&lines).unwrap();
    assert!(
        removed.removed.contains(&center),
        "the owned center must go with the shape that owns it"
    );
    assert!(s.dto().entities.is_empty(), "{:?}", s.dto().entities);
    assert_eq!(s.undo().unwrap().sketch.entities, created.sketch.entities);
    s.redo().unwrap();
    assert!(s.dto().entities.is_empty());
}

#[test]
fn copied_and_transformed_circles_keep_an_attached_center() {
    let mut s = session();
    let circle = s
        .add_circle(CircleMode::CenterDiameter, v(20.0, 10.0), v(30.0, 10.0))
        .unwrap()
        .entities[0];

    // Move keeps the owned handle attached to the curve.
    s.move_copy_entities(&MoveCopyRequest {
        entity_ids: vec![circle],
        dx: 5.0,
        dy: -3.0,
        copy: false,
    })
    .unwrap();
    let dto = s.dto();
    let handle = center_handles(&dto, circle)[0];
    assert!(point(&dto, handle).distance(v(25.0, 7.0)) < 1e-6);

    // Scale keeps it attached too.
    s.scale_entities(&ScaleRequest {
        entity_ids: vec![circle],
        origin: v(0.0, 0.0),
        factor_text: "2".to_string(),
    })
    .unwrap();
    let dto = s.dto();
    assert!(circle_center_of(&dto, circle).distance(v(50.0, 14.0)) < 1e-6);
    assert!(point(&dto, handle).distance(v(50.0, 14.0)) < 1e-6);

    // A copied occurrence owns a fresh handle, not a shared one.
    let copied = s
        .move_copy_entities(&MoveCopyRequest {
            entity_ids: vec![circle],
            dx: 100.0,
            dy: 0.0,
            copy: true,
        })
        .unwrap();
    let copy_id = copied
        .sketch
        .entities
        .iter()
        .filter(|e| matches!(e, EntityDto::Circle { .. }))
        .map(|e| e.id())
        .find(|id| *id != circle)
        .expect("the copied circle");
    let copy_handles = center_handles(&copied.sketch, copy_id);
    assert_eq!(copy_handles.len(), 1, "the occurrence owns one handle");
    assert_ne!(copy_handles[0], handle, "handles are not shared");
    assert!(
        point(&copied.sketch, copy_handles[0]).distance(v(150.0, 14.0)) < 1e-6,
        "the copied handle follows the copied center"
    );
}
