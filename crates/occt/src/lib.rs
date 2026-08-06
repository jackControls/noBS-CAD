//! Native OCCT adapter.
//!
//! The C++ bridge is enabled by the `native-occt` feature in the Tauri
//! shell. Keeping the feature off lets the host-neutral workspace and WASM
//! target build on machines that do not have the OCCT SDK installed.

use std::collections::HashSet;

use nbcad_core::{BodyId, EdgeId};
use nbcad_solid::SolidSceneDto;
#[cfg(not(feature = "native-occt"))]
use nbcad_solid::{KernelSceneDto, RecomputePlanDto};
use serde::{Deserialize, Serialize};

/// Orthographic hidden-line projection request. `direction` points from the
/// model toward the viewer; `up` is the desired page-up direction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawingProjectionRequest {
    #[serde(default)]
    pub body_ids: Vec<BodyId>,
    pub direction: [f64; 3],
    pub up: [f64; 3],
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default)]
    pub include_tangent_edges: bool,
    #[serde(default = "default_projection_deflection")]
    pub deflection: f64,
}

fn default_projection_deflection() -> f64 {
    0.05
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawingPolylineDto {
    pub points: Vec<[f64; 2]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawingProjectionDto {
    pub visible: Vec<DrawingPolylineDto>,
    pub hidden: Vec<DrawingPolylineDto>,
    #[serde(default)]
    pub anchors: Vec<DrawingProjectionAnchorDto>,
    /// min x, min y, max x, max y in model millimetres.
    pub bounds: [f64; 4],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawingProjectionAnchorEndpoint {
    Start,
    End,
}

/// Exact topological endpoint projected into the same model-millimetre page
/// coordinates as hidden-line output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawingProjectionAnchorDto {
    pub body_id: BodyId,
    pub edge_id: EdgeId,
    pub edge_key: String,
    pub endpoint: DrawingProjectionAnchorEndpoint,
    pub model_point: [f64; 3],
    pub point: [f64; 2],
    pub hidden: bool,
}

/// Project stable topology endpoints with the same orthographic basis used by
/// OCCT HLR. Duplicate edge uses at one model vertex collapse deterministically
/// to the lowest stable edge id.
pub fn drawing_projection_anchors(
    scene: &SolidSceneDto,
    request: &DrawingProjectionRequest,
    projection: &DrawingProjectionDto,
) -> Result<Vec<DrawingProjectionAnchorDto>, OcctError> {
    let direction = normalize(request.direction)?;
    let right = normalize(cross(request.up, direction))?;
    let page_up = normalize(cross(direction, right))?;
    let selected = request.body_ids.iter().copied().collect::<HashSet<_>>();
    let mut anchors = Vec::new();
    for body in &scene.bodies {
        if !selected.is_empty() && !selected.contains(&body.id) {
            continue;
        }
        for edge in &body.edges {
            let Some(first) = edge.points.first() else {
                continue;
            };
            let Some(last) = edge.points.last() else {
                continue;
            };
            for (endpoint, model_point) in [
                (DrawingProjectionAnchorEndpoint::Start, first),
                (DrawingProjectionAnchorEndpoint::End, last),
            ] {
                let model_point = [model_point.x, model_point.y, model_point.z];
                let point = [dot(model_point, right), dot(model_point, page_up)];
                let hidden = !point_touches_polylines(
                    point,
                    &projection.visible,
                    request.deflection.max(1.0e-4) * 2.5,
                );
                anchors.push(DrawingProjectionAnchorDto {
                    body_id: body.id,
                    edge_id: edge.id,
                    edge_key: edge.key.clone(),
                    endpoint,
                    model_point,
                    point,
                    hidden,
                });
            }
        }
    }
    anchors.sort_by_key(|anchor| {
        (
            anchor.body_id,
            anchor.edge_id,
            endpoint_order(anchor.endpoint),
        )
    });
    let mut seen = HashSet::new();
    anchors.retain(|anchor| {
        seen.insert((
            anchor.body_id,
            quantize(anchor.model_point[0]),
            quantize(anchor.model_point[1]),
            quantize(anchor.model_point[2]),
        ))
    });
    Ok(anchors)
}

fn normalize(vector: [f64; 3]) -> Result<[f64; 3], OcctError> {
    if vector.iter().any(|value| !value.is_finite()) {
        return Err(OcctError(
            "drawing projection basis contains non-finite values".to_string(),
        ));
    }
    let length = dot(vector, vector).sqrt();
    if length < 1.0e-9 {
        return Err(OcctError(
            "drawing projection basis is degenerate".to_string(),
        ));
    }
    Ok([vector[0] / length, vector[1] / length, vector[2] / length])
}

fn cross(left: [f64; 3], right: [f64; 3]) -> [f64; 3] {
    [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ]
}

fn dot(left: [f64; 3], right: [f64; 3]) -> f64 {
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

fn point_touches_polylines(
    point: [f64; 2],
    polylines: &[DrawingPolylineDto],
    tolerance: f64,
) -> bool {
    polylines.iter().any(|polyline| {
        polyline
            .points
            .windows(2)
            .any(|segment| point_segment_distance(point, segment[0], segment[1]) <= tolerance)
    })
}

fn point_segment_distance(point: [f64; 2], start: [f64; 2], end: [f64; 2]) -> f64 {
    let delta = [end[0] - start[0], end[1] - start[1]];
    let length_sq = delta[0] * delta[0] + delta[1] * delta[1];
    if length_sq <= 1.0e-18 {
        return ((point[0] - start[0]).powi(2) + (point[1] - start[1]).powi(2)).sqrt();
    }
    let t = (((point[0] - start[0]) * delta[0] + (point[1] - start[1]) * delta[1]) / length_sq)
        .clamp(0.0, 1.0);
    let closest = [start[0] + delta[0] * t, start[1] + delta[1] * t];
    ((point[0] - closest[0]).powi(2) + (point[1] - closest[1]).powi(2)).sqrt()
}

fn quantize(value: f64) -> i64 {
    (value * 1.0e7).round() as i64
}

fn endpoint_order(endpoint: DrawingProjectionAnchorEndpoint) -> u8 {
    match endpoint {
        DrawingProjectionAnchorEndpoint::Start => 0,
        DrawingProjectionAnchorEndpoint::End => 1,
    }
}

#[derive(Debug, Clone)]
pub struct OcctError(pub String);

impl std::fmt::Display for OcctError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for OcctError {}

/// Stateful native kernel. The feature-enabled implementation is supplied
/// by `native.rs`; this placeholder keeps non-native workspace builds clean.
#[cfg(not(feature = "native-occt"))]
#[derive(Debug, Default)]
pub struct OcctKernel;

#[cfg(not(feature = "native-occt"))]
impl OcctKernel {
    pub fn new() -> Result<Self, OcctError> {
        Err(OcctError(
            "native OCCT support was not enabled at compile time".to_string(),
        ))
    }

    pub fn recompute(&mut self, _plan: &RecomputePlanDto) -> Result<KernelSceneDto, OcctError> {
        Err(OcctError(
            "native OCCT support was not enabled at compile time".to_string(),
        ))
    }

    pub fn drawing_projection(
        &self,
        _request: &DrawingProjectionRequest,
    ) -> Result<DrawingProjectionDto, OcctError> {
        Err(OcctError(
            "native OCCT support was not enabled at compile time".to_string(),
        ))
    }
}

#[cfg(feature = "native-occt")]
mod native;
#[cfg(feature = "native-occt")]
pub use native::OcctKernel;

#[cfg(test)]
mod drawing_anchor_tests {
    use super::*;
    use nbcad_core::FeatureId;
    use nbcad_solid::{BodyDto, EdgeDto, MeshDto, Point3Dto};

    #[test]
    fn projects_stable_topology_endpoints_into_hlr_coordinates() {
        let scene = SolidSceneDto {
            bodies: vec![BodyDto {
                id: BodyId(3),
                name: "Body1".to_string(),
                feature_id: FeatureId(1),
                mesh: MeshDto {
                    positions: vec![],
                    normals: vec![],
                    indices: vec![],
                },
                faces: vec![],
                edges: vec![EdgeDto {
                    id: EdgeId(7),
                    key: "edge-7".to_string(),
                    points: vec![
                        Point3Dto {
                            x: -10.0,
                            y: -5.0,
                            z: 2.0,
                        },
                        Point3Dto {
                            x: 10.0,
                            y: -5.0,
                            z: 2.0,
                        },
                    ],
                    refinable: true,
                }],
            }],
            errors: vec![],
        };
        let request = DrawingProjectionRequest {
            body_ids: vec![BodyId(3)],
            direction: [0.0, 0.0, 1.0],
            up: [0.0, 1.0, 0.0],
            include_hidden: false,
            include_tangent_edges: false,
            deflection: 0.05,
        };
        let projection = DrawingProjectionDto {
            visible: vec![DrawingPolylineDto {
                points: vec![[-10.0, -5.0], [10.0, -5.0]],
            }],
            hidden: vec![],
            anchors: vec![],
            bounds: [-10.0, -5.0, 10.0, -5.0],
        };

        let anchors = drawing_projection_anchors(&scene, &request, &projection).unwrap();
        assert_eq!(anchors.len(), 2);
        assert_eq!(anchors[0].edge_id, EdgeId(7));
        assert_eq!(anchors[0].point, [-10.0, -5.0]);
        assert_eq!(anchors[1].point, [10.0, -5.0]);
        assert!(anchors.iter().all(|anchor| !anchor.hidden));
    }
}
