//! Lightweight construction guides, never B-rep or a boolean result. The
//! accepted request still goes to the normal kernel only when Apply runs.

use nbcad_core::PlaneBasis;
use nbcad_solid::{ExtrudeExtent, ExtrudeOperation, ExtrudeRequest};

use crate::native_viewport::{ViewportArrow, ViewportLineLayer, ViewportModel, ViewportPreview};

const MAX_SEGMENTS: usize = 100_000;

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
