use cxx::UniquePtr;
use nbcad_solid::{
    CombineOperation, ExtrudeOperation, HoleBottomStyle, HoleExtent, HoleStyle, KernelBodyDto,
    KernelCurveDto, KernelEdgeDto, KernelFaceDto, KernelFeatureErrorDto, KernelJobDto,
    KernelProfileDto, KernelSceneDto, KernelTransformDto, LoftContinuity, Point3Dto,
    RecomputePlanDto, StepExportRequest, SweepOrientation, SweepTransition,
};

use crate::OcctError;

#[cxx::bridge(namespace = "nbcad_occt")]
mod ffi {
    struct FfiJob {
        feature_id: u64,
        kind: u8,
        operation: u8,
        points: Vec<f64>,
        profile_offsets: Vec<u32>,
        /// Prefix offsets into profile wires. Each region starts with its outer
        /// wire followed by zero or more inner (hole) wires.
        region_offsets: Vec<u32>,
        curve_kinds: Vec<u8>,
        curve_profile_offsets: Vec<u32>,
        curve_point_offsets: Vec<u32>,
        curve_points: Vec<f64>,
        normal_x: f64,
        normal_y: f64,
        normal_z: f64,
        start_offset: f64,
        end_offset: f64,
        taper_angle_deg: f64,
        axis_origin_x: f64,
        axis_origin_y: f64,
        axis_origin_z: f64,
        axis_direction_x: f64,
        axis_direction_y: f64,
        axis_direction_z: f64,
        angle_rad: f64,
        path_curve_kinds: Vec<u8>,
        path_curve_point_offsets: Vec<u32>,
        path_curve_points: Vec<f64>,
        guide_curve_kinds: Vec<u8>,
        guide_curve_point_offsets: Vec<u32>,
        guide_curve_points: Vec<f64>,
        orientation: u8,
        transition: u8,
        continuity: u8,
        force_c1: bool,
        ruled: bool,
        edge_indices: Vec<u32>,
        face_indices: Vec<u32>,
        transform_kinds: Vec<u8>,
        transform_values: Vec<f64>,
        radius: f64,
        diameter: f64,
        secondary_diameter: f64,
        secondary_depth: f64,
        hole_angle_deg: f64,
        hole_style: u8,
        drill_point_angle_deg: f64,
        hole_bottom_style: u8,
        through_all: bool,
        inward: bool,
        keep_tools: bool,
        step_data: Vec<u8>,
        target_body_ids: Vec<u64>,
        result_body_ids: Vec<u64>,
    }

    struct FfiMesh {
        body_id: u64,
        positions: Vec<f32>,
        normals: Vec<f32>,
        indices: Vec<u32>,
        face_first_indices: Vec<u32>,
        face_index_counts: Vec<u32>,
        /// Per face: valid flag then origin/u/v/normal (13 f64 values).
        face_plane_data: Vec<f64>,
        /// Prefix offsets into `edge_points`, measured in 3D points.
        edge_point_offsets: Vec<u32>,
        /// Flat xyz edge polyline coordinates.
        edge_points: Vec<f64>,
        /// Per-edge topology classification for refinement tools.
        edge_refinable: Vec<u8>,
    }

    unsafe extern "C++" {
        include!("shim.hpp");

        type Kernel;
        fn new_kernel() -> UniquePtr<Kernel>;
        fn reset(self: Pin<&mut Kernel>);
        fn apply_job(self: Pin<&mut Kernel>, job: &FfiJob) -> Result<()>;
        fn body_ids(self: &Kernel) -> Vec<u64>;
        fn mesh(self: &Kernel, body_id: u64) -> Result<FfiMesh>;
        fn export_step(self: &Kernel, body_ids: &Vec<u64>) -> Result<Vec<u8>>;
    }
}

// The C++ Kernel is never accessed concurrently: both the native shell and
// tests serialize all calls through `&mut OcctKernel` (the shell additionally
// holds it inside a Mutex). OCCT objects owned by this instance never escape
// the bridge, so moving the opaque pointer between command threads is safe.
unsafe impl Send for ffi::Kernel {}

pub struct OcctKernel {
    inner: UniquePtr<ffi::Kernel>,
}

impl std::fmt::Debug for OcctKernel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OcctKernel").finish_non_exhaustive()
    }
}

impl OcctKernel {
    pub fn new() -> Result<Self, OcctError> {
        let inner = ffi::new_kernel();
        if inner.is_null() {
            return Err(OcctError("OCCT kernel allocation failed".to_string()));
        }
        Ok(Self { inner })
    }

    pub fn recompute(&mut self, plan: &RecomputePlanDto) -> Result<KernelSceneDto, OcctError> {
        let mut pinned = self.inner.pin_mut();
        pinned.as_mut().reset();
        let mut errors = plan.errors.clone();
        for job in &plan.jobs {
            let ffi_job = match to_ffi_job(job) {
                Ok(job) => job,
                Err(error) => {
                    errors.push(KernelFeatureErrorDto {
                        feature_id: job.feature_id(),
                        message: error.to_string(),
                    });
                    break;
                }
            };
            if let Err(error) = pinned.as_mut().apply_job(&ffi_job) {
                errors.push(KernelFeatureErrorDto {
                    feature_id: job.feature_id(),
                    message: error.to_string(),
                });
                break;
            }
        }

        let body_ids = self
            .inner
            .as_ref()
            .ok_or_else(|| OcctError("OCCT kernel was released".to_string()))?
            .body_ids();
        let mut bodies = Vec::with_capacity(body_ids.len());
        for body_id in body_ids {
            let raw = self
                .inner
                .as_ref()
                .ok_or_else(|| OcctError("OCCT kernel was released".to_string()))?
                .mesh(body_id)
                .map_err(|error| OcctError(error.to_string()))?;
            bodies.push(from_ffi_mesh(raw)?);
        }
        Ok(KernelSceneDto { bodies, errors })
    }

    /// Serialize selected (or all) live B-reps as an AP242 STEP exchange
    /// file. Tessellated meshes are never used for export.
    pub fn export_step(&self, request: &StepExportRequest) -> Result<Vec<u8>, OcctError> {
        let body_ids = request.body_ids.iter().map(|id| id.0).collect::<Vec<_>>();
        self.inner
            .as_ref()
            .ok_or_else(|| OcctError("OCCT kernel was released".to_string()))?
            .export_step(&body_ids)
            .map_err(|error| OcctError(error.to_string()))
    }
}

struct ProfileBuffers {
    points: Vec<f64>,
    profile_offsets: Vec<u32>,
    region_offsets: Vec<u32>,
    curve_kinds: Vec<u8>,
    curve_profile_offsets: Vec<u32>,
    curve_point_offsets: Vec<u32>,
    curve_points: Vec<f64>,
}

