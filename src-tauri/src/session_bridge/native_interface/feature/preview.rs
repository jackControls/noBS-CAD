//! Lightweight construction guides, never B-rep or a boolean result. The
//! accepted request still goes to the normal kernel only when Apply runs.

use nbcad_core::PlaneBasis;
use nbcad_solid::{ExtrudeExtent, ExtrudeOperation, ExtrudeRequest};

use crate::native_viewport::{ViewportArrow, ViewportLineLayer, ViewportModel, ViewportPreview};

const MAX_SEGMENTS: usize = 100_000;

pub(super) fn references(
    form: &crate::native_forms::SolidForm,
    model: &crate::native_forms::FormModel<'_>,
    viewport: &ViewportModel,
) -> Result<ViewportPreview, String> {
    let mut segments = Vec::new();
    let mut triangles = Vec::new();
    let mut plane_lines = Vec::new();
    for body in form.selected_bodies() {
        triangles.push(body_fill(model.scene, *body, [1., 0.65, 0.25, 0.25])?);
        if triangles
            .iter()
            .map(|t| t.positions.len() / 9)
            .sum::<usize>()
            > MAX_SEGMENTS
        {
            return Err("Selected bodies are too large to highlight together".into());
        }
    }
    let axis_center = form.plane_axis().and_then(|(body, edge)| {
        let edge = model
            .scene
            .bodies
            .iter()
            .find(|b| b.id == body)?
            .edges
            .iter()
            .find(|e| e.id == edge)?;
        let a = edge.points.first()?;
        let b = edge.points.last()?;
        Some([(a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5])
    });
    // A plane is infinite; center its finite display patch on the selected
    // axis while preserving its actual equation and saved coordinate origin.
    let centered = |mut basis: PlaneBasis| {
        if let Some(point) = axis_center {
            basis.origin = basis.to_3d(basis.to_2d(point));
        }
        basis
    };
    let mut arrows = Vec::new();
    if let Some((basis, distance)) = form.plane_offset(model) {
        arrows.push(ViewportArrow {
            start: basis.origin.map(|v| v as f32),
            end: std::array::from_fn(|i| (basis.origin[i] + basis.normal[i] * distance) as f32),
            color: [1., 0.72, 0.15, 1.],
            width: 3.,
            xray: true,
        });
    }
    for basis in form.plane_guides(model) {
        plane_quad(
            centered(basis),
            [0.35, 0.65, 1., 0.12],
            &mut triangles,
            &mut plane_lines,
        )?;
    }
    if let Some(basis) = form.plane_preview(model)? {
        plane_quad(
            centered(basis),
            [1., 0.72, 0.15, 0.26],
            &mut triangles,
            &mut plane_lines,
        )?;
    }
    for (body, edge) in form.plane_axis().into_iter().chain(form.pattern_edges()) {
        if let Some(edge) = model
            .scene
            .bodies
            .iter()
            .find(|b| b.id == body)
            .and_then(|b| b.edges.iter().find(|e| e.id == edge))
        {
            for pair in edge.points.windows(2) {
                for point in pair {
                    segments.extend([point.x as f32, point.y as f32, point.z as f32]);
                }
            }
        }
    }
    for (field, color) in [
        (
            crate::native_forms::SolidField::TargetBody,
            [1., 0.65, 0.25, 0.30],
        ),
        (
            crate::native_forms::SolidField::ToolBodies,
            [0.25, 0.7, 1., 0.30],
        ),
    ] {
        for id in form.combine_bodies(field) {
            triangles.push(body_fill(model.scene, id, color)?);
            if triangles
                .iter()
                .map(|t| t.positions.len() / 9)
                .sum::<usize>()
                > MAX_SEGMENTS
            {
                return Err("Selected bodies are too large to highlight together".into());
            }
        }
    }
    if let Some((body, faces)) = form.selected_faces() {
        triangles.push(face_fill(model.scene, body, faces, [1., 0.80, 0.25, 0.35])?);
    }
    if let Some((id, edges)) = form.selected_edges() {
        if let Some(body) = model.scene.bodies.iter().find(|b| b.id == id) {
            for edge in body.edges.iter().filter(|edge| edges.contains(&edge.id)) {
                for pair in edge.points.windows(2) {
                    if segments.len() / 6 >= MAX_SEGMENTS {
                        return Err("Selected edges are too large to preview".into());
                    }
                    for point in pair {
                        segments.extend([point.x as f32, point.y as f32, point.z as f32]);
                    }
                }
            }
        }
    }
    for selected in form.selected_profiles() {
        if let Some(sketch) = model
            .profiles
            .iter()
            .find(|s| s.sketch_name == selected.sketch_name)
        {
            for profile in sketch.profiles.iter().filter(|p| {
                p.index == selected.profile_index || p.parent_index == Some(selected.profile_index)
            }) {
                for (a, b) in profile
                    .points
                    .iter()
                    .zip(profile.points.iter().cycle().skip(1))
                    .take(profile.points.len())
                {
                    if segments.len() / 6 >= MAX_SEGMENTS {
                        return Err("Selected profile is too large to preview".into());
                    }
                    segments.extend(sketch.basis.to_3d([a.x, a.y]).map(|v| v as f32));
                    segments.extend(sketch.basis.to_3d([b.x, b.y]).map(|v| v as f32));
                }
            }
        }
    }
    for path in form.selected_paths() {
        if let Some(sketch) = viewport
            .finished_sketches
            .iter()
            .find(|s| s.name == path.sketch_name)
        {
            for entity in sketch
                .entities
                .iter()
                .filter(|e| path.entity_ids.contains(&e.id().0))
            {
                for pair in curve_points(entity).windows(2) {
                    if segments.len() / 6 >= MAX_SEGMENTS {
                        return Err("Selected paths are too large to preview".into());
                    }
                    for point in pair {
                        segments.extend(sketch.basis.to_3d([point.x, point.y]).map(|v| v as f32));
                    }
                }
            }
        }
    }
    if let Some(axis) = form.revolution_axis(model)? {
        segments.extend(axis.into_iter().flatten().map(|v| v as f32));
    }
    if segments.iter().any(|v| !v.is_finite()) {
        return Err("Feature reference exceeds the renderer's range".into());
    }
    plane_lines.push(ViewportLineLayer {
        color: if form.selected_edges().is_some() {
            [1., 0.88, 0.35, 1.]
        } else {
            [0.45, 0.72, 1., 1.]
        },
        width: 3.,
        segments,
        ..Default::default()
    });
    Ok(ViewportPreview {
        triangles,
        arrows,
        lines: plane_lines,
        ..Default::default()
    })
}

pub(super) fn body_fill(
    scene: &nbcad_solid::SolidSceneDto,
    id: nbcad_core::BodyId,
    color: [f32; 4],
) -> Result<crate::native_viewport::ViewportTriangleLayer, String> {
    let body = scene
        .bodies
        .iter()
        .find(|b| b.id == id)
        .ok_or("Selected body no longer exists")?;
    face_fill(
        scene,
        id,
        &body.faces.iter().map(|f| f.id).collect::<Vec<_>>(),
        color,
    )
}

pub(super) fn face_fill(
    scene: &nbcad_solid::SolidSceneDto,
    body: nbcad_core::BodyId,
    faces: &[nbcad_core::FaceId],
    color: [f32; 4],
) -> Result<crate::native_viewport::ViewportTriangleLayer, String> {
    let body = scene
        .bodies
        .iter()
        .find(|b| b.id == body)
        .ok_or("Selected body no longer exists")?;
    let selected: std::collections::HashSet<_> = faces.iter().collect();
    let mut positions = Vec::new();
    for face in body.faces.iter().filter(|f| selected.contains(&f.id)) {
        let start = face.first_index as usize;
        let end = start
            .checked_add(face.index_count as usize)
            .ok_or("Face tessellation is too large")?;
        let indices = body
            .mesh
            .indices
            .get(start..end)
            .ok_or("Face tessellation is incomplete")?;
        if indices.len() % 3 != 0 || positions.len() / 9 + indices.len() / 3 > MAX_SEGMENTS {
            return Err("Selected faces are too large to preview".into());
        }
        for &index in indices {
            let start = (index as usize)
                .checked_mul(3)
                .ok_or("Face vertex exceeds renderer range")?;
            let point = body
                .mesh
                .positions
                .get(start..start + 3)
                .ok_or("Face vertex is missing")?;
            if point.iter().any(|v| !v.is_finite()) {
                return Err("Face vertex exceeds renderer range".into());
            }
            positions.extend_from_slice(point);
        }
    }
    Ok(crate::native_viewport::ViewportTriangleLayer {
        positions,
        color,
        ..Default::default()
    })
}

fn plane_quad(
    basis: PlaneBasis,
    color: [f32; 4],
    triangles: &mut Vec<crate::native_viewport::ViewportTriangleLayer>,
    lines: &mut Vec<ViewportLineLayer>,
) -> Result<(), String> {
    let points = [[-40., -40.], [40., -40.], [40., 40.], [-40., 40.]]
        .map(|p| basis.to_3d(p).map(|v| v as f32));
    if points.iter().flatten().any(|v| !v.is_finite()) {
        return Err("Construction preview exceeds renderer range".into());
    }
    let mut segments = Vec::with_capacity(24);
    for i in 0..4 {
        segments.extend(points[i]);
        segments.extend(points[(i + 1) % 4]);
    }
    lines.push(ViewportLineLayer {
        segments,
        color: [color[0], color[1], color[2], 1.],
        width: 2.,
        ..Default::default()
    });
    triangles.push(crate::native_viewport::ViewportTriangleLayer {
        positions: [0, 1, 2, 0, 2, 3]
            .into_iter()
            .flat_map(|i| points[i])
            .collect(),
        color,
        ..Default::default()
    });
    Ok(())
}

fn curve_points(entity: &nbcad_sketch::EntityDto) -> Vec<nbcad_sketch::Vec2> {
    use nbcad_sketch::{EntityDto, Vec2};
    let (center, radius, start, sweep) = match entity {
        EntityDto::Line { start, end, .. } => return vec![*start, *end],
        EntityDto::Spline { tessellation, .. } => return tessellation.clone(),
        EntityDto::Circle { center, radius, .. } => (*center, *radius, 0., std::f64::consts::TAU),
        EntityDto::Arc {
            center,
            radius,
            start_angle,
            end_angle,
            ..
        } => (
            *center,
            *radius,
            *start_angle,
            (end_angle - start_angle).rem_euclid(std::f64::consts::TAU),
        ),
        _ => return vec![],
    };
    let steps = ((sweep * 30.).ceil() as usize).clamp(12, 192);
    (0..=steps)
        .map(|i| {
            let a = start + sweep * i as f64 / steps as f64;
            center + Vec2::new(a.cos(), a.sin()) * radius
        })
        .collect()
}

pub(super) fn build(
    request: &ExtrudeRequest,
    model: &ViewportModel,
) -> Result<ViewportPreview, String> {
    if request.taper_angle_deg.abs() > 1e-9 {
        return Err("Taper will be calculated by the kernel on Apply; an untapered preview would be misleading".into());
    }
    let (basis, boundaries) = source(request, model)?;
    let (start, end, direction) = offsets(request, model, basis)?;
    let stop = if let ExtrudeExtent::ToFace { face_id } = request.extent {
        model
            .scene
            .bodies
            .iter()
            .flat_map(|body| &body.faces)
            .find(|face| face.id == face_id)
            .and_then(|face| face.plane)
    } else {
        None
    };
    let mut segments = Vec::new();
    let mut centroid = [0.; 3];
    let mut count = 0.;
    for boundary in boundaries {
        for pair in boundary.windows(2) {
            let a = pair[0];
            let b = pair[1];
            let translated = |point: [f64; 3], offset: f64| -> Result<[f64; 3], String> {
                let offset = if let Some(stop) = stop {
                    if offset == start {
                        offset
                    } else {
                        let denominator = dot(basis.normal, stop.normal);
                        if denominator.abs() < 1e-9 {
                            return Err("Extrude direction is parallel to the stop face".into());
                        }
                        dot(sub(stop.origin, point), stop.normal) / denominator
                            * if request.flip { -1. } else { 1. }
                    }
                } else {
                    offset
                };
                Ok(add(point, scale(basis.normal, offset)))
            };
            let a0 = translated(a, start)?;
            let b0 = translated(b, start)?;
            let a1 = translated(a, end)?;
            let b1 = translated(b, end)?;
            for (a, b) in [(a0, b0), (a1, b1), (a0, a1)] {
                if segments.len() / 6 >= MAX_SEGMENTS {
                    return Err(
                        "This profile exceeds the interactive construction preview limit".into(),
                    );
                }
                for coordinate in a.into_iter().chain(b) {
                    let value = coordinate as f32;
                    if !value.is_finite() {
                        return Err(
                            "Extrude preview coordinates are outside the renderer range".into()
                        );
                    }
                    segments.push(value);
                }
            }
            centroid = add(centroid, a);
            count += 1.;
        }
    }
    if count == 0. {
        return Err("No source boundary is available for a construction preview".into());
    }
    centroid = scale(centroid, 1. / count);
    let color = match request.operation {
        ExtrudeOperation::Cut => [0.96, 0.31, 0.23, 1.],
        ExtrudeOperation::Intersect => [0.87, 0.64, 0.16, 1.],
        _ => [0.12, 0.64, 0.97, 1.],
    };
    Ok(ViewportPreview {
        lines: vec![ViewportLineLayer {
            color,
            width: 2.,
            segments,
            ..Default::default()
        }],
        arrows: vec![ViewportArrow {
            start: centroid.map(|v| v as f32),
            end: add(centroid, scale(basis.normal, direction)).map(|v| v as f32),
            color,
            width: 2.,
            xray: false,
        }],
        ..Default::default()
    })
}

fn source(
    request: &ExtrudeRequest,
    model: &ViewportModel,
) -> Result<(PlaneBasis, Vec<Vec<[f64; 3]>>), String> {
    if let Some(source) = request.source_face {
        let body = model
            .scene
            .bodies
            .iter()
            .find(|body| body.id == source.body_id)
            .ok_or("Source body is unavailable")?;
        let face = body
            .faces
            .iter()
            .find(|face| face.id == source.face_id)
            .ok_or("Source face is unavailable")?;
        let basis = face.plane.ok_or("Source face is not planar")?;
        let mut boundaries = Vec::new();
        // Use only this exact face's topology edges, including its inner
        // wires. Never infer a source boundary from the body's bounding box.
        for key in &face.edge_keys {
            let edge = body
                .edges
                .iter()
                .find(|edge| &edge.key == key)
                .ok_or("Source face boundary is unavailable")?;
            boundaries.push(edge.points.iter().map(|p| [p.x, p.y, p.z]).collect());
        }
        Ok((basis, boundaries))
    } else {
        let catalog = model
            .profile_catalog
            .iter()
            .find(|catalog| catalog.sketch_name == request.sketch_name)
            .ok_or("Source sketch is unavailable")?;
        let mut boundaries = Vec::new();
        for profile in &catalog.profiles {
            let selected = request.profile_indices.contains(&profile.index)
                || (profile.nesting_depth % 2 == 1
                    && profile
                        .parent_index
                        .is_some_and(|parent| request.profile_indices.contains(&parent)));
            if !selected {
                continue;
            }
            let mut points: Vec<_> = profile
                .points
                .iter()
                .map(|point| catalog.basis.to_3d([point.x, point.y]))
                .collect();
            if points.len() >= 2 && points.first() != points.last() {
                points.push(points[0]);
            }
            boundaries.push(points);
        }
        Ok((catalog.basis, boundaries))
    }
}

fn offsets(
    request: &ExtrudeRequest,
    model: &ViewportModel,
    basis: PlaneBasis,
) -> Result<(f64, f64, f64), String> {
    let sign = if request.flip { -1. } else { 1. };
    let offsets = match request.extent {
        ExtrudeExtent::Distance { distance } => (0., distance * sign, distance * sign),
        ExtrudeExtent::TwoSides {
            distance,
            second_distance,
        } => (-second_distance * sign, distance * sign, distance * sign),
        ExtrudeExtent::Symmetric { distance } => {
            (-distance * 0.5, distance * 0.5, distance * 0.5 * sign)
        }
        ExtrudeExtent::ToFace { face_id } => {
            let stop = model
                .scene
                .bodies
                .iter()
                .flat_map(|body| &body.faces)
                .find(|face| face.id == face_id)
                .and_then(|face| face.plane)
                .ok_or("Stop face is unavailable")?;
            let denominator = dot(basis.normal, stop.normal);
            if denominator.abs() < 1. - 1e-6 {
                return Err("To Face currently requires a parallel planar face".into());
            }
            let distance = dot(sub(stop.origin, basis.origin), stop.normal) / denominator * sign;
            if distance.abs() <= 1e-6 {
                return Err("Stop face has no extrusion distance at the source origin".into());
            }
            (0., distance, distance)
        }
        ExtrudeExtent::ThroughAll => {
            let mut minimum = f64::INFINITY;
            let mut maximum = f64::NEG_INFINITY;
            for body in &model.scene.bodies {
                if !request.target_body_ids.is_empty()
                    && !request.target_body_ids.contains(&body.id)
                {
                    continue;
                }
                for point in body.mesh.positions.chunks_exact(3) {
                    let distance = dot(
                        sub(
                            [point[0] as f64, point[1] as f64, point[2] as f64],
                            basis.origin,
                        ),
                        basis.normal,
                    );
                    minimum = minimum.min(distance);
                    maximum = maximum.max(distance);
                }
            }
            if !minimum.is_finite() || !maximum.is_finite() {
                return Err("Through All needs target geometry for a bounded preview".into());
            }
            let padding = 2_f64.max((maximum - minimum) * 0.08);
            (
                minimum - padding,
                maximum + padding,
                if request.flip {
                    minimum - padding
                } else {
                    maximum + padding
                },
            )
        }
    };
    if ![offsets.0, offsets.1, offsets.2]
        .iter()
        .all(|v| v.is_finite())
    {
        return Err("Extrude preview distance is not finite".into());
    }
    Ok(offsets)
}

fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn scale(a: [f64; 3], scale: f64) -> [f64; 3] {
    a.map(|v| v * scale)
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
