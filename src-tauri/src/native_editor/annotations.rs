//! Dimension leaders and editable labels, projected by the same native camera
//! as sketch geometry. Cache model data; camera changes only redo projection.
use super::*;
use crate::native_viewport::interface_shell::ribbon::Icon;
use crate::native_viewport::{interface_shell, ViewportLineLayer};
use crate::session_bridge::native_interface::controller::chrome::{rect, Widgets};
use nbcad_sketch::{ConstraintKind, DimensionDto, EntityDto, Vec2 as Point};

const COLOR: [f32; 4] = [0.69, 0.79, 0.04, 1.];
#[derive(Resource, Default)]
struct AnnotationState {
    stamp: Option<Stamp>,
    sketch: Option<SketchDto>,
    view: Vec<u32>,
    widgets: Widgets,
}

fn projected(p: Point, a: Point, b: Point) -> Point {
    let d = b - a;
    let n = d.dot(d);
    if n < 1e-20 {
        a
    } else {
        a + d * ((p - a).dot(d) / n)
    }
}
fn radial(e: &EntityDto) -> Option<(Point, f64)> {
    match e {
        EntityDto::Arc { center, radius, .. } | EntityDto::Circle { center, radius, .. } => {
            Some((*center, *radius))
        }
        _ => None,
    }
}
fn line(e: &EntityDto) -> Option<(Point, Point)> {
    match e {
        EntityDto::Line { start, end, .. } => Some((*start, *end)),
        _ => None,
    }
}
fn anchor(e: &EntityDto) -> Point {
    match e {
        EntityDto::Point { position, .. } => *position,
        EntityDto::Line { start, end, .. } => (*start + *end) * 0.5,
        EntityDto::Arc { center, .. } | EntityDto::Circle { center, .. } => *center,
        EntityDto::Spline { points, .. } => points.first().copied().unwrap_or(Point::ZERO),
    }
}
fn relation_icon(kind: &str) -> &'static str {
    match kind {
        "horizontal" | "vertical" | "horizontal_points" | "vertical_points" => "hv",
        "parallel" => "parallel",
        "perpendicular" => "perpendicular",
        "tangent" => "tangent",
        "equal" | "equal_distance" => "equal",
        "fix" => "fix",
        "midpoint" | "reference_midpoint" | "span_midpoint" => "midpointC",
        "concentric" => "concentric",
        "collinear" => "collinear",
        "symmetry" => "symmetry",
        _ => "coincident",
    }
}

/// Pure annotation geometry. Extension endpoints come from authoritative
/// entities, not the formatted value (which may be rounded or a reference).
fn leaders(dim: &DimensionDto, entities: &[EntityDto], arrow: f64) -> Vec<[Point; 2]> {
    let refs: Vec<_> = dim
        .entities
        .iter()
        .filter_map(|id| entities.iter().find(|e| e.id() == *id))
        .collect();
    if refs.len() != dim.entities.len() {
        return vec![];
    }
    let mut out = vec![];
    let mut arrow_at = |tip: Point, toward: Point| {
        let delta = toward - tip;
        let length = delta.length();
        if length < 1e-12 {
            return;
        }
        let d = delta * (arrow / length);
        let n = Point::new(-d.y, d.x) * 0.4;
        out.extend([[tip, tip + d + n], [tip, tip + d - n]]);
    };
    if matches!(dim.kind.as_str(), "radius" | "diameter") {
        if let Some((center, radius)) = refs.first().and_then(|e| radial(e)) {
            let d = dim.text_pos - center;
            let length = d.length();
            let mut unit = if length > 1e-12 {
                d * (1. / length)
            } else {
                Point::new(1., 0.)
            };
            if dim.kind == "radius" {
                if let Some(EntityDto::Arc {
                    start_angle,
                    end_angle,
                    ..
                }) = refs.first().copied()
                {
                    let angle = start_angle
                        + (end_angle - start_angle).rem_euclid(std::f64::consts::TAU) * 0.5;
                    unit = Point::new(angle.cos(), angle.sin());
                }
            }
            let edge = center + unit * radius;
            arrow_at(edge, dim.text_pos);
            let start = if dim.kind == "diameter" {
                center - unit * radius
            } else {
                center
            };
            if dim.kind == "diameter" {
                arrow_at(start, edge);
            }
            out.extend([[start, edge], [edge, dim.text_pos]]);
        }
        return out;
    }
    if dim.kind == "angle" {
        if refs.len() != 2 {
            return out;
        }
        let (Some((a, b)), Some((c, d))) = (line(refs[0]), line(refs[1])) else {
            return out;
        };
        let u = b - a;
        let v = d - c;
        let cross = u.x * v.y - u.y * v.x;
        if cross.abs() < 1e-12 {
            return out;
        }
        let t = ((c.x - a.x) * v.y - (c.y - a.y) * v.x) / cross;
        let center = a + u * t;
        let radius = dim.text_pos.distance(center);
        if radius < 1e-8 {
            return out;
        }
        let start = u.y.atan2(u.x);
        let mut sweep = (v.y.atan2(v.x) - start).rem_euclid(std::f64::consts::TAU);
        if sweep > std::f64::consts::PI {
            sweep -= std::f64::consts::TAU;
        }
        let at = |t: f64| {
            center + Point::new((start + sweep * t).cos(), (start + sweep * t).sin()) * radius
        };
        arrow_at(at(0.), at(0.1));
        arrow_at(at(1.), at(0.9));
        for i in 0..48 {
            out.push([at(i as f64 / 48.), at((i + 1) as f64 / 48.)]);
        }
        return out;
    }
    if dim.kind != "distance" {
        return out;
    }
    let endpoints = match refs.as_slice() {
        [EntityDto::Line { start, end, .. }] => Some((*start, *end)),
        [EntityDto::Point { position: a, .. }, EntityDto::Point { position: b, .. }] => {
            Some((*a, *b))
        }
        [EntityDto::Point { position, .. }, other] | [other, EntityDto::Point { position, .. }] => {
            line(other).map(|(a, b)| (*position, projected(*position, a, b)))
        }
        [a, b] => {
            if let (Some((a, _)), Some((c, d))) = (line(a), line(b)) {
                Some((a, projected(a, c, d)))
            } else if let (Some((a, r)), Some((b, s))) = (radial(a), radial(b)) {
                let delta = dim.text_pos - a;
                let len = delta.length().max(1e-12);
                let u = delta * (1. / len);
                Some((a + u * r, b + u * s))
            } else {
                None
            }
        }
        _ => None,
    };
    if let Some((a, b)) = endpoints {
        let d = b - a;
        let len = d.length();
        if len < 1e-12 {
            return out;
        }
        let u = d * (1. / len);
        let n = Point::new(-u.y, u.x);
        let offset = n * (dim.text_pos - a).dot(n);
        let p = a + offset;
        let q = b + offset;
        arrow_at(p, q);
        arrow_at(q, p);
        out.extend([[a, p], [b, q], [p, q]]);
    }
    out
}