fn profile_buffers(profiles: &[KernelProfileDto]) -> ProfileBuffers {
    let mut buffers = ProfileBuffers {
        points: Vec::new(),
        profile_offsets: Vec::with_capacity(profiles.len() + 1),
        region_offsets: Vec::with_capacity(profiles.len() + 1),
        curve_kinds: Vec::new(),
        curve_profile_offsets: Vec::with_capacity(profiles.len() + 1),
        curve_point_offsets: vec![0],
        curve_points: Vec::new(),
    };
    buffers.profile_offsets.push(0);
    buffers.region_offsets.push(0);
    buffers.curve_profile_offsets.push(0);
    fn append_profile(buffers: &mut ProfileBuffers, profile: &KernelProfileDto) {
        for point in &profile.points {
            buffers.points.extend([point.x, point.y, point.z]);
        }
        buffers
            .profile_offsets
            .push((buffers.points.len() / 3) as u32);

        if profile.curves.is_empty() {
            for (start, end) in profile
                .points
                .iter()
                .zip(profile.points.iter().cycle().skip(1))
                .take(profile.points.len())
            {
                push_curve(buffers, 0, &[*start, *end]);
            }
        } else {
            for curve in &profile.curves {
                match curve {
                    KernelCurveDto::Line { start, end, .. } => {
                        push_curve(buffers, 0, &[*start, *end]);
                    }
                    KernelCurveDto::Arc {
                        start, mid, end, ..
                    } => {
                        push_curve(buffers, 1, &[*start, *mid, *end]);
                    }
                    KernelCurveDto::Circle {
                        center,
                        axis_point,
                        normal,
                        ..
                    } => {
                        push_curve(buffers, 2, &[*center, *axis_point, *normal]);
                    }
                    KernelCurveDto::Polyline { points, .. } => {
                        push_curve(buffers, 3, points);
                    }
                }
            }
        }
        buffers
            .curve_profile_offsets
            .push(buffers.curve_kinds.len() as u32);
    }
    for profile in profiles {
        append_profile(&mut buffers, profile);
        for hole in &profile.holes {
            append_profile(&mut buffers, hole);
        }
        buffers
            .region_offsets
            .push((buffers.profile_offsets.len() - 1) as u32);
    }
    buffers
}

fn push_curve(buffers: &mut ProfileBuffers, kind: u8, points: &[Point3Dto]) {
    buffers.curve_kinds.push(kind);
    for point in points {
        buffers.curve_points.extend([point.x, point.y, point.z]);
    }
    buffers
        .curve_point_offsets
        .push((buffers.curve_points.len() / 3) as u32);
}

struct CurveBuffers {
    kinds: Vec<u8>,
    point_offsets: Vec<u32>,
    points: Vec<f64>,
}

fn curve_buffers(curves: &[KernelCurveDto]) -> CurveBuffers {
    let mut buffers = CurveBuffers {
        kinds: Vec::with_capacity(curves.len()),
        point_offsets: vec![0],
        points: Vec::new(),
    };
    for curve in curves {
        let (kind, points): (u8, Vec<Point3Dto>) = match curve {
            KernelCurveDto::Line { start, end, .. } => (0, vec![*start, *end]),
            KernelCurveDto::Arc {
                start, mid, end, ..
            } => (1, vec![*start, *mid, *end]),
            KernelCurveDto::Circle {
                center,
                axis_point,
                normal,
                ..
            } => (2, vec![*center, *axis_point, *normal]),
            KernelCurveDto::Polyline { points, .. } => (3, points.clone()),
        };
        buffers.kinds.push(kind);
        for point in points {
            buffers.points.extend([point.x, point.y, point.z]);
        }
        buffers
            .point_offsets
            .push((buffers.points.len() / 3) as u32);
    }
    buffers
}

fn empty_ffi_job(feature_id: u64, kind: u8) -> ffi::FfiJob {
    ffi::FfiJob {
        feature_id,
        kind,
        operation: 0,
        points: Vec::new(),
        profile_offsets: vec![0],
        region_offsets: vec![0],
        curve_kinds: Vec::new(),
        curve_profile_offsets: vec![0],
        curve_point_offsets: vec![0],
        curve_points: Vec::new(),
        normal_x: 0.0,
        normal_y: 0.0,
        normal_z: 0.0,
        start_offset: 0.0,
        end_offset: 0.0,
        taper_angle_deg: 0.0,
        axis_origin_x: 0.0,
        axis_origin_y: 0.0,
        axis_origin_z: 0.0,
        axis_direction_x: 0.0,
        axis_direction_y: 0.0,
        axis_direction_z: 0.0,
        angle_rad: 0.0,
        path_curve_kinds: Vec::new(),
        path_curve_point_offsets: vec![0],
        path_curve_points: Vec::new(),
        guide_curve_kinds: Vec::new(),
        guide_curve_point_offsets: vec![0],
        guide_curve_points: Vec::new(),
        orientation: 0,
        transition: 0,
        continuity: 1,
        force_c1: false,
        ruled: false,
        edge_indices: Vec::new(),
        face_indices: Vec::new(),
        transform_kinds: Vec::new(),
        transform_values: Vec::new(),
        radius: 0.0,
        diameter: 0.0,
        secondary_diameter: 0.0,
        secondary_depth: 0.0,
        hole_angle_deg: 0.0,
        hole_style: 0,
        drill_point_angle_deg: 0.0,
        hole_bottom_style: 0,
        through_all: false,
        inward: false,
        keep_tools: false,
        step_data: Vec::new(),
        target_body_ids: Vec::new(),
        result_body_ids: Vec::new(),
    }
}

fn set_profiles(job: &mut ffi::FfiJob, buffers: ProfileBuffers) {
    job.points = buffers.points;
    job.profile_offsets = buffers.profile_offsets;
    job.region_offsets = buffers.region_offsets;
    job.curve_kinds = buffers.curve_kinds;
    job.curve_profile_offsets = buffers.curve_profile_offsets;
    job.curve_point_offsets = buffers.curve_point_offsets;
    job.curve_points = buffers.curve_points;
}

fn set_path(job: &mut ffi::FfiJob, curves: &[KernelCurveDto]) {
    let buffers = curve_buffers(curves);
    job.path_curve_kinds = buffers.kinds;
    job.path_curve_point_offsets = buffers.point_offsets;
    job.path_curve_points = buffers.points;
}

fn set_guide(job: &mut ffi::FfiJob, curves: &[KernelCurveDto]) {
    let buffers = curve_buffers(curves);
    job.guide_curve_kinds = buffers.kinds;
    job.guide_curve_point_offsets = buffers.point_offsets;
    job.guide_curve_points = buffers.points;
}

