//! Feature-level feedback for agents: what a script actually built, in the
//! terms an agent reasons in (holes with positions, diameters, depths and
//! faces; bodies with bounding boxes), plus warnings for the mistakes that
//! never raise an error, and a check of an expected feature table against
//! the built model. Everything here reads the same document and scene the
//! desktop shows; nothing is a second modelling path.
use nbcad_core::PlaneBasis;
use nbcad_solid::{BodyDto, HoleDefinitionDto, HoleExtent, HoleStyle, SolidSceneDto};
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// One drilled position, in world coordinates.
#[derive(Clone, Debug)]
pub struct Hole {
    pub feature_id: Option<u64>,
    pub name: String,
    pub body_id: u64,
    pub face_id: Option<u64>,
    pub position: [f64; 3],
    /// Outward normal of the face the hole starts from (drilling goes the
    /// other way unless `flip`).
    pub normal: [f64; 3],
    pub flip: bool,
    pub diameter: f64,
    pub through: bool,
    pub depth: Option<f64>,
    pub style: String,
    pub counterbore_diameter: Option<f64>,
    pub counterbore_depth: Option<f64>,
    pub thread: Option<String>,
}

impl Hole {
    fn json(&self) -> Value {
        json!({
            "feature_id": self.feature_id,
            "name": self.name,
            "body_id": self.body_id,
            "face_id": self.face_id,
            "x": round3(self.position[0]),
            "y": round3(self.position[1]),
            "z": round3(self.position[2]),
            "normal": [round3(self.normal[0]), round3(self.normal[1]), round3(self.normal[2])],
            "flip": self.flip,
            "diameter": round3(self.diameter),
            "through": self.through,
            "depth": self.depth.map(round3),
            "style": self.style,
            "counterbore_diameter": self.counterbore_diameter.map(round3),
            "counterbore_depth": self.counterbore_depth.map(round3),
            "thread": self.thread,
        })
    }

