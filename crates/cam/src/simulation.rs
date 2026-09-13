//! Deterministic, renderer-neutral 3D stock simulation.
//!
//! The simulator deliberately consumes the same controller-neutral motion
//! program as every post processor.  It owns material removal and safety
//! findings; OCCT remains the exact B-rep authority and Bevy remains a
//! presentation layer.  A bounded voxel stock is used for the first
//! implementation because it represents real volume (including side entry
//! and disconnected material) without putting topology-changing OCCT
//! booleans in an animation loop.

use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

use serde::{Deserialize, Serialize};

use crate::model::{
    CamDocumentDto, CamResolvedStockDto, CamSetupDto, CamToolDto, CamToolKind, Point3Dto,
    StockBoxDto, WorkCoordinateSystemDto,
};
use crate::planner::{
    plan_setup, CamArcPlane, CamCommandDto, CamPlanError, CamProgramDto,
    RAPID_FEED_ESTIMATE_MM_PER_MIN,
};

mod cache;
mod frame;
mod surface;
pub use frame::CamPlayback;

const DEFAULT_MAX_VOXELS: usize = 8_000_000;
const HARD_MAX_VOXELS: usize = 8_000_000;
/// Auto detail is model-relative: aim for this many cells along the stock's
/// longest side, then coarsen only as required by the bounded voxel budget.
/// Camera zoom never changes the physical simulation grid.
// 352^3 / 160^3 = 10.65: this is a little over ten times the former Auto
// *volumetric* sample density while remaining roughly 2.2x finer per axis.
// Ten times finer on every axis would require one thousand times the memory
// and cutter work, which is not a safe interactive default.
const AUTO_LONGEST_SIDE_CELLS: f64 = 352.0;
const MAX_SWEEP_SAMPLES: usize = 2_000_000;
/// Matches the native transient triangle budget. Greedy meshing normally
/// keeps a rectangular 3-axis stock far below this limit.
const MAX_SURFACE_TRIANGLES: usize = 65_536;
/// Tessellation budget for a modeled body used as stock.
const MAX_STOCK_MESH_TRIANGLES: usize = 20_000;
/// Hard cap on triangle-to-column intersection tests while voxelizing a
/// modeled stock body, so a pathological mesh fails instead of hanging.
const MAX_STOCK_VOXELIZE_TESTS: usize = 50_000_000;
const MAX_TARGET_MESHES: usize = 64;
const MAX_VERIFICATION_CACHE_ENTRIES: usize = 8;
const MAX_VERIFICATION_CACHE_KEY_BYTES: usize = 128;
/// Operation-boundary stock checkpoints are bitsets (one bit per voxel), not
/// triangle meshes. Keep enough for normal setup switching while bounding the
/// process-wide cache on large professional jobs.
const MAX_STAGE_CACHE_ENTRIES: usize = 4;
const MAX_STAGE_CACHE_BYTES: usize = 32 * 1024 * 1024;
const EPSILON: f64 = 1.0e-9;
const DEFAULT_COMPARISON_TOLERANCE_MM: f64 = 0.1;
const DISPLAY_SURFACE_SMOOTHING: f64 = 0.72;

#[cfg(test)]
thread_local! { static MESH_EXTRACTIONS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

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

/// Intended finished-part geometry and the dimensional band used when
/// comparing it with simulated remaining stock. Meshes are closed triangle
/// soups in model coordinates; multiple meshes are voxelized as a union.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamSimulationTargetDto {
    /// Opaque host-owned identity for target geometry and comparison inputs.
    /// A playback frame may omit `meshes` after a complete request has
    /// prepared this key. The simulator keeps only a small bounded cache.
    #[serde(default)]
    pub cache_key: Option<String>,
    #[serde(default)]
    pub meshes: Vec<CamStockMeshDto>,
    /// Requested radial comparison tolerance in millimetres. The effective
    /// value can be larger when the voxel grid cannot resolve this request.
    #[serde(default = "default_comparison_tolerance_mm")]
    pub tolerance_mm: f64,
}

fn default_comparison_tolerance_mm() -> f64 {
    DEFAULT_COMPARISON_TOLERANCE_MM
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
    /// Optional intended finished-part input. When present, the simulator
    /// classifies excess material and protected target loss and attributes
    /// target loss to the physical motion block that caused it.
    #[serde(default)]
    pub target: Option<CamSimulationTargetDto>,
    /// Simulate only through this operation (inclusive, in the setup's
    /// operation order): the remaining-stock view of a selected operation
    /// must not show material that later operations have not removed yet.
    /// Omitted simulates the whole program.
    #[serde(default)]
    pub through_operation_id: Option<u64>,
    /// Playback frame request: execute only the first N physical timeline
    /// steps. Omitted computes the complete program. Stock therefore updates
    /// at deterministic motion-block boundaries while the presentation layer
    /// interpolates the tool continuously between them.
    #[serde(default)]
    pub completed_steps: Option<usize>,
    /// CAM playback: stock at a physical timeline time, including a partial
    /// line/arc sweep. Uses prepared physical moves, not the programmed
    /// (potentially uncompensated) coordinates.
    #[serde(default)]
    pub playback_time_seconds: Option<f64>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamSimulationSourceDto {
    #[default]
    CamToolpath,
    GCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamSimulationStepKind {
    Position,
    Rapid,
    Linear,
    Circular,
    Dwell,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamSimulationStepDto {
    pub command_index: usize,
    /// NC sequence number when present, otherwise the physical source line.
    /// CAM-predicted motion has no text authority and leaves this empty.
    #[serde(default)]
    pub source_line: Option<u32>,
    pub kind: CamSimulationStepKind,
    #[serde(default)]
    pub tool_id: Option<u64>,
    pub from: Option<Point3Dto>,
    pub to: Option<Point3Dto>,
    #[serde(default)]
    pub center: Option<Point3Dto>,
    #[serde(default)]
    pub clockwise: Option<bool>,
    #[serde(default)]
    pub plane: Option<CamArcPlane>,
    pub duration_seconds: f64,
    pub cumulative_seconds: f64,
    pub removed_voxels: usize,
    /// Protected target cells removed by this physical step. The protection
    /// band is derived from the result's effective comparison tolerance.
    #[serde(default)]
    pub gouged_voxels: usize,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamSimulationCollisionKindDto {
    #[default]
    RapidStockContact,
    TargetGouge,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamSimulationCollisionDto {
    #[serde(default)]
    pub kind: CamSimulationCollisionKindDto,
    pub command_index: usize,
    pub position: Point3Dto,
    pub message: String,
}

/// Final remaining-stock comparison against the intended part. `excess_mesh`
/// contains remaining material outside the accepted target band;
/// `gouge_mesh` occupies protected target volume removed by the program, so
/// an otherwise empty overcut stays visible to the presentation layer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamSimulationComparisonDto {
    pub requested_tolerance_mm: f64,
    pub effective_tolerance_mm: f64,
    pub target_voxels: usize,
    pub excess_voxels: usize,
    pub gouged_voxels: usize,
    pub initial_shortfall_voxels: usize,
    pub target_volume_mm3: f64,
    pub excess_volume_mm3: f64,
    pub gouged_volume_mm3: f64,
    pub initial_shortfall_volume_mm3: f64,
    pub excess_mesh: Option<CamSimulationMeshDto>,
    pub gouge_mesh: Option<CamSimulationMeshDto>,
}

/// Triangle soup in setup coordinates. This maps directly to the existing
/// native Bevy transient-triangle contract and is also usable by browser
/// preview renderers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamSimulationMeshDto {
    pub positions: Vec<f32>,
    /// Optional per-vertex normals, packed one-for-one with `positions`.
    /// The display extractor populates these from the occupancy gradient;
    /// verification continues to use the untouched conservative bitset.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub normals: Vec<f32>,
    pub triangle_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamSimulationResultDto {
    pub setup_id: u64,
    #[serde(default)]
    pub source: CamSimulationSourceDto,
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
    /// The desktop host can retain the stock mesh directly in Bevy and omit it
    /// from the JSON result. Browser/WASM hosts leave this false and continue
    /// consuming `stock_mesh` normally.
    #[serde(default)]
    pub native_stock_present: bool,
    #[serde(default)]
    pub comparison: Option<CamSimulationComparisonDto>,
    /// Echo of the request's truncation target, so the host can keep a stale
    /// result from painting over a freshly changed operation selection.
    pub through_operation_id: Option<u64>,
    /// Echo of a playback-frame request. `None` means the stock/timeline is
    /// the complete simulation; `Some(n)` means at most N steps were run.
    #[serde(default)]
    pub completed_steps: Option<usize>,
    pub warnings: Vec<String>,
}

/// Cooperative latest-request cancellation for native background simulation.
/// Browser/WASM callers keep using [`simulate_setup`] and pay no atomic checks.
#[derive(Debug, Clone, Default)]
pub struct CamSimulationCancellation {
    cancelled: Arc<AtomicBool>,
}

impl CamSimulationCancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    fn check(&self) -> Result<(), CamPlanError> {
        if self.is_cancelled() {
            Err(CamPlanError(
                "CAM simulation superseded by a newer request".to_string(),
            ))
        } else {
            Ok(())
        }
    }
}

pub fn simulate_setup(
    document: &CamDocumentDto,
    request: &CamSimulationRequestDto,
) -> Result<CamSimulationResultDto, CamPlanError> {
    simulate_setup_with_cancellation(document, request, None)
}

/// Native/worker entry point. The numerical result is identical to
/// [`simulate_setup`], but long cutter sweeps yield promptly when a newer UI
/// request supersedes this one.
pub fn simulate_setup_with_cancellation(
    document: &CamDocumentDto,
    request: &CamSimulationRequestDto,
    cancellation: Option<&CamSimulationCancellation>,
) -> Result<CamSimulationResultDto, CamPlanError> {
    if let Some(cancellation) = cancellation {
        cancellation.check()?;
    }
    // Check before a cached result/frame can bypass the planner's support gate.
    crate::machine::ensure_setup_machines_supported(document, request.setup_id)?;
    if request
        .voxel_size
        .is_some_and(|size| !size.is_finite() || size <= 0.0)
    {
        return Err(CamPlanError(
            "simulation voxel size must be finite and positive".into(),
        ));
    }
    if let Some(time) = request.playback_time_seconds {
        return frame::simulate(document, request, time, cancellation);
    }
    let key = cache::key(document, request)?;
    if let Some(result) = cache::get(&key) {
        return Ok(result);
    }
    let setup = document
        .setup(request.setup_id)
        .ok_or_else(|| CamPlanError(format!("CAM setup {} does not exist", request.setup_id)))?;
    let mut program = if request.completed_steps == Some(0) {
        // Incoming stock needs no toolpaths, including a newly-created empty
        // setup. Do not generate an entire roughing program just to show it.
        CamProgramDto {
            setup_id: setup.id,
            name: setup.name.clone(),
            commands: Vec::new(),
            stats: Default::default(),
            per_operation: Vec::new(),
            work_offsets: setup.work_offsets(),
            warnings: Vec::new(),
        }
    } else if let Some(through) = request.through_operation_id {
        crate::plan_setup_through(document, request.setup_id, through)?
    } else {
        plan_setup(document, request.setup_id)?
    };
    if let Some(through) = request.through_operation_id {
        truncate_program_through(setup, &mut program, through)?;
    }
    let result = simulate_program_with_cancellation(
        document,
        setup,
        &program,
        request,
        CamSimulationSourceDto::CamToolpath,
        &[],
        cancellation,
    )?;
    if let Some(cancellation) = cancellation {
        cancellation.check()?;
    }
    cache::insert(key, &result);
    Ok(result)
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
            CamCommandDto::SectionEnd if current.is_some_and(|pos| pos <= target) => {
                end = index + 1;
            }
            _ => {}
        }
    }
    program.commands.truncate(end);
    Ok(())
}

pub(crate) fn simulate_program(
    document: &CamDocumentDto,
    setup: &CamSetupDto,
    program: &CamProgramDto,
    request: &CamSimulationRequestDto,
    source: CamSimulationSourceDto,
    source_lines: &[Option<u32>],
) -> Result<CamSimulationResultDto, CamPlanError> {
    simulate_program_with_cancellation(
        document,
        setup,
        program,
        request,
        source,
        source_lines,
        None,
    )
}

fn simulate_program_with_cancellation(
    document: &CamDocumentDto,
    setup: &CamSetupDto,
    program: &CamProgramDto,
    request: &CamSimulationRequestDto,
    source: CamSimulationSourceDto,
    source_lines: &[Option<u32>],
    cancellation: Option<&CamSimulationCancellation>,
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
    if let Some(cancellation) = cancellation {
        cancellation.check()?;
    }
    if source == CamSimulationSourceDto::CamToolpath {
        if let Some(cached) = resolve_stage_cache(document, setup, &spec, request) {
            if let Some((stock, outcome)) = cached.state_for(setup, request) {
                return finish_simulation_result(
                    setup,
                    program,
                    request,
                    source,
                    stock,
                    cached.initial_voxels,
                    &cached.initial_stock_words,
                    cached.verification.as_deref(),
                    outcome,
                    cancellation,
                );
            }
            let mut resume_request = request.clone();
            let extend_stages = request.completed_steps.is_none();
            if extend_stages {
                resume_request.completed_steps = Some(usize::MAX);
            }
            if let Some((mut stock, resume)) = cached.resume_for(setup, program, &resume_request) {
                let mut checkpoints = cached.checkpoints.clone();
                let outcome = run_program(
                    document,
                    program,
                    &mut stock,
                    ProgramRunOptions {
                        collect: true,
                        completed_steps: request.completed_steps,
                        source_lines,
                        verification: cached.verification.as_deref(),
                        checkpoints: extend_stages.then_some(&mut checkpoints),
                        cancellation,
                        resume: Some(resume),
                    },
                )?;
                if extend_stages {
                    let mut extended = (*cached).clone();
                    extended.through_operation_id = request.through_operation_id;
                    extended.checkpoints = checkpoints;
                    extended.final_stock = stock.clone();
                    extended.final_outcome = outcome.clone();
                    store_stage_cache(extended);
                }
                return finish_simulation_result(
                    setup,
                    program,
                    request,
                    source,
                    stock,
                    cached.initial_voxels,
                    &cached.initial_stock_words,
                    cached.verification.as_deref(),
                    outcome,
                    cancellation,
                );
            }
        }
    }
    let mut stock = initial_stock(
        document,
        setup,
        &spec,
        request.stock_mesh.as_ref(),
        cancellation,
    )?;
    let initial_voxels = stock.occupied_count;
    let initial_stock_words = stock.occupied.clone();
    let initial_stock = stock.clone();
    let verification = request
        .target
        .as_ref()
        .map(|target| resolve_verification_grid(setup, &spec, target))
        .transpose()?;
    if let Some(cancellation) = cancellation {
        cancellation.check()?;
    }
    let capture_stages = source == CamSimulationSourceDto::CamToolpath
        && request.completed_steps.is_none()
        && stage_cache_key(request).is_some();
    let mut checkpoints = Vec::new();
    let outcome = run_program(
        document,
        program,
        &mut stock,
        ProgramRunOptions {
            collect: true,
            completed_steps: request.completed_steps,
            source_lines,
            verification: verification.as_deref(),
            checkpoints: capture_stages.then_some(&mut checkpoints),
            cancellation,
            resume: None,
        },
    )?;

    if capture_stages {
        store_stage_cache(SimulationStageCacheEntry {
            document: document.clone(),
            document_bytes: serde_json::to_vec(document)
                .map_or(MAX_STAGE_CACHE_BYTES, |bytes| bytes.len()),
            through_operation_id: request.through_operation_id,
            key: stage_cache_key(request).expect("capture requires a cache key"),
            setup_id: setup.id,
            min: spec.min,
            dimensions: spec.dimensions,
            cell_size: spec.cell_size,
            wcs: setup.wcs,
            requested_tolerance_mm: request.target.as_ref().map(|target| target.tolerance_mm),
            initial_voxels,
            initial_stock_words: initial_stock_words.clone(),
            initial_stock,
            verification: verification.clone(),
            checkpoints,
            final_stock: stock.clone(),
            final_outcome: outcome.clone(),
        });
    }

    finish_simulation_result(
        setup,
        program,
        request,
        source,
        stock,
        initial_voxels,
        &initial_stock_words,
        verification.as_deref(),
        outcome,
        cancellation,
    )
}

#[allow(clippy::too_many_arguments)]
fn finish_simulation_result(
    setup: &CamSetupDto,
    program: &CamProgramDto,
    request: &CamSimulationRequestDto,
    source: CamSimulationSourceDto,
    stock: VoxelStock,
    initial_voxels: usize,
    initial_stock_words: &[u64],
    verification: Option<&VerificationGrid>,
    outcome: ProgramRunOutcome,
    cancellation: Option<&CamSimulationCancellation>,
) -> Result<CamSimulationResultDto, CamPlanError> {
    let mut warnings = program.warnings.clone();
    warnings.extend(stock.mesh_quality_warnings.iter().cloned());
    if let Some(target) = verification {
        warnings.extend(target.target.mesh_quality_warnings.iter().cloned());
    }
    if outcome.approximated_drill {
        warnings.push(
            "Drill stock removal assumes a conventional 118-degree point because the tool point angle is not set."
                .to_string(),
        );
    }
    warnings.push(format!(
        "3D stock is voxelized at {:.3} × {:.3} × {:.3} mm per cell ({} × {} × {} cells); displayed boundaries and remaining-stock measurements can vary by about one cell.",
        stock.cell_size[0],
        stock.cell_size[1],
        stock.cell_size[2],
        stock.dimensions[0],
        stock.dimensions[1],
        stock.dimensions[2],
    ));
    if !stock.display_cuts.is_empty() {
        warnings.push("Stock display uses bounded cutter-profile reconstruction for drill points, chamfers and rounded corners; this does not increase verification accuracy or guarantee features smaller than a voxel. Modeled stock retains grid-based detail; over-budget sweep histories or refinement work fall back to a complete grid surface.".into());
    }
    if verification.is_none() {
        warnings.push(
            "No finished-part target was supplied, so this run measures stock removal without excess-material or gouge verification."
                .to_string(),
        );
    }
    warnings.push(
        "Fixture, shank, holder, and machine-envelope checks are not active in this workpiece simulation."
            .to_string(),
    );

    let remaining_voxels = stock.occupied_count;
    let removed_voxels = initial_voxels - remaining_voxels;
    let completed_step_count = outcome.steps.len();
    let voxel_volume = stock.cell_size.iter().product::<f64>();
    if let Some(cancellation) = cancellation {
        cancellation.check()?;
    }
    let stock_mesh = Some(stock.presentation_mesh(MAX_SURFACE_TRIANGLES, &mut warnings)?);
    if let Some(cancellation) = cancellation {
        cancellation.check()?;
    }
    let comparison = verification
        .filter(|_| request.playback_time_seconds.is_none())
        .map(|target| comparison_result(&stock, initial_stock_words, target, &mut warnings));

    Ok(CamSimulationResultDto {
        setup_id: setup.id,
        source,
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
        native_stock_present: false,
        comparison,
        through_operation_id: request.through_operation_id,
        completed_steps: request.completed_steps.map(|_| completed_step_count),
        warnings,
    })
}

#[derive(Clone, Default)]
struct ProgramRunOutcome {
    steps: Vec<CamSimulationStepDto>,
    collisions: Vec<CamSimulationCollisionDto>,
    cumulative_seconds: f64,
    approximated_drill: bool,
}

impl ProgramRunOutcome {
    fn byte_size(&self) -> usize {
        self.steps.len() * std::mem::size_of::<CamSimulationStepDto>()
            + self.collisions.len() * std::mem::size_of::<CamSimulationCollisionDto>()
            + self
                .collisions
                .iter()
                .map(|collision| collision.message.len())
                .sum::<usize>()
    }
}

#[derive(Clone)]
struct SimulationStageCheckpoint {
    operation_id: u64,
    next_command_index: usize,
    position: Option<Point3Dto>,
    active_tool_id: Option<u64>,
    sweep_samples: usize,
    stock: VoxelStock,
    outcome: ProgramRunOutcome,
}

struct ProgramResumeState {
    next_command_index: usize,
    position: Option<Point3Dto>,
    active_tool_id: Option<u64>,
    sweep_samples: usize,
    outcome: ProgramRunOutcome,
}

#[derive(Clone)]
struct SimulationStageCacheEntry {
    document: CamDocumentDto,
    document_bytes: usize,
    through_operation_id: Option<u64>,
    key: String,
    setup_id: u64,
    min: Point3Dto,
    dimensions: [usize; 3],
    cell_size: [f64; 3],
    wcs: WorkCoordinateSystemDto,
    requested_tolerance_mm: Option<f64>,
    initial_voxels: usize,
    initial_stock_words: Vec<u64>,
    initial_stock: VoxelStock,
    verification: Option<Arc<VerificationGrid>>,
    checkpoints: Vec<SimulationStageCheckpoint>,
    final_stock: VoxelStock,
    final_outcome: ProgramRunOutcome,
}

impl SimulationStageCacheEntry {
    fn compatible(
        &self,
        setup: &CamSetupDto,
        spec: &GridSpec,
        request: &CamSimulationRequestDto,
    ) -> bool {
        self.setup_id == setup.id
            && self.min == spec.min
            && self.dimensions == spec.dimensions
            && self.cell_size == spec.cell_size
            && self.wcs == setup.wcs
            && self.requested_tolerance_mm
                == request.target.as_ref().map(|target| target.tolerance_mm)
    }

    fn state_for(
        &self,
        setup: &CamSetupDto,
        request: &CamSimulationRequestDto,
    ) -> Option<(VoxelStock, ProgramRunOutcome)> {
        if request.completed_steps == Some(0) {
            return Some((self.initial_stock.clone(), ProgramRunOutcome::default()));
        }
        if request.completed_steps.is_some() {
            return None;
        }
        if let Some(prepared_through) = self.through_operation_id {
            let prepared = setup
                .operations
                .iter()
                .position(|op| op.id() == prepared_through)?;
            let requested = setup
                .operations
                .iter()
                .position(|op| Some(op.id()) == request.through_operation_id)?;
            if requested > prepared {
                return None;
            }
        }
        let Some(through) = request.through_operation_id else {
            return Some((self.final_stock.clone(), self.final_outcome.clone()));
        };
        let target = setup
            .operations
            .iter()
            .position(|operation| operation.id() == through)?;
        let Some(last_enabled) = setup.operations[..=target]
            .iter()
            .rev()
            .find(|operation| operation.enabled())
        else {
            return Some((self.initial_stock.clone(), ProgramRunOutcome::default()));
        };
        self.checkpoints
            .iter()
            .rev()
            .find(|checkpoint| checkpoint.operation_id == last_enabled.id())
            .map(|checkpoint| (checkpoint.stock.clone(), checkpoint.outcome.clone()))
    }

    fn resume_for(
        &self,
        setup: &CamSetupDto,
        program: &CamProgramDto,
        request: &CamSimulationRequestDto,
    ) -> Option<(VoxelStock, ProgramResumeState)> {
        let completed_steps = request.completed_steps?;
        if completed_steps == 0 {
            return None;
        }
        let through_position = request.through_operation_id.and_then(|through| {
            setup
                .operations
                .iter()
                .position(|operation| operation.id() == through)
        });
        let checkpoint = self.checkpoints.iter().rev().find(|checkpoint| {
            checkpoint.outcome.steps.len() <= completed_steps
                && checkpoint.next_command_index <= program.commands.len()
                && through_position.is_none_or(|target| {
                    setup
                        .operations
                        .iter()
                        .position(|operation| operation.id() == checkpoint.operation_id)
                        .is_some_and(|position| position <= target)
                })
        });
        if let Some(checkpoint) = checkpoint {
            return Some((
                checkpoint.stock.clone(),
                ProgramResumeState {
                    next_command_index: checkpoint.next_command_index,
                    position: checkpoint.position,
                    active_tool_id: checkpoint.active_tool_id,
                    sweep_samples: checkpoint.sweep_samples,
                    outcome: checkpoint.outcome.clone(),
                },
            ));
        }
        Some((
            self.initial_stock.clone(),
            ProgramResumeState {
                next_command_index: 0,
                position: None,
                active_tool_id: None,
                sweep_samples: 0,
                outcome: ProgramRunOutcome::default(),
            },
        ))
    }

    fn byte_size(&self) -> usize {
        let stock_bytes = |stock: &VoxelStock| {
            stock.occupied.len() * std::mem::size_of::<u64>() + stock.display_cuts.bytes()
        };
        stock_bytes(&self.initial_stock)
            + stock_bytes(&self.final_stock)
            + self.document_bytes
            + self.final_outcome.byte_size()
            + self
                .checkpoints
                .iter()
                .map(|checkpoint| stock_bytes(&checkpoint.stock) + checkpoint.outcome.byte_size())
                .sum::<usize>()
            + self.initial_stock_words.len() * std::mem::size_of::<u64>()
    }
}

fn stage_cache_key(request: &CamSimulationRequestDto) -> Option<String> {
    request
        .target
        .as_ref()?
        .cache_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_string)
}