pub(super) fn synchronize(
    world: &mut World,
    camera: Entity,
    services: &NativeServices,
    owner: &DocumentContext,
    editor: &Editor,
    canvas: InterfaceRect,
) -> Result<(), String> {
    let mut state = world
        .remove_resource::<AnnotationState>()
        .unwrap_or_default();
    let result = (|| {
        let (_, view, _, size) = native_viewport::interface_view_snapshot(world);
        let mut key: Vec<_> = view
            .position
            .into_iter()
            .chain(view.target)
            .chain(view.up)
            .chain([view.vertical_fov_degrees])
            .chain(size)
            .chain([canvas.x as f32, canvas.y as f32])
            .map(f32::to_bits)
            .collect();
        let selected = editor
            .interaction
            .constraint
            .as_ref()
            .map(|c| c.id.0)
            .unwrap_or(u64::MAX);
        key.extend([selected as u32, (selected >> 32) as u32]);
        if state.stamp == editor.stamp && state.view == key {
            return Ok(());
        }
        if state.stamp != editor.stamp {
            state.sketch = active(&services.engine)?;
            state.stamp = editor.stamp.clone();
        }
        state.view = key;
        state.widgets.begin();
        let mut segments = vec![];
        if let Some(sketch) = &state.sketch {
            let (_, _, _, size) = native_viewport::interface_view_snapshot(world);
            let offset = [canvas.x as f32, canvas.y as f32];
            for dim in &sketch.dimensions {
                let world_point = |p: Point| sketch.basis.to_3d([p.x, p.y]);
                let Some(screen) = native_viewport::interface_world_point(
                    world,
                    &owner.document_id,
                    world_point(dim.text_pos),
                )?
                else {
                    continue;
                };
                if screen[0] < 0. || screen[1] < 0. || screen[0] > size[0] || screen[1] > size[1] {
                    continue;
                }
                let mut unit = 0.01_f32;
                for axis in [Point::new(1., 0.), Point::new(0., 1.)] {
                    if let Some(p) = native_viewport::interface_world_point(
                        world,
                        &owner.document_id,
                        world_point(dim.text_pos + axis),
                    )? {
                        unit = unit.max((p[0] - screen[0]).hypot(p[1] - screen[1]));
                    }
                }
                for pair in leaders(dim, &sketch.entities, 6. / f64::from(unit)) {
                    for point in pair {
                        segments.extend(world_point(point).map(|v| v as f32));
                    }
                }
                let w = (dim.text.chars().count() as f32 * 7. + 12.).max(36.);
                let mut bounds = rect(
                    offset[0] + screen[0] - w / 2.,
                    offset[1] + screen[1] - 22.,
                    w,
                    20.,
                );
                bounds.justify_content = JustifyContent::Center;
                let c = InterfaceControl::button(
                    "sketch/dimension",
                    format!("Edit dimension {}: {}", dim.constraint_id.0, dim.text),
                );
                let entity = state.widgets.button(
                    world,
                    camera,
                    &format!("dim-{}", dim.constraint_id.0),
                    c,
                    Some(&dim.text),
                    NativeCommand::Sketch(EditorCommand::Interaction(
                        InteractionCommand::EditDimension(dim.constraint_id),
                    )),
                    bounds,
                    None,
                    22,
                )?;
                interface_shell::dimension_label(
                    world,
                    entity,
                    Color::srgba(COLOR[0], COLOR[1], COLOR[2], COLOR[3]),
                );
            }
            let mut anchors = HashMap::<(i32, i32), usize>::new();
            for constraint in &sketch.constraints {
                if constraint.constraint.kind() != ConstraintKind::Geometric {
                    continue;
                }
                let ids = constraint.constraint.referenced_entities();
                let positions: Vec<_> = ids
                    .iter()
                    .filter_map(|id| sketch.entities.iter().find(|e| e.id() == *id))
                    .map(anchor)
                    .collect();
                if positions.is_empty() {
                    continue;
                }
                let center = positions.iter().fold(Point::ZERO, |a, b| a + *b)
                    * (1. / positions.len() as f64);
                let Some(screen) = native_viewport::interface_world_point(
                    world,
                    &owner.document_id,
                    sketch.basis.to_3d([center.x, center.y]),
                )?
                else {
                    continue;
                };
                let count = anchors
                    .entry((
                        (screen[0] / 24.).round() as i32,
                        (screen[1] / 24.).round() as i32,
                    ))
                    .or_default();
                let x = screen[0] + (*count % 5) as f32 * 22.;
                let y = screen[1] + 14. + (*count / 5) as f32 * 22.;
                *count += 1;
                if x < 0. || y < 0. || x + 22. > size[0] || y + 22. > size[1] {
                    continue;
                }
                let kind = constraint.constraint.kind_str();
                let mut control = InterfaceControl::button(
                    "sketch/constrain",
                    format!("Constraint {}: {}", constraint.id.0, kind.replace('_', " ")),
                );
                control.selected = Some(selected == constraint.id.0);
                state.widgets.button(
                    world,
                    camera,
                    &format!("constraint-{}", constraint.id.0),
                    control,
                    Some(""),
                    NativeCommand::Sketch(EditorCommand::Interaction(
                        InteractionCommand::ConstraintInfo(constraint.id),
                    )),
                    rect(offset[0] + x - 11., offset[1] + y - 11., 22., 22.),
                    Some(Icon::Relation(relation_icon(kind))),
                    22,
                )?;
            }
        }
        state.widgets.finish(world);
        native_viewport::apply_interface_sketch_lines(
            world,
            &owner.document_id,
            if segments.is_empty() {
                vec![]
            } else {
                vec![ViewportLineLayer {
                    color: COLOR,
                    width: 1.5,
                    segments,
                    ..default()
                }]
            },
        )
    })();
    world.insert_resource(state);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn radius_leader_touches_the_actual_arc_even_when_the_label_is_on_its_missing_half() {
        let arc: EntityDto = serde_json::from_value(json!({"kind":"arc","id":3,"center":{"x":0.,"y":0.},"radius":10.,"start_angle":0.,"end_angle":std::f64::consts::PI,"fully_defined":false})).unwrap();
        let dim: DimensionDto = serde_json::from_value(json!({"constraint_id":1,"mode":"driving","kind":"radius","entities":[3],"value":10.,"text":"R10.00","text_pos":{"x":0.,"y":-15.}})).unwrap();
        let lines = leaders(&dim, &[arc], 0.5);
        let [_, tip] = lines[lines.len() - 2];
        assert!(tip.x.abs() < 1e-10 && (tip.y - 10.).abs() < 1e-10);
    }
    #[test]
    fn dimension_leaders_use_model_endpoints_instead_of_rounded_text() {
        let e = EntityDto::Line {
            id: nbcad_sketch::EntityId(3),
            start_id: nbcad_sketch::EntityId(1),
            end_id: nbcad_sketch::EntityId(2),
            start: Point::new(0., 0.),
            end: Point::new(12.345, 0.),
            fully_defined: false,
            consumed: false,
        };
        let d:DimensionDto=serde_json::from_value(json!({"constraint_id":1,"mode":"driving","kind":"distance","entities":[3],"value":12.345,"text":"12.35","text_pos":{"x":5.,"y":-4.}})).unwrap();
        let lines = leaders(&d, &[e], 0.5);
        assert!(lines.contains(&[Point::new(0., -4.), Point::new(12.345, -4.)]));
    }
}
