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
    CamDocumentDto, CamResolvedStockDto, CamSetupDto, CamToolDto, CamToolKind, Point3Dto,
    StockBoxDto, WorkCoordinateSystemDto,
};
use crate::planner::{
    plan_setup, CamCommandDto, CamPlanError, CamProgramDto, RAPID_FEED_ESTIMATE_MM_PER_MIN,
};

const DEFAULT_MAX_VOXELS: usize = 750_000;
const HARD_MAX_VOXELS: usize = 4_000_000;
const MAX_SWEEP_SAMPLES: usize = 2_000_000;
/// Matches the native transient triangle budget. Greedy meshing normally
/// keeps a rectangular 3-axis stock far below this limit.
const MAX_SURFACE_TRIANGLES: usize = 65_536;
/// Tessellation budget for a modeled body used as stock.
const MAX_STOCK_MESH_TRIANGLES: usize = 20_000;
/// Hard cap on triangle-to-column intersection tests while voxelizing a
/// modeled stock body, so a pathological mesh fails instead of hanging.
const MAX_STOCK_VOXELIZE_TESTS: usize = 50_000_000;
const EPSILON: f64 = 1.0e-9;

/// Closed triangle mesh of a modeled body used as stock, in model
/// coordinates (millimetres). The host extracts it from the scene; the
/// simulator transforms it into setup coordinates with the setup WCS.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamStockMeshDto {
    #[serde(default)]
    pub positions: Vec<f64>,
    #[serde(default)]
    pub indices: Vec<u32>,
}

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
    /// Required when the setup's stock is a modeled body: that body's mesh
    /// in model coordinates. Ignored for parametric stock shapes.
    #[serde(default)]
    pub stock_mesh: Option<CamStockMeshDto>,
    /// Simulate only through this operation (inclusive, in the setup's
    /// operation order): the remaining-stock view of a selected operation
    /// must not show material that later operations have not removed yet.
    /// Omitted simulates the whole program.
    #[serde(default)]
    pub through_operation_id: Option<u64>,
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
    /// Echo of the request's truncation target, so the host can keep a stale
    /// result from painting over a freshly changed operation selection.
    pub through_operation_id: Option<u64>,
    pub warnings: Vec<String>,
}

pub fn simulate_setup(
    document: &CamDocumentDto,
    request: &CamSimulationRequestDto,
) -> Result<CamSimulationResultDto, CamPlanError> {
    let mut program = plan_setup(document, request.setup_id)?;
    let setup = document
        .setup(request.setup_id)
        .ok_or_else(|| CamPlanError(format!("CAM setup {} does not exist", request.setup_id)))?;
    if let Some(through) = request.through_operation_id {
        truncate_program_through(setup, &mut program, through)?;
    }
    simulate_program(document, setup, &program, request)
}

/// Cut the program off at the end of the last section whose operation sorts
/// at or before `through` in the setup's operation list. Sections exist only
/// for enabled operations, so a disabled target contributes nothing itself;
/// the first work-offset copy bounds the truncation either way (duplicated
/// offsets repeat identical motion against already-removed material).
fn truncate_program_through(
    setup: &CamSetupDto,
    program: &mut CamProgramDto,
    through: u64,
) -> Result<(), CamPlanError> {
    let position = |id: u64| setup.operations.iter().position(|op| op.id() == id);
    let target = position(through).ok_or_else(|| {
        CamPlanError(format!(
            "CAM operation {through} does not exist in setup '{}'",
            setup.name
        ))
    })?;
    let mut end = 0usize;
    let mut current: Option<usize> = None;
    let mut offset_copies = 0usize;
    for (index, command) in program.commands.iter().enumerate() {
        match command {
            CamCommandDto::WorkOffset { .. } => {
                offset_copies += 1;
                if offset_copies > 1 {
                    break;
                }
            }
            CamCommandDto::SectionStart { operation_id, .. } => {
                current = position(*operation_id);
                if current.is_none_or(|pos| pos > target) {
                    break;
                }
            }
            CamCommandDto::SectionEnd => {
                if current.is_some_and(|pos| pos <= target) {
                    end = index + 1;
                }
            }
            _ => {}
        }
    }
    program.commands.truncate(end);
    Ok(())
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
    let spec = GridSpec::for_stock(&setup.stock, requested_size, max_voxels)?;
    let mut stock = initial_stock(document, setup, &spec, request.stock_mesh.as_ref())?;
    let initial_voxels = stock.occupied_count;
    let outcome = run_program(document, program, &mut stock, true)?;

    let mut warnings = program.warnings.clone();
    if outcome.approximated_drill {
        warnings.push(
            "Drill stock removal uses a conventional 118-degree point because tool point angle is not yet stored."
                .to_string(),
        );
    }
    if outcome.approximated_chamfer {
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
        estimated_seconds: outcome.cumulative_seconds,
        steps: outcome.steps,
        collisions: outcome.collisions,
        stock_mesh,
        through_operation_id: request.through_operation_id,
        warnings,
    })
}