fn to_ffi_job(job: &KernelJobDto) -> Result<ffi::FfiJob, OcctError> {
    Ok(match job {
        KernelJobDto::Extrude(source) => {
            let mut job = empty_ffi_job(source.feature_id.0, 0);
            job.operation = operation_code(source.operation);
            set_profiles(&mut job, profile_buffers(&source.profiles));
            job.normal_x = source.normal.x;
            job.normal_y = source.normal.y;
            job.normal_z = source.normal.z;
            job.start_offset = source.start_offset;
            job.end_offset = source.end_offset;
            job.taper_angle_deg = source.taper_angle_deg;
            job.target_body_ids = source.target_body_ids.iter().map(|id| id.0).collect();
            job.result_body_ids = source.result_body_ids.iter().map(|id| id.0).collect();
            job
        }
        KernelJobDto::Revolve(source) => {
            let mut job = empty_ffi_job(source.feature_id.0, 1);
            job.operation = operation_code(source.operation);
            set_profiles(&mut job, profile_buffers(&source.profiles));
            job.axis_origin_x = source.axis_origin.x;
            job.axis_origin_y = source.axis_origin.y;
            job.axis_origin_z = source.axis_origin.z;
            job.axis_direction_x = source.axis_direction.x;
            job.axis_direction_y = source.axis_direction.y;
            job.axis_direction_z = source.axis_direction.z;
            job.angle_rad = source.angle_rad;
            job.target_body_ids = source.target_body_ids.iter().map(|id| id.0).collect();
            job.result_body_ids = source.result_body_ids.iter().map(|id| id.0).collect();
            job
        }
        KernelJobDto::Sweep(source) => {
            let mut job = empty_ffi_job(source.feature_id.0, 2);
            job.operation = operation_code(source.operation);
            set_profiles(
                &mut job,
                profile_buffers(std::slice::from_ref(&source.profile)),
            );
            set_path(&mut job, &source.path);
            set_guide(&mut job, &source.guide_rail);
            job.orientation = match source.orientation {
                SweepOrientation::CorrectedFrenet => 0,
                SweepOrientation::Frenet => 1,
                SweepOrientation::Fixed => 2,
            };
            job.transition = match source.transition {
                SweepTransition::Transformed => 0,
                SweepTransition::RightCorner => 1,
                SweepTransition::RoundCorner => 2,
            };
            job.force_c1 = source.force_c1;
            job.target_body_ids = source.target_body_ids.iter().map(|id| id.0).collect();
            job.result_body_ids = source.result_body_ids.iter().map(|id| id.0).collect();
            job
        }
        KernelJobDto::Loft(source) => {
            let mut job = empty_ffi_job(source.feature_id.0, 3);
            job.operation = operation_code(source.operation);
            set_profiles(&mut job, profile_buffers(&source.sections));
            set_path(&mut job, &source.centerline);
            set_guide(&mut job, &source.guide_rail);
            job.ruled = source.ruled;
            job.continuity = match source.continuity {
                LoftContinuity::G0 => 0,
                LoftContinuity::G1 => 1,
                LoftContinuity::G2 => 2,
            };
            job.target_body_ids = source.target_body_ids.iter().map(|id| id.0).collect();
            job.result_body_ids = source.result_body_ids.iter().map(|id| id.0).collect();
            job
        }
        KernelJobDto::Rib(source) => {
            let mut job = empty_ffi_job(source.feature_id.0, 4);
            job.operation = operation_code(source.operation);
            set_profiles(&mut job, profile_buffers(&source.profiles));
            job.normal_x = source.normal.x;
            job.normal_y = source.normal.y;
            job.normal_z = source.normal.z;
            job.start_offset = source.start_offset;
            job.end_offset = source.end_offset;
            job.target_body_ids = source.target_body_ids.iter().map(|id| id.0).collect();
            job.result_body_ids = source.result_body_ids.iter().map(|id| id.0).collect();
            job
        }
        KernelJobDto::Fillet(source) => refinement_ffi_job(
            source.feature_id.0,
            5,
            source.target_body_id.0,
            edge_indices(&source.edge_keys),
            source.radius,
        ),
        KernelJobDto::Chamfer(source) => refinement_ffi_job(
            source.feature_id.0,
            6,
            source.target_body_id.0,
            edge_indices(&source.edge_keys),
            source.distance,
        ),
        KernelJobDto::Hole(source) => {
            let mut job = empty_ffi_job(source.feature_id.0, 7);
            job.operation = 2;
            job.end_offset = match source.extent {
                HoleExtent::Distance { depth } => depth,
                HoleExtent::ThroughAll => 1_000_000.0,
            };
            job.axis_origin_x = source.center.x;
            job.axis_origin_y = source.center.y;
            job.axis_origin_z = source.center.z;
            job.axis_direction_x = source.direction.x;
            job.axis_direction_y = source.direction.y;
            job.axis_direction_z = source.direction.z;
            job.diameter = source.diameter;
            match source.style {
                HoleStyle::Simple => {}
                HoleStyle::Counterbore => {
                    job.hole_style = 1;
                    job.secondary_diameter = source.counterbore_diameter;
                    job.secondary_depth = source.counterbore_depth;
                }
                HoleStyle::Countersink => {
                    job.hole_style = 2;
                    job.secondary_diameter = source.countersink_diameter;
                    job.hole_angle_deg = source.countersink_angle_deg;
                }
            }
            job.hole_bottom_style = match source.bottom_style {
                HoleBottomStyle::Flat => 0,
                HoleBottomStyle::DrillPoint => 1,
            };
            job.drill_point_angle_deg = source.drill_point_angle_deg;
            job.through_all = matches!(source.extent, HoleExtent::ThroughAll);
            job.target_body_ids = vec![source.target_body_id.0];
            job.result_body_ids = vec![source.target_body_id.0];
            job
        }
        KernelJobDto::Shell(source) => {
            let mut job = empty_ffi_job(source.feature_id.0, 8);
            job.target_body_ids = vec![source.target_body_id.0];
            job.result_body_ids = vec![source.target_body_id.0];
            job.face_indices = face_indices(&source.face_keys);
            job.radius = source.thickness;
            job.inward = source.inward;
            job
        }
        KernelJobDto::Transform(source) => {
            let mut job = empty_ffi_job(source.feature_id.0, 9);
            job.target_body_ids = source.source_body_ids.iter().map(|id| id.0).collect();
            job.result_body_ids = source.result_body_ids.iter().map(|id| id.0).collect();
            for transform in &source.transforms {
                match transform {
                    KernelTransformDto::Mirror { origin, normal } => {
                        job.transform_kinds.push(0);
                        job.transform_values.extend([
                            origin.x, origin.y, origin.z, normal.x, normal.y, normal.z, 0.0,
                        ]);
                    }
                    KernelTransformDto::Translate { vector } => {
                        job.transform_kinds.push(1);
                        job.transform_values
                            .extend([vector.x, vector.y, vector.z, 0.0, 0.0, 0.0, 0.0]);
                    }
                    KernelTransformDto::Rotate {
                        origin,
                        axis,
                        angle_rad,
                    } => {
                        job.transform_kinds.push(2);
                        job.transform_values.extend([
                            origin.x, origin.y, origin.z, axis.x, axis.y, axis.z, *angle_rad,
                        ]);
                    }
                }
            }
            job
        }
        KernelJobDto::Combine(source) => {
            let mut job = empty_ffi_job(source.feature_id.0, 10);
            job.operation = combine_operation_code(source.operation);
            job.target_body_ids = std::iter::once(source.target_body_id.0)
                .chain(source.tool_body_ids.iter().map(|id| id.0))
                .collect();
            job.result_body_ids = vec![source.target_body_id.0];
            job.keep_tools = source.keep_tools;
            job
        }
        KernelJobDto::SplitBody(source) => {
            let mut job = empty_ffi_job(source.feature_id.0, 11);
            job.target_body_ids = vec![source.target_body_id.0];
            job.result_body_ids = vec![source.target_body_id.0, source.new_body_id.0];
            job.axis_origin_x = source.plane_origin.x;
            job.axis_origin_y = source.plane_origin.y;
            job.axis_origin_z = source.plane_origin.z;
            job.axis_direction_x = source.plane_normal.x;
            job.axis_direction_y = source.plane_normal.y;
            job.axis_direction_z = source.plane_normal.z;
            job
        }
        KernelJobDto::ImportStep(source) => {
            let mut job = empty_ffi_job(source.feature_id.0, 12);
            job.step_data = decode_base64(&source.data_base64)?;
            job.result_body_ids = vec![source.result_body_id.0];
            job
        }
    })
}

