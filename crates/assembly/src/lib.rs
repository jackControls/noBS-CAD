//! Host-neutral assembly intent.
//!
//! Joints reference stable solid topology and store connector frames in model
//! space. This crate owns the host-neutral forward-kinematics solution but no
//! renderer or OCCT objects, so native, browser, CAM, and headless hosts all
//! consume the same persisted intent and solved body poses.

use std::collections::{HashMap, HashSet, VecDeque};

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
    /// The body held fixed while forward kinematics is evaluated. When this is
    /// absent, the lowest live body id is used as a deterministic temporary
    /// ground without mutating the document.
    #[serde(default)]
    pub grounded_body_id: Option<BodyId>,
}

impl Default for AssemblyDocumentDto {
    fn default() -> Self {
        Self {
            joints: Vec::new(),
            next_joint_id: default_next_joint_id(),
            grounded_body_id: None,
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
        if self.grounded_body_id.is_some_and(|body_id| body_id.0 == 0) {
            return Err("grounded body id must be non-zero".to_string());
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
        if self.grounded_body_id.is_none() {
            self.grounded_body_id = Some(joint.connector_a.body_id);
        }
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

    pub fn set_grounded_body(
        &mut self,
        body_id: Option<BodyId>,
        scene: &SolidSceneDto,
    ) -> Result<(), String> {
        if let Some(body_id) = body_id {
            if body_id.0 == 0 || !scene.bodies.iter().any(|body| body.id == body_id) {
                return Err(format!("body {} does not exist", body_id.0));
            }
        }
        self.grounded_body_id = body_id;
        Ok(())
    }

    pub fn set_joint_value(&mut self, id: JointId, value: f64) -> Result<(), String> {
        if !value.is_finite() {
            return Err("joint position must be finite".to_string());
        }
        let joint = self
            .joints
            .iter_mut()
            .find(|joint| joint.id == id)
            .ok_or_else(|| format!("joint {} does not exist", id.0))?;
        if joint.kind == JointKindDto::Rigid {
            return Err(format!("rigid joint '{}' has no motion value", joint.name));
        }
        if let Some(limits) = joint.limits {
            if value < limits.min || value > limits.max {
                return Err(format!(
                    "joint '{}' value {value} is outside [{}, {}]",
                    joint.name, limits.min, limits.max
                ));
            }
        }
        match joint.kind {
            JointKindDto::Rigid => unreachable!(),
            JointKindDto::Revolute => joint.angle_offset_deg = value,
            JointKindDto::Slider => joint.linear_offset_mm = value,
        }
        Ok(())
    }

    /// Deterministic rigid-body forward kinematics. Geometry remains in OCCT
    /// model coordinates; consumers apply these poses for display and picking.
    pub fn solve(&self, scene: &SolidSceneDto) -> AssemblySolutionDto {
        solve_assembly(self, scene)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BodyPoseDto {
    pub body_id: BodyId,
    pub translation: [f64; 3],
    /// Unit quaternion in x, y, z, w order.
    pub rotation: [f64; 4],
}

impl BodyPoseDto {
    pub fn identity(body_id: BodyId) -> Self {
        Self {
            body_id,
            translation: [0.0; 3],
            rotation: [0.0, 0.0, 0.0, 1.0],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssemblyDiagnosticKindDto {
    BrokenReference,
    InvalidGround,
    FreeComponent,
    LimitViolation,
    CycleConflict,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssemblyDiagnosticDto {
    pub kind: AssemblyDiagnosticKindDto,
    pub message: String,
    pub joint_id: Option<JointId>,
    pub body_id: Option<BodyId>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AssemblySolutionDto {
    pub body_poses: Vec<BodyPoseDto>,
    pub diagnostics: Vec<AssemblyDiagnosticDto>,
    /// False only when a broken reference or inconsistent closed loop prevents
    /// the saved joint graph from being satisfied exactly.
    pub solved: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SetJointValueRequestDto {
    pub joint_id: JointId,
    pub value: f64,
}

#[derive(Clone, Copy, Debug)]
struct RigidPose {
    translation: [f64; 3],
    rotation: [f64; 4],
}

impl RigidPose {
    const IDENTITY: Self = Self {
        translation: [0.0; 3],
        rotation: [0.0, 0.0, 0.0, 1.0],
    };

    fn compose(self, rhs: Self) -> Self {
        Self {
            translation: add(self.translation, rotate(self.rotation, rhs.translation)),
            rotation: normalize_quaternion(quaternion_mul(self.rotation, rhs.rotation)),
        }
    }

    fn inverse(self) -> Self {
        let rotation = [
            -self.rotation[0],
            -self.rotation[1],
            -self.rotation[2],
            self.rotation[3],
        ];
        Self {
            translation: rotate(rotation, scale(self.translation, -1.0)),
            rotation,
        }
    }

    fn from_frame(frame: JointFrameDto) -> Self {
        let z = normalize(frame.primary_axis);
        let mut x = sub(frame.secondary_axis, scale(z, dot(frame.secondary_axis, z)));
        x = normalize(x);
        let y = normalize(cross(z, x));
        Self {
            translation: frame.origin,
            rotation: quaternion_from_basis(x, y, z),
        }
    }

    fn rotation(axis: [f64; 3], angle_radians: f64) -> Self {
        let axis = normalize(axis);
        let half = angle_radians * 0.5;
        let sine = half.sin();
        Self {
            translation: [0.0; 3],
            rotation: [axis[0] * sine, axis[1] * sine, axis[2] * sine, half.cos()],
        }
    }

    fn translation(value: [f64; 3]) -> Self {
        Self {
            translation: value,
            ..Self::IDENTITY
        }
    }

    fn approximately_eq(self, rhs: Self) -> bool {
        length(sub(self.translation, rhs.translation)) <= 1.0e-5
            && (1.0 - quaternion_dot(self.rotation, rhs.rotation).abs()) <= 1.0e-8
    }
}

#[derive(Clone, Copy)]
struct SolveEdge {
    joint_id: JointId,
    a: BodyId,
    b: BodyId,
    a_to_b: RigidPose,
}

fn solve_assembly(document: &AssemblyDocumentDto, scene: &SolidSceneDto) -> AssemblySolutionDto {
    let mut body_ids = scene.bodies.iter().map(|body| body.id).collect::<Vec<_>>();
    body_ids.sort_by_key(|body_id| body_id.0);
    let live_ids = body_ids.iter().copied().collect::<HashSet<_>>();
    let mut diagnostics = Vec::new();
    let mut edges = Vec::new();

    for joint in document.joints.iter().filter(|joint| joint.enabled) {
        let connector_a = canonical_connector_against_scene(&joint.connector_a, scene);
        let connector_b = canonical_connector_against_scene(&joint.connector_b, scene);
        let (connector_a, connector_b) = match (connector_a, connector_b) {
            (Ok(a), Ok(b)) => (a, b),
            (Err(error), _) | (_, Err(error)) => {
                diagnostics.push(AssemblyDiagnosticDto {
                    kind: AssemblyDiagnosticKindDto::BrokenReference,
                    message: format!("Joint '{}': {error}", joint.name),
                    joint_id: Some(joint.id),
                    body_id: None,
                });
                continue;
            }
        };
        let mut value = match joint.kind {
            JointKindDto::Rigid => 0.0,
            JointKindDto::Revolute => joint.angle_offset_deg,
            JointKindDto::Slider => joint.linear_offset_mm,
        };
        if let Some(limits) = joint.limits {
            let clamped = value.clamp(limits.min, limits.max);
            if clamped != value {
                diagnostics.push(AssemblyDiagnosticDto {
                    kind: AssemblyDiagnosticKindDto::LimitViolation,
                    message: format!(
                        "Joint '{}' value {value} was clamped to {clamped}",
                        joint.name
                    ),
                    joint_id: Some(joint.id),
                    body_id: None,
                });
                value = clamped;
            }
        }
        let frame_a = RigidPose::from_frame(connector_a.frame);
        let frame_b = RigidPose::from_frame(connector_b.frame);
        let motion = match joint.kind {
            JointKindDto::Rigid => RigidPose::IDENTITY,
            JointKindDto::Revolute => RigidPose::rotation([0.0, 0.0, 1.0], value.to_radians()),
            JointKindDto::Slider => RigidPose::translation([0.0, 0.0, value]),
        };
        // Planar connector normals oppose one another by default. Flipped
        // requests intentionally keep their normals aligned.
        let mate = if joint.flipped {
            RigidPose::IDENTITY
        } else {
            RigidPose::rotation([1.0, 0.0, 0.0], std::f64::consts::PI)
        };
        edges.push(SolveEdge {
            joint_id: joint.id,
            a: connector_a.body_id,
            b: connector_b.body_id,
            a_to_b: frame_a
                .compose(motion)
                .compose(mate)
                .compose(frame_b.inverse()),
        });
    }

    edges.sort_by_key(|edge| edge.joint_id.0);
    let requested_ground = document.grounded_body_id;
    let ground = requested_ground
        .filter(|body_id| live_ids.contains(body_id))
        .or_else(|| body_ids.first().copied());
    if let Some(body_id) = requested_ground.filter(|body_id| !live_ids.contains(body_id)) {
        diagnostics.push(AssemblyDiagnosticDto {
            kind: AssemblyDiagnosticKindDto::InvalidGround,
            message: format!("Grounded body {} no longer exists", body_id.0),
            joint_id: None,
            body_id: Some(body_id),
        });
    }

    let mut poses = HashMap::<BodyId, RigidPose>::new();
    let mut conflict_joints = HashSet::new();
    let mut seeds = Vec::new();
    if let Some(ground) = ground {
        seeds.push((ground, true));
    }
    seeds.extend(
        body_ids
            .iter()
            .copied()
            .filter(|body_id| Some(*body_id) != ground)
            .map(|body_id| (body_id, false)),
    );

    for (seed, grounded_component) in seeds {
        if poses.contains_key(&seed) {
            continue;
        }
        poses.insert(seed, RigidPose::IDENTITY);
        if !grounded_component {
            diagnostics.push(AssemblyDiagnosticDto {
                kind: AssemblyDiagnosticKindDto::FreeComponent,
                message: format!(
                    "Body {} belongs to an ungrounded component; its seed pose remains free",
                    seed.0
                ),
                joint_id: None,
                body_id: Some(seed),
            });
        }
        let mut queue = VecDeque::from([seed]);
        while let Some(current) = queue.pop_front() {
            let current_pose = poses[&current];
            for edge in &edges {
                let (next, relation) = if edge.a == current {
                    (edge.b, edge.a_to_b)
                } else if edge.b == current {
                    (edge.a, edge.a_to_b.inverse())
                } else {
                    continue;
                };
                let candidate = current_pose.compose(relation);
                if let Some(existing) = poses.get(&next) {
                    if !existing.approximately_eq(candidate)
                        && conflict_joints.insert(edge.joint_id)
                    {
                        diagnostics.push(AssemblyDiagnosticDto {
                            kind: AssemblyDiagnosticKindDto::CycleConflict,
                            message: format!(
                                "Joint {} closes an inconsistent kinematic loop",
                                edge.joint_id.0
                            ),
                            joint_id: Some(edge.joint_id),
                            body_id: Some(next),
                        });
                    }
                } else {
                    poses.insert(next, candidate);
                    queue.push_back(next);
                }
            }
        }
    }

    let body_poses = body_ids
        .into_iter()
        .map(|body_id| {
            let pose = poses.get(&body_id).copied().unwrap_or(RigidPose::IDENTITY);
            BodyPoseDto {
                body_id,
                translation: pose.translation,
                rotation: pose.rotation,
            }
        })
        .collect();
    let solved = !diagnostics.iter().any(|diagnostic| {
        matches!(
            diagnostic.kind,
            AssemblyDiagnosticKindDto::BrokenReference | AssemblyDiagnosticKindDto::CycleConflict
        )
    });
    AssemblySolutionDto {
        body_poses,
        diagnostics,
        solved,
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

fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn scale(value: [f64; 3], factor: f64) -> [f64; 3] {
    [value[0] * factor, value[1] * factor, value[2] * factor]
}

fn normalize(value: [f64; 3]) -> [f64; 3] {
    let magnitude = length(value);
    if magnitude <= 1.0e-12 {
        [0.0; 3]
    } else {
        scale(value, magnitude.recip())
    }
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn quaternion_mul(a: [f64; 4], b: [f64; 4]) -> [f64; 4] {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}

fn quaternion_dot(a: [f64; 4], b: [f64; 4]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
}

fn normalize_quaternion(value: [f64; 4]) -> [f64; 4] {
    let magnitude = quaternion_dot(value, value).sqrt();
    if magnitude <= 1.0e-12 {
        [0.0, 0.0, 0.0, 1.0]
    } else {
        [
            value[0] / magnitude,
            value[1] / magnitude,
            value[2] / magnitude,
            value[3] / magnitude,
        ]
    }
}

fn rotate(rotation: [f64; 4], point: [f64; 3]) -> [f64; 3] {
    let q = [point[0], point[1], point[2], 0.0];
    let inverse = [-rotation[0], -rotation[1], -rotation[2], rotation[3]];
    let result = quaternion_mul(quaternion_mul(rotation, q), inverse);
    [result[0], result[1], result[2]]
}

fn quaternion_from_basis(x: [f64; 3], y: [f64; 3], z: [f64; 3]) -> [f64; 4] {
    // Matrix columns are the connector's orthonormal x, y, z axes.
    let m00 = x[0];
    let m01 = y[0];
    let m02 = z[0];
    let m10 = x[1];
    let m11 = y[1];
    let m12 = z[1];
    let m20 = x[2];
    let m21 = y[2];
    let m22 = z[2];
    let trace = m00 + m11 + m22;
    let quaternion = if trace > 0.0 {
        let s = (trace + 1.0).sqrt() * 2.0;
        [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]
    } else if m00 > m11 && m00 > m22 {
        let s = (1.0 + m00 - m11 - m22).sqrt() * 2.0;
        [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
    } else if m11 > m22 {
        let s = (1.0 + m11 - m00 - m22).sqrt() * 2.0;
        [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
    } else {
        let s = (1.0 + m22 - m00 - m11).sqrt() * 2.0;
        [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
    };
    normalize_quaternion(quaternion)
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

    fn solved_pose(solution: &AssemblySolutionDto, body_id: u64) -> RigidPose {
        let pose = solution
            .body_poses
            .iter()
            .find(|pose| pose.body_id == BodyId(body_id))
            .unwrap();
        RigidPose {
            translation: pose.translation,
            rotation: pose.rotation,
        }
    }

    fn assert_vec3(actual: [f64; 3], expected: [f64; 3]) {
        assert!(
            length(sub(actual, expected)) < 1.0e-8,
            "expected {expected:?}, got {actual:?}"
        );
    }

    #[test]
    fn rigid_joint_aligns_live_planar_connector_frames() {
        let scene = scene();
        let mut document = AssemblyDocumentDto::default();
        let mut request = request(&scene);
        request.kind = JointKindDto::Rigid;
        request.limits = None;
        document.create(request, &scene).unwrap();

        let solution = document.solve(&scene);
        assert!(solution.solved, "{:?}", solution.diagnostics);
        assert_eq!(document.grounded_body_id, Some(BodyId(1)));
        let connector_b = RigidPose::from_frame(
            connector_from_planar_face(BodyId(2), &scene.bodies[1].faces[0])
                .unwrap()
                .frame,
        );
        let world_b = solved_pose(&solution, 2).compose(connector_b);
        assert_vec3(world_b.translation, [1.0, 0.0, 0.0]);
        assert_vec3(rotate(world_b.rotation, [0.0, 0.0, 1.0]), [0.0, 0.0, -1.0]);
    }

    #[test]
    fn slider_and_revolute_values_drive_expected_degrees_of_freedom() {
        let scene = scene();
        let mut slider = AssemblyDocumentDto::default();
        let mut slider_request = request(&scene);
        slider_request.kind = JointKindDto::Slider;
        slider_request.linear_offset_mm = 8.0;
        slider_request.limits = Some(JointLimitsDto {
            min: -10.0,
            max: 10.0,
        });
        slider.create(slider_request, &scene).unwrap();
        let connector_b = RigidPose::from_frame(
            connector_from_planar_face(BodyId(2), &scene.bodies[1].faces[0])
                .unwrap()
                .frame,
        );
        let world_b = solved_pose(&slider.solve(&scene), 2).compose(connector_b);
        assert_vec3(world_b.translation, [1.0, 0.0, 8.0]);

        let mut revolute = AssemblyDocumentDto::default();
        let mut revolute_request = request(&scene);
        revolute_request.angle_offset_deg = 90.0;
        revolute.create(revolute_request, &scene).unwrap();
        let world_b = solved_pose(&revolute.solve(&scene), 2).compose(connector_b);
        assert_vec3(rotate(world_b.rotation, [1.0, 0.0, 0.0]), [0.0, 1.0, 0.0]);
    }

    #[test]
    fn joint_values_enforce_limits_and_free_components_are_explicit() {
        let scene = scene();
        let mut document = AssemblyDocumentDto::default();
        document.create(request(&scene), &scene).unwrap();
        assert!(document.set_joint_value(JointId(1), 45.0).is_ok());
        assert!(document.set_joint_value(JointId(1), 100.0).is_err());

        let empty = AssemblyDocumentDto::default().solve(&scene);
        assert!(empty.solved);
        assert!(empty
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.kind == AssemblyDiagnosticKindDto::FreeComponent));
        assert_eq!(empty.body_poses[0], BodyPoseDto::identity(BodyId(1)));
        assert_eq!(empty.body_poses[1], BodyPoseDto::identity(BodyId(2)));
    }

    #[test]
    fn topology_key_changes_are_reported_without_retargeting() {
        let scene = scene();
        let mut document = AssemblyDocumentDto::default();
        document.create(request(&scene), &scene).unwrap();
        document.joints[0].connector_b.face_key = "stale-key".to_string();
        let solution = document.solve(&scene);
        assert!(!solution.solved);
        assert_eq!(
            solution.diagnostics[0].kind,
            AssemblyDiagnosticKindDto::BrokenReference
        );
    }

    #[test]
    fn inconsistent_closed_loops_are_diagnosed_deterministically() {
        let mut scene = scene();
        let mut third = scene.bodies[1].clone();
        third.id = BodyId(3);
        third.name = "Body3".to_string();
        third.feature_id = FeatureId(3);
        third.faces[0].id = FaceId(30);
        third.faces[0].key = "face-3".to_string();
        third.faces[0].plane.as_mut().unwrap().origin = [3.0, 0.0, 0.0];
        scene.bodies.push(third);

        let connector = |body_index: usize| {
            let body = &scene.bodies[body_index];
            connector_from_planar_face(body.id, &body.faces[0]).unwrap()
        };
        let rigid = |name: &str, a: usize, b: usize| CreateJointRequestDto {
            name: name.to_string(),
            kind: JointKindDto::Rigid,
            connector_a: connector(a),
            connector_b: connector(b),
            flipped: false,
            angle_offset_deg: 0.0,
            linear_offset_mm: 0.0,
            limits: None,
        };
        let mut document = AssemblyDocumentDto::default();
        document.create(rigid("AB", 0, 1), &scene).unwrap();
        document.create(rigid("BC", 1, 2), &scene).unwrap();
        document.create(rigid("AC", 0, 2), &scene).unwrap();

        let solution = document.solve(&scene);
        assert!(!solution.solved);
        assert!(solution.diagnostics.iter().any(|diagnostic| {
            diagnostic.kind == AssemblyDiagnosticKindDto::CycleConflict
                && diagnostic.joint_id == Some(JointId(2))
        }));
    }
}