#[derive(Default)]
struct ProgramRunOutcome {
    steps: Vec<CamSimulationStepDto>,
    collisions: Vec<CamSimulationCollisionDto>,
    cumulative_seconds: f64,
    approximated_drill: bool,
    approximated_chamfer: bool,
}

/// Sweep the program through the stock. With `collect` false (evaluating a
/// rest-stock source setup) only material removal runs: steps, collision
/// reporting, and rapid sweeps are skipped because the source setup's own
/// simulation already reported them.
fn run_program(
    document: &CamDocumentDto,
    program: &CamProgramDto,
    stock: &mut VoxelStock,
    collect: bool,
) -> Result<ProgramRunOutcome, CamPlanError> {
    let mut outcome = ProgramRunOutcome::default();
    let mut active_tool: Option<&CamToolDto> = None;
    let mut position: Option<Point3Dto> = None;
    let mut sweep_samples = 0usize;

    for (command_index, command) in program.commands.iter().enumerate() {
        match command {
            CamCommandDto::ToolChange { tool_id, .. } => {
                active_tool = document.tool(*tool_id);
            }
            CamCommandDto::Rapid { to } => {
                let from = position;
                let duration = from
                    .map(|start| distance(start, *to) / RAPID_FEED_ESTIMATE_MM_PER_MIN * 60.0)
                    .unwrap_or(0.0);
                if collect {
                    if let (Some(start), Some(tool)) = (from, active_tool) {
                        let sweep = stock.sweep_tool(
                            tool,
                            start,
                            *to,
                            SweepMode::CollisionOnly,
                            &mut sweep_samples,
                        )?;
                        if let Some(hit) = sweep.first_contact {
                            outcome.collisions.push(CamSimulationCollisionDto {
                                command_index,
                                position: hit,
                                message: format!(
                                    "rapid motion intersects remaining stock with tool {}",
                                    tool.label()
                                ),
                            });
                        }
                    }
                    outcome.cumulative_seconds += duration;
                    outcome.steps.push(CamSimulationStepDto {
                        command_index,
                        kind: CamSimulationStepKind::Rapid,
                        from,
                        to: Some(*to),
                        duration_seconds: duration,
                        cumulative_seconds: outcome.cumulative_seconds,
                        removed_voxels: 0,
                    });
                }
                position = Some(*to);
            }
            CamCommandDto::Linear { to, feed } => {
                let from = position;
                let duration = from
                    .map(|start| distance(start, *to) / *feed * 60.0)
                    .unwrap_or(0.0);
                let removed = if let (Some(start), Some(tool)) = (from, active_tool) {
                    note_approximation(
                        tool,
                        &mut outcome.approximated_drill,
                        &mut outcome.approximated_chamfer,
                    );
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
                if collect {
                    outcome.cumulative_seconds += duration;
                    outcome.steps.push(CamSimulationStepDto {
                        command_index,
                        kind: CamSimulationStepKind::Linear,
                        from,
                        to: Some(*to),
                        duration_seconds: duration,
                        cumulative_seconds: outcome.cumulative_seconds,
                        removed_voxels: removed,
                    });
                }
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
                    note_approximation(
                        tool,
                        &mut outcome.approximated_drill,
                        &mut outcome.approximated_chamfer,
                    );
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
                if collect {
                    outcome.cumulative_seconds += duration;
                    outcome.steps.push(CamSimulationStepDto {
                        command_index,
                        kind: CamSimulationStepKind::Circular,
                        from,
                        to: Some(*to),
                        duration_seconds: duration,
                        cumulative_seconds: outcome.cumulative_seconds,
                        removed_voxels: removed,
                    });
                }
                position = Some(*to);
            }
            CamCommandDto::Dwell { seconds } => {
                if collect {
                    outcome.cumulative_seconds += seconds;
                    outcome.steps.push(CamSimulationStepDto {
                        command_index,
                        kind: CamSimulationStepKind::Dwell,
                        from: position,
                        to: position,
                        duration_seconds: *seconds,
                        cumulative_seconds: outcome.cumulative_seconds,
                        removed_voxels: 0,
                    });
                }
            }
            CamCommandDto::ProgramStart { .. }
            | CamCommandDto::WorkOffset { .. }
            | CamCommandDto::SectionStart { .. }
            | CamCommandDto::Spindle { .. }
            | CamCommandDto::Coolant { .. }
            | CamCommandDto::SectionEnd
            | CamCommandDto::ProgramEnd => {}
        }
    }
    Ok(outcome)
}

/// Voxel grid derived from a stock envelope and a resolution budget.
struct GridSpec {
    min: Point3Dto,
    dimensions: [usize; 3],
    cell_size: [f64; 3],
    /// Isotropic edge that produced this grid, reused to reproduce the exact
    /// grid of a rest-stock source setup.
    edge: f64,
}

impl GridSpec {
    fn for_stock(
        stock: &StockBoxDto,
        requested_size: Option<f64>,
        max_voxels: usize,
    ) -> Result<Self, CamPlanError> {
        let extent = [
            stock.max.x - stock.min.x,
            stock.max.y - stock.min.y,
            stock.max.z - stock.min.z,
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
        Ok(Self {
            min: stock.min,
            dimensions,
            cell_size: [
                extent[0] / dimensions[0] as f64,
                extent[1] / dimensions[1] as f64,
                extent[2] / dimensions[2] as f64,
            ],
            edge,
        })
    }
}

/// Build the starting stock for a setup. Rest stock re-runs the source
/// setup's program on an identical grid; document validation guarantees the
/// chain is acyclic, the WCS frames match, and the envelopes agree.
fn initial_stock(
    document: &CamDocumentDto,
    setup: &CamSetupDto,
    spec: &GridSpec,
    stock_mesh: Option<&CamStockMeshDto>,
) -> Result<VoxelStock, CamPlanError> {
    match &setup.resolved_stock {
        CamResolvedStockDto::Box => Ok(VoxelStock::filled(spec, |_| true)),
        CamResolvedStockDto::Cylinder { center, radius } => {
            Ok(VoxelStock::filled(spec, |point| {
                let dx = point.x - center.x;
                let dy = point.y - center.y;
                dx * dx + dy * dy <= radius * radius + EPSILON
            }))
        }
        CamResolvedStockDto::Hex {
            center,
            across_flats,
        } => {
            // Flats perpendicular to X; the other two slab normals sit at
            // +/-60 degrees from X.
            let half = across_flats / 2.0;
            let sin60 = 0.866_025_403_784_438_6;
            Ok(VoxelStock::filled(spec, |point| {
                let dx = point.x - center.x;
                let dy = point.y - center.y;
                dx.abs() <= half + EPSILON
                    && (0.5 * dx + sin60 * dy).abs() <= half + EPSILON
                    && (0.5 * dx - sin60 * dy).abs() <= half + EPSILON
            }))
        }
        CamResolvedStockDto::ModelBody { .. } => {
            let mesh = stock_mesh.ok_or_else(|| {
                CamPlanError(format!(
                    "setup '{}' uses a modeled body as stock; simulation needs the host to supply that body's mesh",
                    setup.name
                ))
            })?;
            voxelize_mesh_stock(setup, spec, mesh)
        }
        CamResolvedStockDto::Rest { source_setup_id } => {
            let source = document.setup(*source_setup_id).ok_or_else(|| {
                CamPlanError(format!(
                    "setup '{}' inherits remaining stock from a missing setup",
                    setup.name
                ))
            })?;
            // Reproduce the source grid exactly: same envelope (validated),
            // same requested edge, and no budget-driven edge growth.
            let source_spec = GridSpec::for_stock(&source.stock, Some(spec.edge), HARD_MAX_VOXELS)?;
            if source_spec.dimensions != spec.dimensions {
                return Err(CamPlanError(format!(
                    "rest-stock source setup '{}' produced a different voxel grid",
                    source.name
                )));
            }
            let mut stock = initial_stock(document, source, &source_spec, stock_mesh)?;
            let program = plan_setup(document, source.id)?;
            run_program(document, &program, &mut stock, false)?;
            Ok(stock)
        }
    }
}

/// Voxelize a closed triangle mesh (model coordinates) into the setup grid
/// by casting a vertical ray through each XY column and filling between
/// sorted intersection pairs (even-odd rule).
fn voxelize_mesh_stock(
    setup: &CamSetupDto,
    spec: &GridSpec,
    mesh: &CamStockMeshDto,
) -> Result<VoxelStock, CamPlanError> {
    if mesh.positions.len() % 3 != 0 || mesh.indices.len() % 3 != 0 {
        return Err(CamPlanError(
            "stock body mesh must contain xyz triples and complete triangles".to_string(),
        ));
    }
    let vertex_count = mesh.positions.len() / 3;
    let triangle_count = mesh.indices.len() / 3;
    if triangle_count == 0 || triangle_count > MAX_STOCK_MESH_TRIANGLES {
        return Err(CamPlanError(format!(
            "stock body mesh must have 1..={MAX_STOCK_MESH_TRIANGLES} triangles"
        )));
    }
    if mesh
        .indices
        .iter()
        .any(|index| *index as usize >= vertex_count)
    {
        return Err(CamPlanError(
            "stock body mesh indices reference missing vertices".to_string(),
        ));
    }
    if !mesh.positions.iter().all(|value| value.is_finite()) {
        return Err(CamPlanError(
            "stock body mesh vertices must be finite".to_string(),
        ));
    }

    let wcs = &setup.wcs;
    let to_setup = |index: u32| -> Point3Dto {
        let base = index as usize * 3;
        let dx = mesh.positions[base] - wcs.origin.x;
        let dy = mesh.positions[base + 1] - wcs.origin.y;
        let dz = mesh.positions[base + 2] - wcs.origin.z;
        Point3Dto::new(
            dx * wcs.x_axis[0] + dy * wcs.x_axis[1] + dz * wcs.x_axis[2],
            dx * wcs.y_axis[0] + dy * wcs.y_axis[1] + dz * wcs.y_axis[2],
            dx * wcs.z_axis[0] + dy * wcs.z_axis[1] + dz * wcs.z_axis[2],
        )
    };

    let column_count = spec.dimensions[0] * spec.dimensions[1];
    let mut column_hits: Vec<Vec<f64>> = (0..column_count).map(|_| Vec::new()).collect();
    let mut tests = 0usize;
    for triangle in mesh.indices.chunks_exact(3) {
        let vertices = [to_setup(triangle[0]), to_setup(triangle[1]), to_setup(triangle[2])];
        let min_x = vertices.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
        let max_x = vertices.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max);
        let min_y = vertices.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
        let max_y = vertices.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);
        let column_range = |min: f64, max: f64, origin: f64, cell: f64, count: usize| {
            let lo = ((min - origin) / cell).floor() as isize;
            let hi = ((max - origin) / cell).ceil() as isize;
            (lo.clamp(0, count as isize) as usize)..(hi.clamp(0, count as isize) as usize)
        };
        let xs = column_range(min_x, max_x, spec.min.x, spec.cell_size[0], spec.dimensions[0]);
        let ys = column_range(min_y, max_y, spec.min.y, spec.cell_size[1], spec.dimensions[1]);
        tests = tests.saturating_add(xs.len().saturating_mul(ys.len()));
        if tests > MAX_STOCK_VOXELIZE_TESTS {
            return Err(CamPlanError(
                "stock body mesh is too complex to voxelize; supply a coarser tessellation"
                    .to_string(),
            ));
        }
        let edge1 = Point3Dto::new(
            vertices[1].x - vertices[0].x,
            vertices[1].y - vertices[0].y,
            vertices[1].z - vertices[0].z,
        );
        let edge2 = Point3Dto::new(
            vertices[2].x - vertices[0].x,
            vertices[2].y - vertices[0].y,
            vertices[2].z - vertices[0].z,
        );
        let determinant = edge1.x * edge2.y - edge2.x * edge1.y;
        if determinant.abs() <= 1.0e-12 {
            // Vertical as seen from Z: no column crossing at cell resolution.
            continue;
        }
        for iy in ys {
            let cy = spec.min.y + (iy as f64 + 0.5) * spec.cell_size[1];
            for ix in xs.clone() {
                let cx = spec.min.x + (ix as f64 + 0.5) * spec.cell_size[0];
                let px = cx - vertices[0].x;
                let py = cy - vertices[0].y;
                let u = (px * edge2.y - py * edge2.x) / determinant;
                let v = (edge1.x * py - edge1.y * px) / determinant;
                if u < -EPSILON || v < -EPSILON || u + v > 1.0 + EPSILON {
                    continue;
                }
                column_hits[ix + spec.dimensions[0] * iy]
                    .push(vertices[0].z + u * edge1.z + v * edge2.z);
            }
        }
    }

    let mut stock = VoxelStock::filled(spec, |_| false);
    let z_epsilon = spec.cell_size[2] * 1.0e-6;
    for iy in 0..spec.dimensions[1] {
        for ix in 0..spec.dimensions[0] {
            let hits = &mut column_hits[ix + spec.dimensions[0] * iy];
            if hits.len() < 2 {
                continue;
            }
            hits.sort_by(|a, b| a.total_cmp(b));
            hits.dedup_by(|a, b| (*a - *b).abs() <= z_epsilon);
            for pair in hits.chunks_exact(2) {
                let (z_low, z_high) = (pair[0].min(pair[1]), pair[0].max(pair[1]));
                let lo = ((z_low - spec.min.z) / spec.cell_size[2]).floor() as isize;
                let hi = ((z_high - spec.min.z) / spec.cell_size[2]).ceil() as isize;
                for iz in lo.clamp(0, spec.dimensions[2] as isize) as usize
                    ..hi.clamp(0, spec.dimensions[2] as isize) as usize
                {
                    let cz = spec.min.z + (iz as f64 + 0.5) * spec.cell_size[2];
                    if cz >= z_low - z_epsilon && cz <= z_high + z_epsilon {
                        let index = stock.index(ix, iy, iz);
                        if !stock.is_occupied_index(index) {
                            stock.occupied[index / 64] |= 1u64 << (index % 64);
                            stock.occupied_count += 1;
                        }
                    }
                }
            }
        }
    }
    Ok(stock)
}