fn decode_base64(value: &str) -> Result<Vec<u8>, OcctError> {
    fn digit(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return Err(OcctError(
            "STEP import contains invalid base64 data".to_string(),
        ));
    }
    let mut output = Vec::with_capacity(bytes.len() / 4 * 3);
    for (chunk_index, chunk) in bytes.chunks_exact(4).enumerate() {
        let last = chunk_index + 1 == bytes.len() / 4;
        let padding = usize::from(chunk[3] == b'=') + usize::from(chunk[2] == b'=');
        if padding > 0 && !last || chunk[2] == b'=' && chunk[3] != b'=' {
            return Err(OcctError(
                "STEP import contains invalid base64 padding".to_string(),
            ));
        }
        let a = digit(chunk[0]);
        let b = digit(chunk[1]);
        let c = if chunk[2] == b'=' {
            Some(0)
        } else {
            digit(chunk[2])
        };
        let d = if chunk[3] == b'=' {
            Some(0)
        } else {
            digit(chunk[3])
        };
        let [Some(a), Some(b), Some(c), Some(d)] = [a, b, c, d] else {
            return Err(OcctError(
                "STEP import contains invalid base64 data".to_string(),
            ));
        };
        let bits = (u32::from(a) << 18) | (u32::from(b) << 12) | (u32::from(c) << 6) | u32::from(d);
        output.push((bits >> 16) as u8);
        if padding < 2 {
            output.push((bits >> 8) as u8);
        }
        if padding == 0 {
            output.push(bits as u8);
        }
    }
    Ok(output)
}

fn edge_indices(keys: &[String]) -> Vec<u32> {
    keys.iter()
        .filter_map(|key| key.strip_prefix("edge:")?.parse::<u32>().ok())
        .collect()
}

fn face_indices(keys: &[String]) -> Vec<u32> {
    keys.iter()
        .filter_map(|key| key.strip_prefix("face:")?.parse::<u32>().ok())
        .collect()
}

fn refinement_ffi_job(
    feature_id: u64,
    kind: u8,
    body_id: u64,
    edge_indices: Vec<u32>,
    radius: f64,
) -> ffi::FfiJob {
    let mut job = empty_ffi_job(feature_id, kind);
    job.edge_indices = edge_indices;
    job.radius = radius;
    job.target_body_ids = vec![body_id];
    job.result_body_ids = vec![body_id];
    job
}

fn operation_code(operation: ExtrudeOperation) -> u8 {
    match operation {
        ExtrudeOperation::NewBody => 0,
        ExtrudeOperation::Join => 1,
        ExtrudeOperation::Cut => 2,
        ExtrudeOperation::Intersect => 3,
    }
}

fn combine_operation_code(operation: CombineOperation) -> u8 {
    match operation {
        CombineOperation::Join => 1,
        CombineOperation::Cut => 2,
        CombineOperation::Intersect => 3,
    }
}