fn simulation_stage_cache() -> &'static Mutex<VecDeque<Arc<SimulationStageCacheEntry>>> {
    static CACHE: OnceLock<Mutex<VecDeque<Arc<SimulationStageCacheEntry>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(VecDeque::new()))
}

fn resolve_stage_cache(
    document: &CamDocumentDto,
    setup: &CamSetupDto,
    spec: &GridSpec,
    request: &CamSimulationRequestDto,
) -> Option<Arc<SimulationStageCacheEntry>> {
    let key = stage_cache_key(request)?;
    let mut cache = simulation_stage_cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let index = cache.iter().position(|entry| entry.key == key)?;
    let entry = cache.remove(index).expect("cache index came from position");
    if crate::machine::motion_document(&entry.document) != crate::machine::motion_document(document)
        || !entry.compatible(setup, spec, request) {
        return None;
    }
    cache.push_back(Arc::clone(&entry));
    Some(entry)
}

fn store_stage_cache(entry: SimulationStageCacheEntry) {
    let entry = Arc::new(entry);
    if entry.byte_size() > MAX_STAGE_CACHE_BYTES {
        return;
    }
    let mut cache = simulation_stage_cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    cache.retain(|existing| existing.key != entry.key);
    cache.push_back(entry);
    while cache.len() > MAX_STAGE_CACHE_ENTRIES
        || cache.iter().map(|entry| entry.byte_size()).sum::<usize>() > MAX_STAGE_CACHE_BYTES
    {
        cache.pop_front();
    }
}

struct SimulationStepRecord {
    command_index: usize,
    kind: CamSimulationStepKind,
    tool_id: Option<u64>,
    from: Option<Point3Dto>,
    to: Option<Point3Dto>,
    center: Option<Point3Dto>,
    clockwise: Option<bool>,
    plane: Option<CamArcPlane>,
    duration_seconds: f64,
    removed_voxels: usize,
    gouged_voxels: usize,
}

impl ProgramRunOutcome {
    fn step_budget_reached(&self, collect: bool, completed_steps: Option<usize>) -> bool {
        collect && completed_steps.is_some_and(|limit| self.steps.len() >= limit)
    }

    fn record_step(&mut self, record: SimulationStepRecord, source_lines: &[Option<u32>]) {
        self.cumulative_seconds += record.duration_seconds;
        self.steps.push(CamSimulationStepDto {
            command_index: record.command_index,
            source_line: source_lines.get(record.command_index).copied().flatten(),
            kind: record.kind,
            tool_id: record.tool_id,
            from: record.from,
            to: record.to,
            center: record.center,
            clockwise: record.clockwise,
            plane: record.plane,
            duration_seconds: record.duration_seconds,
            cumulative_seconds: self.cumulative_seconds,
            removed_voxels: record.removed_voxels,
            gouged_voxels: record.gouged_voxels,
        });
    }

    fn record_target_gouge(
        &mut self,
        command_index: usize,
        tool: &CamToolDto,
        sweep: &SweepOutcome,
    ) {
        let Some(position) = sweep.first_gouge else {
            return;
        };
        if self.collisions.iter().any(|issue| {
            issue.kind == CamSimulationCollisionKindDto::TargetGouge
                && issue.command_index == command_index
        }) {
            return;
        }
        self.collisions.push(CamSimulationCollisionDto {
            kind: CamSimulationCollisionKindDto::TargetGouge,
            command_index,
            position,
            message: format!(
                "cutting motion removes protected target material with tool {}",
                tool.label()
            ),
        });
    }
}

/// Motion buffered while cutter compensation is active. Lines/circles are
/// offset and intersected analytically when the block closes; only the final
/// centerline is sampled for the stock sweep.
enum CompMove {
    Line(Point3Dto),
    Arc {
        center: crate::model::Point2Dto,
        clockwise: bool,
        to: Point3Dto,
    },
}

struct ProgramRunOptions<'a> {
    collect: bool,
    completed_steps: Option<usize>,
    source_lines: &'a [Option<u32>],
    verification: Option<&'a VerificationGrid>,
    checkpoints: Option<&'a mut Vec<SimulationStageCheckpoint>>,
    cancellation: Option<&'a CamSimulationCancellation>,
    resume: Option<ProgramResumeState>,
}

