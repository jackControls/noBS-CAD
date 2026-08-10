//! Host-neutral assembly intent.
//!
//! Joints reference stable solid topology and store connector frames in model
//! space. This crate deliberately owns no display transforms and no OCCT
//! objects: a future kinematics solver can consume the same persisted intent
//! in native, browser, CAM, and headless hosts.

use std::collections::HashSet;

use nbcad_core::{BodyId, FaceId};
use nbcad_solid::{FaceDto, SolidSceneDto};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct JointId(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JointKindDto {
    Rigid,
    Revolute,
    Slider,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct JointFrameDto {
    pub origin: [f64; 3],
    /// Axis of rotation for a revolute joint or translation for a slider.
    pub primary_axis: [f64; 3],
    /// Defines zero-angle orientation around `primary_axis`.
    pub secondary_axis: [f64; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JointConnectorDto {
    pub body_id: BodyId,
    pub face_id: FaceId,
    /// Stable topology key captured with the numeric id. A changed key is a
    /// broken reference, never permission to retarget an ordinal face.
    pub face_key: String,
    pub frame: JointFrameDto,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct JointLimitsDto {
    pub min: f64,
    pub max: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JointDefinitionDto {
    pub id: JointId,
    pub name: String,
    pub kind: JointKindDto,
    pub connector_a: JointConnectorDto,
    pub connector_b: JointConnectorDto,
    #[serde(default)]
    pub flipped: bool,
    #[serde(default)]
    pub angle_offset_deg: f64,
    #[serde(default)]
    pub linear_offset_mm: f64,
    #[serde(default)]
    pub limits: Option<JointLimitsDto>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateJointRequestDto {
    pub name: String,
    pub kind: JointKindDto,
    pub connector_a: JointConnectorDto,
    pub connector_b: JointConnectorDto,
    #[serde(default)]
    pub flipped: bool,
    #[serde(default)]
    pub angle_offset_deg: f64,
    #[serde(default)]
    pub linear_offset_mm: f64,
    #[serde(default)]
    pub limits: Option<JointLimitsDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssemblyDocumentDto {
    #[serde(default)]
    pub joints: Vec<JointDefinitionDto>,
    #[serde(default = "default_next_joint_id")]
    pub next_joint_id: u64,
}

impl Default for AssemblyDocumentDto {
    fn default() -> Self {
        Self {
            joints: Vec::new(),
            next_joint_id: default_next_joint_id(),
        }
    }
}

impl AssemblyDocumentDto {
    pub fn validate(&self) -> Result<(), String> {
        let mut ids = HashSet::new();
        let mut names = HashSet::new();
        let mut max_id = 0;
        for joint in &self.joints {
            validate_joint(joint)?;
            if !ids.insert(joint.id) {
                return Err(format!("duplicate joint id {}", joint.id.0));
            }
            if !names.insert(joint.name.trim()) {
                return Err(format!("duplicate joint name '{}'", joint.name.trim()));
            }
            max_id = max_id.max(joint.id.0);
        }
        if self.next_joint_id == 0 || self.next_joint_id <= max_id {
            return Err(format!(
                "next joint id {} must be greater than every saved joint id",
                self.next_joint_id
            ));
        }
        Ok(())
    }

    pub fn create(
        &mut self,
        request: CreateJointRequestDto,
        scene: &SolidSceneDto,
    ) -> Result<JointDefinitionDto, String> {
        if self.next_joint_id == u64::MAX {
            return Err("joint id space is exhausted".to_string());
        }
        if self
            .joints
            .iter()
            .any(|joint| joint.name.trim() == request.name.trim())
        {
            return Err(format!("duplicate joint name '{}'", request.name.trim()));
        }
        let connector_a = canonical_connector_against_scene(&request.connector_a, scene)?;
        let connector_b = canonical_connector_against_scene(&request.connector_b, scene)?;
        let joint = JointDefinitionDto {
            id: JointId(self.next_joint_id.max(1)),
            name: request.name,
            kind: request.kind,
            connector_a,
            connector_b,
            flipped: request.flipped,
            angle_offset_deg: request.angle_offset_deg,
            linear_offset_mm: request.linear_offset_mm,
            limits: request.limits,
            enabled: true,
        };
        validate_joint(&joint)?;
        self.next_joint_id = joint.id.0 + 1;
        self.joints.push(joint.clone());
        Ok(joint)
    }

    pub fn delete(&mut self, id: JointId) -> Result<(), String> {
        let original_len = self.joints.len();
        self.joints.retain(|joint| joint.id != id);
        if self.joints.len() == original_len {
            return Err(format!("joint {} does not exist", id.0));
        }
        Ok(())
    }
}

pub fn connector_from_planar_face(
    body_id: BodyId,
    face: &FaceDto,
) -> Result<JointConnectorDto, String> {
    let plane = face
        .plane
        .ok_or_else(|| format!("face {} is not planar", face.id.0))?;
    let origin = face
        .signature
        .map(|signature| {
            [
                signature.centroid.x,
                signature.centroid.y,
                signature.centroid.z,
            ]
        })
        .unwrap_or(plane.origin);
    let connector = JointConnectorDto {
        body_id,
        face_id: face.id,
        face_key: face.key.clone(),
        frame: JointFrameDto {
            origin,
            primary_axis: plane.normal,
            secondary_axis: plane.u,
        },
    };
    validate_connector(&connector)?;
    Ok(connector)
}

fn validate_joint(joint: &JointDefinitionDto) -> Result<(), String> {
    if joint.id.0 == 0 {
        return Err("joint id must be non-zero".to_string());
    }
    if joint.name.trim().is_empty() {
        return Err(format!("joint {} requires a name", joint.id.0));
    }
    validate_connector(&joint.connector_a)?;
    validate_connector(&joint.connector_b)?;
    if joint.connector_a.body_id == joint.connector_b.body_id {
        return Err(format!(
            "joint '{}' must connect two different bodies",
            joint.name
        ));
    }
    if !joint.angle_offset_deg.is_finite() || !joint.linear_offset_mm.is_finite() {
        return Err(format!("joint '{}' has a non-finite offset", joint.name));
    }
    if joint.kind == JointKindDto::Rigid && joint.limits.is_some() {
        return Err(format!(
            "rigid joint '{}' cannot have motion limits",
            joint.name
        ));
    }
    if let Some(limits) = joint.limits {
        if !limits.min.is_finite() || !limits.max.is_finite() || limits.min > limits.max {
            return Err(format!("joint '{}' has invalid motion limits", joint.name));
        }
    }
    Ok(())
}

fn validate_connector(connector: &JointConnectorDto) -> Result<(), String> {
    if connector.body_id.0 == 0 || connector.face_id.0 == 0 {
        return Err("joint connector requires non-zero body and face ids".to_string());
    }
    if connector.face_key.trim().is_empty() {
        return Err(format!(
            "joint connector face {} requires a stable topology key",
            connector.face_id.0
        ));
    }
    let frame = connector.frame;
    if !frame.origin.into_iter().all(f64::is_finite)
        || !frame.primary_axis.into_iter().all(f64::is_finite)
        || !frame.secondary_axis.into_iter().all(f64::is_finite)
    {
        return Err("joint connector frame must contain finite values".to_string());
    }
    let primary_len = length(frame.primary_axis);
    let secondary_len = length(frame.secondary_axis);
    if primary_len <= 1e-9 || secondary_len <= 1e-9 {
        return Err("joint connector axes must be non-zero".to_string());
    }
    let parallel =
        dot(frame.primary_axis, frame.secondary_axis).abs() / (primary_len * secondary_len);
    if parallel > 1.0 - 1e-6 {
        return Err("joint connector axes must not be parallel".to_string());
    }
    Ok(())
}

fn canonical_connector_against_scene(
    connector: &JointConnectorDto,
    scene: &SolidSceneDto,
) -> Result<JointConnectorDto, String> {
    validate_connector(connector)?;
    let body = scene
        .bodies
        .iter()
        .find(|body| body.id == connector.body_id)
        .ok_or_else(|| format!("body {} no longer exists", connector.body_id.0))?;
    let face = body
        .faces
        .iter()
        .find(|face| face.id == connector.face_id)
        .ok_or_else(|| format!("face {} no longer exists", connector.face_id.0))?;
    if face.key != connector.face_key {
        return Err(format!(
            "face {} topology changed; refusing to retarget joint connector",
            connector.face_id.0
        ));
    }
    connector_from_planar_face(body.id, face)
}

fn length(value: [f64; 3]) -> f64 {
    dot(value, value).sqrt()
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

const fn default_true() -> bool {
    true
}

const fn default_next_joint_id() -> u64 {
    1
}

#[cfg(test)]
mod tests {
    use super::*;
    use nbcad_core::{FeatureId, PlaneBasis};
    use nbcad_solid::{BodyDto, MeshDto};

    fn scene() -> SolidSceneDto {
        SolidSceneDto {
            bodies: [1_u64, 2]
                .into_iter()
                .map(|id| BodyDto {
                    id: BodyId(id),
                    name: format!("Body{id}"),
                    feature_id: FeatureId(id),
                    mesh: MeshDto {
                        positions: Vec::new(),
                        normals: Vec::new(),
                        indices: Vec::new(),
                    },
                    faces: vec![FaceDto {
                        id: FaceId(id * 10),
                        key: format!("face-{id}"),
                        first_index: 0,
                        index_count: 0,
                        plane: Some(PlaneBasis {
                            origin: [id as f64, 0.0, 0.0],
                            u: [1.0, 0.0, 0.0],
                            v: [0.0, 1.0, 0.0],
                            normal: [0.0, 0.0, 1.0],
                        }),
                        signature: None,
                    }],
                    edges: Vec::new(),
                })
                .collect(),
            errors: Vec::new(),
        }
    }

    fn request(scene: &SolidSceneDto) -> CreateJointRequestDto {
        CreateJointRequestDto {
            name: "Revolute1".to_string(),
            kind: JointKindDto::Revolute,
            connector_a: connector_from_planar_face(BodyId(1), &scene.bodies[0].faces[0]).unwrap(),
            connector_b: connector_from_planar_face(BodyId(2), &scene.bodies[1].faces[0]).unwrap(),
            flipped: false,
            angle_offset_deg: 0.0,
            linear_offset_mm: 0.0,
            limits: Some(JointLimitsDto {
                min: -90.0,
                max: 90.0,
            }),
        }
    }

    #[test]
    fn creates_and_round_trips_a_stable_face_joint() {
        let scene = scene();
        let mut document = AssemblyDocumentDto::default();
        let mut untrusted_request = request(&scene);
        untrusted_request.connector_a.frame.origin = [999.0, 999.0, 999.0];
        let created = document.create(untrusted_request, &scene).unwrap();
        assert_eq!(created.id, JointId(1));
        assert_eq!(created.connector_a.frame.origin, [1.0, 0.0, 0.0]);
        assert_eq!(document.next_joint_id, 2);
        let json = serde_json::to_string(&document).unwrap();
        let restored: AssemblyDocumentDto = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, document);
        assert!(restored.validate().is_ok());
    }

    #[test]
    fn rejects_same_body_and_topology_retargeting() {
        let scene = scene();
        let mut same_body = request(&scene);
        same_body.connector_b = same_body.connector_a.clone();
        assert!(AssemblyDocumentDto::default()
            .create(same_body, &scene)
            .unwrap_err()
            .contains("different bodies"));

        let mut changed_key = request(&scene);
        changed_key.connector_b.face_key = "ordinal-face-2".to_string();
        assert!(AssemblyDocumentDto::default()
            .create(changed_key, &scene)
            .unwrap_err()
            .contains("refusing to retarget"));
    }

    #[test]
    fn validates_counter_and_axes() {
        let scene = scene();
        let mut document = AssemblyDocumentDto::default();
        let created = document.create(request(&scene), &scene).unwrap();
        document.next_joint_id = created.id.0;
        assert!(document.validate().is_err());
        document.next_joint_id = created.id.0 + 1;
        document.joints[0].connector_a.frame.secondary_axis = [0.0, 0.0, -2.0];
        assert!(document
            .validate()
            .unwrap_err()
            .contains("must not be parallel"));
    }
}