fn from_ffi_mesh(raw: ffi::FfiMesh) -> Result<KernelBodyDto, OcctError> {
    if raw.face_first_indices.len() != raw.face_index_counts.len()
        || raw.face_plane_data.len() != raw.face_first_indices.len() * 13
    {
        return Err(OcctError(
            "OCCT bridge returned malformed face metadata".to_string(),
        ));
    }
    let faces = raw
        .face_first_indices
        .iter()
        .zip(&raw.face_index_counts)
        .enumerate()
        .map(|(index, (first_index, index_count))| {
            let data = &raw.face_plane_data[index * 13..(index + 1) * 13];
            let point = |offset: usize| [data[offset], data[offset + 1], data[offset + 2]];
            KernelFaceDto {
                key: format!("face:{index}"),
                first_index: *first_index,
                index_count: *index_count,
                plane: (data[0] != 0.0).then(|| nbcad_core::PlaneBasis {
                    origin: point(1),
                    u: point(4),
                    v: point(7),
                    normal: point(10),
                }),
            }
        })
        .collect();

    if raw.edge_point_offsets.is_empty()
        || raw.edge_point_offsets[0] != 0
        || raw
            .edge_point_offsets
            .last()
            .is_none_or(|offset| *offset as usize * 3 != raw.edge_points.len())
        || raw.edge_refinable.len() + 1 != raw.edge_point_offsets.len()
    {
        return Err(OcctError(
            "OCCT bridge returned malformed edge metadata".to_string(),
        ));
    }
    let edges = raw
        .edge_point_offsets
        .windows(2)
        .enumerate()
        .map(|(index, offsets)| {
            let points = (offsets[0] as usize..offsets[1] as usize)
                .map(|point_index| {
                    let offset = point_index * 3;
                    Point3Dto {
                        x: raw.edge_points[offset],
                        y: raw.edge_points[offset + 1],
                        z: raw.edge_points[offset + 2],
                    }
                })
                .collect();
            KernelEdgeDto {
                key: format!("edge:{index}"),
                points,
                refinable: raw.edge_refinable[index] != 0,
            }
        })
        .collect();

    Ok(KernelBodyDto {
        body_id: nbcad_core::BodyId(raw.body_id),
        positions: raw.positions,
        normals: raw.normals,
        indices: raw.indices,
        faces,
        edges,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use nbcad_core::{BodyId, FeatureId};
    use nbcad_solid::{
        HoleBottomStyle, HoleExtent, HoleStyle, KernelChamferJobDto, KernelCombineJobDto,
        KernelCurveDto, KernelExtrudeJobDto, KernelFilletJobDto, KernelHoleJobDto,
        KernelImportStepJobDto, KernelJobDto, KernelLoftJobDto, KernelProfileDto,
        KernelRevolveJobDto, KernelRibJobDto, KernelSweepJobDto, LoftContinuity, Point3Dto,
        RecomputePlanDto, SweepOrientation, SweepTransition,
    };

    fn square(z: f64, half: f64) -> KernelProfileDto {
        KernelProfileDto {
            profile_index: 0,
            points: vec![
                Point3Dto {
                    x: -half,
                    y: -half,
                    z,
                },
                Point3Dto {
                    x: half,
                    y: -half,
                    z,
                },
                Point3Dto {
                    x: half,
                    y: half,
                    z,
                },
                Point3Dto {
                    x: -half,
                    y: half,
                    z,
                },
            ],
            curves: Vec::new(),
            holes: Vec::new(),
        }
    }

    fn rectangle_profile(
        profile_index: u32,
        min_x: f64,
        max_x: f64,
        min_y: f64,
        max_y: f64,
    ) -> KernelProfileDto {
        KernelProfileDto {
            profile_index,
            points: vec![
                Point3Dto {
                    x: min_x,
                    y: min_y,
                    z: 0.0,
                },
                Point3Dto {
                    x: max_x,
                    y: min_y,
                    z: 0.0,
                },
                Point3Dto {
                    x: max_x,
                    y: max_y,
                    z: 0.0,
                },
                Point3Dto {
                    x: min_x,
                    y: max_y,
                    z: 0.0,
                },
            ],
            curves: Vec::new(),
            holes: Vec::new(),
        }
    }

    fn box_job(feature_id: u64, body_id: u64) -> KernelJobDto {
        KernelJobDto::Extrude(KernelExtrudeJobDto {
            feature_id: FeatureId(feature_id),
            operation: ExtrudeOperation::NewBody,
            profiles: vec![square(0.0, 10.0)],
            normal: Point3Dto {
                x: 0.0,
                y: 0.0,
                z: 1.0,
            },
            start_offset: 0.0,
            end_offset: 10.0,
            taper_angle_deg: 0.0,
            target_body_ids: Vec::new(),
            result_body_ids: vec![BodyId(body_id)],
        })
    }

    fn encode_base64(bytes: &[u8]) -> String {
        const ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let a = u32::from(chunk[0]);
            let b = u32::from(*chunk.get(1).unwrap_or(&0));
            let c = u32::from(*chunk.get(2).unwrap_or(&0));
            let bits = (a << 16) | (b << 8) | c;
            encoded.push(ALPHABET[((bits >> 18) & 63) as usize] as char);
            encoded.push(ALPHABET[((bits >> 12) & 63) as usize] as char);
            encoded.push(if chunk.len() > 1 {
                ALPHABET[((bits >> 6) & 63) as usize] as char
            } else {
                '='
            });
            encoded.push(if chunk.len() > 2 {
                ALPHABET[(bits & 63) as usize] as char
            } else {
                '='
            });
        }
        encoded
    }

    #[test]
    fn occt_extrudes_and_meshes_a_rectangle() {
        let mut kernel = OcctKernel::new().unwrap();
        let plan = RecomputePlanDto {
            transaction_id: 1,
            errors: Vec::new(),
            jobs: vec![KernelJobDto::Extrude(KernelExtrudeJobDto {
                feature_id: FeatureId(2),
                operation: ExtrudeOperation::NewBody,
                profiles: vec![KernelProfileDto {
                    profile_index: 0,
                    points: vec![
                        Point3Dto {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                        },
                        Point3Dto {
                            x: 40.0,
                            y: 0.0,
                            z: 0.0,
                        },
                        Point3Dto {
                            x: 40.0,
                            y: 30.0,
                            z: 0.0,
                        },
                        Point3Dto {
                            x: 0.0,
                            y: 30.0,
                            z: 0.0,
                        },
                    ],
                    curves: Vec::new(),
                    holes: Vec::new(),
                }],
                normal: Point3Dto {
                    x: 0.0,
                    y: 0.0,
                    z: 1.0,
                },
                start_offset: 0.0,
                end_offset: 20.0,
                taper_angle_deg: 0.0,
                target_body_ids: vec![],
                result_body_ids: vec![BodyId(1)],
            })],
        };
        let scene = kernel.recompute(&plan).unwrap();
        assert!(scene.errors.is_empty());
        assert_eq!(scene.bodies.len(), 1);
        assert_eq!(scene.bodies[0].faces.len(), 6);
        assert_eq!(scene.bodies[0].edges.len(), 12);
        assert_eq!(scene.bodies[0].indices.len(), 36);
        assert!(scene.bodies[0]
            .faces
            .iter()
            .all(|face| face.plane.is_some()));

        let step = kernel.export_step(&StepExportRequest::default()).unwrap();
        let text = String::from_utf8(step).unwrap();
        assert!(text.starts_with("ISO-10303-21;"));
        assert!(
            text.to_ascii_uppercase().contains("AP242"),
            "{}",
            &text[..text.len().min(2_000)]
        );
        assert!(text.contains("MANIFOLD_SOLID_BREP"));
        assert!(text.ends_with("END-ISO-10303-21;\n"));
    }

    #[test]
    fn occt_imports_an_exported_step_as_a_recomputable_body() {
        let mut source_kernel = OcctKernel::new().unwrap();
        let source_scene = source_kernel
            .recompute(&RecomputePlanDto {
                transaction_id: 1,
                errors: Vec::new(),
                jobs: vec![box_job(1, 1)],
            })
            .unwrap();
        assert!(source_scene.errors.is_empty());
        let step = source_kernel
            .export_step(&StepExportRequest::default())
            .unwrap();

        let mut imported_kernel = OcctKernel::new().unwrap();
        let imported_scene = imported_kernel
            .recompute(&RecomputePlanDto {
                transaction_id: 2,
                errors: Vec::new(),
                jobs: vec![KernelJobDto::ImportStep(KernelImportStepJobDto {
                    feature_id: FeatureId(2),
                    result_body_id: BodyId(7),
                    data_base64: encode_base64(&step),
                })],
            })
            .unwrap();

        assert!(imported_scene.errors.is_empty());
        assert_eq!(imported_scene.bodies.len(), 1);
        assert_eq!(imported_scene.bodies[0].body_id, BodyId(7));
        assert!(!imported_scene.bodies[0].positions.is_empty());
        let reexported = imported_kernel
            .export_step(&StepExportRequest::default())
            .unwrap();
        assert!(reexported.starts_with(b"ISO-10303-21;"));
    }

    #[test]
    fn occt_joins_adjacent_extrude_profiles_without_an_existing_target() {
        let mut kernel = OcctKernel::new().unwrap();
        let scene = kernel
            .recompute(&RecomputePlanDto {
                transaction_id: 1,
                errors: Vec::new(),
                jobs: vec![KernelJobDto::Extrude(KernelExtrudeJobDto {
                    feature_id: FeatureId(2),
                    operation: ExtrudeOperation::Join,
                    profiles: vec![
                        rectangle_profile(0, -10.0, 0.0, -5.0, 5.0),
                        rectangle_profile(1, 0.0, 10.0, -5.0, 5.0),
                    ],
                    normal: Point3Dto {
                        x: 0.0,
                        y: 0.0,
                        z: 1.0,
                    },
                    start_offset: 0.0,
                    end_offset: 10.0,
                    taper_angle_deg: 0.0,
                    target_body_ids: Vec::new(),
                    result_body_ids: vec![BodyId(1)],
                })],
            })
            .unwrap();
        assert!(scene.errors.is_empty(), "{:?}", scene.errors);
        assert_eq!(scene.bodies.len(), 1);
        assert_eq!(
            scene.bodies[0].faces.len(),
            6,
            "same-domain cap and wall faces should be unified"
        );
        assert_eq!(
            scene.bodies[0].edges.len(),
            12,
            "the shared profile boundary must not survive as a seam"
        );
        assert!(scene.bodies[0].edges.iter().all(|edge| edge.refinable));
    }

    #[test]
    fn occt_combine_join_unifies_coplanar_faces_and_removes_the_seam() {
        let new_body = |feature_id, body_id, profile| {
            KernelJobDto::Extrude(KernelExtrudeJobDto {
                feature_id: FeatureId(feature_id),
                operation: ExtrudeOperation::NewBody,
                profiles: vec![profile],
                normal: Point3Dto {
                    x: 0.0,
                    y: 0.0,
                    z: 1.0,
                },
                start_offset: 0.0,
                end_offset: 10.0,
                taper_angle_deg: 0.0,
                target_body_ids: Vec::new(),
                result_body_ids: vec![BodyId(body_id)],
            })
        };
        let mut kernel = OcctKernel::new().unwrap();
        let scene = kernel
            .recompute(&RecomputePlanDto {
                transaction_id: 1,
                errors: Vec::new(),
                jobs: vec![
                    new_body(1, 1, rectangle_profile(0, -10.0, 0.0, -5.0, 5.0)),
                    new_body(2, 2, rectangle_profile(0, 0.0, 10.0, -5.0, 5.0)),
                    KernelJobDto::Combine(KernelCombineJobDto {
                        feature_id: FeatureId(3),
                        target_body_id: BodyId(1),
                        tool_body_ids: vec![BodyId(2)],
                        operation: CombineOperation::Join,
                        keep_tools: false,
                    }),
                ],
            })
            .unwrap();
        assert!(scene.errors.is_empty(), "{:?}", scene.errors);
        assert_eq!(scene.bodies.len(), 1);
        assert_eq!(scene.bodies[0].body_id, BodyId(1));
        assert_eq!(scene.bodies[0].faces.len(), 6);
        assert_eq!(scene.bodies[0].edges.len(), 12);
        assert!(scene.bodies[0].edges.iter().all(|edge| edge.refinable));
    }

    #[test]
    fn occt_extrudes_one_analytic_arc_into_one_curved_face() {
        let p = |x, y| Point3Dto { x, y, z: 0.0 };
        let profile = KernelProfileDto {
            profile_index: 0,
            // Discovery/preview tessellation deliberately contains several
            // samples; the analytic curve list must determine B-rep topology.
            points: vec![
                p(-10.0, 0.0),
                p(10.0, 0.0),
                p(7.071, 7.071),
                p(0.0, 10.0),
                p(-7.071, 7.071),
            ],
            curves: vec![
                KernelCurveDto::Line {
                    entity_id: 1,
                    start: p(-10.0, 0.0),
                    end: p(10.0, 0.0),
                },
                KernelCurveDto::Arc {
                    entity_id: 2,
                    start: p(10.0, 0.0),
                    mid: p(0.0, 10.0),
                    end: p(-10.0, 0.0),
                },
            ],
            holes: Vec::new(),
        };
        let mut kernel = OcctKernel::new().unwrap();
        let scene = kernel
            .recompute(&RecomputePlanDto {
                transaction_id: 1,
                errors: Vec::new(),
                jobs: vec![KernelJobDto::Extrude(KernelExtrudeJobDto {
                    feature_id: FeatureId(2),
                    operation: ExtrudeOperation::NewBody,
                    profiles: vec![profile],
                    normal: Point3Dto {
                        x: 0.0,
                        y: 0.0,
                        z: 1.0,
                    },
                    start_offset: 0.0,
                    end_offset: 5.0,
                    taper_angle_deg: 0.0,
                    target_body_ids: Vec::new(),
                    result_body_ids: vec![BodyId(1)],
                })],
            })
            .unwrap();
        assert!(scene.errors.is_empty(), "{:?}", scene.errors);
        let body = &scene.bodies[0];
        assert_eq!(body.faces.len(), 4, "caps + line side + one arc side");
        assert_eq!(
            body.faces
                .iter()
                .filter(|face| face.plane.is_none())
                .count(),
            1,
            "the analytic arc must create one cylindrical face"
        );
        assert_eq!(
            body.edges.len(),
            6,
            "two profile edges at each cap + uprights"
        );

        let curved_face = body.faces.iter().find(|face| face.plane.is_none()).unwrap();
        let first = curved_face.first_index as usize;
        let last = first + curved_face.index_count as usize;
        let mut curved_normals = body.indices[first..last]
            .iter()
            .map(|index| {
                let offset = *index as usize * 3;
                (
                    (body.normals[offset] * 100.0).round() as i32,
                    (body.normals[offset + 1] * 100.0).round() as i32,
                    (body.normals[offset + 2] * 100.0).round() as i32,
                )
            })
            .collect::<Vec<_>>();
        curved_normals.sort_unstable();
        curved_normals.dedup();
        assert!(
            curved_normals.len() > 3,
            "the curved face should use varying vertex normals instead of flat facets"
        );

        let step =
            String::from_utf8(kernel.export_step(&StepExportRequest::default()).unwrap()).unwrap();
        assert!(step.contains("CYLINDRICAL_SURFACE"));
    }

    #[test]
    fn occt_extrudes_nested_profile_as_one_body_with_a_real_hole() {
        let mut outer = square(0.0, 20.0);
        let mut inner = square(0.0, 6.0);
        inner.profile_index = 1;
        outer.holes.push(inner);

        let mut kernel = OcctKernel::new().unwrap();
        let scene = kernel
            .recompute(&RecomputePlanDto {
                transaction_id: 1,
                errors: Vec::new(),
                jobs: vec![KernelJobDto::Extrude(KernelExtrudeJobDto {
                    feature_id: FeatureId(2),
                    operation: ExtrudeOperation::NewBody,
                    profiles: vec![outer],
                    normal: Point3Dto {
                        x: 0.0,
                        y: 0.0,
                        z: 1.0,
                    },
                    start_offset: 0.0,
                    end_offset: 10.0,
                    taper_angle_deg: 0.0,
                    target_body_ids: Vec::new(),
                    result_body_ids: vec![BodyId(1)],
                })],
            })
            .unwrap();
        assert!(scene.errors.is_empty(), "{:?}", scene.errors);
        assert_eq!(scene.bodies.len(), 1);
        assert_eq!(scene.bodies[0].faces.len(), 10, "two caps plus eight walls");
        assert_eq!(scene.bodies[0].edges.len(), 24);
        let body = &scene.bodies[0];
        for face in body
            .faces
            .iter()
            .filter(|face| face.plane.is_some_and(|basis| basis.normal[2].abs() > 0.9))
        {
            let begin = face.first_index as usize;
            let end = begin + face.index_count as usize;
            for triangle in body.indices[begin..end].chunks_exact(3) {
                let centroid = triangle.iter().fold([0.0f64; 3], |mut sum, index| {
                    let offset = *index as usize * 3;
                    sum[0] += body.positions[offset] as f64 / 3.0;
                    sum[1] += body.positions[offset + 1] as f64 / 3.0;
                    sum[2] += body.positions[offset + 2] as f64 / 3.0;
                    sum
                });
                assert!(
                    centroid[0].abs() >= 5.5 || centroid[1].abs() >= 5.5,
                    "a cap triangle filled the intended inner void at {centroid:?}"
                );
            }
        }
    }

    #[test]
    fn occt_builds_multi_edge_refinements_and_all_first_hole_styles() {
        let refinements = vec![
            KernelJobDto::Fillet(KernelFilletJobDto {
                feature_id: FeatureId(3),
                target_body_id: BodyId(1),
                edge_keys: vec!["edge:0".to_string(), "edge:1".to_string()],
                radius: 1.0,
                tangent_chain: false,
            }),
            KernelJobDto::Chamfer(KernelChamferJobDto {
                feature_id: FeatureId(3),
                target_body_id: BodyId(1),
                edge_keys: vec!["edge:0".to_string(), "edge:1".to_string()],
                distance: 1.0,
                tangent_chain: false,
            }),
            KernelJobDto::Hole(KernelHoleJobDto {
                feature_id: FeatureId(3),
                target_body_id: BodyId(1),
                center: Point3Dto {
                    x: 0.0,
                    y: 0.0,
                    z: 10.0,
                },
                direction: Point3Dto {
                    x: 0.0,
                    y: 0.0,
                    z: -1.0,
                },
                diameter: 4.0,
                extent: HoleExtent::Distance { depth: 5.0 },
                style: HoleStyle::Simple,
                counterbore_diameter: 0.0,
                counterbore_depth: 0.0,
                countersink_diameter: 0.0,
                countersink_angle_deg: 90.0,
                bottom_style: HoleBottomStyle::DrillPoint,
                drill_point_angle_deg: 118.0,
            }),
            KernelJobDto::Hole(KernelHoleJobDto {
                feature_id: FeatureId(3),
                target_body_id: BodyId(1),
                center: Point3Dto {
                    x: 0.0,
                    y: 0.0,
                    z: 10.0,
                },
                direction: Point3Dto {
                    x: 0.0,
                    y: 0.0,
                    z: -1.0,
                },
                diameter: 4.0,
                extent: HoleExtent::ThroughAll,
                style: HoleStyle::Simple,
                counterbore_diameter: 0.0,
                counterbore_depth: 0.0,
                countersink_diameter: 0.0,
                countersink_angle_deg: 90.0,
                bottom_style: HoleBottomStyle::Flat,
                drill_point_angle_deg: 118.0,
            }),
            KernelJobDto::Hole(KernelHoleJobDto {
                feature_id: FeatureId(3),
                target_body_id: BodyId(1),
                center: Point3Dto {
                    x: 0.0,
                    y: 0.0,
                    z: 10.0,
                },
                direction: Point3Dto {
                    x: 0.0,
                    y: 0.0,
                    z: -1.0,
                },
                diameter: 4.0,
                extent: HoleExtent::Distance { depth: 8.0 },
                style: HoleStyle::Counterbore,
                counterbore_diameter: 8.0,
                counterbore_depth: 2.0,
                countersink_diameter: 0.0,
                countersink_angle_deg: 90.0,
                bottom_style: HoleBottomStyle::Flat,
                drill_point_angle_deg: 118.0,
            }),
            KernelJobDto::Hole(KernelHoleJobDto {
                feature_id: FeatureId(3),
                target_body_id: BodyId(1),
                center: Point3Dto {
                    x: 0.0,
                    y: 0.0,
                    z: 10.0,
                },
                direction: Point3Dto {
                    x: 0.0,
                    y: 0.0,
                    z: -1.0,
                },
                diameter: 4.0,
                extent: HoleExtent::Distance { depth: 8.0 },
                style: HoleStyle::Countersink,
                counterbore_diameter: 0.0,
                counterbore_depth: 0.0,
                countersink_diameter: 8.0,
                countersink_angle_deg: 90.0,
                bottom_style: HoleBottomStyle::Flat,
                drill_point_angle_deg: 118.0,
            }),
        ];

        for refinement in refinements {
            let feature_id = refinement.feature_id();
            let mut kernel = OcctKernel::new().unwrap();
            let scene = kernel
                .recompute(&RecomputePlanDto {
                    transaction_id: feature_id.0,
                    errors: Vec::new(),
                    jobs: vec![box_job(2, 1), refinement],
                })
                .unwrap();
            assert!(
                scene.errors.is_empty(),
                "feature {feature_id:?} failed: {:?}",
                scene.errors
            );
            assert_eq!(scene.bodies.len(), 1);
            assert!(!scene.bodies[0].indices.is_empty());
            assert_ne!(scene.bodies[0].edges.len(), 12);
        }
    }

    #[test]
    fn occt_revolves_and_meshes_a_profile() {
        let mut kernel = OcctKernel::new().unwrap();
        let plan = RecomputePlanDto {
            transaction_id: 1,
            errors: Vec::new(),
            jobs: vec![KernelJobDto::Revolve(KernelRevolveJobDto {
                feature_id: FeatureId(2),
                operation: ExtrudeOperation::NewBody,
                profiles: vec![KernelProfileDto {
                    profile_index: 0,
                    points: vec![
                        Point3Dto {
                            x: 10.0,
                            y: 0.0,
                            z: 0.0,
                        },
                        Point3Dto {
                            x: 20.0,
                            y: 0.0,
                            z: 0.0,
                        },
                        Point3Dto {
                            x: 20.0,
                            y: 15.0,
                            z: 0.0,
                        },
                        Point3Dto {
                            x: 10.0,
                            y: 15.0,
                            z: 0.0,
                        },
                    ],
                    curves: Vec::new(),
                    holes: Vec::new(),
                }],
                axis_origin: Point3Dto {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                axis_direction: Point3Dto {
                    x: 0.0,
                    y: 1.0,
                    z: 0.0,
                },
                angle_rad: std::f64::consts::TAU,
                target_body_ids: Vec::new(),
                result_body_ids: vec![BodyId(1)],
            })],
        };
        let scene = kernel.recompute(&plan).unwrap();
        assert!(scene.errors.is_empty(), "{:?}", scene.errors);
        assert_eq!(scene.bodies.len(), 1);
        assert!(!scene.bodies[0].indices.is_empty());
        assert!(scene.bodies[0]
            .faces
            .iter()
            .any(|face| face.plane.is_none()));
    }

    #[test]
    fn occt_sweeps_lofts_and_builds_ribs() {
        let cases = vec![
            KernelJobDto::Sweep(KernelSweepJobDto {
                feature_id: FeatureId(3),
                operation: ExtrudeOperation::NewBody,
                profile: square(0.0, 3.0),
                path: vec![KernelCurveDto::Polyline {
                    entity_id: 1,
                    points: vec![
                        Point3Dto {
                            x: 0.0,
                            y: 0.0,
                            z: 0.0,
                        },
                        Point3Dto {
                            x: 0.0,
                            y: 0.0,
                            z: 20.0,
                        },
                        Point3Dto {
                            x: 10.0,
                            y: 0.0,
                            z: 30.0,
                        },
                    ],
                }],
                guide_rail: Vec::new(),
                orientation: SweepOrientation::CorrectedFrenet,
                transition: SweepTransition::Transformed,
                force_c1: false,
                target_body_ids: Vec::new(),
                result_body_ids: vec![BodyId(1)],
            }),
            KernelJobDto::Loft(KernelLoftJobDto {
                feature_id: FeatureId(4),
                operation: ExtrudeOperation::NewBody,
                sections: vec![square(0.0, 3.0), square(20.0, 7.0)],
                ruled: false,
                continuity: LoftContinuity::G1,
                centerline: Vec::new(),
                guide_rail: Vec::new(),
                target_body_ids: Vec::new(),
                result_body_ids: vec![BodyId(1)],
            }),
            KernelJobDto::Rib(KernelRibJobDto {
                feature_id: FeatureId(5),
                operation: ExtrudeOperation::NewBody,
                profiles: vec![KernelProfileDto {
                    profile_index: 0,
                    points: vec![
                        Point3Dto {
                            x: -10.0,
                            y: -1.0,
                            z: 0.0,
                        },
                        Point3Dto {
                            x: 10.0,
                            y: -1.0,
                            z: 0.0,
                        },
                        Point3Dto {
                            x: 10.0,
                            y: 1.0,
                            z: 0.0,
                        },
                        Point3Dto {
                            x: -10.0,
                            y: 1.0,
                            z: 0.0,
                        },
                    ],
                    curves: Vec::new(),
                    holes: Vec::new(),
                }],
                normal: Point3Dto {
                    x: 0.0,
                    y: 0.0,
                    z: 1.0,
                },
                start_offset: 0.0,
                end_offset: 12.0,
                target_body_ids: Vec::new(),
                result_body_ids: vec![BodyId(1)],
            }),
        ];
        for job in cases {
            let mut kernel = OcctKernel::new().unwrap();
            let scene = kernel
                .recompute(&RecomputePlanDto {
                    transaction_id: 1,
                    errors: Vec::new(),
                    jobs: vec![job],
                })
                .unwrap();
            assert!(scene.errors.is_empty(), "{:?}", scene.errors);
            assert_eq!(scene.bodies.len(), 1);
            assert!(!scene.bodies[0].indices.is_empty());
        }
    }

    #[test]
    fn occt_applies_revolve_boolean_to_an_existing_body() {
        let base = KernelJobDto::Extrude(KernelExtrudeJobDto {
            feature_id: FeatureId(2),
            operation: ExtrudeOperation::NewBody,
            profiles: vec![KernelProfileDto {
                profile_index: 0,
                points: vec![
                    Point3Dto {
                        x: 0.0,
                        y: 0.0,
                        z: 0.0,
                    },
                    Point3Dto {
                        x: 20.0,
                        y: 0.0,
                        z: 0.0,
                    },
                    Point3Dto {
                        x: 20.0,
                        y: 20.0,
                        z: 0.0,
                    },
                    Point3Dto {
                        x: 0.0,
                        y: 20.0,
                        z: 0.0,
                    },
                ],
                curves: Vec::new(),
                holes: Vec::new(),
            }],
            normal: Point3Dto {
                x: 0.0,
                y: 0.0,
                z: 1.0,
            },
            start_offset: -10.0,
            end_offset: 10.0,
            taper_angle_deg: 0.0,
            target_body_ids: Vec::new(),
            result_body_ids: vec![BodyId(1)],
        });
        let cut = KernelJobDto::Revolve(KernelRevolveJobDto {
            feature_id: FeatureId(3),
            operation: ExtrudeOperation::Cut,
            profiles: vec![KernelProfileDto {
                profile_index: 0,
                points: vec![
                    Point3Dto {
                        x: 4.0,
                        y: 0.0,
                        z: 0.0,
                    },
                    Point3Dto {
                        x: 8.0,
                        y: 0.0,
                        z: 0.0,
                    },
                    Point3Dto {
                        x: 8.0,
                        y: 20.0,
                        z: 0.0,
                    },
                    Point3Dto {
                        x: 4.0,
                        y: 20.0,
                        z: 0.0,
                    },
                ],
                curves: Vec::new(),
                holes: Vec::new(),
            }],
            axis_origin: Point3Dto {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            axis_direction: Point3Dto {
                x: 0.0,
                y: 1.0,
                z: 0.0,
            },
            angle_rad: std::f64::consts::TAU,
            target_body_ids: vec![BodyId(1)],
            result_body_ids: vec![BodyId(1)],
        });
        let mut kernel = OcctKernel::new().unwrap();
        let scene = kernel
            .recompute(&RecomputePlanDto {
                transaction_id: 1,
                errors: Vec::new(),
                jobs: vec![base, cut],
            })
            .unwrap();
        assert!(scene.errors.is_empty(), "{:?}", scene.errors);
        assert_eq!(
            scene
                .bodies
                .iter()
                .map(|body| body.body_id)
                .collect::<Vec<_>>(),
            vec![BodyId(1)]
        );
        assert!(!scene.bodies[0].indices.is_empty());
    }
}