/// Sweep the program through the stock. With `collect` false (evaluating a
/// rest-stock source setup) only material removal runs: steps, collision
/// reporting, and rapid sweeps are skipped because the source setup's own
/// simulation already reported them.
fn run_program(
    document: &CamDocumentDto,
    program: &CamProgramDto,
    stock: &mut VoxelStock,
    options: ProgramRunOptions<'_>,
) -> Result<ProgramRunOutcome, CamPlanError> {
    let ProgramRunOptions {
        collect,
        completed_steps,
        source_lines,
        verification,
        mut checkpoints,
        cancellation,
        resume,
    } = options;
    let (start_command_index, mut position, active_tool_id, mut sweep_samples, mut outcome) =
        resume
            .map(|resume| {
                (
                    resume.next_command_index,
                    resume.position,
                    resume.active_tool_id,
                    resume.sweep_samples,
                    resume.outcome,
                )
            })
            .unwrap_or((0, None, None, 0, ProgramRunOutcome::default()));
    let mut active_tool: Option<&CamToolDto> = active_tool_id.and_then(|id| document.tool(id));
    // Machine-side cutter compensation (in-control contour sections): the
    // programmed path is the part contour, so the compensated centerline is
    // reconstructed here with normal controller approach/retract behavior:
    // the activation move runs from the uncompensated anchor to the first
    // compensated point, the following contour is offset by the tool radius,
    // and cancellation returns from the final compensated point. `comp_tool`
    // is the tool that was active when compensation began.
    let mut comp_side: Option<bool> = None;
    let mut comp_anchor: Option<Point3Dto> = None;
    let mut comp_tool: Option<&CamToolDto> = None;
    let mut comp_buffer: Vec<(usize, CompMove, f64)> = Vec::new();
    // The tool's true position right after a compensation block closes (the
    // compensated end point): the move that follows — the lead-out — starts
    // there while the offset slides back to the programmed point.
    let mut compensated_position: Option<Point3Dto> = None;
    let mut current_operation_id: Option<u64> = None;

    for (command_index, command) in program
        .commands
        .iter()
        .enumerate()
        .skip(start_command_index)
    {
        if let Some(cancellation) = cancellation {
            cancellation.check()?;
        }
        match command {
            CamCommandDto::ToolChange { tool_id, .. } => {
                active_tool = document.tool(*tool_id);
            }
            CamCommandDto::CutterCompensationOn { left } => {
                if comp_side.is_some() {
                    return Err(CamPlanError(
                        "simulation: cutter compensation activated twice without cancellation"
                            .to_string(),
                    ));
                }
                comp_side = Some(*left);
                comp_anchor = position;
                comp_tool = active_tool;
                comp_buffer.clear();
            }
            CamCommandDto::CutterCompensationOff => {
                let left = comp_side.take().ok_or_else(|| {
                    CamPlanError(
                        "simulation: cutter compensation cancelled without activation".to_string(),
                    )
                })?;
                let anchor = comp_anchor.take().ok_or_else(|| {
                    CamPlanError(
                        "simulation: cutter compensation activated without a known position"
                            .to_string(),
                    )
                })?;
                let tool = comp_tool.take().ok_or_else(|| {
                    CamPlanError(
                        "simulation: cutter compensation activated without a tool".to_string(),
                    )
                })?;
                // The first buffered LINEAR is the G41/G42 activation move.
                // With the controller's normal approach behavior, the tool
                // travels from the uncompensated anchor directly to the
                // compensated starting position; compensation is not already
                // at full radius at the anchor. The remaining programmed
                // contour is offset as one path. This distinction is crucial
                // for large tools: offsetting the anchor itself invents a
                // diagonal lead transition that can gouge the part corner.
                let depth = anchor.z;
                let Some((entry, compensated_moves)) = comp_buffer.split_first() else {
                    return Err(CamPlanError(
                        "simulation: cutter compensation has no activation move".to_string(),
                    ));
                };
                let (entry_index, entry_target, entry_feed) = match entry {
                    (index, CompMove::Line(to), feed) => (*index, *to, *feed),
                    _ => {
                        return Err(CamPlanError(
                            "simulation: cutter compensation must activate on a linear move"
                                .to_string(),
                        ));
                    }
                };
                if (entry_target.z - depth).abs() > 1.0e-6 {
                    return Err(CamPlanError(
                        "simulation: cutter compensation activation must stay at constant depth"
                            .to_string(),
                    ));
                }
                let mut moves = Vec::with_capacity(compensated_moves.len());
                for (_, buffered, _) in compensated_moves {
                    let (to, motion) = match buffered {
                        CompMove::Line(to) => (*to, crate::compensation::ProfileMove::Line(
                            crate::model::Point2Dto::new(to.x, to.y))),
                        CompMove::Arc { center, clockwise, to } => (*to, crate::compensation::ProfileMove::Arc {
                            center: *center, clockwise: *clockwise, to: crate::model::Point2Dto::new(to.x,to.y),
                        }),
                    };
                    if (to.z-depth).abs() > 1e-6 {
                        return Err(CamPlanError("simulation: cutter compensation only applies to constant-depth profiling moves".into()));
                    }
                    moves.push(motion);
                }
                let (offset, source_moves) = crate::compensation::intersection_path(
                    crate::model::Point2Dto::new(entry_target.x,entry_target.y),
                    &moves, tool.diameter*0.5, left,
                )?;
                let seg_meta: Vec<_> = source_moves.into_iter().map(|i| {
                    let (index, _, feed) = compensated_moves[i];
                    (index, feed)
                }).collect();
                let compensated_start = Point3Dto::new(offset[0].x, offset[0].y, depth);
                note_approximation(tool, &mut outcome.approximated_drill);
                if outcome.step_budget_reached(collect, completed_steps) {
                    return Ok(outcome);
                }
                let entry_sweep = stock.sweep_tool(
                    tool,
                    anchor,
                    compensated_start,
                    ToolSweepOptions {
                        mode: SweepMode::RemoveMaterial,
                        total_samples: &mut sweep_samples,
                        verification,
                        cancellation,
                    },
                )?;
                if collect {
                    outcome.record_target_gouge(entry_index, tool, &entry_sweep);
                    let duration = distance(anchor, compensated_start) / entry_feed * 60.0;
                    outcome.record_step(
                        SimulationStepRecord {
                            command_index: entry_index,
                            kind: CamSimulationStepKind::Linear,
                            tool_id: Some(tool.id),
                            from: Some(anchor),
                            to: Some(compensated_start),
                            center: None,
                            clockwise: None,
                            plane: None,
                            duration_seconds: duration,
                            removed_voxels: entry_sweep.removed,
                            gouged_voxels: entry_sweep.gouged,
                        },
                        source_lines,
                    );
                }
                for (index, (buffered_index, feed)) in seg_meta.iter().enumerate() {
                    if outcome.step_budget_reached(collect, completed_steps) {
                        return Ok(outcome);
                    }
                    let start = offset[index];
                    let end = offset[index + 1];
                    let from3 = Point3Dto::new(start.x, start.y, depth);
                    let to3 = Point3Dto::new(end.x, end.y, depth);
                    note_approximation(tool, &mut outcome.approximated_drill);
                    let sweep = stock.sweep_tool(
                        tool,
                        from3,
                        to3,
                        ToolSweepOptions {
                            mode: SweepMode::RemoveMaterial,
                            total_samples: &mut sweep_samples,
                            verification,
                            cancellation,
                        },
                    )?;
                    if collect {
                        outcome.record_target_gouge(*buffered_index, tool, &sweep);
                        let duration = distance(from3, to3) / *feed * 60.0;
                        outcome.record_step(
                            SimulationStepRecord {
                                command_index: *buffered_index,
                                kind: CamSimulationStepKind::Linear,
                                tool_id: Some(tool.id),
                                from: Some(from3),
                                to: Some(to3),
                                center: None,
                                clockwise: None,
                                plane: None,
                                duration_seconds: duration,
                                removed_voxels: sweep.removed,
                                gouged_voxels: sweep.gouged,
                            },
                            source_lines,
                        );
                    }
                }
                let last = offset[offset.len() - 1];
                compensated_position = Some(Point3Dto::new(last.x, last.y, depth));
                comp_buffer.clear();
            }
            CamCommandDto::SetPosition { to } => {
                if outcome.step_budget_reached(collect, completed_steps) {
                    return Ok(outcome);
                }
                if comp_side.is_some() {
                    return Err(CamPlanError(
                        "simulation: workpiece position reset while cutter compensation is active"
                            .to_string(),
                    ));
                }
                position = Some(*to);
                compensated_position = None;
                if collect {
                    outcome.record_step(
                        SimulationStepRecord {
                            command_index,
                            kind: CamSimulationStepKind::Position,
                            tool_id: active_tool.map(|tool| tool.id),
                            from: None,
                            to: Some(*to),
                            center: None,
                            clockwise: None,
                            plane: None,
                            duration_seconds: 0.0,
                            removed_voxels: 0,
                            gouged_voxels: 0,
                        },
                        source_lines,
                    );
                }
            }
            CamCommandDto::Rapid { to } => {
                if outcome.step_budget_reached(collect, completed_steps) {
                    return Ok(outcome);
                }
                if comp_side.is_some() {
                    return Err(CamPlanError(
                        "simulation: rapid motion while cutter compensation is active".to_string(),
                    ));
                }
                // A controller can cancel radius compensation on this rapid
                // block (for example `G0 G40 Z...`). The physical rapid starts
                // at the compensated endpoint, and consuming it here prevents
                // a later feed from sweeping a stale full-depth phantom cut.
                let from = compensated_position.take().or(position);
                let duration = from
                    .map(|start| distance(start, *to) / RAPID_FEED_ESTIMATE_MM_PER_MIN * 60.0)
                    .unwrap_or(0.0);
                if collect {
                    if let (Some(start), Some(tool)) = (from, active_tool) {
                        let sweep = stock.sweep_tool(
                            tool,
                            start,
                            *to,
                            ToolSweepOptions {
                                mode: SweepMode::CollisionOnly,
                                total_samples: &mut sweep_samples,
                                verification,
                                cancellation,
                            },
                        )?;
                        if let Some(hit) = sweep.first_contact {
                            outcome.collisions.push(CamSimulationCollisionDto {
                                kind: CamSimulationCollisionKindDto::RapidStockContact,
                                command_index,
                                position: hit,
                                message: format!(
                                    "rapid motion intersects remaining stock with tool {}",
                                    tool.label()
                                ),
                            });
                        }
                    }
                    outcome.record_step(
                        SimulationStepRecord {
                            command_index,
                            kind: CamSimulationStepKind::Rapid,
                            tool_id: active_tool.map(|tool| tool.id),
                            from,
                            to: Some(*to),
                            center: None,
                            clockwise: None,
                            plane: None,
                            duration_seconds: duration,
                            removed_voxels: 0,
                            gouged_voxels: 0,
                        },
                        source_lines,
                    );
                }
                position = Some(*to);
            }
            CamCommandDto::Linear { to, feed } => {
                if comp_side.is_some() {
                    // Compensation activates on this move: the control slides
                    // from the programmed anchor toward the compensated path.
                    // The buffer offsets analytic lines/circles before chord
                    // sampling when the block closes; joins use intersections.
                    comp_buffer.push((command_index, CompMove::Line(*to), *feed));
                    position = Some(*to);
                    continue;
                }
                if outcome.step_budget_reached(collect, completed_steps) {
                    return Ok(outcome);
                }
                let from = position;
                // The first move after a compensation block (the lead-out)
                // physically starts at the compensated end point and slides
                // back to the programmed path as the offset cancels.
                let sweep_from = compensated_position.take().or(from);
                let duration = sweep_from
                    .map(|start| distance(start, *to) / *feed * 60.0)
                    .unwrap_or(0.0);
                let sweep = if let (Some(start), Some(tool)) = (sweep_from, active_tool) {
                    note_approximation(tool, &mut outcome.approximated_drill);
                    stock.sweep_tool(
                        tool,
                        start,
                        *to,
                        ToolSweepOptions {
                            mode: SweepMode::RemoveMaterial,
                            total_samples: &mut sweep_samples,
                            verification,
                            cancellation,
                        },
                    )?
                } else {
                    SweepOutcome::default()
                };
                if collect {
                    if let Some(tool) = active_tool {
                        outcome.record_target_gouge(command_index, tool, &sweep);
                    }
                    outcome.record_step(
                        SimulationStepRecord {
                            command_index,
                            kind: CamSimulationStepKind::Linear,
                            tool_id: active_tool.map(|tool| tool.id),
                            from: sweep_from,
                            to: Some(*to),
                            center: None,
                            clockwise: None,
                            plane: None,
                            duration_seconds: duration,
                            removed_voxels: sweep.removed,
                            gouged_voxels: sweep.gouged,
                        },
                        source_lines,
                    );
                }
                position = Some(*to);
            }
            CamCommandDto::Circular {
                clockwise,
                plane,
                center,
                to,
                feed,
            } => {
                if comp_side.is_some() {
                    // Arc leads run with compensation already active; the
                    // move buffers and tessellates into chords when the
                    // block closes.
                    if *plane != CamArcPlane::Xy {
                        return Err(CamPlanError(
                            "simulation: cutter compensation only supports XY-plane arcs"
                                .to_string(),
                        ));
                    }
                    comp_buffer.push((
                        command_index,
                        CompMove::Arc {
                            center: crate::model::Point2Dto::new(center.x, center.y),
                            clockwise: *clockwise,
                            to: *to,
                        },
                        *feed,
                    ));
                    position = Some(*to);
                    continue;
                }
                if outcome.step_budget_reached(collect, completed_steps) {
                    return Ok(outcome);
                }
                let from = position;
                let (duration, sweep) = if let (Some(start), Some(tool)) = (from, active_tool) {
                    note_approximation(tool, &mut outcome.approximated_drill);
                    let arc = ArcSweep::new(start, *center, *to, *clockwise, *plane)?;
                    let duration = arc.length / *feed * 60.0;
                    let removed = stock.sweep_arc(
                        tool,
                        &arc,
                        SweepMode::RemoveMaterial,
                        &mut sweep_samples,
                        verification,
                        cancellation,
                    )?;
                    (duration, removed)
                } else {
                    (0.0, SweepOutcome::default())
                };
                if collect {
                    if let Some(tool) = active_tool {
                        outcome.record_target_gouge(command_index, tool, &sweep);
                    }
                    outcome.record_step(
                        SimulationStepRecord {
                            command_index,
                            kind: CamSimulationStepKind::Circular,
                            tool_id: active_tool.map(|tool| tool.id),
                            from,
                            to: Some(*to),
                            center: Some(*center),
                            clockwise: Some(*clockwise),
                            plane: Some(*plane),
                            duration_seconds: duration,
                            removed_voxels: sweep.removed,
                            gouged_voxels: sweep.gouged,
                        },
                        source_lines,
                    );
                }
                position = Some(*to);
            }
            CamCommandDto::Dwell { seconds } => {
                if outcome.step_budget_reached(collect, completed_steps) {
                    return Ok(outcome);
                }
                if collect {
                    outcome.record_step(
                        SimulationStepRecord {
                            command_index,
                            kind: CamSimulationStepKind::Dwell,
                            tool_id: active_tool.map(|tool| tool.id),
                            from: position,
                            to: position,
                            center: None,
                            clockwise: None,
                            plane: None,
                            duration_seconds: *seconds,
                            removed_voxels: 0,
                            gouged_voxels: 0,
                        },
                        source_lines,
                    );
                }
            }
            CamCommandDto::SectionEnd => {
                if comp_side.is_some() {
                    return Err(CamPlanError(
                        "simulation: cutter compensation still active at the end of a section"
                            .to_string(),
                    ));
                }
                if collect && completed_steps.is_none() {
                    if let (Some(operation_id), Some(checkpoints)) =
                        (current_operation_id.take(), checkpoints.as_deref_mut())
                    {
                        if !checkpoints
                            .iter()
                            .any(|checkpoint| checkpoint.operation_id == operation_id)
                            && checkpoints
                                .iter()
                                .map(|checkpoint| {
                                    checkpoint.stock.occupied.len() * 8
                                        + checkpoint.stock.display_cuts.bytes()
                                        + checkpoint.outcome.byte_size()
                                })
                                .sum::<usize>()
                                + stock.occupied.len() * 8
                                + stock.display_cuts.bytes()
                                + outcome.byte_size()
                                <= MAX_STAGE_CACHE_BYTES / 2
                        {
                            checkpoints.push(SimulationStageCheckpoint {
                                operation_id,
                                next_command_index: command_index + 1,
                                position,
                                active_tool_id: active_tool.map(|tool| tool.id),
                                sweep_samples,
                                stock: stock.clone(),
                                outcome: outcome.clone(),
                            });
                        }
                    }
                }
            }
            CamCommandDto::ProgramEnd => {
                if comp_side.is_some() {
                    return Err(CamPlanError(
                        "simulation: cutter compensation still active at program end".to_string(),
                    ));
                }
            }
            CamCommandDto::SectionStart { operation_id, .. } => {
                current_operation_id = Some(*operation_id);
            }
            CamCommandDto::ProgramStart { .. }
            | CamCommandDto::WorkOffset { .. }
            | CamCommandDto::Spindle { .. }
            | CamCommandDto::Coolant { .. } => {}
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
        let mut edge = requested_size.unwrap_or(max_extent / AUTO_LONGEST_SIDE_CELLS);
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
    cancellation: Option<&CamSimulationCancellation>,
) -> Result<VoxelStock, CamPlanError> {
    if let Some(cancellation) = cancellation {
        cancellation.check()?;
    }
    match &setup.resolved_stock {
        CamResolvedStockDto::Box => Ok(VoxelStock::filled(spec, |_| true)),
        CamResolvedStockDto::Cylinder { center, radius } => {
            let mut stock = VoxelStock::filled(spec, |point| {
                let dx = point.x - center.x;
                let dy = point.y - center.y;
                dx * dx + dy * dy <= radius * radius + EPSILON
            });
            stock.display_cuts.initial = Some(surface::StockBoundary::new(
                spec,
                setup.resolved_stock.clone(),
            ));
            Ok(stock)
        }
        CamResolvedStockDto::Hex {
            center,
            across_flats,
        } => {
            // Flats perpendicular to X; the other two slab normals sit at
            // +/-60 degrees from X.
            let half = across_flats / 2.0;
            let sin60 = 0.866_025_403_784_438_6;
            let mut stock = VoxelStock::filled(spec, |point| {
                let dx = point.x - center.x;
                let dy = point.y - center.y;
                dx.abs() <= half + EPSILON
                    && (0.5 * dx + sin60 * dy).abs() <= half + EPSILON
                    && (0.5 * dx - sin60 * dy).abs() <= half + EPSILON
            });
            stock.display_cuts.initial = Some(surface::StockBoundary::new(
                spec,
                setup.resolved_stock.clone(),
            ));
            Ok(stock)
        }
        CamResolvedStockDto::ModelBody { .. } => {
            let mesh = stock_mesh.ok_or_else(|| {
                CamPlanError(format!(
                    "setup '{}' uses a modeled body as stock; simulation needs the host to supply that body's mesh",
                    setup.name
                ))
            })?;
            voxelize_mesh_volume(setup, spec, mesh, "stock body", cancellation)
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
            let mut stock =
                initial_stock(document, source, &source_spec, stock_mesh, cancellation)?;
            let program = plan_setup(document, source.id)?;
            run_program(
                document,
                &program,
                &mut stock,
                ProgramRunOptions {
                    collect: false,
                    completed_steps: None,
                    source_lines: &[],
                    verification: None,
                    checkpoints: None,
                    cancellation,
                    resume: None,
                },
            )?;
            Ok(stock)
        }
    }
}

/// Voxelize a closed triangle mesh (model coordinates) into the setup grid
/// by casting a vertical ray through each XY column and filling between
/// sorted intersection pairs (even-odd rule).
fn voxelize_mesh_volume(
    setup: &CamSetupDto,
    spec: &GridSpec,
    mesh: &CamStockMeshDto,
    label: &str,
    cancellation: Option<&CamSimulationCancellation>,
) -> Result<VoxelStock, CamPlanError> {
    if !mesh.positions.len().is_multiple_of(3) || !mesh.indices.len().is_multiple_of(3) {
        return Err(CamPlanError(format!(
            "{label} mesh must contain xyz triples and complete triangles"
        )));
    }
    let vertex_count = mesh.positions.len() / 3;
    let triangle_count = mesh.indices.len() / 3;
    if triangle_count == 0 || triangle_count > MAX_STOCK_MESH_TRIANGLES {
        return Err(CamPlanError(format!(
            "{label} mesh must have 1..={MAX_STOCK_MESH_TRIANGLES} triangles"
        )));
    }
    if mesh
        .indices
        .iter()
        .any(|index| *index as usize >= vertex_count)
    {
        return Err(CamPlanError(format!(
            "{label} mesh indices reference missing vertices"
        )));
    }
    if !mesh.positions.iter().all(|value| value.is_finite()) {
        return Err(CamPlanError(format!(
            "{label} mesh vertices must be finite"
        )));
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
    for (triangle_index, triangle) in mesh.indices.chunks_exact(3).enumerate() {
        if triangle_index.is_multiple_of(64) {
            if let Some(cancellation) = cancellation {
                cancellation.check()?;
            }
        }
        let vertices = [
            to_setup(triangle[0]),
            to_setup(triangle[1]),
            to_setup(triangle[2]),
        ];
        let min_x = vertices.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
        let max_x = vertices
            .iter()
            .map(|p| p.x)
            .fold(f64::NEG_INFINITY, f64::max);
        let min_y = vertices.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
        let max_y = vertices
            .iter()
            .map(|p| p.y)
            .fold(f64::NEG_INFINITY, f64::max);
        let column_range = |min: f64, max: f64, origin: f64, cell: f64, count: usize| {
            let lo = ((min - origin) / cell).floor() as isize;
            let hi = ((max - origin) / cell).ceil() as isize;
            (lo.clamp(0, count as isize) as usize)..(hi.clamp(0, count as isize) as usize)
        };
        let xs = column_range(
            min_x,
            max_x,
            spec.min.x,
            spec.cell_size[0],
            spec.dimensions[0],
        );
        let ys = column_range(
            min_y,
            max_y,
            spec.min.y,
            spec.cell_size[1],
            spec.dimensions[1],
        );
        tests = tests.saturating_add(xs.len().saturating_mul(ys.len()));
        if tests > MAX_STOCK_VOXELIZE_TESTS {
            return Err(CamPlanError(format!(
                "{label} mesh is too complex to voxelize; supply a coarser tessellation"
            )));
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
    let mut odd_parity_columns = 0usize;
    for iy in 0..spec.dimensions[1] {
        if let Some(cancellation) = cancellation {
            cancellation.check()?;
        }
        for ix in 0..spec.dimensions[0] {
            let hits = &mut column_hits[ix + spec.dimensions[0] * iy];
            if hits.is_empty() {
                continue;
            }
            hits.sort_by(|a, b| a.total_cmp(b));
            hits.dedup_by(|a, b| (*a - *b).abs() <= z_epsilon);
            if !hits.len().is_multiple_of(2) {
                odd_parity_columns += 1;
            }
            if hits.len() < 2 {
                continue;
            }
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
    if odd_parity_columns > 0 {
        stock.mesh_quality_warnings.push(format!(
            "{label} voxelization found {odd_parity_columns} columns with unpaired surface crossings; check mesh closure or tessellation seams. Filled volume and verification can be incomplete near those columns."
        ));
    }
    Ok(stock)
}

struct VerificationGrid {
    target: VoxelStock,
    near_target: Vec<u64>,
    protected_target: Vec<u64>,
    requested_tolerance_mm: f64,
    effective_tolerance_mm: f64,
    clipped_to_stock_grid: bool,
    wcs: WorkCoordinateSystemDto,
}

impl VerificationGrid {
    fn protects(&self, index: usize) -> bool {
        self.protected_target[index / 64] & (1u64 << (index % 64)) != 0
    }
}

struct VerificationCacheEntry {
    key: String,
    grid: Arc<VerificationGrid>,
}

fn verification_cache() -> &'static Mutex<VecDeque<VerificationCacheEntry>> {
    static CACHE: OnceLock<Mutex<VecDeque<VerificationCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(VecDeque::new()))
}

fn resolve_verification_grid(
    setup: &CamSetupDto,
    spec: &GridSpec,
    input: &CamSimulationTargetDto,
) -> Result<Arc<VerificationGrid>, CamPlanError> {
    let cache_key = input
        .cache_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty());
    if input.cache_key.is_some() && cache_key.is_none() {
        return Err(CamPlanError(
            "simulation target cache key cannot be empty".to_string(),
        ));
    }
    if let Some(key) = cache_key {
        if key.len() > MAX_VERIFICATION_CACHE_KEY_BYTES || !key.is_ascii() {
            return Err(CamPlanError(format!(
                "simulation target cache key must be ASCII and no longer than {MAX_VERIFICATION_CACHE_KEY_BYTES} bytes"
            )));
        }
        let mut cache = verification_cache()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(index) = cache.iter().position(|entry| entry.key == key) {
            let entry = cache.remove(index).expect("cache index came from position");
            let compatible = entry.grid.target.min == spec.min
                && entry.grid.target.dimensions == spec.dimensions
                && entry.grid.target.cell_size == spec.cell_size
                && entry.grid.requested_tolerance_mm == input.tolerance_mm
                && entry.grid.wcs == setup.wcs;
            if compatible {
                let grid = Arc::clone(&entry.grid);
                cache.push_back(entry);
                return Ok(grid);
            }
        }
    }

    if input.meshes.is_empty() {
        return Err(CamPlanError(
            "simulation target cache is not prepared; run a complete target-mesh simulation before requesting playback frames"
                .to_string(),
        ));
    }
    let grid = Arc::new(build_verification_grid(setup, spec, input)?);
    if let Some(key) = cache_key {
        let mut cache = verification_cache()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        cache.retain(|entry| entry.key != key);
        cache.push_back(VerificationCacheEntry {
            key: key.to_string(),
            grid: Arc::clone(&grid),
        });
        while cache.len() > MAX_VERIFICATION_CACHE_ENTRIES {
            cache.pop_front();
        }
    }
    Ok(grid)
}

fn build_verification_grid(
    setup: &CamSetupDto,
    spec: &GridSpec,
    input: &CamSimulationTargetDto,
) -> Result<VerificationGrid, CamPlanError> {
    if !input.tolerance_mm.is_finite() || input.tolerance_mm < 0.0 {
        return Err(CamPlanError(
            "simulation comparison tolerance must be finite and non-negative".to_string(),
        ));
    }
    if input.meshes.is_empty() || input.meshes.len() > MAX_TARGET_MESHES {
        return Err(CamPlanError(format!(
            "simulation target must contain 1..={MAX_TARGET_MESHES} closed body meshes"
        )));
    }

    let mut target = VoxelStock::filled(spec, |_| false);
    let mut clipped_to_stock_grid = false;
    for (index, mesh) in input.meshes.iter().enumerate() {
        clipped_to_stock_grid |= mesh_extends_outside_grid(setup, spec, mesh);
        let volume = voxelize_mesh_volume(
            setup,
            spec,
            mesh,
            &format!("target body {}", index + 1),
            None,
        )?;
        target.union_assign(&volume);
    }
    if target.occupied_count == 0 {
        return Err(CamPlanError(
            "simulation target has no resolvable volume inside the stock grid; increase detail or verify the setup stock and target bodies"
                .to_string(),
        ));
    }

    // Voxel centers can be displaced from an exact surface by up to a cell
    // diagonal. Never claim a comparison band tighter than that geometric
    // uncertainty; echo both values so the UI can state this honestly.
    let cell_diagonal = spec
        .cell_size
        .iter()
        .map(|value| value * value)
        .sum::<f64>()
        .sqrt();
    let effective_tolerance_mm = input.tolerance_mm.max(cell_diagonal);
    let tolerance_sq = effective_tolerance_mm * effective_tolerance_mm;
    let distance_to_target = squared_distance_to_mask(&target, true, false);
    let distance_to_exterior = squared_distance_to_mask(&target, false, true);
    let mut near_target = vec![0u64; target.occupied.len()];
    let mut protected_target = vec![0u64; target.occupied.len()];
    let voxel_count = spec.dimensions.iter().product::<usize>();
    for index in 0..voxel_count {
        if distance_to_target[index] <= tolerance_sq + EPSILON {
            set_mask_bit(&mut near_target, index);
        }
        if target.is_occupied_index(index) && distance_to_exterior[index] > tolerance_sq + EPSILON {
            set_mask_bit(&mut protected_target, index);
        }
    }

    Ok(VerificationGrid {
        target,
        near_target,
        protected_target,
        requested_tolerance_mm: input.tolerance_mm,
        effective_tolerance_mm,
        clipped_to_stock_grid,
        wcs: setup.wcs,
    })
}

fn mesh_extends_outside_grid(setup: &CamSetupDto, spec: &GridSpec, mesh: &CamStockMeshDto) -> bool {
    let max = Point3Dto::new(
        spec.min.x + spec.dimensions[0] as f64 * spec.cell_size[0],
        spec.min.y + spec.dimensions[1] as f64 * spec.cell_size[1],
        spec.min.z + spec.dimensions[2] as f64 * spec.cell_size[2],
    );
    mesh.positions.chunks_exact(3).any(|position| {
        let point =
            model_point_to_setup(setup, Point3Dto::new(position[0], position[1], position[2]));
        point.x < spec.min.x - EPSILON
            || point.y < spec.min.y - EPSILON
            || point.z < spec.min.z - EPSILON
            || point.x > max.x + EPSILON
            || point.y > max.y + EPSILON
            || point.z > max.z + EPSILON
    })
}

fn model_point_to_setup(setup: &CamSetupDto, point: Point3Dto) -> Point3Dto {
    let wcs = &setup.wcs;
    let dx = point.x - wcs.origin.x;
    let dy = point.y - wcs.origin.y;
    let dz = point.z - wcs.origin.z;
    Point3Dto::new(
        dx * wcs.x_axis[0] + dy * wcs.x_axis[1] + dz * wcs.x_axis[2],
        dx * wcs.y_axis[0] + dy * wcs.y_axis[1] + dz * wcs.y_axis[2],
        dx * wcs.z_axis[0] + dy * wcs.z_axis[1] + dz * wcs.z_axis[2],
    )
}

fn set_mask_bit(mask: &mut [u64], index: usize) {
    mask[index / 64] |= 1u64 << (index % 64);
}

/// Exact squared Euclidean distance transform over anisotropic voxel-center
/// coordinates. `distance_to_occupied` chooses which binary state is the
/// feature. For distance to the target exterior, the stock-grid boundary is
/// also an exterior feature; this keeps target surfaces that coincide with a
/// stock face inside the same tolerance model as interior surfaces.
fn squared_distance_to_mask(
    volume: &VoxelStock,
    distance_to_occupied: bool,
    include_grid_exterior: bool,
) -> Vec<f64> {
    let count = volume.dimensions.iter().product::<usize>();
    let mut distances = vec![f64::INFINITY; count];
    for z in 0..volume.dimensions[2] {
        for y in 0..volume.dimensions[1] {
            for x in 0..volume.dimensions[0] {
                let index = volume.index(x, y, z);
                let feature = volume.is_occupied_index(index) == distance_to_occupied;
                if feature {
                    distances[index] = 0.0;
                } else if include_grid_exterior {
                    let boundary_distance = [
                        ((x as f64 + 0.5) * volume.cell_size[0]).min(
                            (volume.dimensions[0] as f64 - x as f64 - 0.5) * volume.cell_size[0],
                        ),
                        ((y as f64 + 0.5) * volume.cell_size[1]).min(
                            (volume.dimensions[1] as f64 - y as f64 - 0.5) * volume.cell_size[1],
                        ),
                        ((z as f64 + 0.5) * volume.cell_size[2]).min(
                            (volume.dimensions[2] as f64 - z as f64 - 0.5) * volume.cell_size[2],
                        ),
                    ]
                    .into_iter()
                    .fold(f64::INFINITY, f64::min);
                    distances[index] = boundary_distance * boundary_distance;
                }
            }
        }
    }
    for axis in 0..3 {
        distance_transform_axis(
            &mut distances,
            volume.dimensions,
            axis,
            volume.cell_size[axis],
        );
    }
    distances
}

fn distance_transform_axis(
    distances: &mut [f64],
    dimensions: [usize; 3],
    axis: usize,
    spacing: f64,
) {
    let line_length = dimensions[axis];
    let mut input = vec![0.0; line_length];
    let mut output = vec![0.0; line_length];
    let index = |x: usize, y: usize, z: usize| x + dimensions[0] * (y + dimensions[1] * z);
    match axis {
        0 => {
            for z in 0..dimensions[2] {
                for y in 0..dimensions[1] {
                    for x in 0..dimensions[0] {
                        input[x] = distances[index(x, y, z)];
                    }
                    squared_distance_transform_1d(&input, spacing, &mut output);
                    for x in 0..dimensions[0] {
                        distances[index(x, y, z)] = output[x];
                    }
                }
            }
        }
        1 => {
            for z in 0..dimensions[2] {
                for x in 0..dimensions[0] {
                    for y in 0..dimensions[1] {
                        input[y] = distances[index(x, y, z)];
                    }
                    squared_distance_transform_1d(&input, spacing, &mut output);
                    for y in 0..dimensions[1] {
                        distances[index(x, y, z)] = output[y];
                    }
                }
            }
        }
        2 => {
            for y in 0..dimensions[1] {
                for x in 0..dimensions[0] {
                    for z in 0..dimensions[2] {
                        input[z] = distances[index(x, y, z)];
                    }
                    squared_distance_transform_1d(&input, spacing, &mut output);
                    for z in 0..dimensions[2] {
                        distances[index(x, y, z)] = output[z];
                    }
                }
            }
        }
        _ => unreachable!(),
    }
}

/// Lower envelope of one-dimensional squared-distance parabolas. Infinite
/// entries are skipped so intermediate transform lines without a feature are
/// handled correctly until a later axis connects them to one.
pub(crate) fn squared_distance_transform_1d(input: &[f64], spacing: f64, output: &mut [f64]) {
    let finite = input
        .iter()
        .enumerate()
        .filter_map(|(index, value)| value.is_finite().then_some(index))
        .collect::<Vec<_>>();
    if finite.is_empty() {
        output.fill(f64::INFINITY);
        return;
    }
    let mut sites = vec![0usize; finite.len()];
    let mut boundaries = vec![0.0f64; finite.len() + 1];
    let mut envelope = 0usize;
    sites[0] = finite[0];
    boundaries[0] = f64::NEG_INFINITY;
    boundaries[1] = f64::INFINITY;
    for &site in finite.iter().skip(1) {
        let site_x = site as f64 * spacing;
        let mut crossing;
        loop {
            let previous = sites[envelope];
            let previous_x = previous as f64 * spacing;
            crossing = ((input[site] + site_x * site_x)
                - (input[previous] + previous_x * previous_x))
                / (2.0 * (site_x - previous_x));
            if crossing > boundaries[envelope] || envelope == 0 {
                break;
            }
            envelope -= 1;
        }
        if crossing <= boundaries[envelope] {
            sites[0] = site;
            boundaries[0] = f64::NEG_INFINITY;
            boundaries[1] = f64::INFINITY;
            envelope = 0;
        } else {
            envelope += 1;
            sites[envelope] = site;
            boundaries[envelope] = crossing;
            boundaries[envelope + 1] = f64::INFINITY;
        }
    }
    let last = envelope;
    envelope = 0;
    for (index, value) in output.iter_mut().enumerate() {
        let x = index as f64 * spacing;
        while envelope < last && boundaries[envelope + 1] < x {
            envelope += 1;
        }
        let site_x = sites[envelope] as f64 * spacing;
        *value = (x - site_x).powi(2) + input[sites[envelope]];
    }
}

fn comparison_result(
    stock: &VoxelStock,
    initial_stock: &[u64],
    verification: &VerificationGrid,
    warnings: &mut Vec<String>,
) -> CamSimulationComparisonDto {
    let mut excess = vec![0u64; stock.occupied.len()];
    let mut gouge = vec![0u64; stock.occupied.len()];
    let mut initial_shortfall = vec![0u64; stock.occupied.len()];
    for index in 0..stock.occupied.len() {
        excess[index] = stock.occupied[index] & !verification.near_target[index];
        gouge[index] =
            verification.protected_target[index] & initial_stock[index] & !stock.occupied[index];
        initial_shortfall[index] = verification.protected_target[index] & !initial_stock[index];
    }
    let count = |mask: &[u64]| {
        mask.iter()
            .map(|word| word.count_ones() as usize)
            .sum::<usize>()
    };
    let excess_voxels = count(&excess);
    let gouged_voxels = count(&gouge);
    let initial_shortfall_voxels = count(&initial_shortfall);
    let protected_voxels = count(&verification.protected_target);
    if protected_voxels == 0 {
        warnings.push(
            "The current 3D detail leaves no target core beyond the effective tolerance; excess stock is still measured, but gouge verification needs finer detail."
                .to_string(),
        );
    }
    if verification.clipped_to_stock_grid {
        warnings.push(
            "At least one target body extends outside the stock grid; comparison is clipped to the setup stock envelope."
                .to_string(),
        );
    }
    if initial_shortfall_voxels > 0 {
        warnings.push(format!(
            "Starting stock is already missing {initial_shortfall_voxels} protected target cells; verify stock dimensions, WCS, and target selection, or whether an earlier rest-source operation already removed them."
        ));
    }
    let excess_mesh = match stock.mesh_from_words(excess, MAX_SURFACE_TRIANGLES) {
        Ok(mesh) => mesh,
        Err(message) => {
            warnings.push(format!("excess-stock display unavailable: {message}"));
            None
        }
    };
    let gouge_mesh = match stock.mesh_from_words(gouge, MAX_SURFACE_TRIANGLES) {
        Ok(mesh) => mesh,
        Err(message) => {
            warnings.push(format!("gouge display unavailable: {message}"));
            None
        }
    };
    let voxel_volume = stock.cell_size.iter().product::<f64>();
    CamSimulationComparisonDto {
        requested_tolerance_mm: verification.requested_tolerance_mm,
        effective_tolerance_mm: verification.effective_tolerance_mm,
        target_voxels: verification.target.occupied_count,
        excess_voxels,
        gouged_voxels,
        initial_shortfall_voxels,
        target_volume_mm3: verification.target.occupied_count as f64 * voxel_volume,
        excess_volume_mm3: excess_voxels as f64 * voxel_volume,
        gouged_volume_mm3: gouged_voxels as f64 * voxel_volume,
        initial_shortfall_volume_mm3: initial_shortfall_voxels as f64 * voxel_volume,
        excess_mesh,
        gouge_mesh,
    }
}

fn note_approximation(tool: &CamToolDto, drill: &mut bool) {
    match tool.kind {
        // Only flag the drill approximation when the point angle is not
        // stored; a known angle sweeps the exact cone in `cutter_contains`.
        CamToolKind::Drill => {
            if tool.point_angle_degrees.is_none() {
                *drill = true;
            }
        }
        // Milling cutters use the same analytic profile as their display,
        // including optional face/end-mill corner radii and chamfers.
        // Tap/reamer/boring/thread tools remain cylindrical envelopes, not
        // tooth/flute-level geometry. Turning tools do not execute today.
        CamToolKind::FlatEndMill
        | CamToolKind::BallEndMill
        | CamToolKind::BullNoseEndMill
        | CamToolKind::ChamferMill
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
    gouged: usize,
    first_contact: Option<Point3Dto>,
    first_gouge: Option<Point3Dto>,
}

struct ToolSweepOptions<'a> {
    mode: SweepMode,
    total_samples: &'a mut usize,
    verification: Option<&'a VerificationGrid>,
    cancellation: Option<&'a CamSimulationCancellation>,
}

#[derive(Clone)]
struct VoxelStock {
    min: Point3Dto,
    dimensions: [usize; 3],
    cell_size: [f64; 3],
    occupied: Vec<u64>,
    occupied_count: usize,
    mesh_quality_warnings: Vec<String>,
    display_cuts: surface::DisplayCuts,
}

impl VoxelStock {
    /// Surface budgets are a presentation constraint, never a reason to lose
    /// the stock or stop the physical timeline. Fall back to a complete,
    /// conservative display-only grid; the authoritative bitset is untouched.
    fn presentation_mesh(
        &self,
        max_triangles: usize,
        warnings: &mut Vec<String>,
    ) -> Result<CamSimulationMeshDto, CamPlanError> {
        if max_triangles < 12 {
            return Err(CamPlanError(
                "Stock surface budget must allow a closed box".into(),
            ));
        }
        if let Ok((mesh, fallback)) = self.surface_mesh_with_status(max_triangles) {
            if let Some(message) = fallback {
                warnings.push(message.into());
            }
            return Ok(mesh);
        }
        let mut display = self.coarser_display_stock();
        loop {
            if let Ok((mesh, fallback)) = display.surface_mesh_with_status(max_triangles) {
                if let Some(message) = fallback {
                    warnings.push(message.into());
                }
                warnings.push(format!(
                    "Remaining-stock display uses a complete {:.3} × {:.3} × {:.3} mm surface grid to fit the triangle budget; small features may be obscured. Cutting, verification and volume measurements retain the original grid.",
                    display.cell_size[0], display.cell_size[1], display.cell_size[2]
                ));
                return Ok(mesh);
            }
            if display.dimensions == [1; 3] {
                return Err(CamPlanError(
                    "Unable to construct a bounded closed stock display".into(),
                ));
            }
            display = display.coarser_display_stock();
        }
    }

    fn coarser_display_stock(&self) -> Self {
        let dimensions = self.dimensions.map(|n| n.div_ceil(2));
        let cell_size = std::array::from_fn(|i| {
            self.cell_size[i] * self.dimensions[i] as f64 / dimensions[i] as f64
        });
        let mut display = Self {
            min: self.min,
            dimensions,
            cell_size,
            occupied: vec![0; dimensions.iter().product::<usize>().div_ceil(64)],
            occupied_count: 0,
            mesh_quality_warnings: vec![],
            display_cuts: self.display_cuts.clone(),
        };
        for z in 0..dimensions[2] {
            for y in 0..dimensions[1] {
                for x in 0..dimensions[0] {
                    let q = [x, y, z];
                    // Integer overlap bounds preserve the exact stock envelope
                    // even when dimensions are odd. Any occupied source cell
                    // keeps the display cell: never invent a cleared region.
                    let lo: [usize; 3] =
                        std::array::from_fn(|i| q[i] * self.dimensions[i] / dimensions[i]);
                    let hi: [usize; 3] = std::array::from_fn(|i| {
                        ((q[i] + 1) * self.dimensions[i]).div_ceil(dimensions[i])
                    });
                    let occupied = (lo[2]..hi[2]).any(|sz| {
                        (lo[1]..hi[1]).any(|sy| {
                            (lo[0]..hi[0]).any(|sx| self.is_occupied_index(self.index(sx, sy, sz)))
                        })
                    });
                    if occupied {
                        let index = display.index(x, y, z);
                        display.occupied[index / 64] |= 1 << (index % 64);
                        display.occupied_count += 1;
                    }
                }
            }
        }
        display
    }

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
            mesh_quality_warnings: Vec::new(),
            display_cuts: surface::DisplayCuts::default(),
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
        if occupied_count == count {
            stock.display_cuts.initial =
                Some(surface::StockBoundary::new(spec, CamResolvedStockDto::Box));
        }
        stock
    }

    fn union_assign(&mut self, other: &Self) {
        debug_assert_eq!(self.dimensions, other.dimensions);
        for (target, source) in self.occupied.iter_mut().zip(&other.occupied) {
            *target |= *source;
        }
        self.occupied_count = self
            .occupied
            .iter()
            .map(|word| word.count_ones() as usize)
            .sum();
        self.mesh_quality_warnings
            .extend(other.mesh_quality_warnings.iter().cloned());
    }

    fn mesh_from_words(
        &self,
        occupied: Vec<u64>,
        max_triangles: usize,
    ) -> Result<Option<CamSimulationMeshDto>, String> {
        let occupied_count = occupied.iter().map(|word| word.count_ones() as usize).sum();
        if occupied_count == 0 {
            return Ok(None);
        }
        let subset = Self {
            min: self.min,
            dimensions: self.dimensions,
            cell_size: self.cell_size,
            occupied,
            occupied_count,
            mesh_quality_warnings: Vec::new(),
            display_cuts: surface::DisplayCuts::default(),
        };
        subset.greedy_surface_mesh(max_triangles).map(Some)
    }

    fn sweep_tool(
        &mut self,
        tool: &CamToolDto,
        from: Point3Dto,
        to: Point3Dto,
        options: ToolSweepOptions<'_>,
    ) -> Result<SweepOutcome, CamPlanError> {
        let ToolSweepOptions {
            mode,
            total_samples,
            verification,
            cancellation,
        } = options;
        let length = distance(from, to);
        let spacing = (self.cell_size.iter().copied().fold(f64::INFINITY, f64::min) * 0.45)
            .min((tool.diameter * 0.2).max(EPSILON));
        let samples = ((length / spacing).ceil() as usize).max(1);
        self.reserve_samples(samples, total_samples)?;
        let mut outcome = SweepOutcome::default();
        let profile = crate::CutterProfile::new(tool.into()).map_err(CamPlanError)?;
        for index in 0..=samples {
            if index.is_multiple_of(16) {
                if let Some(cancellation) = cancellation {
                    cancellation.check()?;
                }
            }
            let t = index as f64 / samples as f64;
            let position = lerp(from, to, t);
            self.apply_tool_at(
                tool,
                &profile,
                position,
                mode,
                verification,
                &mut outcome,
                cancellation,
            )?;
            if mode == SweepMode::CollisionOnly && outcome.first_contact.is_some() {
                break;
            }
        }
        if mode == SweepMode::RemoveMaterial && outcome.removed > 0 {
            self.display_cuts.record(tool, from, to);
        }
        Ok(outcome)
    }

    fn sweep_arc(
        &mut self,
        tool: &CamToolDto,
        arc: &ArcSweep,
        mode: SweepMode,
        total_samples: &mut usize,
        verification: Option<&VerificationGrid>,
        cancellation: Option<&CamSimulationCancellation>,
    ) -> Result<SweepOutcome, CamPlanError> {
        let spacing = (self.cell_size.iter().copied().fold(f64::INFINITY, f64::min) * 0.45)
            .min((tool.diameter * 0.2).max(EPSILON));
        let samples = ((arc.length / spacing).ceil() as usize).max(1);
        self.reserve_samples(samples, total_samples)?;
        let mut outcome = SweepOutcome::default();
        let profile = crate::CutterProfile::new(tool.into()).map_err(CamPlanError)?;
        for index in 0..=samples {
            if index.is_multiple_of(16) {
                if let Some(cancellation) = cancellation {
                    cancellation.check()?;
                }
            }
            let t = index as f64 / samples as f64;
            self.apply_tool_at(
                tool,
                &profile,
                arc.point(t),
                mode,
                verification,
                &mut outcome,
                cancellation,
            )?;
            if mode == SweepMode::CollisionOnly && outcome.first_contact.is_some() {
                break;
            }
        }
        if mode == SweepMode::RemoveMaterial && outcome.removed > 0 {
            let tolerance = self.cell_size.iter().copied().fold(f64::INFINITY, f64::min) * 0.02;
            self.display_cuts.record_arc(tool, arc, tolerance);
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
        profile: &crate::CutterProfile,
        tip: Point3Dto,
        mode: SweepMode,
        verification: Option<&VerificationGrid>,
        outcome: &mut SweepOutcome,
        cancellation: Option<&CamSimulationCancellation>,
    ) -> Result<(), CamPlanError> {
        let radius = tool.diameter * 0.5;
        let lower = Point3Dto::new(tip.x - radius, tip.y - radius, tip.z);
        let upper = Point3Dto::new(tip.x + radius, tip.y + radius, tip.z + tool.flute_length);
        let ranges = self.index_ranges(lower, upper);
        for z in ranges[2].0..ranges[2].1 {
            if let Some(cancellation) = cancellation {
                cancellation.check()?;
            }
            // One analytic radius per Z slice, not trig/sqrt per occupied voxel.
            let local_z = self.center(0, 0, z).z - tip.z;
            let Some(local_radius) = profile.radius_at_height(local_z) else { continue; };
            let local_radius_sq = local_radius * local_radius + EPSILON;
            for y in ranges[1].0..ranges[1].1 {
                for x in ranges[0].0..ranges[0].1 {
                    let index = self.index(x, y, z);
                    if !self.is_occupied_index(index) {
                        continue;
                    }
                    let point = self.center(x, y, z);
                    if (point.x - tip.x).powi(2) + (point.y - tip.y).powi(2) > local_radius_sq {
                        continue;
                    }
                    match mode {
                        SweepMode::RemoveMaterial => {
                            if verification.is_some_and(|target| target.protects(index)) {
                                outcome.gouged += 1;
                                outcome.first_gouge.get_or_insert(tip);
                            }
                            self.clear_index(index);
                            outcome.removed += 1;
                        }
                        SweepMode::CollisionOnly => {
                            outcome.first_contact.get_or_insert(tip);
                            return Ok(());
                        }
                    }
                }
            }
        }
        Ok(())
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
        self.surface_mesh_with_status(max_triangles)
            .map(|(mesh, _)| mesh)
    }

    fn surface_mesh_with_status(
        &self,
        max_triangles: usize,
    ) -> Result<(CamSimulationMeshDto, Option<&'static str>), String> {
        if self.display_cuts.limited {
            return self.surface_mesh_with_refinement(max_triangles, false).map(|mesh| (mesh, Some(
                "Stock display reached its cutter-history limit and uses the complete grid surface; small chamfers and radii may look stepped. Cutting and verification are unchanged."
            )));
        }
        match self.surface_mesh_with_refinement(max_triangles, true) {
            Err(message) if message == surface::WORK_LIMIT => {
                #[cfg(test)]
                if std::env::var_os("NBCAD_CAM_DETAIL_CAPTURE").is_some() {
                    eprintln!("Stock display reconstruction reached its work budget; using the complete grid fallback");
                }
                // Discard the whole attempted mesh, not just the expensive
                // neighborhood. Shared boundaries cannot mix refined and
                // unrefined positions after a work-budget fallback.
                self.surface_mesh_with_refinement(max_triangles, false).map(|mesh| (mesh, Some(
                    "Stock display reached its reconstruction work limit and uses the complete grid surface; small chamfers and radii may look stepped. Cutting and verification are unchanged."
                )))
            }
            result => result.map(|mesh| (mesh, None)),
        }
    }

    fn surface_mesh_with_refinement(
        &self,
        max_triangles: usize,
        refine: bool,
    ) -> Result<CamSimulationMeshDto, String> {
        #[cfg(test)]
        let mesh_start = std::time::Instant::now();
        #[cfg(test)]
        MESH_EXTRACTIONS.with(|count| count.set(count.get() + 1));
        let mut positions = Vec::<f32>::new();
        let mut normals = Vec::<f32>::new();
        let plain = surface::DisplayCuts::default();
        let refiner = surface::Refiner::new(
            if refine { &self.display_cuts } else { &plain },
            self.cell_size,
        );
        let origin = [self.min.x, self.min.y, self.min.z];
        for axis in 0..3 {
            let u = (axis + 1) % 3;
            let v = (axis + 2) % 3;
            let width = self.dimensions[u];
            let height = self.dimensions[v];
            let mut mask = vec![0i8; width * height];
            for slice in 0..=self.dimensions[axis] {
                if refiner.exhausted() {
                    return Err(surface::WORK_LIMIT.into());
                }
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
                        let sign = mask[column + row * width];
                        if sign != 0 {
                            let mut normal = [0.0; 3];
                            normal[axis] = sign as f32;
                            // Greedy rectangles are safe only on an unchanged
                            // plane. Moving their corners otherwise makes long
                            // slivers and T-junction cracks across the stock.
                            // Curved neighborhoods keep a conforming unit grid;
                            // large untouched planes retain greedy compression.
                            let curved =
                                [(0, 0), (1, 0), (1, 1), (0, 1)]
                                    .into_iter()
                                    .any(|(dx, dy)| {
                                        let q =
                                            lattice_point(axis, u, v, slice, column + dx, row + dy);
                                        let raw: [f64; 3] = std::array::from_fn(|i| {
                                            origin[i] + q[i] as f64 * self.cell_size[i]
                                        });
                                        let (point, n) = self.display_vertex(q, normal, &refiner);
                                        (0..3).any(|i| {
                                            (point[i] - raw[i]).abs() > EPSILON
                                                || (n[i] - normal[i]).abs() > 1e-5
                                        })
                                    });
                            if curved {
                                mask[column + row * width] *= 2;
                            }
                        }
                    }
                }
                let mut row = 0;
                while row < height {
                    let mut column = 0;
                    while column < width {
                        let mask_value = mask[column + row * width];
                        if mask_value == 0 {
                            column += 1;
                            continue;
                        }
                        let sign = mask_value.signum();
                        let mut run_width = 1;
                        while (mask_value.abs() == 1
                            || self.curved_strip_is_exact(
                                axis,
                                u,
                                v,
                                slice,
                                column,
                                row,
                                run_width + 1,
                                true,
                                sign,
                                &refiner,
                            ))
                            && column + run_width < width
                            && mask[column + run_width + row * width] == mask_value
                        {
                            run_width += 1;
                        }
                        let mut run_height = 1;
                        'height: while row + run_height < height {
                            for offset in 0..run_width {
                                // Check every column, not just the first pair.
                                // A shifted flat plane and its neighboring
                                // bevel both have a curved-mask value; testing
                                // only one column stretches the far edge over
                                // the rim and paints streaks across the top.
                                if mask[column + offset + (row + run_height) * width] != mask_value
                                    || (mask_value.abs() != 1
                                        && !self.curved_strip_is_exact(
                                            axis,
                                            u,
                                            v,
                                            slice,
                                            column + offset,
                                            row,
                                            run_height + 1,
                                            false,
                                            sign,
                                            &refiner,
                                        ))
                                {
                                    break 'height;
                                }
                            }
                            run_height += 1;
                        }
                        let mut face_normal = [0.0f32; 3];
                        face_normal[axis] = sign as f32;
                        let q0 = lattice_point(axis, u, v, slice, column, row);
                        let q1 = lattice_point(axis, u, v, slice, column + run_width, row);
                        let q2 =
                            lattice_point(axis, u, v, slice, column + run_width, row + run_height);
                        let q3 = lattice_point(axis, u, v, slice, column, row + run_height);
                        let vertices =
                            [q0, q1, q2, q3].map(|q| self.display_vertex(q, face_normal, &refiner));
                        let [(p0, n0), (p1, n1), (p2, n2), (p3, n3)] = vertices;
                        if positions.len() / 9 + 2 > max_triangles {
                            return Err(format!(
                                "remaining-stock mesh exceeds the {max_triangles}-triangle presentation budget; increase voxel size"
                            ));
                        }
                        if sign > 0 {
                            push_triangle_with_normals(
                                &mut positions,
                                &mut normals,
                                [p0, p1, p2],
                                [n0, n1, n2],
                            );
                            push_triangle_with_normals(
                                &mut positions,
                                &mut normals,
                                [p0, p2, p3],
                                [n0, n2, n3],
                            );
                        } else {
                            push_triangle_with_normals(
                                &mut positions,
                                &mut normals,
                                [p0, p3, p2],
                                [n0, n3, n2],
                            );
                            push_triangle_with_normals(
                                &mut positions,
                                &mut normals,
                                [p0, p2, p1],
                                [n0, n2, n1],
                            );
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
        if refiner.exhausted() {
            return Err(surface::WORK_LIMIT.into());
        }
        #[cfg(test)]
        if std::env::var_os("NBCAD_CAM_DETAIL_CAPTURE").is_some() {
            eprintln!(
                "Stock base mesh: {} triangles, {:.1} ms",
                positions.len() / 9,
                mesh_start.elapsed().as_secs_f64() * 1000.
            );
        }
        let mesh = refiner.refine_mesh(
            CamSimulationMeshDto {
                triangle_count: positions.len() / 9,
                positions,
                normals,
            },
            max_triangles,
            self.cell_size,
        );
        if refiner.exhausted() {
            return Err(surface::WORK_LIMIT.into());
        }
        Ok(mesh)
    }

    /// Merge an exact extrusion along any grid axis: cylinder walls in Z,
    /// straight bevels/fillets in X or Y. The cross-section and normals must
    /// remain identical. Never stretch a rectangle across curved transitions.
    #[allow(clippy::too_many_arguments)]
    fn curved_strip_is_exact(
        &self,
        axis: usize,
        u: usize,
        v: usize,
        slice: usize,
        column: usize,
        row: usize,
        length: usize,
        along_u: bool,
        sign: i8,
        refiner: &surface::Refiner<'_>,
    ) -> bool {
        let mut face = [0.0; 3];
        face[axis] = sign as f32;
        let limit = if along_u {
            self.dimensions[u] - column
        } else {
            self.dimensions[v] - row
        };
        if length > limit {
            return false;
        }
        let at = |side: usize, offset: usize| {
            self.display_vertex(
                lattice_point(
                    axis,
                    u,
                    v,
                    slice,
                    column + if along_u { offset } else { side },
                    row + if along_u { side } else { offset },
                ),
                face,
                refiner,
            )
        };
        let along = if along_u { u } else { v };
        let epsilon = self.cell_size[along] * 1e-6;
        (0..2).all(|side| {
            let (first, normal) = at(side, 0);
            [1, length].into_iter().all(|offset| {
                let (point, n) = at(side, offset);
                (0..3).all(|i| {
                    (point[i]
                        - first[i]
                        - if i == along {
                            offset as f64 * self.cell_size[along]
                        } else {
                            0.
                        })
                    .abs()
                        < epsilon
                }) && (0..3).all(|i| (n[i] - normal[i]).abs() < 1e-6)
            })
        })
    }

    fn display_vertex(
        &self,
        lattice: [usize; 3],
        face: [f32; 3],
        refiner: &surface::Refiner<'_>,
    ) -> ([f64; 3], [f32; 3]) {
        let raw =
            std::array::from_fn(|i| self.min_component(i) + lattice[i] as f64 * self.cell_size[i]);
        let axis = face.iter().position(|value| *value != 0.0).unwrap_or(2);
        let projection_cell = std::array::from_fn(|i| {
            if !refiner.analytic_stock() && (lattice[i] == 0 || lattice[i] == self.dimensions[i]) {
                0.0
            } else {
                self.cell_size[i]
            }
        });
        {
            // Most boundary cells belong to flat stock/faced planes. One
            // analytic query plus eight bit reads avoids Hermite/QEF work and
            // keeps the vertex cache for curved neighborhoods. Only accept a
            // projection along this face's normal, never across a small bevel.
            let u = (axis + 1) % 3;
            let v = (axis + 2) % 3;
            let mut negative = 0;
            let mut positive = 0;
            for du in 0..2 {
                for dv in 0..2 {
                    let mut q = lattice.map(|n| n as isize);
                    q[u] = (q[u] + du - 1).clamp(0, self.dimensions[u] as isize - 1);
                    q[v] = (q[v] + dv - 1).clamp(0, self.dimensions[v] as isize - 1);
                    positive += self.occupied_at(q) as u8;
                    q[axis] -= 1;
                    negative += self.occupied_at(q) as u8;
                }
            }
            if (negative == 4 && positive == 0) || (negative == 0 && positive == 4) {
                match refiner.project(raw) {
                    Some((point, n))
                        if (0..3).all(|i| {
                            (n[i] - face[i]).abs() < 1e-6
                                && (i == axis || (point[i] - raw[i]).abs() < EPSILON)
                        }) =>
                    {
                        return (point, face)
                    }
                    None => return (raw, face),
                    _ => {}
                }
            }
        }
        let projected = refiner.project_in_cell(raw, projection_cell);
        let mut point = self.smooth_surface_position(lattice, raw);
        let envelope = lattice[axis] == 0 || lattice[axis] == self.dimensions[axis];
        let mut normal = if envelope {
            face
        } else {
            let gradient = self.surface_normal_at_lattice(lattice, face);
            if axis == 2 {
                gradient
            } else {
                vertical_component(gradient, face)
            }
        };
        if let Some((projected, cutter_normal)) = projected {
            for i in 0..3 {
                if refiner.analytic_stock() || (lattice[i] > 0 && lattice[i] < self.dimensions[i]) {
                    point[i] = projected[i];
                }
            }
            if !envelope
                && cutter_normal
                    .iter()
                    .zip(face)
                    .map(|(a, b)| a * b)
                    .sum::<f32>()
                    > 1e-6
            {
                normal = cutter_normal;
            } else {
                // The flat top and the cylinder/cone are a sharp intersection,
                // not a normal blended across an entire merged top rectangle.
                normal = face;
            }
        }
        (point, normal)
    }

    fn surface_normal_at_lattice(&self, lattice: [usize; 3], fallback: [f32; 3]) -> [f32; 3] {
        let mut outward = [0.0f64; 3];
        for axis in 0..3 {
            let other = [(axis + 1) % 3, (axis + 2) % 3];
            let mut negative = 0.0;
            let mut positive = 0.0;
            for first in 0..2 {
                for second in 0..2 {
                    let mut negative_cell = lattice.map(|value| value as isize - 1);
                    let mut positive_cell = negative_cell;
                    negative_cell[other[0]] = lattice[other[0]] as isize - 1 + first;
                    positive_cell[other[0]] = negative_cell[other[0]];
                    negative_cell[other[1]] = lattice[other[1]] as isize - 1 + second;
                    positive_cell[other[1]] = negative_cell[other[1]];
                    positive_cell[axis] = lattice[axis] as isize;
                    negative += self.occupied_at(negative_cell) as u8 as f64;
                    positive += self.occupied_at(positive_cell) as u8 as f64;
                }
            }
            // Density rises toward occupied material; the visible surface
            // normal points in the opposite direction, toward empty space.
            outward[axis] = (negative - positive) / self.cell_size[axis];
        }
        let length = outward
            .iter()
            .map(|value| value * value)
            .sum::<f64>()
            .sqrt();
        if length <= EPSILON {
            return fallback;
        }
        outward.map(|value| (value / length) as f32)
    }

    /// Relax a shared lattice vertex toward the average binary-isosurface
    /// crossing in its surrounding dual cell. Flat faces remain exactly flat;
    /// only mixed cutter boundaries move, by at most half a voxel. Greedy
    /// rectangles and the compact triangle count are preserved.
    fn smooth_surface_position(&self, lattice: [usize; 3], fallback: [f64; 3]) -> [f64; 3] {
        const EDGES: [([usize; 3], [usize; 3]); 12] = [
            ([0, 0, 0], [1, 0, 0]),
            ([0, 1, 0], [1, 1, 0]),
            ([0, 0, 1], [1, 0, 1]),
            ([0, 1, 1], [1, 1, 1]),
            ([0, 0, 0], [0, 1, 0]),
            ([1, 0, 0], [1, 1, 0]),
            ([0, 0, 1], [0, 1, 1]),
            ([1, 0, 1], [1, 1, 1]),
            ([0, 0, 0], [0, 0, 1]),
            ([1, 0, 0], [1, 0, 1]),
            ([0, 1, 0], [0, 1, 1]),
            ([1, 1, 0], [1, 1, 1]),
        ];
        let cell = |corner: [usize; 3]| {
            std::array::from_fn(|axis| {
                (lattice[axis] as isize + corner[axis] as isize - 1)
                    .clamp(0, self.dimensions[axis] as isize - 1)
            })
        };
        let occupied_corners = (0..8)
            .map(|bits| cell([bits & 1, (bits >> 1) & 1, (bits >> 2) & 1]))
            .filter(|coordinate| self.occupied_at(*coordinate))
            .count();
        let mut crossing_sum = [0.0f64; 3];
        let mut crossing_count = 0usize;
        for (start, end) in EDGES {
            let start_cell = cell(start);
            let end_cell = cell(end);
            if self.occupied_at(start_cell) == self.occupied_at(end_cell) {
                continue;
            }
            for axis in 0..3 {
                let start_center = self.min_component(axis)
                    + (start_cell[axis] as f64 + 0.5) * self.cell_size[axis];
                let end_center =
                    self.min_component(axis) + (end_cell[axis] as f64 + 0.5) * self.cell_size[axis];
                crossing_sum[axis] += (start_center + end_center) * 0.5;
            }
            crossing_count += 1;
        }
        if crossing_count == 0 {
            return fallback;
        }
        let mut normal = self
            .surface_normal_at_lattice(lattice, [0.0, 0.0, 1.0])
            .map(f64::from);
        for axis in 0..3 {
            if lattice[axis] == 0 || lattice[axis] == self.dimensions[axis] {
                normal[axis] = 0.0;
            }
        }
        let normal_length = normal.iter().map(|value| value * value).sum::<f64>().sqrt();
        if normal_length > EPSILON {
            normal = normal.map(|value| value / normal_length);
        }
        let density_shift = (occupied_corners as f64 / 8.0 - 0.5)
            * self.cell_size.iter().copied().fold(f64::INFINITY, f64::min)
            * DISPLAY_SURFACE_SMOOTHING;
        std::array::from_fn(|axis| {
            if lattice[axis] == 0 || lattice[axis] == self.dimensions[axis] {
                return fallback[axis];
            }
            let target = crossing_sum[axis] / crossing_count as f64;
            fallback[axis]
                + (target - fallback[axis]) * DISPLAY_SURFACE_SMOOTHING
                + normal[axis] * density_shift
        })
    }

    fn min_component(&self, axis: usize) -> f64 {
        match axis {
            0 => self.min.x,
            1 => self.min.y,
            2 => self.min.z,
            _ => unreachable!(),
        }
    }
}

fn lattice_point(
    axis: usize,
    u: usize,
    v: usize,
    slice: usize,
    column: usize,
    row: usize,
) -> [usize; 3] {
    let mut point = [0usize; 3];
    point[axis] = slice;
    point[u] = column;
    point[v] = row;
    point
}

fn vertical_component(normal: [f32; 3], fallback: [f32; 3]) -> [f32; 3] {
    let length = normal[0].hypot(normal[1]);
    if length <= EPSILON as f32 {
        return fallback;
    }
    [normal[0] / length, normal[1] / length, 0.0]
}

fn dimensions_for_extent(extent: [f64; 3], edge: f64) -> [usize; 3] {
    extent.map(|value| (value / edge).ceil().max(1.0) as usize)
}

#[cfg(test)]
fn cutter_contains(tool: &CamToolDto, tip: Point3Dto, point: Point3Dto) -> bool {
    crate::CutterProfile::new(tool.into()).unwrap()
        .contains((point.x - tip.x).powi(2) + (point.y - tip.y).powi(2), point.z - tip.z)
}

#[derive(Clone, PartialEq)]
struct ArcSweep {
    plane: CamArcPlane,
    start_w: f64,
    center_u: f64,
    center_v: f64,
    end_w: f64,
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
        plane: CamArcPlane,
    ) -> Result<Self, CamPlanError> {
        let [start_u, start_v, start_w] = arc_components(start, plane);
        let [center_u, center_v, _] = arc_components(center, plane);
        let [end_u, end_v, end_w] = arc_components(end, plane);
        let start_radius = ((start_u - center_u).powi(2) + (start_v - center_v).powi(2)).sqrt();
        let end_radius = ((end_u - center_u).powi(2) + (end_v - center_v).powi(2)).sqrt();
        if !start_radius.is_finite()
            || start_radius <= EPSILON
            || (start_radius - end_radius).abs() > 1.0e-5
        {
            return Err(CamPlanError(format!(
                "simulation circular move has inconsistent {plane:?} radius"
            )));
        }
        let start_angle = (start_v - center_v).atan2(start_u - center_u);
        let end_angle = (end_v - center_v).atan2(end_u - center_u);
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
        let dw = end_w - start_w;
        Ok(Self {
            plane,
            start_w,
            center_u,
            center_v,
            end_w,
            radius: start_radius,
            start_angle,
            sweep,
            length: (planar * planar + dw * dw).sqrt(),
        })
    }

    fn point(&self, t: f64) -> Point3Dto {
        let angle = self.start_angle + self.sweep * t;
        point_from_arc_components(
            self.center_u + self.radius * angle.cos(),
            self.center_v + self.radius * angle.sin(),
            self.start_w + (self.end_w - self.start_w) * t,
            self.plane,
        )
    }
}

/// Right-handed plane coordinates matching controller conventions: XY for
/// G17, Z/X for G18, and Y/Z for G19. The third component is the helical
/// applicate axis.
fn arc_components(point: Point3Dto, plane: CamArcPlane) -> [f64; 3] {
    match plane {
        CamArcPlane::Xy => [point.x, point.y, point.z],
        CamArcPlane::Xz => [point.z, point.x, point.y],
        CamArcPlane::Yz => [point.y, point.z, point.x],
    }
}

fn point_from_arc_components(u: f64, v: f64, w: f64, plane: CamArcPlane) -> Point3Dto {
    match plane {
        CamArcPlane::Xy => Point3Dto::new(u, v, w),
        CamArcPlane::Xz => Point3Dto::new(v, w, u),
        CamArcPlane::Yz => Point3Dto::new(w, u, v),
    }
}

fn push_triangle_with_normals(
    positions: &mut Vec<f32>,
    normals: &mut Vec<f32>,
    points: [[f64; 3]; 3],
    mut vertex_normals: [[f32; 3]; 3],
) {
    // Analytic projection can collapse a voxel stair onto a cylinder/cone.
    // Drop zero-area faces in the *transported f32 geometry* and orient the
    // remaining faces toward their physical outward normals. Tiny inverted
    // slivers otherwise show as dark speckles in a double-sided material.
    let mut points = points.map(|point| point.map(|value| value as f32));
    let a: [f64; 3] = std::array::from_fn(|i| (points[1][i] - points[0][i]) as f64);
    let b: [f64; 3] = std::array::from_fn(|i| (points[2][i] - points[0][i]) as f64);
    let cross = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
    let area_sq = cross.iter().map(|v| v * v).sum::<f64>();
    let scale = a.iter().chain(&b).map(|v| v * v).sum::<f64>();
    if area_sq <= scale * scale * 1e-12 {
        return;
    }
    let alignment = (0..3)
        .map(|i| cross[i] * vertex_normals.iter().map(|n| n[i] as f64).sum::<f64>())
        .sum::<f64>();
    if alignment < 0.0 {
        points.swap(1, 2);
        vertex_normals.swap(1, 2);
    }
    for (point, normal) in points.into_iter().zip(vertex_normals) {
        positions.extend(point);
        normals.extend(normal);
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
    include!("simulation/corner_tests.rs");
    include!("simulation/detail_tests.rs");
    use super::*;
    use crate::model::{
        CamOperationDto, CamPostConfigDto, CamUnits, CompensationMode, ContourCompensation,
        CoolantMode, CuttingParametersDto, FaceDirection, MillingDirection, Point2Dto, Rect2Dto,
        StockBoxDto, WcsOriginSpecDto, WorkOffset,
    };

    fn document() -> CamDocumentDto {
        let cutting = CuttingParametersDto {
            spindle_rpm: 8_000,
            feed_xy: 600.0,
            feed_z: 180.0,
            coolant: CoolantMode::Off,
        };
        CamDocumentDto {
            load_warnings: Vec::new(),
            toolpath_generations: Vec::new(),
            height_expressions: Vec::new(),
            linking: Vec::new(),
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
                machine: None,
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
                        direction: FaceDirection::BothWays,
                        clearance_z: 5.0,
                        retract_z: 2.0,
                        feed_height_z: 1.0,
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
                        compensation_mode: CompensationMode::InSoftware,
                        lead_in: 5.0,
                        lead_out: 5.0,
                        lead_arc_radius: None,
                        direction: MillingDirection::Climb,
                        roughing_passes: 1,
                        roughing_step_over: None,
                        finishing_pass: false,
                        finish_allowance: 0.0,
                        finish_feed: None,
                        spring_pass: false,
                        chain_ref: None,
                        clearance_z: 5.0,
                        retract_z: 2.0,
                        feed_height_z: 1.0,
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
                corner_chamfer: None,
                cutting: CuttingParametersDto::default(),
                cutting_presets: vec![],
                default_step_down: None,
                default_step_over: None,
            }],
            units: CamUnits::Millimeters,
            post_defaults: CamPostConfigDto::default(),
            next_setup_id: 2,
            next_operation_id: 3,
            next_tool_id: 2,
        }
    }

    fn box_mesh(min: Point3Dto, max: Point3Dto) -> CamStockMeshDto {
        let corners = [
            (min.x, min.y, min.z),
            (max.x, min.y, min.z),
            (max.x, max.y, min.z),
            (min.x, max.y, min.z),
            (min.x, min.y, max.z),
            (max.x, min.y, max.z),
            (max.x, max.y, max.z),
            (min.x, max.y, max.z),
        ];
        let mut positions = Vec::new();
        for (x, y, z) in corners {
            positions.extend([x, y, z]);
        }
        #[rustfmt::skip]
        let indices = vec![
            0, 2, 1, 0, 3, 2, // bottom
            4, 5, 6, 4, 6, 7, // top
            0, 1, 5, 0, 5, 4, // -Y
            1, 2, 6, 1, 6, 5, // +X
            2, 3, 7, 2, 7, 6, // +Y
            3, 0, 4, 3, 4, 7, // -X
        ];
        CamStockMeshDto { positions, indices }
    }

    #[test]
    fn auto_detail_scales_with_the_stock_instead_of_fixed_millimetres() {
        let small = StockBoxDto {
            min: Point3Dto::new(0.0, 0.0, 0.0),
            max: Point3Dto::new(160.0, 80.0, 40.0),
        };
        let large = StockBoxDto {
            min: Point3Dto::new(0.0, 0.0, 0.0),
            max: Point3Dto::new(1_600.0, 800.0, 400.0),
        };
        let small_spec = GridSpec::for_stock(&small, None, DEFAULT_MAX_VOXELS)
            .expect("small model-relative grid");
        let large_spec = GridSpec::for_stock(&large, None, DEFAULT_MAX_VOXELS)
            .expect("large model-relative grid");

        assert_eq!(small_spec.dimensions, [352, 176, 88]);
        assert_eq!(large_spec.dimensions, small_spec.dimensions);
        assert!((small_spec.edge - (160.0 / 352.0)).abs() < EPSILON);
        assert!((large_spec.edge - (1_600.0 / 352.0)).abs() < EPSILON);
    }

    #[test]
    fn internal_cut_walls_receive_continuous_display_normals() {
        let spec = GridSpec {
            min: Point3Dto::new(0.0, 0.0, 0.0),
            dimensions: [12, 12, 3],
            cell_size: [1.0, 1.0, 1.0],
            edge: 1.0,
        };
        let stock = VoxelStock::filled(&spec, |point| {
            let dx = point.x - 6.0;
            let dy = point.y - 6.0;
            dx * dx + dy * dy >= 9.0
        });
        let mesh = stock
            .greedy_surface_mesh(MAX_SURFACE_TRIANGLES)
            .expect("smoothed presentation mesh");

        assert_eq!(mesh.normals.len(), mesh.positions.len());
        assert!(mesh.normals.chunks_exact(3).any(|normal| {
            normal[0].abs() > 0.2 && normal[1].abs() > 0.2 && normal[2].abs() < 0.01
        }));
        assert!(mesh.positions.iter().any(|value| {
            let nearest = value.round();
            (*value - nearest).abs() > 1.0e-3
        }));
    }

    #[test]
    fn anisotropic_distance_transform_matches_brute_force() {
        let spec = GridSpec {
            min: Point3Dto::new(0.0, 0.0, 0.0),
            dimensions: [4, 3, 2],
            cell_size: [0.5, 1.25, 2.0],
            edge: 0.5,
        };
        let target = VoxelStock::filled(&spec, |point| {
            (point.x - 0.75).abs() < EPSILON
                && (point.y - 1.875).abs() < EPSILON
                && (point.z - 1.0).abs() < EPSILON
        });
        assert_eq!(target.occupied_count, 1);
        let distances = squared_distance_to_mask(&target, true, false);
        let feature = Point3Dto::new(0.75, 1.875, 1.0);
        for z in 0..spec.dimensions[2] {
            for y in 0..spec.dimensions[1] {
                for x in 0..spec.dimensions[0] {
                    let point = target.center(x, y, z);
                    let expected = (point.x - feature.x).powi(2)
                        + (point.y - feature.y).powi(2)
                        + (point.z - feature.z).powi(2);
                    assert!(
                        (distances[target.index(x, y, z)] - expected).abs() < 1.0e-9,
                        "distance mismatch at {x},{y},{z}"
                    );
                }
            }
        }
    }

    #[test]
    fn bull_nose_envelope_honors_the_corner_radius() {
        let mut tool = document().tools.remove(0);
        tool.kind = CamToolKind::BullNoseEndMill;
        tool.corner_radius = Some(1.0);
        let tip = Point3Dto::new(0.0, 0.0, 0.0);

        // A 6 mm tool with a 1 mm corner has a 2 mm flat at the tip,
        // expands through the quarter-round, then reaches the 3 mm OD.
        assert!(cutter_contains(&tool, tip, Point3Dto::new(2.0, 0.0, 0.0)));
        assert!(!cutter_contains(&tool, tip, Point3Dto::new(2.1, 0.0, 0.0)));
        assert!(cutter_contains(&tool, tip, Point3Dto::new(2.8, 0.0, 0.5)));
        assert!(!cutter_contains(&tool, tip, Point3Dto::new(2.95, 0.0, 0.5)));
        assert!(cutter_contains(&tool, tip, Point3Dto::new(3.0, 0.0, 1.0)));
    }

    #[test]
    fn chamfer_mill_envelope_honors_the_conical_profile() {
        let mut tool = document().tools.remove(0);
        tool.kind = CamToolKind::ChamferMill;
        tool.point_angle_degrees = Some(90.0);
        tool.corner_radius = None;
        let tip = Point3Dto::new(0.0, 0.0, 0.0);

        // A 6 mm, 90-degree V cutter has a sharp tip and grows by 1 mm
        // radially for each 1 mm above it, until reaching its 3 mm OD.
        assert!(cutter_contains(&tool, tip, Point3Dto::new(0.0, 0.0, 0.0)));
        assert!(!cutter_contains(&tool, tip, Point3Dto::new(0.1, 0.0, 0.0)));
        assert!(cutter_contains(&tool, tip, Point3Dto::new(1.0, 0.0, 1.0)));
        assert!(!cutter_contains(&tool, tip, Point3Dto::new(1.1, 0.0, 1.0)));
        assert!(cutter_contains(&tool, tip, Point3Dto::new(3.0, 0.0, 3.0)));
        assert!(cutter_contains(&tool, tip, Point3Dto::new(3.0, 0.0, 4.0)));
    }

    #[test]
    fn material_removal_respects_face_mill_radii_and_end_mill_chamfers() {
        let mut tool = document().tools.remove(0);
        tool.diameter = 6.; tool.flute_length = 8.; tool.overall_length = 30.;
        let envelope = StockBoxDto { min: Point3Dto::new(-4.,-4.,-4.), max: Point3Dto::new(4.,4.,0.) };
        let spec = GridSpec::for_stock(&envelope, Some(0.125), HARD_MAX_VOXELS).unwrap();
        let remove = |tool: &CamToolDto| {
            let mut stock = VoxelStock::filled(&spec, |_| true);
            stock.sweep_tool(tool, Point3Dto::new(0.,0.,-3.), Point3Dto::new(0.,0.,-3.), ToolSweepOptions {
                mode: SweepMode::RemoveMaterial, total_samples: &mut 0, verification: None, cancellation: None,
            }).unwrap().removed
        };
        tool.kind = CamToolKind::FlatEndMill;
        let flat = remove(&tool);
        tool.kind = CamToolKind::FaceMill; tool.corner_radius = Some(1.);
        let rounded = remove(&tool);
        tool.kind = CamToolKind::FlatEndMill; tool.corner_radius = None;
        tool.corner_chamfer = Some(crate::CamCornerChamferDto { width: 1., angle_degrees: 45. });
        let chamfered = remove(&tool);
        assert!(flat > rounded && rounded > chamfered && chamfered > 0);
    }

    #[test]
    fn prepared_target_grid_is_reused_without_resending_meshes() {
        let source = document();
        let setup = &source.setups[0];
        let spec = GridSpec::for_stock(&setup.stock, Some(2.0), HARD_MAX_VOXELS)
            .expect("verification grid spec");
        let key = "simulation-test-prepared-target".to_string();
        let prepared = resolve_verification_grid(
            setup,
            &spec,
            &CamSimulationTargetDto {
                cache_key: Some(key.clone()),
                meshes: vec![box_mesh(setup.stock.min, setup.stock.max)],
                tolerance_mm: 0.1,
            },
        )
        .expect("prepare target grid");
        let reused = resolve_verification_grid(
            setup,
            &spec,
            &CamSimulationTargetDto {
                cache_key: Some(key),
                meshes: vec![],
                tolerance_mm: 0.1,
            },
        )
        .expect("reuse prepared target grid");
        assert!(Arc::ptr_eq(&prepared, &reused));
    }

    #[test]
    fn operation_stage_checkpoint_matches_a_fresh_truncated_simulation() {
        let source = document();
        let target_mesh = box_mesh(source.setups[0].stock.min, source.setups[0].stock.max);
        let cached_target = CamSimulationTargetDto {
            cache_key: Some("simulation-test-operation-stage-cache".to_string()),
            meshes: vec![target_mesh.clone()],
            tolerance_mm: 0.1,
        };
        let full = simulate_setup(
            &source,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                target: Some(cached_target),
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
            },
        )
        .expect("prepare full setup checkpoints");
        let cached = simulate_setup(
            &source,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                target: Some(CamSimulationTargetDto {
                    cache_key: Some("simulation-test-operation-stage-cache".to_string()),
                    meshes: vec![],
                    tolerance_mm: 0.1,
                }),
                through_operation_id: Some(1),
                completed_steps: None,
                playback_time_seconds: None,
            },
        )
        .expect("reuse first-operation checkpoint");
        let fresh = simulate_setup(
            &source,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                target: Some(CamSimulationTargetDto {
                    cache_key: None,
                    meshes: vec![target_mesh],
                    tolerance_mm: 0.1,
                }),
                through_operation_id: Some(1),
                completed_steps: None,
                playback_time_seconds: None,
            },
        )
        .expect("fresh first-operation simulation");

        assert_eq!(cached.remaining_voxels, fresh.remaining_voxels);
        assert_eq!(cached.removed_voxels, fresh.removed_voxels);
        assert_eq!(cached.steps, fresh.steps);
        assert_eq!(cached.collisions, fresh.collisions);
        assert_eq!(cached.stock_mesh, fresh.stock_mesh);
        assert_eq!(cached.comparison, fresh.comparison);

        let completed_steps = full.steps.len().saturating_sub(1).max(1);
        let cached_frame = simulate_setup(
            &source,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                target: Some(CamSimulationTargetDto {
                    cache_key: Some("simulation-test-operation-stage-cache".to_string()),
                    meshes: vec![],
                    tolerance_mm: 0.1,
                }),
                through_operation_id: None,
                completed_steps: Some(completed_steps),
                playback_time_seconds: None,
            },
        )
        .expect("resume playback from operation checkpoint");
        let fresh_frame = simulate_setup(
            &source,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                target: Some(CamSimulationTargetDto {
                    cache_key: None,
                    meshes: vec![box_mesh(
                        source.setups[0].stock.min,
                        source.setups[0].stock.max,
                    )],
                    tolerance_mm: 0.1,
                }),
                through_operation_id: None,
                completed_steps: Some(completed_steps),
                playback_time_seconds: None,
            },
        )
        .expect("fresh playback frame");
        assert_eq!(cached_frame.remaining_voxels, fresh_frame.remaining_voxels);
        assert_eq!(cached_frame.steps, fresh_frame.steps);
        assert_eq!(cached_frame.stock_mesh, fresh_frame.stock_mesh);
        assert_eq!(cached_frame.comparison, fresh_frame.comparison);
    }

    #[test]
    fn a_cancelled_native_request_stops_before_simulation() {
        let cancellation = CamSimulationCancellation::default();
        cancellation.cancel();
        let error = simulate_setup_with_cancellation(
            &document(),
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                target: None,
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
            },
            Some(&cancellation),
        )
        .expect_err("cancelled request must stop");
        assert!(error.to_string().contains("superseded"));
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
                target: None,
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
            },
        )
        .expect("simulation");
        assert!(result.removed_voxels > 0);
        assert!(result.remaining_voxels < result.initial_voxels);
        assert!(result.removed_volume_mm3 > 0.0);
        let stock_mesh = result.stock_mesh.as_ref().unwrap();
        assert!(stock_mesh.triangle_count >= 12);
        assert_eq!(stock_mesh.normals.len(), stock_mesh.positions.len());
        assert!(stock_mesh.normals.iter().all(|value| value.is_finite()));
        assert!(!result.steps.is_empty());
        let resolution_warning = result
            .warnings
            .iter()
            .find(|warning| warning.starts_with("3D stock is voxelized at"))
            .expect("actual preview resolution is operator-visible");
        assert!(resolution_warning.contains("1.000 × 1.000 × 1.000 mm per cell"));
        assert!(resolution_warning.contains("one cell"));
    }

    #[test]
    fn voxel_simulation_is_deterministic() {
        let request = CamSimulationRequestDto {
            setup_id: 1,
            voxel_size: Some(1.5),
            max_voxels: None,
            stock_mesh: None,
            target: None,
            through_operation_id: None,
            completed_steps: None,
            playback_time_seconds: None,
        };
        let first = simulate_setup(&document(), &request).expect("first simulation");
        let second = simulate_setup(&document(), &request).expect("second simulation");
        assert_eq!(first, second);
    }

    #[test]
    fn target_comparison_reports_an_honest_effective_tolerance() {
        let mut source = document();
        source.setups[0].operations.truncate(1);
        let mut target_max = source.setups[0].stock.max;
        target_max.z = -1.0;
        let result = simulate_setup(
            &source,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                target: Some(CamSimulationTargetDto {
                    cache_key: None,
                    meshes: vec![box_mesh(source.setups[0].stock.min, target_max)],
                    tolerance_mm: 0.1,
                }),
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
            },
        )
        .expect("target comparison");
        let comparison = result.comparison.expect("comparison result");
        assert!(comparison.target_voxels < result.initial_voxels);
        assert_eq!(comparison.excess_voxels, 0);
        assert_eq!(comparison.gouged_voxels, 0);
        assert_eq!(comparison.initial_shortfall_voxels, 0);
        assert!((comparison.requested_tolerance_mm - 0.1).abs() < 1.0e-9);
        assert!((comparison.effective_tolerance_mm - 3.0f64.sqrt()).abs() < 1.0e-9);
    }

    #[test]
    fn target_voxelization_discloses_unpaired_surface_crossings() {
        let mut source = document();
        source.setups[0].operations.truncate(1);
        let mut mesh = box_mesh(source.setups[0].stock.min, source.setups[0].stock.max);
        let first_extra_vertex = u32::try_from(mesh.positions.len() / 3).unwrap();
        mesh.positions.extend([
            2.0, 2.0, -3.0, // one open horizontal triangle inside the box
            8.0, 2.0, -3.0, 2.0, 8.0, -3.0,
        ]);
        mesh.indices.extend([
            first_extra_vertex,
            first_extra_vertex + 1,
            first_extra_vertex + 2,
        ]);
        let result = simulate_setup(
            &source,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                target: Some(CamSimulationTargetDto {
                    cache_key: None,
                    meshes: vec![mesh],
                    tolerance_mm: 0.1,
                }),
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
            },
        )
        .expect("best-effort target comparison with disclosed parity damage");
        assert!(result.warnings.iter().any(|warning| {
            warning.contains("target body 1 voxelization found")
                && warning.contains("unpaired surface crossings")
        }));
    }

    #[test]
    fn target_gouge_is_attributed_to_the_cutting_step() {
        let mut source = document();
        source.setups[0].operations.truncate(1);
        if let CamOperationDto::Face { target_z, .. } = &mut source.setups[0].operations[0] {
            *target_z = -3.0;
        }
        let result = simulate_setup(
            &source,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                target: Some(CamSimulationTargetDto {
                    cache_key: None,
                    meshes: vec![box_mesh(
                        source.setups[0].stock.min,
                        source.setups[0].stock.max,
                    )],
                    tolerance_mm: 0.0,
                }),
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
            },
        )
        .expect("gouge comparison");
        let comparison = result.comparison.expect("comparison result");
        assert!(comparison.gouged_voxels > 0);
        assert!(comparison.gouge_mesh.is_some());
        assert!(result.steps.iter().any(|step| step.gouged_voxels > 0));
        assert!(result
            .collisions
            .iter()
            .any(|issue| { issue.kind == CamSimulationCollisionKindDto::TargetGouge }));
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
                target: None,
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
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
                target: None,
                through_operation_id: Some(1),
                completed_steps: None,
                playback_time_seconds: None,
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
                target: None,
                through_operation_id: Some(2),
                completed_steps: None,
                playback_time_seconds: None,
            },
        )
        .expect("through-last simulation");
        assert_eq!(through_last.removed_voxels, full.removed_voxels);
    }

    #[test]
    fn zero_step_frame_preserves_the_setups_incoming_stock() {
        let result = simulate_setup(
            &document(),
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                target: None,
                through_operation_id: None,
                completed_steps: Some(0),
                playback_time_seconds: None,
            },
        )
        .expect("incoming-stock frame");
        assert_eq!(result.remaining_voxels, result.initial_voxels);
        assert_eq!(result.removed_voxels, 0);
        assert!(result.steps.is_empty());
        assert_eq!(result.completed_steps, Some(0));
    }

    fn contour_document(mode: CompensationMode) -> CamDocumentDto {
        let mut source = document();
        source.setups[0].operations = vec![CamOperationDto::Contour2d {
            id: 1,
            name: "Boss wall".to_string(),
            enabled: true,
            tool_id: 1,
            // A CCW rectangle; outside compensation tracks the tool's outer
            // edge along the wall.
            path: vec![
                Point2Dto::new(5.0, 5.0),
                Point2Dto::new(15.0, 5.0),
                Point2Dto::new(15.0, 11.0),
                Point2Dto::new(5.0, 11.0),
            ],
            closed: true,
            top_z: 0.0,
            bottom_z: -2.0,
            step_down: 2.0,
            compensation: ContourCompensation::Outside,
            compensation_mode: mode,
            lead_in: 5.0,
            lead_out: 5.0,
            lead_arc_radius: None,
            direction: MillingDirection::Climb,
            roughing_passes: 1,
            roughing_step_over: None,
            finishing_pass: false,
            finish_allowance: 0.0,
            finish_feed: None,
            spring_pass: false,
            chain_ref: None,
            clearance_z: 5.0,
            retract_z: 2.0,
            feed_height_z: 1.0,
            cutting: CuttingParametersDto {
                spindle_rpm: 8_000,
                feed_xy: 600.0,
                feed_z: 180.0,
                coolant: CoolantMode::Off,
            },
        }];
        source
    }

    /// World-space voxel occupancy probe (true when the cell containing the
    /// point was cut away).
    fn removed_at(stock: &VoxelStock, x: f64, y: f64, z: f64) -> bool {
        let ix = ((x - stock.min.x) / stock.cell_size[0]).floor() as isize;
        let iy = ((y - stock.min.y) / stock.cell_size[1]).floor() as isize;
        let iz = ((z - stock.min.z) / stock.cell_size[2]).floor() as isize;
        !stock.occupied_at([ix, iy, iz])
    }

    #[test]
    fn in_control_simulation_cuts_to_the_contour_not_past_it() {
        let document = contour_document(CompensationMode::InControl);
        let setup = document.setup(1).expect("setup");
        let spec = GridSpec::for_stock(&setup.stock, Some(0.5), 4_000_000).expect("grid");
        let mut stock = initial_stock(&document, setup, &spec, None, None).expect("stock");
        let program = plan_setup(&document, 1).expect("plan");
        run_program(
            &document,
            &program,
            &mut stock,
            ProgramRunOptions {
                collect: true,
                completed_steps: None,
                source_lines: &[],
                verification: None,
                checkpoints: None,
                cancellation: None,
                resume: None,
            },
        )
        .expect("run");
        // r = 3 outside the CCW rectangle: the band from the wall (x = 5)
        // outward is removed...
        assert!(removed_at(&stock, 3.0, 8.0, -1.0));
        // ...and the wall is the finish line: everything inside the boss
        // stays, right up to the wall. A simulation that forgot the machine's
        // radius offset would sweep the centerline on the contour and cut
        // this probe away.
        assert!(!removed_at(&stock, 5.5, 8.0, -1.0));
        assert!(!removed_at(&stock, 10.0, 8.0, -1.0));
    }

    /// Contour-only document for the compensation matrix tests: one contour
    /// op with the given mode/side on an arbitrary path (r = 3 tool, stock
    /// 0..20 x 0..16 x -6..0, probes read at z = -1).
    fn contour_case_document(
        mode: CompensationMode,
        compensation: ContourCompensation,
        path: Vec<Point2Dto>,
        closed: bool,
    ) -> CamDocumentDto {
        let mut source = document();
        source.setups[0].operations = vec![CamOperationDto::Contour2d {
            id: 1,
            name: "Contour case".to_string(),
            enabled: true,
            tool_id: 1,
            path,
            closed,
            top_z: 0.0,
            bottom_z: -2.0,
            step_down: 2.0,
            compensation,
            compensation_mode: mode,
            lead_in: 5.0,
            lead_out: 5.0,
            lead_arc_radius: None,
            direction: MillingDirection::Climb,
            roughing_passes: 1,
            roughing_step_over: None,
            finishing_pass: false,
            finish_allowance: 0.0,
            finish_feed: None,
            spring_pass: false,
            chain_ref: None,
            clearance_z: 5.0,
            retract_z: 2.0,
            feed_height_z: 1.0,
            cutting: CuttingParametersDto {
                spindle_rpm: 8_000,
                feed_xy: 600.0,
                feed_z: 180.0,
                coolant: CoolantMode::Off,
            },
        }];
        source
    }

    fn run_contour_case(document: &CamDocumentDto) -> VoxelStock {
        let setup = document.setup(1).expect("setup");
        let spec = GridSpec::for_stock(&setup.stock, Some(0.5), 4_000_000).expect("grid");
        let mut stock = initial_stock(document, setup, &spec, None, None).expect("stock");
        let program = plan_setup(document, 1).expect("plan");
        run_program(
            document,
            &program,
            &mut stock,
            ProgramRunOptions {
                collect: true,
                completed_steps: None,
                source_lines: &[],
                verification: None,
                checkpoints: None,
                cancellation: None,
                resume: None,
            },
        )
        .expect("run");
        stock
    }

    // Mathematically CW winding of the (5,5)-(15,5)-(15,11)-(5,11) rectangle.
    fn cw_boss_rect() -> Vec<Point2Dto> {
        vec![
            Point2Dto::new(5.0, 5.0),
            Point2Dto::new(5.0, 11.0),
            Point2Dto::new(15.0, 11.0),
            Point2Dto::new(15.0, 5.0),
        ]
    }

    // A wide CCW ring (2,1)-(18,1)-(18,15)-(2,15) whose inside band leaves
    // the middle of the interior standing (the ring is taller than 4r, so
    // the top and bottom wall bands cannot meet in the middle).
    fn ccw_wide_ring() -> Vec<Point2Dto> {
        vec![
            Point2Dto::new(2.0, 1.0),
            Point2Dto::new(18.0, 1.0),
            Point2Dto::new(18.0, 15.0),
            Point2Dto::new(2.0, 15.0),
        ]
    }

    fn assert_outside_band_removed(stock: &VoxelStock) {
        // r = 3 outside the wall (x = 5): the exterior band is removed, the
        // interior survives right up to the wall.
        assert!(removed_at(stock, 3.0, 8.0, -1.0));
        assert!(!removed_at(stock, 5.5, 8.0, -1.0));
        assert!(!removed_at(stock, 10.0, 8.0, -1.0));
    }

    fn assert_inside_band_removed(stock: &VoxelStock) {
        // r = 3 inside the wide ring: the wall band (x in 2..8) is cleared,
        // the middle of the interior and the exterior stock survive.
        assert!(removed_at(stock, 4.0, 8.0, -1.0));
        assert!(!removed_at(stock, 10.0, 8.0, -1.0));
        assert!(!removed_at(stock, 0.5, 12.0, -1.0));
    }

    #[test]
    fn in_control_simulation_offsets_outside_for_cw_winding() {
        let stock = run_contour_case(&contour_case_document(
            CompensationMode::InControl,
            ContourCompensation::Outside,
            cw_boss_rect(),
            true,
        ));
        assert_outside_band_removed(&stock);
    }

    #[test]
    fn in_control_simulation_offsets_inside_for_ccw_winding() {
        let stock = run_contour_case(&contour_case_document(
            CompensationMode::InControl,
            ContourCompensation::Inside,
            ccw_wide_ring(),
            true,
        ));
        assert_inside_band_removed(&stock);
    }

    #[test]
    fn in_control_simulation_offsets_inside_for_cw_winding() {
        let mut ring = ccw_wide_ring();
        ring.reverse();
        let stock = run_contour_case(&contour_case_document(
            CompensationMode::InControl,
            ContourCompensation::Inside,
            ring,
            true,
        ));
        assert_inside_band_removed(&stock);
    }

    #[test]
    fn in_control_simulation_offsets_open_chains_to_their_side() {
        let chain = || vec![Point2Dto::new(5.0, 8.0), Point2Dto::new(15.0, 8.0)];
        // Left of +X travel is +Y: the band above the chain is removed, the
        // material below survives.
        let left = run_contour_case(&contour_case_document(
            CompensationMode::InControl,
            ContourCompensation::Left,
            chain(),
            false,
        ));
        assert!(removed_at(&left, 10.0, 10.0, -1.0));
        assert!(!removed_at(&left, 10.0, 6.0, -1.0));
        let right = run_contour_case(&contour_case_document(
            CompensationMode::InControl,
            ContourCompensation::Right,
            chain(),
            false,
        ));
        assert!(removed_at(&right, 10.0, 6.0, -1.0));
        assert!(!removed_at(&right, 10.0, 10.0, -1.0));
    }

    #[test]
    fn in_software_and_in_control_remove_the_same_band() {
        // The planner offsets in software mode, the control offsets in
        // control mode — either way the same material must go.
        let software = run_contour_case(&contour_case_document(
            CompensationMode::InSoftware,
            ContourCompensation::Outside,
            cw_boss_rect(),
            true,
        ));
        assert_outside_band_removed(&software);
    }

    /// Arc leads keep the tool off the wall line on entry; with machine
    /// compensation active the simulator tessellates the arcs into chords
    /// inside the buffered compensation block. The removed band must still
    /// be exactly the diameter-wide strip outside the wall.
    #[test]
    fn in_control_arc_leads_remove_the_same_band() {
        let mut document = contour_document(CompensationMode::InControl);
        if let CamOperationDto::Contour2d {
            lead_arc_radius, ..
        } = &mut document.setups[0].operations[0]
        {
            *lead_arc_radius = Some(1.5);
        }
        let stock = run_contour_case(&document);
        assert_outside_band_removed(&stock);
    }

    /// Regression probe for a reported "overcut": a face-mill-class Ø63 tool
    /// contouring a 20 x 12 boss. The compensated band around a profile is
    /// exactly one tool DIAMETER wide (the inner edge finishes on the wall,
    /// the outer edge reaches one diameter out), so with a cutter much larger
    /// than the part the simulation legitimately clears most of the
    /// surrounding stock. What must never happen is cutting into the part
    /// itself, and stock beyond the band must survive.
    #[test]
    fn in_control_large_tool_clears_a_diameter_wide_band_not_the_part() {
        let mut document = contour_case_document(
            CompensationMode::InControl,
            ContourCompensation::Outside,
            vec![
                Point2Dto::new(90.0, 70.0),
                Point2Dto::new(110.0, 70.0),
                Point2Dto::new(110.0, 82.0),
                Point2Dto::new(90.0, 82.0),
            ],
            true,
        );
        document.setups[0].stock = StockBoxDto {
            min: Point3Dto::new(0.0, 0.0, -6.0),
            max: Point3Dto::new(200.0, 160.0, 0.0),
        };
        document.tools[0] = CamToolDto {
            id: 1,
            number: Some(1),
            name: "63 mm face mill".to_string(),
            kind: CamToolKind::FaceMill,
            diameter: 63.0,
            flute_length: 12.0,
            overall_length: 60.0,
            center_cutting: true,
            flute_count: 6,
            point_angle_degrees: None,
            corner_radius: None,
            corner_chamfer: None,
            cutting: CuttingParametersDto::default(),
            cutting_presets: vec![],
            default_step_down: None,
            default_step_over: None,
        };
        // In-control activation requires leads longer than the tool radius.
        if let CamOperationDto::Contour2d {
            lead_in, lead_out, ..
        } = &mut document.setups[0].operations[0]
        {
            *lead_in = 40.0;
            *lead_out = 40.0;
        }
        let stock = run_contour_case(&document);
        // The diameter-wide band outside the walls is removed...
        assert!(removed_at(&stock, 88.0, 76.0, -1.0));
        assert!(removed_at(&stock, 95.0, 30.0, -1.0));
        // ...the part survives right up to its walls, including immediately
        // inside the activation/cancellation corner...
        assert!(!removed_at(&stock, 105.0, 76.0, -1.0));
        assert!(!removed_at(&stock, 109.0, 76.0, -1.0));
        assert!(!removed_at(&stock, 95.0, 81.0, -1.0));
        assert!(!removed_at(&stock, 91.0, 71.0, -1.0));
        // ...and stock well beyond the band is untouched.
        assert!(!removed_at(&stock, 10.0, 10.0, -1.0));
        assert!(!removed_at(&stock, 190.0, 76.0, -1.0));

        // A small requested lead radius is the physical cutter-center
        // radius. The planner enlarges the programmed arc by the tool radius
        // before G42, so even a Ø63 cutter keeps the same safe corner.
        if let CamOperationDto::Contour2d {
            lead_arc_radius, ..
        } = &mut document.setups[0].operations[0]
        {
            *lead_arc_radius = Some(2.0);
        }
        let arc_stock = run_contour_case(&document);
        assert!(!removed_at(&arc_stock, 91.0, 71.0, -1.0));
        assert!(!removed_at(&arc_stock, 105.0, 76.0, -1.0));
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
                target: None,
                through_operation_id: Some(99),
                completed_steps: None,
                playback_time_seconds: None,
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
                target: None,
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
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
                target: None,
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
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
                target: None,
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
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
                target: None,
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
            },
        )
        .expect("first setup simulation");
        let mut document = document();
        let mut second = document.setups[0].clone();
        second.id = 2;
        second.name = "Second clamping group".to_string();
        second.stock_spec = crate::model::CamStockSpecDto::RestFromSetup { setup_id: 1 };
        second.resolved_stock = CamResolvedStockDto::Rest { source_setup_id: 1 };
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
            direction: FaceDirection::BothWays,
            clearance_z: 5.0,
            retract_z: 2.0,
            feed_height_z: 1.0,
            cutting: CuttingParametersDto {
                spindle_rpm: 8_000,
                feed_xy: 600.0,
                feed_z: 180.0,
                coolant: CoolantMode::Off,
            },
        }];
        second.operations.iter_mut().for_each(|operation| {
            if let CamOperationDto::Face { id, .. } = operation {
                *id = 3;
            }
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
                target: None,
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
            },
        )
        .expect("rest simulation");
        // The second setup starts from what the first left behind, and the
        // corner face still removes its own material.
        assert_eq!(result.initial_voxels, first.remaining_voxels);
        assert!(result.removed_voxels > 0);

        let incoming = simulate_setup(
            &document,
            &CamSimulationRequestDto {
                setup_id: 2,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                target: None,
                through_operation_id: None,
                completed_steps: Some(0),
                playback_time_seconds: None,
            },
        )
        .expect("rest setup incoming-stock frame");
        assert_eq!(incoming.initial_voxels, first.remaining_voxels);
        assert_eq!(incoming.remaining_voxels, first.remaining_voxels);
        assert_eq!(incoming.removed_voxels, 0);
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
        document.setups[0].stock_spec = crate::model::CamStockSpecDto::ModelBody { body_id: 9 };
        document.setups[0].resolved_stock = CamResolvedStockDto::ModelBody { body_id: 9 };
        let result = simulate_setup(
            &document,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: Some(CamStockMeshDto { positions, indices }),
                target: None,
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
            },
        )
        .expect("model-body simulation");
        // Exactly the 10 x 8 x 4 cell block is material before cutting.
        assert_eq!(result.initial_voxels, 320);
        assert!(result.removed_voxels > 0);
        assert!(result.remaining_voxels < 320);
    }

    #[test]
    fn rest_stock_chain_accepts_the_source_modeled_body_mesh() {
        let mesh = box_mesh(
            Point3Dto::new(2.0, 2.0, -4.0),
            Point3Dto::new(12.0, 10.0, 0.0),
        );
        let mut source = document();
        source.setups[0].stock_spec = crate::model::CamStockSpecDto::ModelBody { body_id: 9 };
        source.setups[0].resolved_stock = CamResolvedStockDto::ModelBody { body_id: 9 };
        source.setups[0].operations.truncate(1);

        let mut rest = source.setups[0].clone();
        rest.id = 2;
        rest.name = "Rest from modeled stock".to_string();
        rest.stock_spec = crate::model::CamStockSpecDto::RestFromSetup { setup_id: 1 };
        rest.resolved_stock = CamResolvedStockDto::Rest { source_setup_id: 1 };
        rest.operations.truncate(1);
        if let CamOperationDto::Face { id, .. } = &mut rest.operations[0] {
            *id = 3;
        }
        source.setups.push(rest);
        source.active_setup_id = Some(2);
        source.next_setup_id = 3;
        source.next_operation_id = 4;

        let result = simulate_setup(
            &source,
            &CamSimulationRequestDto {
                setup_id: 2,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: Some(mesh),
                target: Some(CamSimulationTargetDto {
                    cache_key: None,
                    meshes: vec![box_mesh(
                        source.setups[1].stock.min,
                        source.setups[1].stock.max,
                    )],
                    tolerance_mm: 0.0,
                }),
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
            },
        )
        .expect("rest simulation should reuse the source modeled-stock mesh");
        assert!(result.initial_voxels > 0);
        assert!(result.initial_voxels < 320);
        assert!(result.warnings.iter().any(|warning| {
            warning.contains("Starting stock is already missing")
                && warning.contains("earlier rest-source operation")
        }));
    }

    #[test]
    fn modeled_body_stock_fails_closed_without_the_host_mesh() {
        let mut document = document();
        document.setups[0].stock_spec = crate::model::CamStockSpecDto::ModelBody { body_id: 9 };
        document.setups[0].resolved_stock = CamResolvedStockDto::ModelBody { body_id: 9 };
        let error = simulate_setup(
            &document,
            &CamSimulationRequestDto {
                setup_id: 1,
                voxel_size: Some(1.0),
                max_voxels: None,
                stock_mesh: None,
                target: None,
                through_operation_id: None,
                completed_steps: None,
                playback_time_seconds: None,
            },
        )
        .unwrap_err();
        assert!(error.0.contains("supply that body's mesh"));
    }

    fn cached_request(key: &str) -> CamSimulationRequestDto {
        CamSimulationRequestDto {
            setup_id: 1,
            voxel_size: Some(0.5),
            max_voxels: None,
            stock_mesh: None,
            target: Some(CamSimulationTargetDto {
                cache_key: Some(key.into()),
                meshes: vec![box_mesh(
                    Point3Dto::new(0.0, 0.0, -6.0),
                    Point3Dto::new(20.0, 16.0, 0.0),
                )],
                tolerance_mm: 0.1,
            }),
            through_operation_id: None,
            completed_steps: None,
            playback_time_seconds: None,
        }
    }

    #[test]
    fn repeat_selection_reuses_mesh_and_invalidates_changed_tools() {
        let mut doc = document();
        let mut request = cached_request("ready-surface-cache-regression");
        request.through_operation_id = Some(1);
        let first = simulate_setup(&doc, &request).unwrap();
        let extractions = MESH_EXTRACTIONS.with(|count| count.get());
        request.target.as_mut().unwrap().meshes.clear();
        let repeated = simulate_setup(&doc, &request).unwrap();
        assert_eq!(first, repeated);
        assert_eq!(
            MESH_EXTRACTIONS.with(|count| count.get()),
            extractions,
            "a cache hit must not remesh hidden comparison surfaces either"
        );
        doc.tools[0].diameter = 4.0;
        let changed = simulate_setup(&doc, &request).unwrap();
        assert!(MESH_EXTRACTIONS.with(|count| count.get()) > extractions);
        assert_ne!(first.removed_voxels, changed.removed_voxels);
    }

    #[test]
    fn scoped_checkpoints_extend_without_losing_the_later_operation() {
        let doc = document();
        let mut request = cached_request("extending-scoped-stage-regression");
        request.through_operation_id = Some(1);
        let first = simulate_setup(&doc, &request).unwrap();
        request.through_operation_id = None;
        let extended = simulate_setup(&doc, &request).unwrap();
        request.target.as_mut().unwrap().cache_key = None;
        let fresh = simulate_setup(&doc, &request).unwrap();
        assert!(extended.removed_voxels > first.removed_voxels);
        assert_eq!(extended, fresh);
    }

    #[test]
    fn time_frames_cut_partial_moves_and_backward_scrubbing_restores_stock() {
        let doc = document();
        let mut request = cached_request("continuous-frame-regression");
        let complete = simulate_setup(&doc, &request).unwrap();
        let step = complete
            .steps
            .iter()
            .find(|step| {
                step.kind == CamSimulationStepKind::Linear
                    && step.removed_voxels > 100
                    && step.duration_seconds > 0.1
            })
            .unwrap();
        let begin = step.cumulative_seconds - step.duration_seconds;
        request.playback_time_seconds = Some(begin);
        let before = simulate_setup(&doc, &request).unwrap();
        request.playback_time_seconds = Some(begin + step.duration_seconds * 0.5);
        let half = simulate_setup(&doc, &request).unwrap();
        request.playback_time_seconds = Some(step.cumulative_seconds);
        let after = simulate_setup(&doc, &request).unwrap();
        assert!(half.removed_voxels > before.removed_voxels);
        assert!(half.removed_voxels < after.removed_voxels);
        request.playback_time_seconds = Some(begin);
        let rewound = simulate_setup(&doc, &request).unwrap();
        assert_eq!(before.stock_mesh, rewound.stock_mesh);
        assert_eq!(before.remaining_voxels, rewound.remaining_voxels);
        request.playback_time_seconds = Some(complete.estimated_seconds);
        assert_eq!(simulate_setup(&doc, &request).unwrap(), complete);
    }

    #[test]
    fn display_reconstruction_recovers_118_degree_point_and_small_chamfer() {
        for (kind, angle) in [
            (CamToolKind::Drill, 118.0_f64),
            (CamToolKind::ChamferMill, 90.0),
        ] {
            let mut tool = document().tools.remove(0);
            tool.kind = kind;
            tool.point_angle_degrees = Some(angle);
            let mut cuts = surface::DisplayCuts::default();
            let tip = Point3Dto::new(0.0, 0.0, -2.0);
            cuts.record(&tool, tip, tip);
            let refiner = surface::Refiner::new(&cuts, [0.5; 3]);
            let radius = 0.3;
            let z = tip.z + radius / (angle.to_radians() * 0.5).tan();
            let (projected, normal) = refiner.project([radius, 0.0, z + 0.06]).unwrap();
            let expected_z =
                tip.z + projected[0].hypot(projected[1]) / (angle.to_radians() * 0.5).tan();
            assert!((projected[2] - expected_z).abs() < 1e-9);
            assert!((normal[2] as f64 - (angle.to_radians() * 0.5).sin()).abs() < 1e-6);
            assert!(
                normal[0] < 0.0,
                "hole normals point into the removed volume"
            );
            assert!(refiner.project([10.0, 10.0, 0.0]).is_none());
        }
    }

    fn drilled_display_fixture(edge: f64) -> (VoxelStock, CamSimulationMeshDto) {
        let envelope = StockBoxDto {
            min: Point3Dto::new(0.0, 0.0, -12.0),
            max: Point3Dto::new(80.0, 50.0, 0.0),
        };
        let spec = GridSpec::for_stock(&envelope, Some(edge), HARD_MAX_VOXELS).unwrap();
        let mut stock = VoxelStock::filled(&spec, |point| point.z < -1.0);
        let mut tool = document().tools.remove(0);
        tool.kind = CamToolKind::Drill;
        tool.diameter = 8.0;
        tool.point_angle_degrees = Some(118.0);
        for x in [22.0, 58.0] {
            stock
                .sweep_tool(
                    &tool,
                    Point3Dto::new(x, 25.0, 1.0),
                    Point3Dto::new(x, 25.0, -9.1),
                    ToolSweepOptions {
                        mode: SweepMode::RemoveMaterial,
                        total_samples: &mut 0,
                        verification: None,
                        cancellation: None,
                    },
                )
                .unwrap();
        }
        let mesh = stock.greedy_surface_mesh(MAX_SURFACE_TRIANGLES).unwrap();
        (stock, mesh)
    }

    #[test]
    fn curved_hole_faces_never_stretch_into_long_stock_stripes() {
        let (stock, mesh) = drilled_display_fixture(0.5);
        let limit = stock.cell_size.iter().map(|x| x * x).sum::<f64>().sqrt() * 4.0;
        let mut conical = 0;
        for (triangle, normals) in mesh
            .positions
            .chunks_exact(9)
            .zip(mesh.normals.chunks_exact(9))
        {
            let p: Vec<_> = triangle
                .chunks_exact(3)
                .map(|q| [q[0] as f64, q[1] as f64, q[2] as f64])
                .collect();
            let variable_normal = normals
                .chunks_exact(3)
                .any(|n| n.iter().filter(|c| c.abs() > 0.1).count() > 1);
            if variable_normal {
                // A cylindrical wall is an exact vertical extrusion. Merging
                // its Z strips is safe; stretching across XY or the drill cone
                // is the old stripe bug and must remain bounded.
                let sloped = normals.chunks_exact(3).any(|n| n[2].abs() > 0.1);
                for i in 0..3 {
                    let distance = (0..if sloped { 3 } else { 2 })
                        .map(|a| (p[i][a] - p[(i + 1) % 3][a]).powi(2))
                        .sum::<f64>()
                        .sqrt();
                    assert!(
                        distance < limit,
                        "curved vertex stretched into a {distance} mm greedy rectangle"
                    );
                }
            }
            for (point, normal) in p.iter().zip(normals.chunks_exact(3)) {
                let radial = (point[0] - 22.0).hypot(point[1] - 25.0);
                if radial > 0.2 && radial < 3.0 && point[2] < -7.2 {
                    let z = -9.1 + radial / 59.0_f64.to_radians().tan();
                    assert!(
                        (point[2] - z).abs() < 1e-4,
                        "drill floor must follow the actual 118-degree cone: {point:?}, expected z {z}"
                    );
                    assert!(normal[2] > 0.8, "cone normal must face into the hole");
                    conical += 1;
                }
            }
        }
        assert!(conical > 30);
        assert!(mesh.triangle_count < MAX_SURFACE_TRIANGLES);
    }

    #[test]
    fn display_budget_fallback_keeps_closed_stock_and_original_verification_grid() {
        let (stock, _) = drilled_display_fixture(0.5);
        let original = stock.occupied.clone();
        let volume = stock.occupied_count;
        let mut warnings = Vec::new();
        let mesh = stock.presentation_mesh(100, &mut warnings).unwrap();
        assert!(mesh.triangle_count > 0 && mesh.triangle_count <= 100);
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("small features may be obscured")));
        assert_eq!(stock.occupied, original);
        assert_eq!(stock.occupied_count, volume);
        // The display grid preserves the original stock envelope, including
        // odd cell counts. No stride-skipped triangles are used.
        let origin = [stock.min.x, stock.min.y, stock.min.z];
        for axis in 0..3 {
            let min = mesh
                .positions
                .chunks_exact(3)
                .map(|p| p[axis])
                .fold(f32::INFINITY, f32::min);
            let max = mesh
                .positions
                .chunks_exact(3)
                .map(|p| p[axis])
                .fold(f32::NEG_INFINITY, f32::max);
            assert!(min >= origin[axis] as f32 - 1e-4);
            assert!(
                max <= (origin[axis] + stock.dimensions[axis] as f64 * stock.cell_size[axis])
                    as f32
                    + 1e-4
            );
        }
    }

    #[test]
    fn deep_fine_drill_stock_and_all_playback_samples_stay_presentable() {
        let mut doc = document();
        doc.setups[0].stock = StockBoxDto {
            min: Point3Dto::new(0.0, 0.0, -14.0),
            max: Point3Dto::new(34.0, 19.0, 0.0),
        };
        doc.tools[0].kind = CamToolKind::Drill;
        doc.tools[0].point_angle_degrees = Some(118.0);
        doc.tools[0].flute_length = 20.0;
        doc.setups[0].operations = vec![serde_json::from_value(serde_json::json!({
            "kind":"drill", "id":1, "tool_id":1, "name":"Fine deep holes", "enabled":true,
            "points":[{"x":10.0,"y":9.5},{"x":24.0,"y":9.5}], "holes":[],
            "top_z":0.0,"bottom_z":-12.0,"clearance_z":5.0,"retract_z":2.0,"feed_height_z":1.0,
            "cycle":"chip_breaking","peck_depth":4.0,"peck_retract":0.1,"dwell_seconds":0.0,
            "cutting":{"spindle_rpm":6000,"feed_xy":300.0,"feed_z":120.0,"coolant":"off"}
        }))
        .unwrap()];
        let request: CamSimulationRequestDto =
            serde_json::from_value(serde_json::json!({"setup_id":1,"voxel_size":0.109})).unwrap();
        let complete = simulate_setup(&doc, &request).unwrap();
        assert!(complete.stock_mesh.as_ref().unwrap().triangle_count <= MAX_SURFACE_TRIANGLES);
        let mut playback = CamPlayback::new(doc, request, 0.0, None).unwrap();
        let mut surface = None;
        for time in [
            0.0,
            complete.estimated_seconds * 0.25,
            complete.estimated_seconds * 0.5,
            complete.estimated_seconds * 0.75,
            complete.estimated_seconds,
        ] {
            let sample = playback.sample(time, None).unwrap();
            if let Some(mesh) = sample.stock_mesh {
                surface = Some(mesh);
            }
            assert!(surface.as_ref().is_some_and(
                |mesh| mesh.triangle_count > 0 && mesh.triangle_count <= MAX_SURFACE_TRIANGLES
            ));
            if time == complete.estimated_seconds {
                assert_eq!(sample.remaining_voxels, complete.remaining_voxels);
            }
        }
    }

    #[test]
    fn prepared_playback_reuses_air_moves_and_matches_seek_results() {
        let doc = document();
        let request = cached_request("prepared-buffer-regression");
        let complete = simulate_setup(&doc, &request).unwrap();
        let mut player = CamPlayback::new(doc.clone(), request.clone(), 0.0, None).unwrap();
        let initial = player.sample(0.0, None).unwrap();
        assert!(initial.stock_mesh.is_some());
        let count = MESH_EXTRACTIONS.with(|count| count.get());
        assert!(player.sample(0.0, None).unwrap().stock_mesh.is_none());
        assert_eq!(count, MESH_EXTRACTIONS.with(|count| count.get()));
        let cut = complete
            .steps
            .iter()
            .find(|step| step.removed_voxels > 100)
            .unwrap();
        let middle = cut.cumulative_seconds - cut.duration_seconds * 0.5;
        let sample = player.sample(middle, None).unwrap();
        let mut expected_request = request.clone();
        expected_request.playback_time_seconds = Some(middle);
        let expected = simulate_setup(&doc, &expected_request).unwrap();
        assert_eq!(sample.remaining_voxels, expected.remaining_voxels);
        assert_eq!(sample.stock_mesh, expected.stock_mesh);
        let final_sample = player.sample(complete.estimated_seconds, None).unwrap();
        assert_eq!(final_sample.remaining_voxels, complete.remaining_voxels);
        assert_eq!(final_sample.stock_mesh, complete.stock_mesh);
        assert_eq!(
            player.sample(0.0, None).unwrap().stock_mesh,
            initial.stock_mesh
        );
        assert!(
            sample.steps.is_empty(),
            "a buffered frame must not copy the full timeline"
        );
    }

    #[test]
    #[ignore = "opt-in release-mode geometry/performance capture"]
    fn capture_drilled_display_mesh() {
        let started = std::time::Instant::now();
        let (stock, mesh) = drilled_display_fixture(80.0 / 352.0);
        eprintln!(
            "CAM display capture: {:?} cells, {} triangles, {:.1} ms",
            stock.dimensions,
            mesh.triangle_count,
            started.elapsed().as_secs_f64() * 1000.0
        );
        if let Some(path) = std::env::var_os("NBCAD_CAM_MESH_CAPTURE") {
            std::fs::write(path, serde_json::to_vec(&mesh).unwrap()).unwrap();
        }
    }

    #[test]
    fn physical_playback_boundaries_match_controller_compensation_and_arc_sweeps() {
        for mode in [CompensationMode::InSoftware, CompensationMode::InControl] {
            let mut doc = contour_document(mode);
            if let CamOperationDto::Contour2d {
                lead_arc_radius, ..
            } = &mut doc.setups[0].operations[0]
            {
                *lead_arc_radius = Some(1.5);
            }
            let mut request = cached_request(&format!("frame-compensation-{mode:?}"));
            let full = simulate_setup(&doc, &request).unwrap();
            let checkpoints: Vec<_> = full
                .steps
                .iter()
                .enumerate()
                .filter(|(_, step)| step.removed_voxels > 0)
                .step_by(3)
                .collect();
            for (index, step) in checkpoints.iter().rev() {
                request.playback_time_seconds = Some(step.cumulative_seconds);
                request.completed_steps = None;
                let frame = simulate_setup(&doc, &request).unwrap();
                request.playback_time_seconds = None;
                request.completed_steps = Some(index + 1);
                let reference = simulate_setup(&doc, &request).unwrap();
                assert_eq!(
                    frame.remaining_voxels, reference.remaining_voxels,
                    "{mode:?} at step {index}"
                );
                assert_eq!(
                    frame.stock_mesh, reference.stock_mesh,
                    "physical playback must not sweep the nominal contour"
                );
            }
        }
    }
}
