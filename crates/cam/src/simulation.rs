//! Deterministic, renderer-neutral 3D stock simulation.
//!
//! The simulator deliberately consumes the same controller-neutral motion
//! program as every post processor.  It owns material removal and safety
//! findings; OCCT remains the exact B-rep authority and Bevy remains a
//! presentation layer.  A bounded voxel stock is used for the first
//! implementation because it represents real volume (including side entry
//! and disconnected material) without putting topology-changing OCCT
//! booleans in an animation loop.

use serde::{Deserialize, Serialize};

use crate::model::{
    CamDocumentDto, CamSetupDto, CamToolDto, CamToolKind, Point3Dto, WorkCoordinateSystemDto,
};
use crate::planner::{plan_setup, CamCommandDto, CamPlanError, CamProgramDto};

const DEFAULT_MAX_VOXELS: usize = 750_000;
const HARD_MAX_VOXELS: usize = 4_000_000;
const MAX_SWEEP_SAMPLES: usize = 2_000_000;
/// Matches the native transient triangle budget. Greedy meshing normally
/// keeps a rectangular 3-axis stock far below this limit.
const MAX_SURFACE_TRIANGLES: usize = 65_536;
const EPSILON: f64 = 1.0e-9;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamSimulationRequestDto {
    pub setup_id: u64,
    /// Requested isotropic voxel edge length in millimetres. When omitted,
    /// the simulator derives a bounded resolution from the stock envelope.
    #[serde(default)]
    pub voxel_size: Option<f64>,
    /// Optional lower budget for interactive previews. The hard safety cap
    /// remains in force even when a larger value is supplied.
    #[serde(default)]
    pub max_voxels: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamSimulationStepKind {
    Rapid,
    Linear,
    Circular,
    Dwell,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamSimulationStepDto {
    pub command_index: usize,
    pub kind: CamSimulationStepKind,
    pub from: Option<Point3Dto>,
    pub to: Option<Point3Dto>,
    pub duration_seconds: f64,
    pub cumulative_seconds: f64,
    pub removed_voxels: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamSimulationCollisionDto {
    pub command_index: usize,
    pub position: Point3Dto,
    pub message: String,
}

/// Triangle soup in setup coordinates. This maps directly to the existing
/// native Bevy transient-triangle contract and is also usable by browser
/// preview renderers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamSimulationMeshDto {
    pub positions: Vec<f32>,
    pub triangle_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamSimulationResultDto {
    pub setup_id: u64,
    pub wcs: WorkCoordinateSystemDto,
    pub grid_origin: Point3Dto,
    pub cell_size: [f64; 3],
    pub dimensions: [u32; 3],
    pub initial_voxels: usize,
    pub remaining_voxels: usize,
    pub removed_voxels: usize,
    pub remaining_volume_mm3: f64,
    pub removed_volume_mm3: f64,
    pub estimated_seconds: f64,
    pub steps: Vec<CamSimulationStepDto>,
    pub collisions: Vec<CamSimulationCollisionDto>,
    pub stock_mesh: Option<CamSimulationMeshDto>,
    pub warnings: Vec<String>,
}

pub fn simulate_setup(
    document: &CamDocumentDto,
    request: &CamSimulationRequestDto,
) -> Result<CamSimulationResultDto, CamPlanError> {
    let program = plan_setup(document, request.setup_id)?;
    let setup = document
        .setup(request.setup_id)
        .ok_or_else(|| CamPlanError(format!("CAM setup {} does not exist", request.setup_id)))?;
    simulate_program(document, setup, &program, request)
}

fn simulate_program(
    document: &CamDocumentDto,
    setup: &CamSetupDto,
    program: &CamProgramDto,
    request: &CamSimulationRequestDto,
) -> Result<CamSimulationResultDto, CamPlanError> {
    let max_voxels = request
        .max_voxels
        .unwrap_or(DEFAULT_MAX_VOXELS)
        .clamp(1, HARD_MAX_VOXELS);
    let requested_size = match request.voxel_size {
        Some(size) if size.is_finite() && size > 0.0 => Some(size),
        Some(_) => {
            return Err(CamPlanError(
                "simulation voxel size must be finite and positive".to_string(),
            ))
        }
        None => None,
    };
    let mut stock = VoxelStock::new(setup, requested_size, max_voxels)?;
    let initial_voxels = stock.occupied_count;
    let mut active_tool: Option<&CamToolDto> = None;
    let mut position: Option<Point3Dto> = None;
    let mut cumulative_seconds = 0.0;
    let mut steps = Vec::new();
    let mut collisions = Vec::new();
    let mut warnings = program.warnings.clone();
    let mut sweep_samples = 0usize;
    let mut approximated_drill = false;
    let mut approximated_chamfer = false;

    for (command_index, command) in program.commands.iter().enumerate() {
        match command {
            CamCommandDto::ToolChange { tool_id, .. } => {
                active_tool = document.tool(*tool_id);
            }
            CamCommandDto::Rapid { to } => {
                let from = position;
                let duration = from
                    .map(|start| distance(start, *to) / setup.rapid_feed * 60.0)
                    .unwrap_or(0.0);
                if let (Some(start), Some(tool)) = (from, active_tool) {
                    let outcome = stock.sweep_tool(
                        tool,
                        start,
                        *to,
                        SweepMode::CollisionOnly,
                        &mut sweep_samples,
                    )?;
                    if let Some(hit) = outcome.first_contact {
                        collisions.push(CamSimulationCollisionDto {
                            command_index,
                            position: hit,
                            message: format!(
                                "rapid motion intersects remaining stock with tool T{}",
                                tool.number
                            ),
                        });
                    }
                }
                cumulative_seconds += duration;
                steps.push(CamSimulationStepDto {
                    command_index,
                    kind: CamSimulationStepKind::Rapid,
                    from,
                    to: Some(*to),
                    duration_seconds: duration,
                    cumulative_seconds,
                    removed_voxels: 0,
                });
                position = Some(*to);
            }
            CamCommandDto::Linear { to, feed } => {
                let from = position;
                let duration = from
                    .map(|start| distance(start, *to) / *feed * 60.0)
                    .unwrap_or(0.0);
                let removed = if let (Some(start), Some(tool)) = (from, active_tool) {
                    note_approximation(tool, &mut approximated_drill, &mut approximated_chamfer);
                    stock
                        .sweep_tool(
                            tool,
                            start,
                            *to,
                            SweepMode::RemoveMaterial,
                            &mut sweep_samples,
                        )?
                        .removed
                } else {
                    0
                };
                cumulative_seconds += duration;
                steps.push(CamSimulationStepDto {
                    command_index,
                    kind: CamSimulationStepKind::Linear,
                    from,
                    to: Some(*to),
                    duration_seconds: duration,
                    cumulative_seconds,
                    removed_voxels: removed,
                });
                position = Some(*to);
            }
            CamCommandDto::Circular {
                clockwise,
                center,
                to,
                feed,
            } => {
                let from = position;
                let (duration, removed) = if let (Some(start), Some(tool)) = (from, active_tool) {
                    note_approximation(tool, &mut approximated_drill, &mut approximated_chamfer);
                    let arc = ArcSweep::new(start, *center, *to, *clockwise)?;
                    let duration = arc.length / *feed * 60.0;
                    let removed = stock.sweep_arc(
                        tool,
                        &arc,
                        SweepMode::RemoveMaterial,
                        &mut sweep_samples,
                    )?;
                    (duration, removed.removed)
                } else {
                    (0.0, 0)
                };
                cumulative_seconds += duration;
                steps.push(CamSimulationStepDto {
                    command_index,
                    kind: CamSimulationStepKind::Circular,
                    from,
                    to: Some(*to),
                    duration_seconds: duration,
                    cumulative_seconds,
                    removed_voxels: removed,
                });
                position = Some(*to);
            }
            CamCommandDto::Dwell { seconds } => {
                cumulative_seconds += seconds;
                steps.push(CamSimulationStepDto {
                    command_index,
                    kind: CamSimulationStepKind::Dwell,
                    from: position,
                    to: position,
                    duration_seconds: *seconds,
                    cumulative_seconds,
                    removed_voxels: 0,
                });
            }
            CamCommandDto::ProgramStart { .. }
            | CamCommandDto::SectionStart { .. }
            | CamCommandDto::Spindle { .. }
            | CamCommandDto::Coolant { .. }
            | CamCommandDto::SectionEnd
            | CamCommandDto::ProgramEnd => {}
        }
    }

    if approximated_drill {
        warnings.push(
            "Drill stock removal uses a conventional 118-degree point because tool point angle is not yet stored."
                .to_string(),
        );
    }
    if approximated_chamfer {
        warnings.push(
            "Chamfer-mill stock removal currently uses a cylindrical envelope until tool angle is stored."
                .to_string(),
        );
    }
    warnings.push(
        "3D stock is voxelized: increase resolution before using remaining-stock measurements for process decisions."
            .to_string(),
    );
    warnings.push(
        "The first simulator slice checks rapid/tool contact with stock; target-part gouge, fixture, shank, holder, and machine-envelope checks are scaffolded for later geometry inputs."
            .to_string(),
    );

    let remaining_voxels = stock.occupied_count;
    let removed_voxels = initial_voxels - remaining_voxels;
    let voxel_volume = stock.cell_size.iter().product::<f64>();
    let stock_mesh = match stock.greedy_surface_mesh(MAX_SURFACE_TRIANGLES) {
        Ok(mesh) => Some(mesh),
        Err(message) => {
            warnings.push(message);
            None
        }
    };

    Ok(CamSimulationResultDto {
        setup_id: setup.id,
        wcs: setup.wcs,
        grid_origin: setup.stock.min,
        cell_size: stock.cell_size,
        dimensions: stock.dimensions.map(|value| value as u32),
        initial_voxels,
        remaining_voxels,
        removed_voxels,
        remaining_volume_mm3: remaining_voxels as f64 * voxel_volume,
        removed_volume_mm3: removed_voxels as f64 * voxel_volume,
        estimated_seconds: cumulative_seconds,
        steps,
        collisions,
        stock_mesh,
        warnings,
    })
}

fn note_approximation(tool: &CamToolDto, drill: &mut bool, chamfer: &mut bool) {
    match tool.kind {
        CamToolKind::Drill => *drill = true,
        CamToolKind::ChamferMill => *chamfer = true,
        CamToolKind::FlatEndMill | CamToolKind::BallEndMill => {}
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SweepMode {
    RemoveMaterial,
    CollisionOnly,
}

#[derive(Default)]
struct SweepOutcome {
    removed: usize,
    first_contact: Option<Point3Dto>,
}

struct VoxelStock {
    min: Point3Dto,
    dimensions: [usize; 3],
    cell_size: [f64; 3],
    occupied: Vec<u64>,
    occupied_count: usize,
}

impl VoxelStock {
    fn new(
        setup: &CamSetupDto,
        requested_size: Option<f64>,
        max_voxels: usize,
    ) -> Result<Self, CamPlanError> {
        let extent = [
            setup.stock.max.x - setup.stock.min.x,
            setup.stock.max.y - setup.stock.min.y,
            setup.stock.max.z - setup.stock.min.z,
        ];
        let max_extent = extent.iter().copied().fold(0.0, f64::max);
        let mut edge = requested_size.unwrap_or_else(|| (max_extent / 72.0).clamp(0.25, 2.0));
        let mut dimensions = dimensions_for_extent(extent, edge);
        while dimensions.iter().product::<usize>() > max_voxels {
            edge *= 1.125;
            dimensions = dimensions_for_extent(extent, edge);
        }
        let count = dimensions.iter().product::<usize>();
        if count == 0 || count > HARD_MAX_VOXELS {
            return Err(CamPlanError(format!(
                "simulation grid requires {count} voxels; increase voxel size"
            )));
        }
        let cell_size = [
            extent[0] / dimensions[0] as f64,
            extent[1] / dimensions[1] as f64,
            extent[2] / dimensions[2] as f64,
        ];
        let word_count = count.div_ceil(64);
        let mut occupied = vec![u64::MAX; word_count];
        if let Some(last) = occupied.last_mut() {
            let used = count % 64;
            if used != 0 {
                *last = (1u64 << used) - 1;
            }
        }
        Ok(Self {
            min: setup.stock.min,
            dimensions,
            cell_size,
            occupied,
            occupied_count: count,
        })
    }

    fn sweep_tool(
        &mut self,
        tool: &CamToolDto,
        from: Point3Dto,
        to: Point3Dto,
        mode: SweepMode,
        total_samples: &mut usize,
    ) -> Result<SweepOutcome, CamPlanError> {
        let length = distance(from, to);
        let spacing = self
            .cell_size
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min)
            .mul_add(0.45, 0.0)
            .min((tool.diameter * 0.2).max(EPSILON));
        let samples = ((length / spacing).ceil() as usize).max(1);
        self.reserve_samples(samples, total_samples)?;
        let mut outcome = SweepOutcome::default();
        for index in 0..=samples {
            let t = index as f64 / samples as f64;
            let position = lerp(from, to, t);
            self.apply_tool_at(tool, position, mode, &mut outcome);
            if mode == SweepMode::CollisionOnly && outcome.first_contact.is_some() {
                break;
            }
        }
        Ok(outcome)
    }

    fn sweep_arc(
        &mut self,
        tool: &CamToolDto,
        arc: &ArcSweep,
        mode: SweepMode,
        total_samples: &mut usize,
    ) -> Result<SweepOutcome, CamPlanError> {
        let spacing = self
            .cell_size
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min)
            .mul_add(0.45, 0.0)
            .min((tool.diameter * 0.2).max(EPSILON));
        let samples = ((arc.length / spacing).ceil() as usize).max(1);
        self.reserve_samples(samples, total_samples)?;
        let mut outcome = SweepOutcome::default();
        for index in 0..=samples {
            let t = index as f64 / samples as f64;
            self.apply_tool_at(tool, arc.point(t), mode, &mut outcome);
            if mode == SweepMode::CollisionOnly && outcome.first_contact.is_some() {
                break;
            }
        }
        Ok(outcome)
    }

    fn reserve_samples(
        &self,
        samples: usize,
        total_samples: &mut usize,
    ) -> Result<(), CamPlanError> {
        *total_samples = total_samples.saturating_add(samples);
        if *total_samples > MAX_SWEEP_SAMPLES {
            return Err(CamPlanError(format!(
                "3D simulation exceeds the {MAX_SWEEP_SAMPLES}-sample safety budget; increase voxel size"
            )));
        }
        Ok(())
    }

    fn apply_tool_at(
        &mut self,
        tool: &CamToolDto,
        tip: Point3Dto,
        mode: SweepMode,
        outcome: &mut SweepOutcome,
    ) {
        let radius = tool.diameter * 0.5;
        let lower = Point3Dto::new(tip.x - radius, tip.y - radius, tip.z);
        let upper = Point3Dto::new(tip.x + radius, tip.y + radius, tip.z + tool.flute_length);
        let ranges = self.index_ranges(lower, upper);
        for z in ranges[2].0..ranges[2].1 {
            for y in ranges[1].0..ranges[1].1 {
                for x in ranges[0].0..ranges[0].1 {
                    let index = self.index(x, y, z);
                    if !self.is_occupied_index(index) {
                        continue;
                    }
                    let point = self.center(x, y, z);
                    if !cutter_contains(tool, tip, point) {
                        continue;
                    }
                    match mode {
                        SweepMode::RemoveMaterial => {
                            self.clear_index(index);
                            outcome.removed += 1;
                        }
                        SweepMode::CollisionOnly => {
                            outcome.first_contact.get_or_insert(tip);
                            return;
                        }
                    }
                }
            }
        }
    }

    fn index_ranges(&self, lower: Point3Dto, upper: Point3Dto) -> [(usize, usize); 3] {
        let lo = [lower.x, lower.y, lower.z];
        let hi = [upper.x, upper.y, upper.z];
        let min = [self.min.x, self.min.y, self.min.z];
        let mut result = [(0, 0); 3];
        for axis in 0..3 {
            let start = (((lo[axis] - min[axis]) / self.cell_size[axis]).floor() as isize - 1)
                .clamp(0, self.dimensions[axis] as isize) as usize;
            let end = (((hi[axis] - min[axis]) / self.cell_size[axis]).ceil() as isize + 1)
                .clamp(0, self.dimensions[axis] as isize) as usize;
            result[axis] = (start, end);
        }
        result
    }

    fn index(&self, x: usize, y: usize, z: usize) -> usize {
        x + self.dimensions[0] * (y + self.dimensions[1] * z)
    }

    fn is_occupied_index(&self, index: usize) -> bool {
        self.occupied[index / 64] & (1u64 << (index % 64)) != 0
    }

    fn occupied_at(&self, coordinate: [isize; 3]) -> bool {
        if coordinate
            .iter()
            .enumerate()
            .any(|(axis, value)| *value < 0 || *value >= self.dimensions[axis] as isize)
        {
            return false;
        }
        self.is_occupied_index(self.index(
            coordinate[0] as usize,
            coordinate[1] as usize,
            coordinate[2] as usize,
        ))
    }

    fn clear_index(&mut self, index: usize) {
        let mask = 1u64 << (index % 64);
        let word = &mut self.occupied[index / 64];
        if *word & mask != 0 {
            *word &= !mask;
            self.occupied_count -= 1;
        }
    }

    fn center(&self, x: usize, y: usize, z: usize) -> Point3Dto {
        Point3Dto::new(
            self.min.x + (x as f64 + 0.5) * self.cell_size[0],
            self.min.y + (y as f64 + 0.5) * self.cell_size[1],
            self.min.z + (z as f64 + 0.5) * self.cell_size[2],
        )
    }

    fn greedy_surface_mesh(&self, max_triangles: usize) -> Result<CamSimulationMeshDto, String> {
        let mut positions = Vec::<f32>::new();
        let origin = [self.min.x, self.min.y, self.min.z];
        for axis in 0..3 {
            let u = (axis + 1) % 3;
            let v = (axis + 2) % 3;
            let width = self.dimensions[u];
            let height = self.dimensions[v];
            let mut mask = vec![0i8; width * height];
            for slice in 0..=self.dimensions[axis] {
                for row in 0..height {
                    for column in 0..width {
                        let mut before = [0isize; 3];
                        let mut after = [0isize; 3];
                        before[axis] = slice as isize - 1;
                        after[axis] = slice as isize;
                        before[u] = column as isize;
                        after[u] = column as isize;
                        before[v] = row as isize;
                        after[v] = row as isize;
                        mask[column + row * width] =
                            match (self.occupied_at(before), self.occupied_at(after)) {
                                (true, false) => 1,
                                (false, true) => -1,
                                _ => 0,
                            };
                    }
                }
                let mut row = 0;
                while row < height {
                    let mut column = 0;
                    while column < width {
                        let sign = mask[column + row * width];
                        if sign == 0 {
                            column += 1;
                            continue;
                        }
                        let mut run_width = 1;
                        while column + run_width < width
                            && mask[column + run_width + row * width] == sign
                        {
                            run_width += 1;
                        }
                        let mut run_height = 1;
                        'height: while row + run_height < height {
                            for offset in 0..run_width {
                                if mask[column + offset + (row + run_height) * width] != sign {
                                    break 'height;
                                }
                            }
                            run_height += 1;
                        }
                        let mut p0 = [0.0; 3];
                        let mut p1 = [0.0; 3];
                        let mut p2 = [0.0; 3];
                        let mut p3 = [0.0; 3];
                        for point in [&mut p0, &mut p1, &mut p2, &mut p3] {
                            point[axis] = origin[axis] + slice as f64 * self.cell_size[axis];
                        }
                        p0[u] = origin[u] + column as f64 * self.cell_size[u];
                        p0[v] = origin[v] + row as f64 * self.cell_size[v];
                        p1[u] = origin[u] + (column + run_width) as f64 * self.cell_size[u];
                        p1[v] = p0[v];
                        p2[u] = p1[u];
                        p2[v] = origin[v] + (row + run_height) as f64 * self.cell_size[v];
                        p3[u] = p0[u];
                        p3[v] = p2[v];
                        if positions.len() / 9 + 2 > max_triangles {
                            return Err(format!(
                                "remaining-stock mesh exceeds the {max_triangles}-triangle presentation budget; increase voxel size"
                            ));
                        }
                        if sign > 0 {
                            push_triangle(&mut positions, p0, p1, p2);
                            push_triangle(&mut positions, p0, p2, p3);
                        } else {
                            push_triangle(&mut positions, p0, p3, p2);
                            push_triangle(&mut positions, p0, p2, p1);
                        }
                        for clear_row in row..row + run_height {
                            for clear_column in column..column + run_width {
                                mask[clear_column + clear_row * width] = 0;
                            }
                        }
                        column += run_width;
                    }
                    row += 1;
                }
            }
        }
        Ok(CamSimulationMeshDto {
            triangle_count: positions.len() / 9,
            positions,
        })
    }
}

fn dimensions_for_extent(extent: [f64; 3], edge: f64) -> [usize; 3] {
    extent.map(|value| (value / edge).ceil().max(1.0) as usize)
}

fn cutter_contains(tool: &CamToolDto, tip: Point3Dto, point: Point3Dto) -> bool {
    let dx = point.x - tip.x;
    let dy = point.y - tip.y;
    let radial_sq = dx * dx + dy * dy;
    let radius = tool.diameter * 0.5;
    let dz = point.z - tip.z;
    if dz < -EPSILON || dz > tool.flute_length + EPSILON {
        return false;
    }
    match tool.kind {
        CamToolKind::FlatEndMill | CamToolKind::ChamferMill => {
            radial_sq <= radius * radius + EPSILON
        }
        CamToolKind::BallEndMill => {
            if dz <= radius {
                radial_sq + (dz - radius).powi(2) <= radius * radius + EPSILON
            } else {
                radial_sq <= radius * radius + EPSILON
            }
        }
        CamToolKind::Drill => {
            let tangent = 59.0_f64.to_radians().tan();
            let point_length = radius / tangent;
            let local_radius = if dz < point_length {
                (dz.max(0.0) * tangent).min(radius)
            } else {
                radius
            };
            radial_sq <= local_radius * local_radius + EPSILON
        }
    }
}

struct ArcSweep {
    start: Point3Dto,
    center: Point3Dto,
    end_z: f64,
    radius: f64,
    start_angle: f64,
    sweep: f64,
    length: f64,
}

impl ArcSweep {
    fn new(
        start: Point3Dto,
        center: Point3Dto,
        end: Point3Dto,
        clockwise: bool,
    ) -> Result<Self, CamPlanError> {
        let start_radius = ((start.x - center.x).powi(2) + (start.y - center.y).powi(2)).sqrt();
        let end_radius = ((end.x - center.x).powi(2) + (end.y - center.y).powi(2)).sqrt();
        if !start_radius.is_finite()
            || start_radius <= EPSILON
            || (start_radius - end_radius).abs() > 1.0e-5
        {
            return Err(CamPlanError(
                "simulation circular move has inconsistent XY radius".to_string(),
            ));
        }
        let start_angle = (start.y - center.y).atan2(start.x - center.x);
        let end_angle = (end.y - center.y).atan2(end.x - center.x);
        let mut sweep = end_angle - start_angle;
        if clockwise {
            while sweep >= -EPSILON {
                sweep -= std::f64::consts::TAU;
            }
        } else {
            while sweep <= EPSILON {
                sweep += std::f64::consts::TAU;
            }
        }
        let planar = start_radius * sweep.abs();
        let dz = end.z - start.z;
        Ok(Self {
            start,
            center,
            end_z: end.z,
            radius: start_radius,
            start_angle,
            sweep,
            length: (planar * planar + dz * dz).sqrt(),
        })
    }

    fn point(&self, t: f64) -> Point3Dto {
        let angle = self.start_angle + self.sweep * t;
        Point3Dto::new(
            self.center.x + self.radius * angle.cos(),
            self.center.y + self.radius * angle.sin(),
            self.start.z + (self.end_z - self.start.z) * t,
        )
    }
}

fn push_triangle(positions: &mut Vec<f32>, a: [f64; 3], b: [f64; 3], c: [f64; 3]) {
    for point in [a, b, c] {
        positions.extend(point.map(|value| value as f32));
    }
}

fn distance(a: Point3Dto, b: Point3Dto) -> f64 {
    ((b.x - a.x).powi(2) + (b.y - a.y).powi(2) + (b.z - a.z).powi(2)).sqrt()
}

fn lerp(a: Point3Dto, b: Point3Dto, t: f64) -> Point3Dto {
    Point3Dto::new(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        CamOperationDto, CamPostConfigDto, ContourCompensation, CoolantMode, CuttingParametersDto,
        Point2Dto, Rect2Dto, StockBoxDto, WorkOffset,
    };

    fn document() -> CamDocumentDto {
        let cutting = CuttingParametersDto {
            spindle_rpm: 8_000,
            feed_xy: 600.0,
            feed_z: 180.0,
            coolant: CoolantMode::Off,
        };
        CamDocumentDto {
            setups: vec![CamSetupDto {
                id: 1,
                name: "Voxel test".to_string(),
                wcs: WorkCoordinateSystemDto::default(),
                work_offset: WorkOffset::G54,
                stock: StockBoxDto {
                    min: Point3Dto::new(0.0, 0.0, -6.0),
                    max: Point3Dto::new(20.0, 16.0, 0.0),
                },
                body_ids: Vec::new(),
                clearance_z: 5.0,
                retract_z: 2.0,
                rapid_feed: 2_000.0,
                post: CamPostConfigDto::default(),
                operations: vec![
                    CamOperationDto::Face {
                        id: 1,
                        name: "Face".to_string(),
                        enabled: true,
                        tool_id: 1,
                        bounds: Rect2Dto {
                            min: Point2Dto::new(1.0, 1.0),
                            max: Point2Dto::new(19.0, 15.0),
                        },
                        top_z: 0.0,
                        target_z: -1.0,
                        step_over: 3.0,
                        step_down: 1.0,
                        cutting,
                    },
                    CamOperationDto::Contour2d {
                        id: 2,
                        name: "Pocket wall".to_string(),
                        enabled: true,
                        tool_id: 1,
                        path: vec![
                            Point2Dto::new(5.0, 5.0),
                            Point2Dto::new(15.0, 5.0),
                            Point2Dto::new(15.0, 11.0),
                            Point2Dto::new(5.0, 11.0),
                        ],
                        top_z: -1.0,
                        bottom_z: -4.0,
                        step_down: 1.5,
                        compensation: ContourCompensation::On,
                        cutting,
                    },
                ],
            }],
            active_setup_id: Some(1),
            tools: vec![CamToolDto {
                id: 1,
                number: 1,
                name: "6 mm flat".to_string(),
                kind: CamToolKind::FlatEndMill,
                diameter: 6.0,
                flute_length: 12.0,
                overall_length: 50.0,
                center_cutting: true,
            }],
            next_setup_id: 2,
            next_operation_id: 3,
            next_tool_id: 2,
        }
    }

    #[test]
    fn voxel_simulation_removes_real_volume_and_builds_a_surface() {
        let result = simulate_setup(
            &document(),
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
            },
        )
        .expect("simulation");
        assert!(result.removed_voxels > 0);
        assert!(result.remaining_voxels < result.initial_voxels);
        assert!(result.removed_volume_mm3 > 0.0);
        assert!(result.stock_mesh.as_ref().unwrap().triangle_count >= 12);
        assert!(!result.steps.is_empty());
    }

    #[test]
    fn voxel_simulation_is_deterministic() {
        let request = CamSimulationRequestDto {
            setup_id: 1,
            voxel_size: Some(1.5),
            max_voxels: None,
        };
        let first = simulate_setup(&document(), &request).expect("first simulation");
        let second = simulate_setup(&document(), &request).expect("second simulation");
        assert_eq!(first, second);
    }

    #[test]
    fn invalid_resolution_fails_closed() {
        let error = simulate_setup(
            &document(),
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(0.0),
                max_voxels: None,
            },
        )
        .unwrap_err();
        assert!(error.to_string().contains("voxel size"));
    }
}