fn note_approximation(tool: &CamToolDto, drill: &mut bool, chamfer: &mut bool) {
    match tool.kind {
        CamToolKind::Drill => *drill = true,
        CamToolKind::ChamferMill => *chamfer = true,
        // Taps, reamers, boring bars, thread mills, and face mills sweep as
        // plain cylinders, like end mills, so they need no
        // tip-approximation note. Bull-nose corner radii deviate from the
        // cylinder only along the bottom edge, which the note does not
        // cover either. Turning tools never reach the simulator today.
        CamToolKind::FlatEndMill
        | CamToolKind::BallEndMill
        | CamToolKind::BullNoseEndMill
        | CamToolKind::FaceMill
        | CamToolKind::Tap
        | CamToolKind::Reamer
        | CamToolKind::BoringBar
        | CamToolKind::ThreadMill
        | CamToolKind::TurningGeneral => {}
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
    /// Fill every cell whose center satisfies `contains`. Box stock passes a
    /// constant true; profiles (cylinder/hex) test their XY slab; modeled
    /// bodies mark cells directly after mesh voxelization.
    fn filled(spec: &GridSpec, contains: impl Fn(Point3Dto) -> bool) -> Self {
        let count = spec.dimensions.iter().product::<usize>();
        let word_count = count.div_ceil(64);
        let mut occupied = vec![0u64; word_count];
        let mut occupied_count = 0usize;
        let mut stock = Self {
            min: spec.min,
            dimensions: spec.dimensions,
            cell_size: spec.cell_size,
            occupied: Vec::new(),
            occupied_count: 0,
        };
        for z in 0..spec.dimensions[2] {
            for y in 0..spec.dimensions[1] {
                for x in 0..spec.dimensions[0] {
                    if !contains(stock.center(x, y, z)) {
                        continue;
                    }
                    let index = stock.index(x, y, z);
                    occupied[index / 64] |= 1u64 << (index % 64);
                    occupied_count += 1;
                }
            }
        }
        stock.occupied = occupied;
        stock.occupied_count = occupied_count;
        stock
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
        CamToolKind::FlatEndMill
        | CamToolKind::BullNoseEndMill
        | CamToolKind::FaceMill
        | CamToolKind::ChamferMill
        | CamToolKind::Tap
        | CamToolKind::Reamer
        | CamToolKind::BoringBar
        | CamToolKind::ThreadMill
        | CamToolKind::TurningGeneral => {
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
        CamOperationDto, CamPostConfigDto, CamUnits, ContourCompensation, CoolantMode,
        CuttingParametersDto, Point2Dto, Rect2Dto, StockBoxDto, WcsOriginSpecDto, WorkOffset,
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
                wcs_origin: WcsOriginSpecDto::Explicit,
                work_offset: WorkOffset::G54,
                stock: StockBoxDto {
                    min: Point3Dto::new(0.0, 0.0, -6.0),
                    max: Point3Dto::new(20.0, 16.0, 0.0),
                },
                work_offset_count: 1,
                stock_spec: crate::model::CamStockSpecDto::LegacyBox,
                resolved_stock: crate::model::CamResolvedStockDto::Box,
                stock_model_box: None,
                body_ids: Vec::new(),
                legacy_clearance_z: None,
                legacy_retract_z: None,
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
                        safe_distance: 5.0,
                        clearance_z: 5.0,
                        retract_z: 2.0,
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
                        closed: true,
                        top_z: -1.0,
                        bottom_z: -4.0,
                        step_down: 1.5,
                        compensation: ContourCompensation::On,
                        clearance_z: 5.0,
                        retract_z: 2.0,
                        cutting,
                    },
                ],
            }],
            active_setup_id: Some(1),
            tools: vec![CamToolDto {
                id: 1,
                number: Some(1),
                name: "6 mm flat".to_string(),
                kind: CamToolKind::FlatEndMill,
                diameter: 6.0,
                flute_length: 12.0,
                overall_length: 50.0,
                center_cutting: true,
                flute_count: 4,
                point_angle_degrees: None,
                corner_radius: None,
                cutting: CuttingParametersDto::default(),
                cutting_presets: vec![],
            }],
            units: CamUnits::Millimeters,
            post_defaults: CamPostConfigDto::default(),
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
                stock_mesh: None,
                through_operation_id: None,
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
            stock_mesh: None,
            through_operation_id: None,
        };
        let first = simulate_setup(&document(), &request).expect("first simulation");
        let second = simulate_setup(&document(), &request).expect("second simulation");
        assert_eq!(first, second);
    }

    #[test]
    fn simulation_through_first_operation_excludes_later_removal() {
        let full = simulate_setup(
            &document(),
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                through_operation_id: None,
            },
        )
        .expect("full simulation");
        let faced_only = simulate_setup(
            &document(),
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                through_operation_id: Some(1),
            },
        )
        .expect("truncated simulation");
        assert_eq!(faced_only.through_operation_id, Some(1));
        assert_eq!(full.through_operation_id, None);
        // The face cuts the top layer; the contour then cuts deeper, so the
        // truncated run must remove strictly less material.
        assert!(faced_only.removed_voxels > 0);
        assert!(faced_only.removed_voxels < full.removed_voxels);
        assert!(faced_only.steps.len() < full.steps.len());
        // Truncating at the LAST operation reproduces the full removal.
        let through_last = simulate_setup(
            &document(),
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                through_operation_id: Some(2),
            },
        )
        .expect("through-last simulation");
        assert_eq!(through_last.removed_voxels, full.removed_voxels);
    }

    #[test]
    fn simulation_through_unknown_operation_fails_closed() {
        let error = simulate_setup(
            &document(),
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                through_operation_id: Some(99),
            },
        )
        .unwrap_err();
        assert!(error.to_string().contains("does not exist"));
    }

    #[test]
    fn invalid_resolution_fails_closed() {
        let error = simulate_setup(
            &document(),
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(0.0),
                max_voxels: None,
                stock_mesh: None,
                through_operation_id: None,
            },
        )
        .unwrap_err();
        assert!(error.to_string().contains("voxel size"));
    }

    #[test]
    fn cylinder_stock_initializes_only_its_circular_profile() {
        let mut document = document();
        document.setups[0].stock_spec = crate::model::CamStockSpecDto::FromModel {
            shape: crate::model::CamStockShape::Cylinder,
            offsets: crate::model::CamStockOffsetsDto::default(),
        };
        document.setups[0].resolved_stock = CamResolvedStockDto::Cylinder {
            center: crate::model::Point2Dto::new(10.0, 8.0),
            radius: 7.0,
        };
        let result = simulate_setup(
            &document,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                through_operation_id: None,
            },
        )
        .expect("simulation");
        // 20x16x6 box would fill 1920 voxels; the r=7 cylinder profile holds
        // about pi*49*6 ~ 924.
        assert!(result.initial_voxels < 1_200);
        assert!(result.initial_voxels > 700);
        assert!(result.removed_voxels > 0);
        assert!(result.removed_voxels < result.initial_voxels);
    }

    #[test]
    fn hex_stock_initializes_only_its_hexagonal_profile() {
        let mut document = document();
        document.setups[0].stock_spec = crate::model::CamStockSpecDto::FromModel {
            shape: crate::model::CamStockShape::Hex,
            offsets: crate::model::CamStockOffsetsDto::default(),
        };
        document.setups[0].resolved_stock = CamResolvedStockDto::Hex {
            center: crate::model::Point2Dto::new(10.0, 8.0),
            across_flats: 13.0,
        };
        let result = simulate_setup(
            &document,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                through_operation_id: None,
            },
        )
        .expect("simulation");
        // Hexagon area (sqrt(3)/2 * AF^2 ~ 146) times 6 layers ~ 878.
        assert!(result.initial_voxels < 1_100);
        assert!(result.initial_voxels > 650);
    }

    #[test]
    fn rest_stock_continues_from_the_source_setups_remaining_material() {
        let first = simulate_setup(
            &document(),
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                through_operation_id: None,
            },
        )
        .expect("first setup simulation");
        let mut document = document();
        let mut second = document.setups[0].clone();
        second.id = 2;
        second.name = "Second clamping group".to_string();
        second.stock_spec = crate::model::CamStockSpecDto::RestFromSetup { setup_id: 1 };
        second.resolved_stock = CamResolvedStockDto::Rest {
            source_setup_id: 1,
        };
        second.operations = vec![CamOperationDto::Face {
            id: 3,
            name: "Corner face".to_string(),
            enabled: true,
            tool_id: 1,
            bounds: Rect2Dto {
                min: Point2Dto::new(1.0, 1.0),
                max: Point2Dto::new(6.0, 6.0),
            },
            top_z: -1.0,
            target_z: -2.0,
            step_over: 2.0,
            step_down: 1.0,
            safe_distance: 5.0,
            clearance_z: 5.0,
            retract_z: 2.0,
            cutting: CuttingParametersDto {
                spindle_rpm: 8_000,
                feed_xy: 600.0,
                feed_z: 180.0,
                coolant: CoolantMode::Off,
            },
        }];
        second.operations.iter_mut().for_each(|operation| match operation {
            CamOperationDto::Face { id, .. } => *id = 3,
            _ => {}
        });
        document.setups.push(second);
        document.next_setup_id = 3;
        document.next_operation_id = 4;
        let result = simulate_setup(
            &document,
            &CamSimulationRequestDto {
                setup_id: 2,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                through_operation_id: None,
            },
        )
        .expect("rest simulation");
        // The second setup starts from what the first left behind, and the
        // corner face still removes its own material.
        assert_eq!(result.initial_voxels, first.remaining_voxels);
        assert!(result.removed_voxels > 0);
    }

    #[test]
    fn modeled_body_stock_voxelizes_a_closed_mesh() {
        // A 10 x 8 x 4 box body sitting inside the 20 x 16 x 6 envelope,
        // expressed in model coordinates (the default WCS is identity).
        let corners = [
            (2.0, 2.0, -4.0),
            (12.0, 2.0, -4.0),
            (12.0, 10.0, -4.0),
            (2.0, 10.0, -4.0),
            (2.0, 2.0, 0.0),
            (12.0, 2.0, 0.0),
            (12.0, 10.0, 0.0),
            (2.0, 10.0, 0.0),
        ];
        let mut positions = Vec::new();
        for (x, y, z) in corners {
            positions.extend([x, y, z]);
        }
        #[rustfmt::skip]
        let indices: Vec<u32> = vec![
            0, 2, 1, 0, 3, 2, // bottom
            4, 5, 6, 4, 6, 7, // top
            0, 1, 5, 0, 5, 4, // -Y
            1, 2, 6, 1, 6, 5, // +X
            2, 3, 7, 2, 7, 6, // +Y
            3, 0, 4, 3, 4, 7, // -X
        ];
        let mut document = document();
        document.setups[0].stock_spec =
            crate::model::CamStockSpecDto::ModelBody { body_id: 9 };
        document.setups[0].resolved_stock = CamResolvedStockDto::ModelBody { body_id: 9 };
        let result = simulate_setup(
            &document,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: Some(CamStockMeshDto { positions, indices }),
                through_operation_id: None,
            },
        )
        .expect("model-body simulation");
        // Exactly the 10 x 8 x 4 cell block is material before cutting.
        assert_eq!(result.initial_voxels, 320);
        assert!(result.removed_voxels > 0);
        assert!(result.remaining_voxels < 320);
    }

    #[test]
    fn modeled_body_stock_fails_closed_without_the_host_mesh() {
        let mut document = document();
        document.setups[0].stock_spec =
            crate::model::CamStockSpecDto::ModelBody { body_id: 9 };
        document.setups[0].resolved_stock = CamResolvedStockDto::ModelBody { body_id: 9 };
        let error = simulate_setup(
            &document,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                through_operation_id: None,
            },
        )
        .unwrap_err();
        assert!(error.0.contains("supply that body's mesh"));
    }
}