    fn class_key(&self) -> String {
        format!(
            "{:.2}|{}|{}|{}|{}",
            self.diameter,
            self.style,
            self.counterbore_diameter
                .map(|d| format!("{d:.2}"))
                .unwrap_or_default(),
            self.thread.clone().unwrap_or_default(),
            if self.through {
                "through".to_string()
            } else {
                format!("depth {:.2}", self.depth.unwrap_or(0.0))
            }
        )
    }
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

pub struct BodyBox {
    pub id: u64,
    pub name: String,
    pub feature_id: u64,
    pub min: [f64; 3],
    pub max: [f64; 3],
    pub faces: usize,
    pub planar_faces: usize,
    pub cylindrical_faces: usize,
}

fn body_box(body: &BodyDto) -> Option<BodyBox> {
    let positions = &body.mesh.positions;
    if positions.len() < 3 {
        return None;
    }
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for chunk in positions.chunks_exact(3) {
        for (i, component) in chunk.iter().enumerate() {
            min[i] = min[i].min(f64::from(*component));
            max[i] = max[i].max(f64::from(*component));
        }
    }
    Some(BodyBox {
        id: body.id.0,
        name: body.name.clone(),
        feature_id: body.feature_id.0,
        min,
        max,
        faces: body.faces.len(),
        planar_faces: body.faces.iter().filter(|f| f.plane.is_some()).count(),
        cylindrical_faces: body.faces.iter().filter(|f| f.cylinder.is_some()).count(),
    })
}

fn face_plane(scene: &SolidSceneDto, body_id: u64, face_id: u64) -> Option<PlaneBasis> {
    scene
        .bodies
        .iter()
        .filter(|b| b.id.0 == body_id)
        .flat_map(|b| b.faces.iter())
        .chain(scene.bodies.iter().flat_map(|b| b.faces.iter()))
        .find(|f| f.id.0 == face_id)
        .and_then(|f| f.plane.clone())
}

/// Holes from the feature history, one entry per drilled position.
pub fn holes_from_definitions(
    definitions: &[HoleDefinitionDto],
    scene: &SolidSceneDto,
) -> Vec<Hole> {
    let mut holes = Vec::new();
    for definition in definitions {
        let Some(basis) = definition
            .face_basis
            .clone()
            .or_else(|| face_plane(scene, definition.body_id.0, definition.face_id.0))
        else {
            continue;
        };
        let (through, depth) = match definition.extent {
            HoleExtent::ThroughAll => (true, None),
            HoleExtent::Distance { depth } => (false, Some(depth)),
        };
        let style = match definition.style {
            HoleStyle::Simple => "simple",
            HoleStyle::Counterbore => "counterbore",
            HoleStyle::Countersink => "countersink",
        };
        let positions: Vec<[f64; 2]> = if definition.positions.is_empty() {
            vec![[definition.position.x, definition.position.y]]
        } else {
            definition
                .positions
                .iter()
                .map(|p| [p.position.x, p.position.y])
                .collect()
        };
        for uv in positions {
            holes.push(Hole {
                feature_id: Some(definition.feature_id.0),
                name: definition.name.clone(),
                body_id: definition.body_id.0,
                face_id: Some(definition.face_id.0),
                position: basis.to_3d(uv),
                normal: basis.normal,
                flip: definition.flip,
                diameter: definition.diameter,
                through,
                depth,
                style: style.to_string(),
                counterbore_diameter: (definition.style == HoleStyle::Counterbore)
                    .then_some(definition.counterbore_diameter),
                counterbore_depth: (definition.style == HoleStyle::Counterbore)
                    .then_some(definition.counterbore_depth),
                thread: definition.thread.as_ref().map(|t| t.designation.clone()),
            });
        }
    }
    holes
}

/// Holes read back from the geometry alone (an imported STEP has no feature
/// history): cylindrical faces sharing an axis line, smallest radius = hole,
/// a larger coaxial radius = counterbore. Positions are a point on the axis.
pub fn holes_from_scene(scene: &SolidSceneDto) -> Vec<Hole> {
    let mut groups: Vec<(u64, [f64; 3], [f64; 3], Vec<f64>)> = Vec::new();
    for body in &scene.bodies {
        for face in &body.faces {
            let Some(cylinder) = &face.cylinder else {
                continue;
            };
            let axis = normalize([cylinder.axis.x, cylinder.axis.y, cylinder.axis.z]);
            let origin = [cylinder.origin.x, cylinder.origin.y, cylinder.origin.z];
            let mut placed = false;
            for group in groups.iter_mut() {
                if group.0 != body.id.0 || dot(group.2, axis).abs() < 0.999 {
                    continue;
                }
                // distance between the axis lines
                let delta = sub(origin, group.1);
                let along = dot(delta, group.2);
                let off = sub(delta, scale(group.2, along));
                if norm(off) < 0.05 {
                    group.3.push(cylinder.radius);
                    placed = true;
                    break;
                }
            }
            if !placed {
                groups.push((body.id.0, origin, axis, vec![cylinder.radius]));
            }
        }
    }
    groups
        .into_iter()
        .map(|(body_id, origin, axis, mut radii)| {
            radii.sort_by(|a, b| a.partial_cmp(b).unwrap());
            Hole {
                feature_id: None,
                name: "cylinder".into(),
                body_id,
                face_id: None,
                position: origin,
                normal: axis,
                flip: false,
                diameter: 2.0 * radii[0],
                through: false,
                depth: None,
                style: if radii.len() > 1 {
                    "counterbore"
                } else {
                    "simple"
                }
                .into(),
                counterbore_diameter: (radii.len() > 1).then(|| 2.0 * radii[radii.len() - 1]),
                counterbore_depth: None,
                thread: None,
            }
        })
        .collect()
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn scale(a: [f64; 3], k: f64) -> [f64; 3] {
    [a[0] * k, a[1] * k, a[2] * k]
}
fn norm(a: [f64; 3]) -> f64 {
    dot(a, a).sqrt()
}
fn normalize(a: [f64; 3]) -> [f64; 3] {
    let n = norm(a);
    if n == 0.0 {
        a
    } else {
        scale(a, 1.0 / n)
    }
}

pub struct Summary {
    pub bodies: Vec<BodyBox>,
    pub holes: Vec<Hole>,
    pub source: &'static str,
    pub errors: usize,
}

pub fn summarize(scene: &SolidSceneDto, definitions: &[HoleDefinitionDto]) -> Summary {
    let bodies = scene.bodies.iter().filter_map(body_box).collect();
    let (holes, source) = if definitions.is_empty() {
        (holes_from_scene(scene), "scene")
    } else {
        (holes_from_definitions(definitions, scene), "features")
    };
    Summary {
        bodies,
        holes,
        source,
        errors: scene.errors.len(),
    }
}

impl Summary {
    /// Compact by default: bodies, counts and a tally per hole class. `full`
    /// adds every hole with its position.
    pub fn json(&self, full: bool) -> Value {
        let mut classes: BTreeMap<String, (Value, usize)> = BTreeMap::new();
        for hole in &self.holes {
            let entry = classes.entry(hole.class_key()).or_insert_with(|| {
                (
                    json!({
                        "diameter": round3(hole.diameter),
                        "style": hole.style,
                        "counterbore_diameter": hole.counterbore_diameter.map(round3),
                        "thread": hole.thread,
                        "through": hole.through,
                        "depth": hole.depth.map(round3),
                    }),
                    0,
                )
            });
            entry.1 += 1;
        }
        let mut result = json!({
            "bodies": self.bodies.iter().map(|b| json!({
                "id": b.id, "name": b.name, "feature_id": b.feature_id,
                "bbox_min": [round3(b.min[0]), round3(b.min[1]), round3(b.min[2])],
                "bbox_max": [round3(b.max[0]), round3(b.max[1]), round3(b.max[2])],
                "size": [round3(b.max[0]-b.min[0]), round3(b.max[1]-b.min[1]), round3(b.max[2]-b.min[2])],
                "faces": b.faces, "planar_faces": b.planar_faces, "cylindrical_faces": b.cylindrical_faces,
            })).collect::<Vec<_>>(),
            "scene_errors": self.errors,
            "hole_source": self.source,
            "hole_count": self.holes.len(),
            "holes_by_class": classes.values().map(|(class, count)| {
                let mut class = class.clone();
                class["count"] = json!(count);
                class
            }).collect::<Vec<_>>(),
        });
        if full {
            result["holes"] = Value::Array(self.holes.iter().map(Hole::json).collect());
        }
        result
    }
}

/// The mistakes that never raise an error: a first point left out of
/// `positions`, holes that merge, holes off the body, blind depths deeper
/// than the body, and bindings a script never used.
pub fn warnings(
    summary: &Summary,
    definitions: &[HoleDefinitionDto],
    unused_bindings: &[String],
) -> Vec<Value> {
    let mut warnings = Vec::new();
    for definition in definitions {
        if !definition.positions.is_empty()
            && !definition.positions.iter().any(|p| {
                (p.position.x - definition.position.x).abs() < 1e-6
                    && (p.position.y - definition.position.y).abs() < 1e-6
            })
        {
            warnings.push(json!({
                "code": "hole_position_ignored",
                "feature_id": definition.feature_id.0,
                "message": format!(
                    "Hole feature {} ({}): position ({}, {}) is not among its {} positions; when positions is given only those points are drilled, so repeat the first point inside positions if it is meant to be a hole",
                    definition.feature_id.0, definition.name, round3(definition.position.x), round3(definition.position.y), definition.positions.len()
                ),
            }));
        }
    }
    let holes = &summary.holes;
    for (i, a) in holes.iter().enumerate() {
        for b in holes.iter().skip(i + 1) {
            if a.body_id != b.body_id || dot(a.normal, b.normal).abs() < 0.999 {
                continue;
            }
            let delta = sub(b.position, a.position);
            let across = sub(delta, scale(a.normal, dot(delta, a.normal)));
            let distance = norm(across);
            let reach = (a.counterbore_diameter.unwrap_or(a.diameter)
                + b.counterbore_diameter.unwrap_or(b.diameter))
                / 2.0;
            if distance < reach - 1e-6 {
                warnings.push(json!({
                    "code": "holes_overlap",
                    "feature_id": a.feature_id,
                    "message": format!(
                        "Holes at ({}, {}, {}) Ø{} and ({}, {}, {}) Ø{} are {} mm apart and overlap; the kernel merges them into one opening",
                        round3(a.position[0]), round3(a.position[1]), round3(a.position[2]), round3(a.diameter),
                        round3(b.position[0]), round3(b.position[1]), round3(b.position[2]), round3(b.diameter),
                        round3(distance)
                    ),
                }));
            }
        }
    }
    for hole in holes {
        let Some(body) = summary.bodies.iter().find(|b| b.id == hole.body_id) else {
            continue;
        };
        let outside = (0..3).any(|i| {
            hole.normal[i].abs() < 0.9
                && (hole.position[i] < body.min[i] - 1e-3 || hole.position[i] > body.max[i] + 1e-3)
        });
        if outside {
            warnings.push(json!({
                "code": "hole_outside_body",
                "feature_id": hole.feature_id,
                "message": format!(
                    "Hole at ({}, {}, {}) Ø{} lies outside body {} (bbox {:?} to {:?})",
                    round3(hole.position[0]), round3(hole.position[1]), round3(hole.position[2]), round3(hole.diameter),
                    body.id, body.min.map(round3), body.max.map(round3)
                ),
            }));
        }
        if let Some(depth) = hole.depth {
            let extent = (0..3)
                .map(|i| (body.max[i] - body.min[i]) * hole.normal[i].abs())
                .sum::<f64>();
            if extent > 0.0 && depth > extent + 1e-3 {
                warnings.push(json!({
                    "code": "blind_depth_exceeds_body",
                    "feature_id": hole.feature_id,
                    "message": format!(
                        "Hole at ({}, {}, {}) Ø{} is blind to {} mm but body {} is only {} mm along its axis; it breaks through",
                        round3(hole.position[0]), round3(hole.position[1]), round3(hole.position[2]), round3(hole.diameter),
                        round3(depth), body.id, round3(extent)
                    ),
                }));
            }
        }
    }
    for name in unused_bindings {
        warnings.push(json!({
            "code": "unused_binding",
            "message": format!("let binding {name} is never referenced"),
        }));
    }
    warnings
}

/// Compare an expected feature table with what was built.
pub fn check(summary: &Summary, expected: &Value, tolerance: f64) -> Result<Value, String> {
    let mut result = json!({"tolerance_mm": tolerance});
    let mut ok = true;
    if let Some(bbox) = expected.get("bbox") {
        let wanted: Vec<f64> = bbox
            .as_array()
            .ok_or("expected.bbox must be [x, y, z] extents")?
            .iter()
            .map(|v| v.as_f64().ok_or("expected.bbox entries must be numbers"))
            .collect::<Result<_, _>>()?;
        if wanted.len() != 3 {
            return Err("expected.bbox must have three extents".into());
        }
        let mut min = [f64::INFINITY; 3];
        let mut max = [f64::NEG_INFINITY; 3];
        for body in &summary.bodies {
            for i in 0..3 {
                min[i] = min[i].min(body.min[i]);
                max[i] = max[i].max(body.max[i]);
            }
        }
        let built: Vec<f64> = if summary.bodies.is_empty() {
            vec![0.0; 3]
        } else {
            (0..3).map(|i| max[i] - min[i]).collect()
        };
        let bbox_ok = (0..3).all(|i| (built[i] - wanted[i]).abs() <= tolerance);
        ok &= bbox_ok;
        result["bbox"] = json!({"expected": wanted, "built": built.iter().map(|v| round3(*v)).collect::<Vec<_>>(), "ok": bbox_ok});
    }
    if let Some(holes) = expected.get("holes") {
        let expected_holes = holes.as_array().ok_or("expected.holes must be an array")?;
        let mut used = vec![false; summary.holes.len()];
        let mut matched = Vec::new();
        let mut missing = Vec::new();
        for (index, wanted) in expected_holes.iter().enumerate() {
            let x = wanted["x"].as_f64().ok_or("expected hole needs x")?;
            let y = wanted["y"].as_f64().ok_or("expected hole needs y")?;
            let z = wanted.get("z").and_then(Value::as_f64);
            let distance_to = |hole: &Hole| {
                let dz = z.map_or(0.0, |z| hole.position[2] - z);
                ((hole.position[0] - x).powi(2) + (hole.position[1] - y).powi(2) + dz * dz).sqrt()
            };
            let mut best: Option<(usize, f64)> = None;
            for (i, hole) in summary.holes.iter().enumerate() {
                if used[i] {
                    continue;
                }
                let distance = distance_to(hole);
                if distance <= tolerance && best.is_none_or(|(_, d)| distance < d) {
                    best = Some((i, distance));
                }
            }
            match best {
                Some((i, distance)) => {
                    used[i] = true;
                    let hole = &summary.holes[i];
                    let diameter_ok = wanted
                        .get("diameter")
                        .and_then(Value::as_f64)
                        .is_none_or(|d| (d - hole.diameter).abs() <= 0.05);
                    let counterbore_ok = wanted
                        .get("counterbore_diameter")
                        .and_then(Value::as_f64)
                        .is_none_or(|d| {
                            hole.counterbore_diameter
                                .is_some_and(|built| (built - d).abs() <= 0.05)
                        });
                    let through_ok = wanted
                        .get("through")
                        .and_then(Value::as_bool)
                        .is_none_or(|through| through == hole.through);
                    let depth_ok =
                        wanted
                            .get("depth")
                            .and_then(Value::as_f64)
                            .is_none_or(|depth| {
                                hole.depth
                                    .is_some_and(|built| (built - depth).abs() <= 0.05)
                            });
                    let all_ok = diameter_ok && counterbore_ok && through_ok && depth_ok;
                    ok &= all_ok;
                    matched.push(json!({
                        "expected_index": index,
                        "built": hole.json(),
                        "offset_mm": round3(distance),
                        "diameter_ok": diameter_ok,
                        "counterbore_ok": counterbore_ok,
                        "through_ok": through_ok,
                        "depth_ok": depth_ok,
                        "ok": all_ok,
                    }));
                }
                None => {
                    ok = false;
                    let nearest = summary
                        .holes
                        .iter()
                        .map(|hole| (distance_to(hole), hole))
                        .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
                    missing.push(json!({
                        "expected_index": index,
                        "expected": wanted,
                        "nearest_built": nearest.map(|(distance, hole)| json!({"offset_mm": round3(distance), "hole": hole.json()})),
                    }));
                }
            }
        }
        let extra: Vec<Value> = summary
            .holes
            .iter()
            .enumerate()
            .filter(|(i, _)| !used[*i])
            .map(|(_, hole)| hole.json())
            .collect();
        ok &= extra.is_empty();
        result["holes"] = json!({
            "expected": expected_holes.len(),
            "built": summary.holes.len(),
            "matched": matched,
            "missing": missing,
            "extra": extra,
        });
    }
    result["ok"] = json!(ok);
    Ok(result)
}
