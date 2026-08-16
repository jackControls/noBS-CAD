//! Sketch session: live editing state of one sketch on one plane.
//!
//! Provides snap and auto-constraint inference, the Newton-based constraint
//! solver ([`crate::solver`]) running after every mutation, over-constraint
//! rejection with an explicit conflict report (D4.2), rubber-band dragging
//! via solver pinning, locked dynamic-input endpoint math, and the core
//! tool ops (line, midpoint line, point, rectangle, circle, arc). Undo/redo
//! stays snapshot-based, so every mutation (including solver motion and
//! cascades) restores exactly.

use std::collections::BTreeSet;
use std::fmt;

use nbcad_core::{DimensionStyle, EdgeId};

use crate::constraint::{Constraint, ConstraintId};
use crate::dto::{
    AddConstraintResult, AddLineResult, CircleMode, ConstraintDesc, ConstraintDto,
    DeleteEntityResult, DofDto, DragPhase, EntityDesc, EntityDto, Inference, LineTrackingRequest,
    LockedCircleRequest, LockedRectangleRequest, LockedSegmentRequest, MovePointRequest,
    MovePointResult, PreviewDto, RectangleMode, ReferenceMidpointDto, SketchDto, SlotMode,
    SlotRequest, SnapTarget, SplineRequest, ToolResult, TrackingAxis, TrackingGuideDto, UndoResult,
};
use crate::entity::{Entity, EntityId};
use crate::geometry::Vec2;
use crate::plane::{PlaneBasis, PlaneRef};
use crate::project::ProjectSketchV2;
use crate::sketch::{Sketch, SketchSnapshot};
use crate::solver::{self, Analysis};

mod dims;
mod mods;

/// Snap distance tolerance in sketch mm (screen-relative scaling is a
/// frontend concern; the engine works on a fixed modeling tolerance).
pub const SNAP_TOLERANCE_MM: f64 = 2.0;
/// Default grid step in mm; the sketch grid snaps to its intersections when
/// grid snap is on.
pub const GRID_STEP_MM: f64 = 10.0;
/// Finest supported modeling grid: one micrometer in the document's mm
/// coordinate system.
pub const MIN_GRID_STEP_MM: f64 = 0.001;
/// Guard against nonsensical or overflowing host input while still allowing
/// very large civil/architectural sketches.
pub const MAX_GRID_STEP_MM: f64 = 1_000_000.0;
/// H/V inference cone half-angle in degrees.
///
/// Ten degrees gives horizontal/vertical the default bias expected from a
/// mechanical sketcher while leaving deliberate diagonals easy to acquire.
/// Ctrl remains the explicit temporary inference override.
pub const INFERENCE_ANGLE_TOL_DEG: f64 = 10.0;
/// Segments shorter than this are rejected as degenerate.
pub const MIN_LINE_LENGTH_MM: f64 = 1e-6;
/// Distance below which two points are considered the same location.
const MERGE_EPS: f64 = 1e-6;
/// Residual above which a fresh constraint counts as inconsistent (D4.2).
const INCONSISTENT_EPS: f64 = 1e-6;

/// Compact number formatting for literal auto-dim parameters (50 not 50.0).
fn format_number(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{v:.0}")
    } else {
        format!("{v:.4}")
    }
}

/// Errors of the sketch-session API. Serialized at the host boundary; the
/// OverConstrained variant also carries structured conflict data (D4.2).
#[derive(Debug, Clone, PartialEq)]
pub enum SessionError {
    /// `begin_sketch` while another sketch is being edited.
    SketchAlreadyActive,
    /// A drawing op was called without an active sketch session.
    NoActiveSketch,
    /// `edit_sketch` named a sketch that is not in the finished list.
    SketchNotFound(String),
    /// The plane reference cannot be resolved yet (reserved M2/M3 kinds).
    UnsupportedPlane,
    /// A persistent body/face reference no longer resolves after recompute.
    BrokenReference(String),
    /// Solid feature planning/commit error surfaced through the shared host.
    Solid(String),
    /// Zero-length segment (after snapping/projection).
    DegenerateSegment,
    /// The referenced entity does not exist in the active sketch.
    EntityNotFound(EntityId),
    /// The referenced entity is not a point.
    NotAPoint(EntityId),
    NothingToUndo,
    NothingToRedo,
    /// The host supplied a non-finite or unsupported adaptive grid spacing.
    InvalidGridStep(f64),
    /// The constraint/entity-kind combination is not applicable.
    InvalidConstraint(String),
    /// Expression parse/eval failure (D9): the message is user-facing
    /// (unexpected token, unknown parameter, division by zero, cycle).
    Expression(String),
    /// Adding the constraint would over-constrain the sketch (D4.2) —
    /// rejected with the conflicting constraints named.
    OverConstrained {
        rejected: ConstraintDesc,
        conflicts_with: Vec<ConstraintDesc>,
    },
}

impl fmt::Display for SessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SessionError::SketchAlreadyActive => write!(f, "a sketch is already being edited"),
            SessionError::NoActiveSketch => write!(f, "no active sketch"),
            SessionError::SketchNotFound(name) => write!(f, "finished sketch '{name}' not found"),
            SessionError::UnsupportedPlane => {
                write!(f, "plane reference is not currently resolvable")
            }
            SessionError::BrokenReference(message) => {
                write!(f, "broken reference: {message}")
            }
            SessionError::Solid(message) => write!(f, "{message}"),
            SessionError::DegenerateSegment => write!(f, "segment has zero length"),
            SessionError::EntityNotFound(id) => write!(f, "entity {} not found", id.0),
            SessionError::NotAPoint(id) => write!(f, "entity {} is not a point", id.0),
            SessionError::NothingToUndo => write!(f, "nothing to undo"),
            SessionError::NothingToRedo => write!(f, "nothing to redo"),
            SessionError::InvalidGridStep(step) => write!(
                f,
                "grid step must be between {MIN_GRID_STEP_MM} mm and {MAX_GRID_STEP_MM} mm, got {step}"
            ),
            SessionError::InvalidConstraint(msg) => write!(f, "{msg}"),
            SessionError::Expression(msg) => write!(f, "{msg}"),
            SessionError::OverConstrained {
                rejected,
                conflicts_with,
            } => {
                let ents = rejected
                    .entities
                    .iter()
                    .map(|e| e.label.as_str())
                    .collect::<Vec<_>>()
                    .join(" and ");
                if conflicts_with.len() > 4 {
                    return write!(
                        f,
                        "Cannot add {} between {}: conflicts with the existing constrained geometry ({} related constraints)",
                        rejected.kind,
                        ents,
                        conflicts_with.len()
                    );
                }
                let conflicts = conflicts_with
                    .iter()
                    .map(|c| {
                        let ents = c
                            .entities
                            .iter()
                            .map(|e| e.label.as_str())
                            .collect::<Vec<_>>()
                            .join(", ");
                        format!("{}({})", c.kind, ents)
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                write!(
                    f,
                    "Cannot add {} between {}: conflicts with {}",
                    rejected.kind, ents, conflicts
                )
            }
        }
    }
}

impl std::error::Error for SessionError {}

/// One undoable command: exact sketch state before/after the mutation.
/// Snapshot-based on purpose — exact by construction and covers solver
/// motion plus cascading deletes without bespoke inverse logic.
#[derive(Debug)]
struct Command {
    before: SketchSnapshot,
    after: SketchSnapshot,
}

/// Live editing session of one sketch.
#[derive(Debug)]
pub struct SketchSession {
    name: String,
    plane: PlaneRef,
    basis: PlaneBasis,
    sketch: Sketch,
    grid_snap: bool,
    /// Point/origin/coincident snapping (magnet to existing geometry).
    /// The palette "Snap" toggle drives BOTH flags (all snapping off,
    /// owner M1c-ii spec); `grid_snap` alone only governs grid rounding.
    point_snap: bool,
    grid_step: f64,
    snap_tolerance: f64,
    /// Runtime external references derived from the support face. These are
    /// rebuilt from stable edge ids when a face-hosted sketch is opened.
    reference_midpoints: Vec<(EdgeId, Vec2)>,
    undo: Vec<Command>,
    redo: Vec<Command>,
    /// Pre-drag snapshot captured on `DragPhase::Begin`; committed as one
    /// undoable command on `DragPhase::End`.
    pending_drag: Option<SketchSnapshot>,
    /// Last consistent state within a drag — restored when a solver-pinned
    /// update fails to converge.
    last_good_drag: Option<SketchSnapshot>,
    /// Latest solver analysis (drives DOF + fully-defined flags in DTOs).
    analysis: Option<Analysis>,
    /// Dimension annotation style from the document settings (D4.5).
    dimension_style: DimensionStyle,
}

/// Locked dynamic-input state for a commit (values evaluated, raw text
/// preserved for auto-dimension creation, D9).
#[derive(Debug, Clone, Default)]
pub(crate) struct LockedInput {
    pub length_mm: Option<f64>,
    pub angle_deg: Option<f64>,
    pub length_text: Option<String>,
    pub angle_text: Option<String>,
    pub tracking: Option<LineTrackingRequest>,
}

/// Resolved placement of one segment endpoint: the point id to use
/// (existing or newly created) and its coordinates.
enum EndpointResolution {
    Existing(EntityId),
    New(Vec2),
}

impl SketchSession {
    pub fn new(
        name: impl Into<String>,
        plane: PlaneRef,
        basis: PlaneBasis,
        grid_snap: bool,
    ) -> Self {
        Self {
            name: name.into(),
            plane,
            basis,
            sketch: Sketch::new(),
            grid_snap,
            point_snap: true,
            grid_step: GRID_STEP_MM,
            snap_tolerance: SNAP_TOLERANCE_MM,
            reference_midpoints: Vec::new(),
            undo: Vec::new(),
            redo: Vec::new(),
            pending_drag: None,
            last_good_drag: None,
            analysis: None,
            dimension_style: DimensionStyle::default(),
        }
    }

    pub fn set_dimension_style(&mut self, style: DimensionStyle) {
        self.dimension_style = style;
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn plane(&self) -> PlaneRef {
        self.plane
    }

    pub(crate) fn basis(&self) -> PlaneBasis {
        self.basis
    }

    pub(crate) fn set_basis(&mut self, basis: PlaneBasis) {
        self.basis = basis;
    }

    pub(crate) fn set_reference_midpoints(&mut self, midpoints: Vec<(EdgeId, Vec2)>) {
        self.reference_midpoints = midpoints;
    }

    pub fn sketch(&self) -> &Sketch {
        &self.sketch
    }

    pub fn set_grid_snap(&mut self, enabled: bool) {
        // Palette "Snap": enable/disable ALL snapping (grid + point).
        self.grid_snap = enabled;
        self.point_snap = enabled;
    }

    pub fn set_grid_step(&mut self, step_mm: f64) -> Result<(), SessionError> {
        if !step_mm.is_finite() || !(MIN_GRID_STEP_MM..=MAX_GRID_STEP_MM).contains(&step_mm) {
            return Err(SessionError::InvalidGridStep(step_mm));
        }
        self.grid_step = step_mm;
        Ok(())
    }

    pub(crate) fn project_state(&self, feature_id: nbcad_core::FeatureId) -> ProjectSketchV2 {
        ProjectSketchV2 {
            feature_id,
            name: self.name.clone(),
            plane: self.plane,
            basis: self.basis,
            dimension_style: self.dimension_style,
            grid_snap: self.grid_snap,
            snapshot: self.sketch.snapshot(),
        }
    }

    pub(crate) fn from_project_state(state: ProjectSketchV2) -> Result<Self, SessionError> {
        state
            .snapshot
            .validate()
            .map_err(|error| SessionError::Solid(format!("invalid saved sketch: {error}")))?;
        let mut sketch = Sketch::new();
        sketch.restore(state.snapshot);
        let mut session = Self {
            name: state.name,
            plane: state.plane,
            basis: state.basis,
            sketch,
            grid_snap: state.grid_snap,
            point_snap: state.grid_snap,
            grid_step: GRID_STEP_MM,
            snap_tolerance: SNAP_TOLERANCE_MM,
            reference_midpoints: Vec::new(),
            undo: Vec::new(),
            redo: Vec::new(),
            pending_drag: None,
            last_good_drag: None,
            analysis: None,
            dimension_style: state.dimension_style,
        };
        session.recompute();
        Ok(session)
    }

    /// Wrapper so the sibling `mods` module can create dimension params.
    pub(crate) fn param_from_text_pub(
        &mut self,
        kind: crate::params::ParamKind,
        text: Option<&str>,
        measured: f64,
    ) -> Result<crate::params::ParamId, SessionError> {
        self.param_from_text(kind, text, measured)
    }

    // --- Solver integration ---

    /// Re-solve after a mutation and refresh the analysis used by DTOs.
    fn recompute(&mut self) {
        self.analysis = Some(solver::solve(&mut self.sketch, &[]));
    }

    fn analysis(&self) -> Analysis {
        self.analysis
            .clone()
            .unwrap_or_else(|| solver::analyze(&self.sketch))
    }

    // --- Snapping ---

    /// Snap priority: existing point within tolerance > origin within
    /// tolerance > line midpoint (`allow_midpoint`, line flow only) > grid
    /// intersection (when grid snap on) > raw. Point, origin, and midpoint
    /// snaps are governed by `point_snap`, grid rounding by `grid_snap`.
    fn snap_inner(
        &self,
        raw: Vec2,
        allow_midpoint: bool,
        exclude_position: Option<Vec2>,
    ) -> (Vec2, SnapTarget) {
        if self.point_snap {
            if let Some((id, _)) = self
                .sketch
                .entities()
                .filter_map(|(id, entity)| {
                    let Entity::Point { position } = entity else {
                        return None;
                    };
                    if exclude_position
                        .is_some_and(|excluded| position.distance(excluded) <= MERGE_EPS)
                    {
                        return None;
                    }
                    let distance = position.distance(raw);
                    (distance <= self.snap_tolerance).then_some((id, distance))
                })
                .min_by(|a, b| a.1.total_cmp(&b.1))
            {
                let position = self.sketch.point_position(id).unwrap_or(raw);
                return (position, SnapTarget::Point { entity: id });
            }
            if raw.distance(Vec2::ZERO) <= self.snap_tolerance
                && !exclude_position
                    .is_some_and(|excluded| excluded.distance(Vec2::ZERO) <= MERGE_EPS)
            {
                return (Vec2::ZERO, SnapTarget::Origin);
            }
            if allow_midpoint {
                if let Some((id, mid)) = self.sketch.nearest_line_midpoint(raw, self.snap_tolerance)
                {
                    if !exclude_position.is_some_and(|excluded| mid.distance(excluded) <= MERGE_EPS)
                    {
                        return (mid, SnapTarget::Midpoint { entity: id });
                    }
                }
                if let Some((edge, midpoint, _)) = self
                    .reference_midpoints
                    .iter()
                    .filter_map(|(edge, midpoint)| {
                        if exclude_position
                            .is_some_and(|excluded| midpoint.distance(excluded) <= MERGE_EPS)
                        {
                            return None;
                        }
                        let distance = midpoint.distance(raw);
                        (distance <= self.snap_tolerance).then_some((*edge, *midpoint, distance))
                    })
                    .min_by(|a, b| a.2.total_cmp(&b.2))
                {
                    return (midpoint, SnapTarget::ReferenceMidpoint { edge });
                }
            }
        }
        if self.grid_snap {
            let step = self.grid_step;
            let snapped = Vec2::new((raw.x / step).round() * step, (raw.y / step).round() * step);
            if exclude_position.is_some_and(|excluded| snapped.distance(excluded) <= MERGE_EPS) {
                return (raw, SnapTarget::None);
            }
            return (snapped, SnapTarget::Grid);
        }
        (raw, SnapTarget::None)
    }

    fn snap(&self, raw: Vec2) -> (Vec2, SnapTarget) {
        self.snap_inner(raw, false, None)
    }

    /// Line-flow snap (M1d): midpoint snapping is enabled here only, because
    /// the line flow is the one that also auto-creates the matching Midpoint
    /// constraint on commit (D4.1 parity). Holding Ctrl suppresses the
    /// midpoint inference (Ctrl disables inferences).
    fn snap_line_flow(&self, raw: Vec2, ctrl_held: bool) -> (Vec2, SnapTarget) {
        self.snap_inner(raw, !ctrl_held, None)
    }

    /// Endpoint acquisition must not magnetize a short segment back onto its
    /// own start point. Other coincident candidates retain normal priority.
    fn snap_line_endpoint(&self, raw: Vec2, from: Vec2, ctrl_held: bool) -> (Vec2, SnapTarget) {
        self.snap_inner(raw, !ctrl_held, Some(from))
    }

    /// Shared pipeline for `preview_segment` and `add_line`: snap, then
    /// (unless Ctrl is held or the snap is coincident) apply H/V inference
    /// within `INFERENCE_ANGLE_TOL_DEG` of the u/v axes and project the
    /// endpoint onto the inferred direction.
    fn snap_and_infer(&self, from: Vec2, to_raw: Vec2, ctrl_held: bool) -> PreviewDto {
        let (mut snapped, target) = self.snap_line_endpoint(to_raw, from, ctrl_held);
        let mut inferences = Vec::new();

        match target {
            SnapTarget::Point { .. } | SnapTarget::Origin => {
                // Coincident snap wins over directional inference.
                inferences.push(Inference::Coincident);
            }
            SnapTarget::Midpoint { .. } | SnapTarget::ReferenceMidpoint { .. } => {
                // Exact snap: no directional inference; the triangle snap
                // marker is the glyph (D4.1), and commit adds the Midpoint
                // constraint.
            }
            SnapTarget::Grid | SnapTarget::None => {
                if !ctrl_held {
                    // Direction inference follows the RAW cursor ray, not the
                    // already-rounded grid point. Otherwise an off-grid
                    // anchor can turn a visually horizontal line into a
                    // diagonal merely because the grid changed its Y value.
                    let d = to_raw - from;
                    let tol = INFERENCE_ANGLE_TOL_DEG.to_radians().tan();
                    if d.x.abs() >= d.y.abs() && d.y.abs() <= tol * d.x.abs() {
                        snapped.y = from.y;
                        inferences.push(Inference::Horizontal);
                    } else if d.y.abs() > d.x.abs() && d.x.abs() <= tol * d.y.abs() {
                        snapped.x = from.x;
                        inferences.push(Inference::Vertical);
                    }
                }
            }
        }

        PreviewDto {
            snapped_to: snapped,
            snap: target,
            inferences,
            tracking: None,
        }
    }

    /// Preview with optional locked fields. Locks constrain only their own
    /// DOF (D9): point snapping and H/V inference keep working on the
    /// remaining freedom (endpoint on the locked circle/ray, still
    /// snapping to points/axes along it).
    pub fn preview_segment_locked(
        &self,
        from: Vec2,
        length_mm: Option<f64>,
        angle_deg: Option<f64>,
        to_hint: Vec2,
        ctrl_held: bool,
        tracking: Option<LineTrackingRequest>,
    ) -> PreviewDto {
        if length_mm.is_none() && angle_deg.is_none() {
            if !ctrl_held {
                if let Some(preview) = self.tracking_preview(from, None, None, to_hint, tracking) {
                    return preview;
                }
            }
            return self.snap_and_infer(from, to_hint, ctrl_held);
        }
        let angle = angle_deg.map(|a| a.to_radians());
        let mut inferences = Vec::new();

        // Both locked → exact point; only coincident merging still applies.
        if let (Some(l), Some(a)) = (length_mm, angle) {
            let exact = from + Vec2::new(a.cos() * l, a.sin() * l);
            return self.coincident_or_exact(from, exact, inferences);
        }

        let endpoint = if let Some(l) = length_mm {
            // 1. Snap onto an existing point lying on the locked circle.
            if let Some((id, pos)) = self.point_on_circle_locus(from, l, to_hint) {
                inferences.push(Inference::Coincident);
                return PreviewDto {
                    snapped_to: pos,
                    snap: SnapTarget::Point { entity: id },
                    inferences,
                    tracking: None,
                };
            }
            if !ctrl_held {
                if let Some(preview) = self.tracking_preview(from, Some(l), None, to_hint, tracking)
                {
                    return preview;
                }
            }
            // 2. Axis inference on the remaining freedom.
            let d = to_hint - from;
            let tol = INFERENCE_ANGLE_TOL_DEG.to_radians().tan();
            if !ctrl_held && d.x.abs() >= d.y.abs() && d.y.abs() <= tol * d.x.abs() {
                inferences.push(Inference::Horizontal);
                Vec2::new(from.x + l * d.x.signum(), from.y)
            } else if !ctrl_held && d.y.abs() > d.x.abs() && d.x.abs() <= tol * d.y.abs() {
                inferences.push(Inference::Vertical);
                Vec2::new(from.x, from.y + l * d.y.signum())
            } else {
                // 3. Snap the remaining angular freedom to the active
                // engineering grid when the locked circle crosses it.
                if let Some(grid) = self.point_on_circle_grid(from, l, to_hint) {
                    return PreviewDto {
                        snapped_to: grid,
                        snap: SnapTarget::Grid,
                        inferences,
                        tracking: None,
                    };
                }
                // 4. Circle in the cursor's direction.
                let len = d.length();
                if len < MERGE_EPS {
                    from + Vec2::new(l, 0.0)
                } else {
                    from + d * (l / len)
                }
            }
        } else if let Some(a) = angle {
            let dir = Vec2::new(a.cos(), a.sin());
            // 1. Snap onto an existing point lying on the locked ray.
            if let Some((id, pos)) = self.point_on_ray_locus(from, dir, to_hint) {
                inferences.push(Inference::Coincident);
                return PreviewDto {
                    snapped_to: pos,
                    snap: SnapTarget::Point { entity: id },
                    inferences,
                    tracking: None,
                };
            }
            if !ctrl_held {
                if let Some(preview) = self.tracking_preview(from, None, Some(a), to_hint, tracking)
                {
                    return preview;
                }
            }
            // 2. Intersect the locked ray with the nearest active grid line.
            if let Some(grid) = self.point_on_ray_grid(from, dir, to_hint) {
                return PreviewDto {
                    snapped_to: grid,
                    snap: SnapTarget::Grid,
                    inferences,
                    tracking: None,
                };
            }
            // 3. Project the cursor onto the ray.
            let t = (to_hint - from).dot(dir).max(0.0);
            from + dir * t
        } else {
            unreachable!()
        };

        self.coincident_or_exact(from, endpoint, inferences)
    }

    /// Resolve a viewport-acquired horizontal/vertical tracking reference
    /// against the segment's remaining degrees of freedom. The viewport
    /// decides *which* point is close in screen space; this engine function
    /// performs the exact intersection and reports the guide that will become
    /// a persistent point-pair relation on commit.
    fn tracking_preview(
        &self,
        from: Vec2,
        length_mm: Option<f64>,
        angle_rad: Option<f64>,
        cursor: Vec2,
        request: Option<LineTrackingRequest>,
    ) -> Option<PreviewDto> {
        let request = request?;
        let source = self.sketch.point_position(request.point)?;
        if length_mm.is_some() && angle_rad.is_some() {
            return None;
        }

        let snapped = match (length_mm, angle_rad, request.axis) {
            (None, None, TrackingAxis::Horizontal) => Vec2::new(
                if self.grid_snap {
                    (cursor.x / self.grid_step).round() * self.grid_step
                } else {
                    cursor.x
                },
                source.y,
            ),
            (None, None, TrackingAxis::Vertical) => Vec2::new(
                source.x,
                if self.grid_snap {
                    (cursor.y / self.grid_step).round() * self.grid_step
                } else {
                    cursor.y
                },
            ),
            (None, Some(angle), axis) => {
                let direction = Vec2::new(angle.cos(), angle.sin());
                self.ray_axis_intersection(from, direction, source, axis)?
            }
            (Some(length), None, axis) => {
                self.circle_axis_intersection(from, length, source, axis, cursor)?
            }
            (Some(_), Some(_), _) => return None,
        };
        if !snapped.x.is_finite()
            || !snapped.y.is_finite()
            || snapped.distance(from) < MIN_LINE_LENGTH_MM
        {
            return None;
        }
        Some(PreviewDto {
            snapped_to: snapped,
            snap: if self.grid_snap {
                SnapTarget::Grid
            } else {
                SnapTarget::None
            },
            inferences: Vec::new(),
            tracking: Some(TrackingGuideDto {
                point: request.point,
                axis: request.axis,
                source,
                snapped_to: snapped,
            }),
        })
    }

    fn ray_axis_intersection(
        &self,
        from: Vec2,
        direction: Vec2,
        source: Vec2,
        axis: TrackingAxis,
    ) -> Option<Vec2> {
        let t = match axis {
            TrackingAxis::Horizontal if direction.y.abs() > MERGE_EPS => {
                (source.y - from.y) / direction.y
            }
            TrackingAxis::Vertical if direction.x.abs() > MERGE_EPS => {
                (source.x - from.x) / direction.x
            }
            _ => return None,
        };
        (t >= -MERGE_EPS).then_some(from + direction * t.max(0.0))
    }

    fn circle_axis_intersection(
        &self,
        from: Vec2,
        radius: f64,
        source: Vec2,
        axis: TrackingAxis,
        cursor: Vec2,
    ) -> Option<Vec2> {
        let (fixed_delta, first, second) = match axis {
            TrackingAxis::Horizontal => {
                let dy = source.y - from.y;
                let free = (radius * radius - dy * dy).max(0.0).sqrt();
                if dy.abs() > radius + MERGE_EPS {
                    return None;
                }
                (
                    dy,
                    Vec2::new(from.x + free, source.y),
                    Vec2::new(from.x - free, source.y),
                )
            }
            TrackingAxis::Vertical => {
                let dx = source.x - from.x;
                let free = (radius * radius - dx * dx).max(0.0).sqrt();
                if dx.abs() > radius + MERGE_EPS {
                    return None;
                }
                (
                    dx,
                    Vec2::new(source.x, from.y + free),
                    Vec2::new(source.x, from.y - free),
                )
            }
        };
        if !fixed_delta.is_finite() {
            return None;
        }
        Some(if first.distance(cursor) <= second.distance(cursor) {
            first
        } else {
            second
        })
    }

    /// Nearest intersection of a locked ray and either family of active grid
    /// lines. This preserves the typed angle exactly while snapping its one
    /// remaining degree of freedom to engineering increments.
    fn point_on_ray_grid(&self, from: Vec2, direction: Vec2, cursor: Vec2) -> Option<Vec2> {
        if !self.grid_snap {
            return None;
        }
        let step = self.grid_step;
        let mut candidates = Vec::with_capacity(2);
        if direction.x.abs() > MERGE_EPS {
            let x = (cursor.x / step).round() * step;
            let t = (x - from.x) / direction.x;
            if t >= -MERGE_EPS {
                candidates.push(from + direction * t.max(0.0));
            }
        }
        if direction.y.abs() > MERGE_EPS {
            let y = (cursor.y / step).round() * step;
            let t = (y - from.y) / direction.y;
            if t >= -MERGE_EPS {
                candidates.push(from + direction * t.max(0.0));
            }
        }
        candidates
            .into_iter()
            .min_by(|a, b| a.distance(cursor).total_cmp(&b.distance(cursor)))
    }

    /// Nearest intersection of a locked-length circle and the active grid.
    /// Sampling the nearest grid line plus its neighbours handles cursors
    /// outside the circle without dropping a valid nearby crossing.
    fn point_on_circle_grid(&self, from: Vec2, radius: f64, cursor: Vec2) -> Option<Vec2> {
        if !self.grid_snap || radius <= MIN_LINE_LENGTH_MM {
            return None;
        }
        let step = self.grid_step;
        let mut candidates = Vec::with_capacity(12);
        for offset in -1..=1 {
            let x = (cursor.x / step).round() * step + f64::from(offset) * step;
            let dx = x - from.x;
            if dx.abs() <= radius + MERGE_EPS {
                let dy = (radius * radius - dx * dx).max(0.0).sqrt();
                candidates.push(Vec2::new(x, from.y + dy));
                candidates.push(Vec2::new(x, from.y - dy));
            }
            let y = (cursor.y / step).round() * step + f64::from(offset) * step;
            let dy = y - from.y;
            if dy.abs() <= radius + MERGE_EPS {
                let dx = (radius * radius - dy * dy).max(0.0).sqrt();
                candidates.push(Vec2::new(from.x + dx, y));
                candidates.push(Vec2::new(from.x - dx, y));
            }
        }
        candidates
            .into_iter()
            .min_by(|a, b| a.distance(cursor).total_cmp(&b.distance(cursor)))
    }

    /// Coincident-merge check for a computed endpoint (point entities,
    /// then the origin), else the point itself as a free snap.
    fn coincident_or_exact(
        &self,
        from: Vec2,
        exact: Vec2,
        mut inferences: Vec<Inference>,
    ) -> PreviewDto {
        if let Some((id, _)) = self
            .sketch
            .entities()
            .filter_map(|(id, entity)| {
                let Entity::Point { position } = entity else {
                    return None;
                };
                if position.distance(from) <= MERGE_EPS {
                    return None;
                }
                let distance = position.distance(exact);
                (distance <= self.snap_tolerance).then_some((id, distance))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
        {
            inferences.push(Inference::Coincident);
            return PreviewDto {
                snapped_to: self.sketch.point_position(id).unwrap_or(exact),
                snap: SnapTarget::Point { entity: id },
                inferences,
                tracking: None,
            };
        }
        if exact.distance(Vec2::ZERO) <= self.snap_tolerance
            && from.distance(Vec2::ZERO) > MERGE_EPS
        {
            inferences.push(Inference::Coincident);
            return PreviewDto {
                snapped_to: Vec2::ZERO,
                snap: SnapTarget::Origin,
                inferences,
                tracking: None,
            };
        }
        PreviewDto {
            snapped_to: exact,
            snap: SnapTarget::None,
            inferences,
            tracking: None,
        }
    }

    /// Nearest existing point lying on the locked circle within snap tol
    /// of the locus and within ~4×tol of the cursor (locality gate).
    fn point_on_circle_locus(&self, from: Vec2, l: f64, cursor: Vec2) -> Option<(EntityId, Vec2)> {
        if !self.point_snap {
            return None;
        }
        let mut best: Option<(EntityId, f64)> = None;
        for (id, e) in self.sketch.entities() {
            let Entity::Point { position } = e else {
                continue;
            };
            if position.distance(from) <= MERGE_EPS {
                continue;
            }
            if (position.distance(from) - l).abs() > self.snap_tolerance {
                continue;
            }
            let dc = position.distance(cursor);
            if dc > self.snap_tolerance * 4.0 {
                continue;
            }
            if best.map_or(true, |(_, bd)| dc < bd) {
                best = Some((id, dc));
            }
        }
        best.and_then(|(id, _)| self.sketch.point_position(id).map(|p| (id, p)))
    }

    /// Nearest existing point lying on the locked ray (perpendicular
    /// deviation within tol, not behind the origin).
    fn point_on_ray_locus(&self, from: Vec2, dir: Vec2, cursor: Vec2) -> Option<(EntityId, Vec2)> {
        if !self.point_snap {
            return None;
        }
        let mut best: Option<(EntityId, f64)> = None;
        for (id, e) in self.sketch.entities() {
            let Entity::Point { position } = e else {
                continue;
            };
            if position.distance(from) <= MERGE_EPS {
                continue;
            }
            let rel = *position - from;
            if (rel.x * dir.y - rel.y * dir.x).abs() > self.snap_tolerance {
                continue;
            }
            if rel.dot(dir) < -MERGE_EPS {
                continue; // behind the origin
            }
            let dc = position.distance(cursor);
            if dc > self.snap_tolerance * 4.0 {
                continue;
            }
            if best.map_or(true, |(_, bd)| dc < bd) {
                best = Some((id, dc));
            }
        }
        best.and_then(|(id, _)| self.sketch.point_position(id).map(|p| (id, p)))
    }

    /// Resolve one segment endpoint to an existing point id or a new point
    /// location. Merging (structural coincident) happens here: endpoints
    /// that snap onto an existing point reuse it, and endpoints landing on
    /// the origin reuse/create a point at (0, 0).
    fn resolve_endpoint(&self, coords: Vec2, target: SnapTarget) -> EndpointResolution {
        match target {
            SnapTarget::Point { entity } => EndpointResolution::Existing(entity),
            SnapTarget::Origin => match self.sketch.nearest_point(Vec2::ZERO, MERGE_EPS) {
                Some((id, _)) => EndpointResolution::Existing(id),
                None => EndpointResolution::New(Vec2::ZERO),
            },
            SnapTarget::Grid
            | SnapTarget::None
            | SnapTarget::Midpoint { .. }
            | SnapTarget::ReferenceMidpoint { .. } => EndpointResolution::New(coords),
        }
    }

    /// Ground a point that truly lands on the sketch origin while snapping
    /// is enabled. Origin acquisition is a geometric reference, not merely
    /// a one-time coordinate rounding: later dimension edits must propagate
    /// away from it instead of translating the whole connected chain.
    fn ground_origin_point(&mut self, point_id: EntityId) -> Option<ConstraintDto> {
        if !self.grid_snap
            || self.sketch.fix_constraint_on(point_id).is_some()
            || self
                .sketch
                .point_position(point_id)
                .is_none_or(|position| position.distance(Vec2::ZERO) > MERGE_EPS)
        {
            return None;
        }
        let constraint = Constraint::Fix { entity: point_id };
        let id = self.sketch.add_constraint(constraint);
        let targets = self.unknown_values(point_id);
        self.sketch.set_fix_targets(id, targets);
        Some(ConstraintDto { id, constraint })
    }

    /// Find the best already-connected line at each endpoint that is within
    /// the normal inference cone of perpendicular to `line_id`.
    fn perpendicular_candidates(
        &self,
        line_id: EntityId,
        endpoint_ids: [EntityId; 2],
    ) -> Vec<Constraint> {
        let Some((start, end)) = self.sketch.resolved_line(line_id) else {
            return Vec::new();
        };
        let direction = end - start;
        let length = direction.length();
        if length < MIN_LINE_LENGTH_MM {
            return Vec::new();
        }
        let perpendicular_cos_limit = INFERENCE_ANGLE_TOL_DEG.to_radians().sin();
        let mut candidates = Vec::with_capacity(2);

        for endpoint_id in endpoint_ids {
            let best = self
                .sketch
                .lines_connected_to(endpoint_id)
                .into_iter()
                .filter(|candidate| *candidate != line_id)
                .filter_map(|candidate| {
                    let (a, b) = self.sketch.resolved_line(candidate)?;
                    let other = b - a;
                    let other_length = other.length();
                    if other_length < MIN_LINE_LENGTH_MM {
                        return None;
                    }
                    let absolute_cosine = direction.dot(other).abs() / (length * other_length);
                    (absolute_cosine <= perpendicular_cos_limit)
                        .then_some((candidate, absolute_cosine))
                })
                .min_by(|a, b| a.1.total_cmp(&b.1));

            if let Some((candidate, _)) = best {
                let constraint = Constraint::Perpendicular {
                    a: candidate,
                    b: line_id,
                };
                if !candidates.contains(&constraint) {
                    candidates.push(constraint);
                }
            }
        }
        candidates
    }

    /// Automatic relations are opportunistic: keep only constraints that
    /// are consistent and remove at least one independent degree of freedom.
    /// This avoids filling a closed profile with redundant relations.
    fn try_add_independent_auto_constraint(
        &mut self,
        constraint: Constraint,
    ) -> Option<ConstraintDto> {
        let already_present = self.sketch.constraints().any(|(_, existing)| {
            *existing == constraint
                || matches!(
                    (*existing, constraint),
                    (
                        Constraint::Perpendicular { a: ea, b: eb },
                        Constraint::Perpendicular { a, b }
                    ) if ea == b && eb == a
                )
        });
        if already_present {
            return None;
        }

        let before = self.sketch.snapshot();
        let before_rank = solver::analyze(&self.sketch).rank;
        let id = self.sketch.add_constraint(constraint);
        let analysis = solver::solve(&mut self.sketch, &[]);
        let residual = solver::constraint_residual(&self.sketch, id);
        if !analysis.converged || residual > INCONSISTENT_EPS || analysis.rank <= before_rank {
            self.sketch.restore(before);
            return None;
        }
        self.analysis = Some(analysis);
        Some(ConstraintDto { id, constraint })
    }

    // --- Drawing ops ---

    /// Preview of a segment from `from` to the raw cursor position: snapped
    /// endpoint plus the constraints that WOULD be created (D4.1).
    pub fn preview_segment(&self, from: Vec2, to_raw: Vec2, ctrl_held: bool) -> PreviewDto {
        self.snap_and_infer(from, to_raw, ctrl_held)
    }

    pub fn add_line(
        &mut self,
        from_raw: Vec2,
        to_raw: Vec2,
        ctrl_held: bool,
    ) -> Result<AddLineResult, SessionError> {
        self.add_line_impl(from_raw, to_raw, ctrl_held, None)
    }

    /// Add a line honoring locked dynamic-input fields (length/angle),
    /// auto-creating driving dimensions for typed values (D9).
    pub fn add_line_locked(
        &mut self,
        request: &LockedSegmentRequest,
    ) -> Result<AddLineResult, SessionError> {
        // Formulas evaluate against the CURRENT sketch parameters (before
        // any new geometry/parameter exists).
        let length_mm = match &request.length_text {
            Some(t) => Some(self.eval_text(t)?),
            None => request.length_mm,
        };
        let angle_deg = match &request.angle_text {
            Some(t) => Some(self.eval_text(t)?),
            None => request.angle_deg,
        };
        let locks = LockedInput {
            length_mm,
            angle_deg,
            length_text: request.length_text.clone(),
            angle_text: request.angle_text.clone(),
            tracking: request.tracking,
        };
        self.add_line_impl(
            request.from,
            request.to_hint,
            request.ctrl_held,
            Some(locks),
        )
    }

    fn add_line_impl(
        &mut self,
        from_raw: Vec2,
        to_raw: Vec2,
        ctrl_held: bool,
        locks: Option<LockedInput>,
    ) -> Result<AddLineResult, SessionError> {
        let (from_coords, from_target) = self.snap_line_flow(from_raw, ctrl_held);
        let preview = match &locks {
            Some(locks) => self.preview_segment_locked(
                from_coords,
                locks.length_mm,
                locks.angle_deg,
                to_raw,
                ctrl_held,
                locks.tracking,
            ),
            None => self.snap_and_infer(from_coords, to_raw, ctrl_held),
        };

        // Resolve endpoints fully before mutating so a degenerate segment
        // leaves the sketch untouched.
        let start = self.resolve_endpoint(from_coords, from_target);
        let end = match preview.snap {
            SnapTarget::Point { entity } => EndpointResolution::Existing(entity),
            SnapTarget::Origin => self.resolve_endpoint(preview.snapped_to, preview.snap),
            SnapTarget::Grid
            | SnapTarget::None
            | SnapTarget::Midpoint { .. }
            | SnapTarget::ReferenceMidpoint { .. } => EndpointResolution::New(preview.snapped_to),
        };

        let start_coords = match start {
            EndpointResolution::Existing(id) => self
                .sketch
                .point_position(id)
                .ok_or(SessionError::EntityNotFound(id))?,
            EndpointResolution::New(p) => p,
        };
        let end_coords = match end {
            EndpointResolution::Existing(id) => self
                .sketch
                .point_position(id)
                .ok_or(SessionError::EntityNotFound(id))?,
            EndpointResolution::New(p) => p,
        };
        if let (EndpointResolution::Existing(a), EndpointResolution::Existing(b)) = (&start, &end) {
            if a == b {
                return Err(SessionError::DegenerateSegment);
            }
        }
        if start_coords.distance(end_coords) < MIN_LINE_LENGTH_MM {
            return Err(SessionError::DegenerateSegment);
        }

        let before = self.sketch.snapshot();
        let start_point_id = match start {
            EndpointResolution::Existing(id) => id,
            EndpointResolution::New(p) => self.sketch.add_entity(Entity::Point { position: p }),
        };
        let end_point_id = match end {
            EndpointResolution::Existing(id) => id,
            EndpointResolution::New(p) => self.sketch.add_entity(Entity::Point { position: p }),
        };
        let line_id = self
            .sketch
            .add_entity(Entity::line(start_point_id, end_point_id));

        let mut created = Vec::new();
        let perpendicular_created = if ctrl_held {
            false
        } else {
            let candidates = self.perpendicular_candidates(line_id, [start_point_id, end_point_id]);
            let mut accepted = false;
            for constraint in candidates {
                if let Some(created_constraint) =
                    self.try_add_independent_auto_constraint(constraint)
                {
                    created.push(created_constraint);
                    accepted = true;
                }
            }
            accepted
        };
        for inference in &preview.inferences {
            let constraint = match inference {
                Inference::Horizontal if !perpendicular_created => {
                    Some(Constraint::Horizontal { entity: line_id })
                }
                Inference::Vertical if !perpendicular_created => {
                    Some(Constraint::Vertical { entity: line_id })
                }
                Inference::Horizontal | Inference::Vertical => None,
                // Structural: merged shared points, no constraint record.
                Inference::Coincident => None,
            };
            if let Some(c) = constraint {
                let id = self.sketch.add_constraint(c);
                created.push(ConstraintDto { id, constraint: c });
            }
        }
        for point_id in [start_point_id, end_point_id] {
            if let Some(constraint) = self.ground_origin_point(point_id) {
                created.push(constraint);
            }
        }

        // Object-snap tracking is associative: moving the acquired reference
        // later keeps this endpoint on the same horizontal/vertical axis.
        if let Some(guide) = preview.tracking {
            if guide.point != end_point_id {
                let constraint = match guide.axis {
                    TrackingAxis::Horizontal => Constraint::HorizontalPoints {
                        a: guide.point,
                        b: end_point_id,
                    },
                    TrackingAxis::Vertical => Constraint::VerticalPoints {
                        a: guide.point,
                        b: end_point_id,
                    },
                };
                let id = self.sketch.add_constraint(constraint);
                created.push(ConstraintDto { id, constraint });
            }
        }

        // Midpoint auto-constraint (M1d, D4.1 parity): an endpoint snapped to
        // a host line's midpoint gets a real Midpoint constraint in the same
        // undo command.
        for (point_id, target) in [(start_point_id, from_target), (end_point_id, preview.snap)] {
            if let SnapTarget::Midpoint { entity: host_line } = target {
                let c = Constraint::Midpoint {
                    a: point_id,
                    b: host_line,
                };
                let id = self.sketch.add_constraint(c);
                created.push(ConstraintDto { id, constraint: c });
            }
        }

        // Auto-dimension on typed input (D9): the locked value becomes a
        // driving dimension with its annotation, in the same undo command.
        if let Some(locks) = &locks {
            if let Some(text) = locks.length_text.as_deref() {
                self.auto_dim_line_length(line_id, text);
            } else if let Some(v) = locks.length_mm {
                self.auto_dim_line_length(line_id, &format_number(v));
            }
            if let Some(text) = locks.angle_text.as_deref() {
                self.auto_dim_line_angle(line_id, text);
            } else if let Some(v) = locks.angle_deg {
                self.auto_dim_line_angle(line_id, &format_number(v));
            }
        }

        self.recompute();
        self.push_command(before);
        Ok(AddLineResult {
            entity_id: line_id,
            start_point_id,
            end_point_id,
            created_constraints: created,
            sketch: self.dto(),
        })
    }

    /// A single standalone point (Point tool), snapped.
    pub fn add_point(&mut self, raw: Vec2) -> Result<ToolResult, SessionError> {
        self.add_point_on(raw, None)
    }

    /// A Point-tool placement with an optional acquired carrier curve.
    /// Keeping creation and Coincident in one engine operation makes Undo
    /// atomic and prevents a visually-on-curve point from remaining free.
    pub fn add_point_on(
        &mut self,
        raw: Vec2,
        coincident_with: Option<EntityId>,
    ) -> Result<ToolResult, SessionError> {
        if let Some(carrier) = coincident_with {
            let position = self.point_projected_to_curve(carrier, raw)?;
            if let Some((id, _)) = self.sketch.nearest_point(position, MERGE_EPS) {
                return Ok(ToolResult {
                    entities: vec![id],
                    sketch: self.dto(),
                });
            }

            let before = self.sketch.snapshot();
            let id = self.sketch.add_entity(Entity::Point { position });
            let constraint = Constraint::Coincident { a: id, b: carrier };
            self.validate_constraint(&constraint)?;
            let cid = self.sketch.add_constraint(constraint);
            let analysis = solver::solve(&mut self.sketch, &[]);
            let residual = solver::constraint_residual(&self.sketch, cid);
            if !analysis.converged || residual > INCONSISTENT_EPS {
                self.sketch.restore(before);
                self.recompute();
                return Err(SessionError::InvalidConstraint(
                    "Cannot place a constrained point on the selected curve".to_string(),
                ));
            }
            self.analysis = Some(analysis);
            self.push_command(before);
            return Ok(ToolResult {
                entities: vec![id],
                sketch: self.dto(),
            });
        }

        let (coords, target) = self.snap(raw);
        let resolution = self.resolve_endpoint(coords, target);
        if let EndpointResolution::Existing(id) = resolution {
            // Snapped onto an existing point: normally nothing to add, but
            // migrate a legacy ungrounded origin point when it is acquired.
            let before = self.sketch.snapshot();
            if self.ground_origin_point(id).is_some() {
                self.recompute();
                self.push_command(before);
            }
            return Ok(ToolResult {
                entities: vec![id],
                sketch: self.dto(),
            });
        }
        let before = self.sketch.snapshot();
        let EndpointResolution::New(p) = resolution else {
            unreachable!()
        };
        let id = self.sketch.add_entity(Entity::Point { position: p });
        self.ground_origin_point(id);
        self.recompute();
        self.push_command(before);
        Ok(ToolResult {
            entities: vec![id],
            sketch: self.dto(),
        })
    }

    fn point_projected_to_curve(&self, carrier: EntityId, raw: Vec2) -> Result<Vec2, SessionError> {
        match self.sketch.entity(carrier) {
            Some(Entity::Line { .. }) => {
                let (start, end) = self
                    .sketch
                    .resolved_line(carrier)
                    .ok_or(SessionError::EntityNotFound(carrier))?;
                let delta = end - start;
                let length_squared = delta.dot(delta);
                if length_squared <= MERGE_EPS * MERGE_EPS {
                    return Err(SessionError::DegenerateSegment);
                }
                // Coincident(point, line) is defined against the infinite
                // support of a line. Preserve that same meaning during Point
                // placement so virtual-extension acquisition does not
                // collapse onto the finite segment's nearest endpoint.
                let t = (raw - start).dot(delta) / length_squared;
                Ok(start + delta * t)
            }
            Some(Entity::Circle { center, radius }) => {
                let delta = raw - *center;
                let length = delta.length();
                let direction = if length <= MERGE_EPS {
                    Vec2::new(1.0, 0.0)
                } else {
                    delta * (1.0 / length)
                };
                Ok(*center + direction * *radius)
            }
            Some(Entity::Arc {
                center,
                radius,
                start_angle,
                end_angle,
            }) => {
                let delta = raw - *center;
                let angle = if delta.length() <= MERGE_EPS {
                    *start_angle
                } else {
                    delta.y.atan2(delta.x)
                };
                let sweep = |from: f64, to: f64| (to - from).rem_euclid(std::f64::consts::TAU);
                let clamped_angle = if sweep(*start_angle, angle) <= sweep(*start_angle, *end_angle)
                {
                    angle
                } else {
                    let start_point =
                        *center + Vec2::new(start_angle.cos(), start_angle.sin()) * *radius;
                    let end_point = *center + Vec2::new(end_angle.cos(), end_angle.sin()) * *radius;
                    if raw.distance(start_point) <= raw.distance(end_point) {
                        *start_angle
                    } else {
                        *end_angle
                    }
                };
                Ok(*center + Vec2::new(clamped_angle.cos(), clamped_angle.sin()) * *radius)
            }
            Some(_) => Err(SessionError::InvalidConstraint(
                "Point-on-curve placement supports lines, circles, and arcs".to_string(),
            )),
            None => Err(SessionError::EntityNotFound(carrier)),
        }
    }

    /// Midpoint Line: a line whose midpoint is `mid_raw`; `end_raw` is one
    /// endpoint; the other mirrors through the midpoint.
    pub fn add_line_midpoint(
        &mut self,
        mid_raw: Vec2,
        end_raw: Vec2,
        ctrl_held: bool,
    ) -> Result<ToolResult, SessionError> {
        let (mid, mid_target) = self.snap_line_flow(mid_raw, ctrl_held);
        let preview = self.snap_and_infer(mid, end_raw, ctrl_held);
        let end = preview.snapped_to;
        let other = mid * 2.0 - end;
        if end.distance(other) < MIN_LINE_LENGTH_MM {
            return Err(SessionError::DegenerateSegment);
        }

        let mid_resolution = self.resolve_endpoint(mid, mid_target);
        let end_resolution = self.resolve_endpoint(end, preview.snap);
        // The mirrored endpoint is exact geometry rather than a free cursor
        // pick. Reuse only a structurally identical point, never a merely
        // nearby snap that would destroy midpoint symmetry.
        let other_resolution = self
            .sketch
            .nearest_point(other, MERGE_EPS)
            .map(|(id, _)| EndpointResolution::Existing(id))
            .unwrap_or(EndpointResolution::New(other));

        let coords = |resolution: &EndpointResolution| match resolution {
            EndpointResolution::Existing(id) => self.sketch.point_position(*id),
            EndpointResolution::New(point) => Some(*point),
        };
        let (Some(mid_coords), Some(end_coords), Some(other_coords)) = (
            coords(&mid_resolution),
            coords(&end_resolution),
            coords(&other_resolution),
        ) else {
            return Err(SessionError::DegenerateSegment);
        };
        if end_coords.distance(other_coords) < MIN_LINE_LENGTH_MM
            || mid_coords.distance(end_coords) < MIN_LINE_LENGTH_MM
        {
            return Err(SessionError::DegenerateSegment);
        }

        let before = self.sketch.snapshot();
        let mut materialize = |resolution: EndpointResolution| match resolution {
            EndpointResolution::Existing(id) => id,
            EndpointResolution::New(position) => self.sketch.add_entity(Entity::Point { position }),
        };
        let mid_id = materialize(mid_resolution);
        let a_id = materialize(other_resolution);
        let b_id = materialize(end_resolution);
        if a_id == b_id || mid_id == a_id || mid_id == b_id {
            self.sketch.restore(before);
            return Err(SessionError::DegenerateSegment);
        }
        let line_id = self.sketch.add_entity(Entity::line(a_id, b_id));
        self.sketch.add_constraint(Constraint::Midpoint {
            a: mid_id,
            b: line_id,
        });
        for inference in preview.inferences {
            match inference {
                Inference::Horizontal => {
                    self.sketch
                        .add_constraint(Constraint::Horizontal { entity: line_id });
                }
                Inference::Vertical => {
                    self.sketch
                        .add_constraint(Constraint::Vertical { entity: line_id });
                }
                Inference::Coincident => {}
            }
        }
        if let SnapTarget::Midpoint { entity } = mid_target {
            self.sketch.add_constraint(Constraint::Midpoint {
                a: mid_id,
                b: entity,
            });
        }
        if let SnapTarget::Midpoint { entity } = preview.snap {
            self.sketch
                .add_constraint(Constraint::Midpoint { a: b_id, b: entity });
        }
        for point_id in [mid_id, a_id, b_id] {
            self.ground_origin_point(point_id);
        }
        self.recompute();
        self.push_command(before);
        Ok(ToolResult {
            entities: vec![mid_id, a_id, b_id, line_id],
            sketch: self.dto(),
        })
    }

    /// Rectangle (2-Point or Center), axis-aligned to the sketch u/v axes:
    /// 4 lines with H/V constraints and structural coincident corners.
    pub fn add_rectangle(
        &mut self,
        mode: RectangleMode,
        p1: Vec2,
        p2: Vec2,
    ) -> Result<ToolResult, SessionError> {
        let (a, _) = self.snap(p1);
        let (b, _) = self.snap(p2);
        self.build_rectangle(mode, a, b)
    }

    /// Rectangle honoring locked width/height dynamic-input fields.
    /// Locks constrain only their own axis (D9): free axes still grid-snap,
    /// and typed values auto-create driving dimensions (one undo command).
    pub fn add_rectangle_locked(
        &mut self,
        request: &LockedRectangleRequest,
    ) -> Result<ToolResult, SessionError> {
        let mode = request.mode;
        let width_mm = match &request.width_text {
            Some(t) => Some(self.eval_text(t)?),
            None => request.width_mm,
        };
        let height_mm = match &request.height_text {
            Some(t) => Some(self.eval_text(t)?),
            None => request.height_mm,
        };
        let (anchor, _) = self.snap(request.anchor);
        let hint = request.corner_hint;
        let sx = if hint.x >= anchor.x { 1.0 } else { -1.0 };
        let sy = if hint.y >= anchor.y { 1.0 } else { -1.0 };
        let extent = |full: f64| match mode {
            RectangleMode::TwoPoint => full,
            RectangleMode::Center => full / 2.0,
        };
        let corner_x = width_mm
            .map(|w| anchor.x + sx * extent(w))
            .unwrap_or_else(|| self.snap_1d(hint.x));
        let corner_y = height_mm
            .map(|h| anchor.y + sy * extent(h))
            .unwrap_or_else(|| self.snap_1d(hint.y));
        // Coincident corner snap respecting the locked axes.
        let corner = self.corner_snap(
            Vec2::new(corner_x, corner_y),
            width_mm.is_some(),
            height_mm.is_some(),
        );

        let before = self.sketch.snapshot();
        let entities = self.create_rectangle(mode, anchor, corner)?;
        // Corner points drive the rectangle: dims span corner-to-corner so
        // later corner ops keep their reference (2026-07-19 PM, D9).
        let (bl, br, tl) = (entities[0], entities[1], entities[3]);
        let w_text = request
            .width_text
            .clone()
            .or_else(|| width_mm.map(format_number));
        let h_text = request
            .height_text
            .clone()
            .or_else(|| height_mm.map(format_number));
        self.auto_dim_rect(bl, br, tl, w_text.as_deref(), h_text.as_deref());
        self.recompute();
        self.push_command(before);
        Ok(ToolResult {
            entities,
            sketch: self.dto(),
        })
    }

    fn build_rectangle(
        &mut self,
        mode: RectangleMode,
        p1: Vec2,
        p2: Vec2,
    ) -> Result<ToolResult, SessionError> {
        let before = self.sketch.snapshot();
        let entities = self.create_rectangle(mode, p1, p2)?;
        self.recompute();
        self.push_command(before);
        Ok(ToolResult {
            entities,
            sketch: self.dto(),
        })
    }

    /// Rectangle mutation only (shared by plain and locked/dimensioned
    /// creation): 4 corner points + 4 H/V-constrained lines, returned as
    /// [points…, lines…].
    fn create_rectangle(
        &mut self,
        mode: RectangleMode,
        p1: Vec2,
        p2: Vec2,
    ) -> Result<Vec<EntityId>, SessionError> {
        let (min, max) = match mode {
            RectangleMode::TwoPoint => (
                Vec2::new(p1.x.min(p2.x), p1.y.min(p2.y)),
                Vec2::new(p1.x.max(p2.x), p1.y.max(p2.y)),
            ),
            RectangleMode::Center => {
                let hx = (p2.x - p1.x).abs();
                let hy = (p2.y - p1.y).abs();
                (
                    Vec2::new(p1.x - hx, p1.y - hy),
                    Vec2::new(p1.x + hx, p1.y + hy),
                )
            }
        };
        if max.x - min.x < MIN_LINE_LENGTH_MM || max.y - min.y < MIN_LINE_LENGTH_MM {
            return Err(SessionError::DegenerateSegment);
        }

        let corners = [
            Vec2::new(min.x, min.y),
            Vec2::new(max.x, min.y),
            Vec2::new(max.x, max.y),
            Vec2::new(min.x, max.y),
        ];
        let mut point_ids = Vec::with_capacity(4);
        for c in corners {
            let existing = self
                .point_snap
                .then(|| self.sketch.nearest_point(c, MERGE_EPS))
                .flatten()
                .map(|(id, _)| id);
            let point_id =
                existing.unwrap_or_else(|| self.sketch.add_entity(Entity::Point { position: c }));
            point_ids.push(point_id);
        }
        let mut line_ids = Vec::with_capacity(4);
        for i in 0..4 {
            line_ids.push(
                self.sketch
                    .add_entity(Entity::line(point_ids[i], point_ids[(i + 1) % 4])),
            );
        }
        // Bottom/top horizontal, left/right vertical.
        self.sketch.add_constraint(Constraint::Horizontal {
            entity: line_ids[0],
        });
        self.sketch.add_constraint(Constraint::Horizontal {
            entity: line_ids[2],
        });
        self.sketch.add_constraint(Constraint::Vertical {
            entity: line_ids[1],
        });
        self.sketch.add_constraint(Constraint::Vertical {
            entity: line_ids[3],
        });
        for point_id in &point_ids {
            self.ground_origin_point(*point_id);
        }

        let mut entities = point_ids;
        entities.extend(line_ids);
        Ok(entities)
    }

    /// Circle (Center-Diameter or 2-Point diameter).
    pub fn add_circle(
        &mut self,
        mode: CircleMode,
        p1: Vec2,
        p2: Vec2,
    ) -> Result<ToolResult, SessionError> {
        let (a, _) = self.snap(p1);
        let (b, _) = self.snap(p2);
        self.build_circle(mode, a, b)
    }

    /// Circle honoring a locked diameter field (typed value auto-creates a
    /// Diameter dimension, D9). `anchor` is the center (Center-Diameter) or
    /// first diameter endpoint (2-Point); `edge_hint` supplies the
    /// radius/direction when unlocked.
    pub fn add_circle_locked(
        &mut self,
        request: &LockedCircleRequest,
    ) -> Result<ToolResult, SessionError> {
        let mode = request.mode;
        let diameter_mm = match &request.diameter_text {
            Some(t) => Some(self.eval_text(t)?),
            None => request.diameter_mm,
        };
        let (anchor, _) = self.snap(request.anchor);
        let hint = if diameter_mm.is_none() {
            self.snap(request.edge_hint).0
        } else {
            request.edge_hint
        };
        let dir = hint - anchor;
        let len = dir.length();
        let unit = if len < MERGE_EPS {
            Vec2::new(1.0, 0.0)
        } else {
            dir * (1.0 / len)
        };
        let second = match (mode, diameter_mm) {
            // Center-Diameter: edge point at radius distance in the hint's
            // direction (lock composes with point-on-circle snapping).
            (CircleMode::CenterDiameter, Some(d)) => {
                let edge = anchor + unit * (d / 2.0);
                self.point_on_circle_locus(anchor, d / 2.0, hint)
                    .map(|(_, p)| p)
                    .unwrap_or(edge)
            }
            // 2-Point: diameter endpoints, full d apart.
            (CircleMode::TwoPoint, Some(d)) => {
                let edge = anchor + unit * d;
                self.point_on_circle_locus(anchor, d, hint)
                    .map(|(_, p)| p)
                    .unwrap_or(edge)
            }
            (_, None) => hint,
        };

        let before = self.sketch.snapshot();
        let id = self.create_circle(mode, anchor, second)?;
        let d_text = request
            .diameter_text
            .clone()
            .or_else(|| diameter_mm.map(format_number));
        if let Some(text) = d_text.as_deref() {
            self.auto_dim_circle(id, text);
        }
        self.recompute();
        self.push_command(before);
        Ok(ToolResult {
            entities: vec![id],
            sketch: self.dto(),
        })
    }

    fn build_circle(
        &mut self,
        mode: CircleMode,
        p1: Vec2,
        p2: Vec2,
    ) -> Result<ToolResult, SessionError> {
        let before = self.sketch.snapshot();
        let id = self.create_circle(mode, p1, p2)?;
        self.recompute();
        self.push_command(before);
        Ok(ToolResult {
            entities: vec![id],
            sketch: self.dto(),
        })
    }

    /// Circle mutation only (shared by plain and locked/dimensioned
    /// creation).
    fn create_circle(
        &mut self,
        mode: CircleMode,
        p1: Vec2,
        p2: Vec2,
    ) -> Result<EntityId, SessionError> {
        let (center, radius) = match mode {
            CircleMode::CenterDiameter => (p1, p1.distance(p2)),
            CircleMode::TwoPoint => (((p1 + p2) * 0.5), p1.distance(p2) / 2.0),
        };
        if radius < MIN_LINE_LENGTH_MM {
            return Err(SessionError::DegenerateSegment);
        }
        Ok(self.sketch.add_entity(Entity::Circle { center, radius }))
    }

    /// Slot (M1 follow-up): a capsule of 2 parallel
    /// lines + 2 semicircular end-cap arcs, tangent by construction
    /// (geomops::slot), with Tangent/Parallel/Equal constraints and a
    /// best-effort Ø width dimension on typed input (D9). One undo command.
    pub fn add_slot(&mut self, request: &SlotRequest) -> Result<ToolResult, SessionError> {
        let (p1, _) = self.snap(request.p1);
        let (p2, _) = self.snap(request.p2);
        let (cursor, _) = self.snap(request.cursor);
        let width_locked = match &request.width_text {
            Some(t) => Some(self.eval_text(t)?),
            None => request.width_mm,
        };
        let width = match width_locked {
            Some(w) => w,
            // Cursor-driven width: twice the perpendicular distance from the
            // cursor to the p1→p2 axis.
            None => {
                let d = p2 - p1;
                let len = d.length();
                if len < MERGE_EPS {
                    return Err(SessionError::DegenerateSegment);
                }
                2.0 * (d.x * (cursor.y - p1.y) - d.y * (cursor.x - p1.x)).abs() / len
            }
        };
        if width < MIN_LINE_LENGTH_MM {
            return Err(SessionError::DegenerateSegment);
        }
        let r = width / 2.0;
        let (c1, c2) = match request.mode {
            SlotMode::CenterToCenter => (p1, p2),
            SlotMode::Overall => {
                let d = p2 - p1;
                let len = d.length();
                if len <= width {
                    return Err(SessionError::DegenerateSegment);
                }
                let u = d * (1.0 / len);
                (p1 + u * r, p2 - u * r)
            }
            SlotMode::CenterPoint => (p2, p1 * 2.0 - p2),
        };
        let cap = crate::geomops::slot::slot_capsule(c1, c2, width)
            .map_err(|_| SessionError::DegenerateSegment)?;

        let before = self.sketch.snapshot();
        let pa1 = self.sketch.add_entity(Entity::Point {
            position: cap.line1.a,
        });
        let pa2 = self.sketch.add_entity(Entity::Point {
            position: cap.line1.b,
        });
        let pb1 = self.sketch.add_entity(Entity::Point {
            position: cap.line2.a,
        });
        let pb2 = self.sketch.add_entity(Entity::Point {
            position: cap.line2.b,
        });
        let line1 = self.sketch.add_entity(Entity::line(pa1, pa2));
        let line2 = self.sketch.add_entity(Entity::line(pb1, pb2));
        let arc1 = self.sketch.add_entity(Entity::Arc {
            center: cap.arc1.center,
            radius: cap.arc1.radius,
            start_angle: cap.arc1.start_angle,
            end_angle: cap.arc1.end_angle,
        });
        let arc2 = self.sketch.add_entity(Entity::Arc {
            center: cap.arc2.center,
            radius: cap.arc2.radius,
            start_angle: cap.arc2.start_angle,
            end_angle: cap.arc2.end_angle,
        });
        self.sketch
            .add_constraint(Constraint::Tangent { a: line1, b: arc1 });
        self.sketch
            .add_constraint(Constraint::Tangent { a: line2, b: arc1 });
        self.sketch
            .add_constraint(Constraint::Tangent { a: line1, b: arc2 });
        self.sketch
            .add_constraint(Constraint::Tangent { a: line2, b: arc2 });
        self.sketch
            .add_constraint(Constraint::Parallel { a: line1, b: line2 });
        self.sketch
            .add_constraint(Constraint::Equal { a: arc1, b: arc2 });
        // Trim anchors (same 2026-07-19 bug class as fillet): glue each line
        // endpoint to its arc endpoint so dims can't slide the capsule open.
        // arc1 spans line1.a → line2.a (CCW), arc2 spans line2.b → line1.b.
        use crate::constraint::ArcEndpoint::{End as AEnd, Start as AStart};
        self.sketch
            .add_constraint(Constraint::ArcEndpointCoincident {
                point: pa1,
                arc: arc1,
                end: AStart,
            });
        self.sketch
            .add_constraint(Constraint::ArcEndpointCoincident {
                point: pb1,
                arc: arc1,
                end: AEnd,
            });
        self.sketch
            .add_constraint(Constraint::ArcEndpointCoincident {
                point: pb2,
                arc: arc2,
                end: AStart,
            });
        self.sketch
            .add_constraint(Constraint::ArcEndpointCoincident {
                point: pa2,
                arc: arc2,
                end: AEnd,
            });
        // Width dimension (typed expression survives, D9): Ø on arc1. Like
        // every auto-dim this is best-effort — geometry must commit even if
        // the dim is rejected as redundant.
        let w_text = request
            .width_text
            .clone()
            .or_else(|| width_locked.map(format_number));
        if let Some(text) = w_text.as_deref() {
            if let Ok(param) =
                self.param_from_text(crate::params::ParamKind::Length, Some(text), width)
            {
                let pos =
                    cap.arc1.center + Vec2::new(cap.arc1.radius + 12.0, cap.arc1.radius + 12.0);
                let _ = self.add_constraint_bound(
                    Constraint::Diameter {
                        entity: arc1,
                        value: width,
                    },
                    param,
                    pos,
                    false,
                );
            }
        }
        self.recompute();
        self.push_command(before);
        Ok(ToolResult {
            entities: vec![pa1, pa2, pb1, pb2, line1, line2, arc1, arc2],
            sketch: self.dto(),
        })
    }

    /// Fit-point spline (M1 follow-up): centripetal Catmull-Rom through the
    /// fit points (geomops::spline). Self-contained entity — no shared
    /// points, no constraints in v1; one undo record. Consecutive duplicate
    /// picks are dropped (zero-length spans).
    pub fn add_spline(&mut self, request: &SplineRequest) -> Result<ToolResult, SessionError> {
        let mut points: Vec<Vec2> = Vec::with_capacity(request.points.len());
        for &p in &request.points {
            let (q, _) = self.snap(p);
            if points
                .last()
                .map_or(true, |last: &Vec2| last.distance(q) > MIN_LINE_LENGTH_MM)
            {
                points.push(q);
            }
        }
        if points.len() < 2 {
            return Err(SessionError::DegenerateSegment);
        }
        let before = self.sketch.snapshot();
        let id = self.sketch.add_entity(Entity::Spline { points });
        self.recompute();
        self.push_command(before);
        Ok(ToolResult {
            entities: vec![id],
            sketch: self.dto(),
        })
    }

    /// 1D snap of a free axis component (grid intersections when on).
    fn snap_1d(&self, v: f64) -> f64 {
        if self.grid_snap {
            (v / self.grid_step).round() * self.grid_step
        } else {
            v
        }
    }

    /// Coincident corner snap for rectangles, respecting locked axes: only
    /// points consistent with the locked components are eligible.
    fn corner_snap(&self, corner: Vec2, x_locked: bool, y_locked: bool) -> Vec2 {
        if !self.point_snap {
            return corner;
        }
        let mut best: Option<(EntityId, f64)> = None;
        for (id, e) in self.sketch.entities() {
            let Entity::Point { position } = e else {
                continue;
            };
            if position.distance(corner) > self.snap_tolerance {
                continue;
            }
            if x_locked && (position.x - corner.x).abs() > self.snap_tolerance {
                continue;
            }
            if y_locked && (position.y - corner.y).abs() > self.snap_tolerance {
                continue;
            }
            let d = position.distance(corner);
            if best.map_or(true, |(_, bd)| d < bd) {
                best = Some((id, d));
            }
        }
        best.and_then(|(id, _)| self.sketch.point_position(id))
            .unwrap_or(corner)
    }

    /// 3-Point Arc: circumscribed circle through p1 (start), p2 (on-arc),
    /// p3 (end); the CCW sweep from start to end contains p2.
    pub fn add_arc_3pt(
        &mut self,
        p1: Vec2,
        p2: Vec2,
        p3: Vec2,
    ) -> Result<ToolResult, SessionError> {
        let (p1, _) = self.snap(p1);
        let (p2, _) = self.snap(p2);
        let (p3, _) = self.snap(p3);
        let d = 2.0 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
        if d.abs() < MERGE_EPS {
            return Err(SessionError::DegenerateSegment); // collinear
        }
        let (a2, b2, c2) = (p1.dot(p1), p2.dot(p2), p3.dot(p3));
        let ux = (a2 * (p2.y - p3.y) + b2 * (p3.y - p1.y) + c2 * (p1.y - p2.y)) / d;
        let uy = (a2 * (p3.x - p2.x) + b2 * (p1.x - p3.x) + c2 * (p2.x - p1.x)) / d;
        let center = Vec2::new(ux, uy);
        let radius = center.distance(p1);
        if radius < MIN_LINE_LENGTH_MM {
            return Err(SessionError::DegenerateSegment);
        }
        let ang = |p: Vec2| (p.y - center.y).atan2(p.x - center.x);
        let (a0, a1, am) = (ang(p1), ang(p3), ang(p2));
        // Choose the CCW sweep that contains the mid pick.
        let ccw_contains = |s: f64, e: f64, m: f64| {
            let span = (e - s).rem_euclid(std::f64::consts::TAU);
            let off = (m - s).rem_euclid(std::f64::consts::TAU);
            off <= span
        };
        let (start_angle, end_angle) = if ccw_contains(a0, a1, am) {
            (a0, a1)
        } else {
            (a1, a0)
        };
        let before = self.sketch.snapshot();
        let id = self.sketch.add_entity(Entity::Arc {
            center,
            radius,
            start_angle,
            end_angle,
        });
        self.recompute();
        self.push_command(before);
        Ok(ToolResult {
            entities: vec![id],
            sketch: self.dto(),
        })
    }

    /// Center Arc: center, start point (defines radius + start angle), and
    /// a sweep point defining the end angle (CCW sweep).
    pub fn add_arc_center(
        &mut self,
        center: Vec2,
        start: Vec2,
        sweep: Vec2,
    ) -> Result<ToolResult, SessionError> {
        let (center, _) = self.snap(center);
        let (start, _) = self.snap(start);
        let (sweep, _) = self.snap(sweep);
        let radius = center.distance(start);
        if radius < MIN_LINE_LENGTH_MM {
            return Err(SessionError::DegenerateSegment);
        }
        let start_angle = (start.y - center.y).atan2(start.x - center.x);
        let mut end_angle = (sweep.y - center.y).atan2(sweep.x - center.x);
        if end_angle <= start_angle {
            end_angle += std::f64::consts::TAU;
        }
        let before = self.sketch.snapshot();
        let id = self.sketch.add_entity(Entity::Arc {
            center,
            radius,
            start_angle,
            end_angle,
        });
        self.recompute();
        self.push_command(before);
        Ok(ToolResult {
            entities: vec![id],
            sketch: self.dto(),
        })
    }

    /// Rubber-band drag of a point via the solver: the dragged point is
    /// pinned to the cursor, everything else is re-solved each call, so
    /// coincident/shared points and all constraints keep holding (D4.4).
    pub fn move_point(
        &mut self,
        request: MovePointRequest,
    ) -> Result<MovePointResult, SessionError> {
        let point_id = request.point_id;
        if self.sketch.entity(point_id).is_none() {
            return Err(SessionError::EntityNotFound(point_id));
        }
        if self.sketch.point_position(point_id).is_none() {
            return Err(SessionError::NotAPoint(point_id));
        }

        if matches!(request.phase, DragPhase::Begin | DragPhase::Single) {
            self.pending_drag = Some(self.sketch.snapshot());
            self.last_good_drag = Some(self.sketch.snapshot());
        }

        // Snap gives the pin target (coordinates only — never a merge).
        let (target, _) = self.snap(request.to_raw);
        let analysis = solver::solve(&mut self.sketch, &[(point_id, target)]);
        if analysis.converged {
            // Hard-set the pin exactly: the damped solve can land ~1e-9
            // off, and chained geometry deserves exact shared points.
            if let Some(Entity::Point { position }) = self.sketch.entity_mut(point_id) {
                *position = target;
            }
            self.analysis = Some(solver::analyze(&self.sketch));
            self.last_good_drag = Some(self.sketch.snapshot());
        } else if let Some(good) = self.last_good_drag.take() {
            // Solver could not satisfy constraints at this position: clamp
            // the rubber band by restoring the last consistent state.
            self.sketch.restore(good.clone());
            self.last_good_drag = Some(good);
            self.analysis = Some(solver::analyze(&self.sketch));
        }

        if matches!(request.phase, DragPhase::End | DragPhase::Single) {
            if let Some(before) = self.pending_drag.take() {
                self.push_command(before);
            }
            self.last_good_drag = None;
        }

        Ok(MovePointResult { sketch: self.dto() })
    }

    /// Delete an entity. Deleting a point cascades to connected lines (and
    /// their constraints); deleting a line keeps its endpoint points.
    pub fn delete_entity(&mut self, id: EntityId) -> Result<DeleteEntityResult, SessionError> {
        self.delete_entities(&[id])
    }

    /// Batch delete (multi-select) as one undoable command.
    pub fn delete_entities(
        &mut self,
        ids: &[EntityId],
    ) -> Result<DeleteEntityResult, SessionError> {
        let existing: Vec<EntityId> = ids
            .iter()
            .copied()
            .filter(|id| self.sketch.entity(*id).is_some())
            .collect();
        if existing.is_empty() {
            return Err(SessionError::EntityNotFound(
                ids.first().copied().unwrap_or(EntityId(0)),
            ));
        }
        let before = self.sketch.snapshot();
        let mut removed = Vec::new();
        for id in existing {
            removed.extend(self.sketch.remove_entity(id));
        }
        removed.sort();
        removed.dedup();
        self.recompute();
        self.push_command(before);
        Ok(DeleteEntityResult {
            removed,
            sketch: self.dto(),
        })
    }

    // --- Constraint application (M1b CONSTRAINTS panel) ---

    /// Current unknown values of an entity in solver layout (Fix targets).
    fn unknown_values(&self, entity: EntityId) -> Vec<f64> {
        match self.sketch.entity(entity) {
            Some(Entity::Point { position }) => vec![position.x, position.y],
            Some(Entity::Circle { center, radius }) => vec![center.x, center.y, *radius],
            Some(Entity::Arc {
                center,
                radius,
                start_angle,
                end_angle,
            }) => vec![center.x, center.y, *radius, *start_angle, *end_angle],
            Some(Entity::Line { .. }) => {
                if let Some((a, b)) = self.sketch.resolved_line(entity) {
                    vec![a.x, a.y, b.x, b.y]
                } else {
                    vec![]
                }
            }
            Some(Entity::Spline { points }) => {
                points.iter().flat_map(|point| [point.x, point.y]).collect()
            }
            None => vec![],
        }
    }

    /// Kind-combination validation for panel application.
    fn validate_constraint(&self, constraint: &Constraint) -> Result<(), SessionError> {
        let entity = |id: EntityId| self.sketch.entity(id);
        let kinds_of = |ids: &[EntityId]| -> Vec<&'static str> {
            ids.iter()
                .map(|id| match entity(*id) {
                    Some(Entity::Point { .. }) => "point",
                    Some(Entity::Line { .. }) => "line",
                    Some(Entity::Circle { .. }) => "circle",
                    Some(Entity::Arc { .. }) => "arc",
                    Some(Entity::Spline { .. }) => "spline",
                    None => "missing",
                })
                .collect()
        };
        let invalid = |msg: &str| SessionError::InvalidConstraint(msg.to_string());

        match *constraint {
            Constraint::ArcEndpointCoincident { .. }
            | Constraint::EqualDistance { .. }
            | Constraint::SpanMidpoint { .. } => {
                return Err(invalid(
                    "This relation is internal and is created by its sketch tool",
                ));
            }
            Constraint::Horizontal { entity: e } | Constraint::Vertical { entity: e } => {
                if !matches!(entity(e), Some(Entity::Line { .. })) {
                    return Err(invalid("Horizontal/Vertical applies to a line"));
                }
            }
            Constraint::HorizontalPoints { a, b } | Constraint::VerticalPoints { a, b } => {
                if kinds_of(&[a, b]) != ["point", "point"] {
                    return Err(invalid("Point alignment needs two points"));
                }
            }
            Constraint::Fix { entity: e } => {
                if entity(e).is_none() {
                    return Err(invalid("Fix applies to an existing entity"));
                }
            }
            Constraint::Coincident { a, b } => {
                let ks = kinds_of(&[a, b]);
                let ok = matches!(
                    ks.as_slice(),
                    ["point", "point"]
                        | ["point", "line"]
                        | ["line", "point"]
                        | ["point", "circle"]
                        | ["circle", "point"]
                        | ["point", "arc"]
                        | ["arc", "point"]
                        | ["circle", "circle"]
                        | ["circle", "arc"]
                        | ["arc", "circle"]
                        | ["arc", "arc"]
                );
                if !ok {
                    return Err(invalid(
                        "Coincident needs two points, or a point on a line/circle/arc",
                    ));
                }
            }
            Constraint::Midpoint { a, b } => {
                if kinds_of(&[a, b]) != ["point", "line"] {
                    return Err(invalid("Midpoint needs a point and a line"));
                }
            }
            Constraint::Equal { a, b } => {
                let ks = kinds_of(&[a, b]);
                let ok = matches!(
                    ks.as_slice(),
                    ["line", "line"]
                        | ["circle", "circle"]
                        | ["arc", "arc"]
                        | ["circle", "arc"]
                        | ["arc", "circle"]
                );
                if !ok {
                    return Err(invalid("Equal needs two lines or two circles/arcs"));
                }
            }
            Constraint::Parallel { a, b }
            | Constraint::Perpendicular { a, b }
            | Constraint::Collinear { a, b } => {
                if kinds_of(&[a, b]) != ["line", "line"] {
                    return Err(invalid("This constraint needs two lines"));
                }
            }
            Constraint::Tangent { a, b } => {
                let ks = kinds_of(&[a, b]);
                let curved = |k: &str| k == "circle" || k == "arc";
                let ok = (ks[0] == "line" && curved(ks[1]))
                    || (curved(ks[0]) && ks[1] == "line")
                    || (curved(ks[0]) && curved(ks[1]));
                if !ok {
                    return Err(invalid(
                        "Tangent needs a line and a circle/arc, or two circles/arcs",
                    ));
                }
            }
            Constraint::Concentric { a, b } => {
                let ks = kinds_of(&[a, b]);
                let curved = |k: &str| k == "circle" || k == "arc";
                if !(curved(ks[0]) && curved(ks[1])) {
                    return Err(invalid("Concentric needs two circles/arcs"));
                }
            }
            Constraint::Symmetry { a, b, axis } => {
                let ks = kinds_of(&[a, b, axis]);
                let ok = (ks[0] == "point" && ks[1] == "point" && ks[2] == "line")
                    || (ks[0] == "line" && ks[1] == "line" && ks[2] == "line");
                if !ok {
                    return Err(invalid(
                        "Symmetry needs two points and an axis line, or two lines and an axis",
                    ));
                }
            }
            Constraint::Distance { from, to, .. } => {
                let kf = kinds_of(&[from])[0];
                let kt = to.map(|t| kinds_of(&[t])[0]);
                let curved = |kind: &str| kind == "circle" || kind == "arc";
                let ok = (kf == "line" && kt.is_none())
                    || (kf == "point" && kt == Some("point"))
                    || (kf == "point" && kt == Some("line"))
                    || (kf == "line" && kt == Some("point"))
                    || (kf == "line" && kt == Some("line"))
                    || kt.is_some_and(|kind| curved(kf) && curved(kind));
                if !ok {
                    return Err(invalid(
                        "Distance needs a line, two points, point+line, two lines, or two circles/arcs",
                    ));
                }
            }
            Constraint::Radius { entity: e, .. } | Constraint::Diameter { entity: e, .. } => {
                if !matches!(entity(e), Some(Entity::Circle { .. } | Entity::Arc { .. })) {
                    return Err(invalid("Radius/Diameter applies to a circle or arc"));
                }
            }
            Constraint::Angle { a, b, .. } => {
                let two_lines = kinds_of(&[a, b]) == ["line", "line"];
                let axis = b.0 == 0 && kinds_of(&[a]) == ["line"]; // +u axis sentinel (auto dims)
                if !two_lines && !axis {
                    return Err(invalid("Angle needs two lines"));
                }
            }
        }
        Ok(())
    }

    /// Apply a constraint from the CONSTRAINTS panel. Over-constraining
    /// input is rejected with an explicit conflict report (D4.2).
    pub fn add_constraint(
        &mut self,
        constraint: Constraint,
    ) -> Result<AddConstraintResult, SessionError> {
        self.validate_constraint(&constraint)?;
        let before_rank = solver::analyze(&self.sketch).rank;
        let before = self.sketch.snapshot();

        let cid = self.sketch.add_constraint(constraint);
        if let Constraint::Fix { entity } = constraint {
            let targets = self.unknown_values(entity);
            self.sketch.set_fix_targets(cid, targets);
        }

        let analysis = solver::solve(&mut self.sketch, &[]);
        let new_residual = solver::constraint_residual(&self.sketch, cid);
        let rank_increased = analysis.rank > before_rank;

        if !analysis.converged || (!rank_increased && new_residual > INCONSISTENT_EPS) {
            // Over-constrained (inconsistent or under-determined): reject
            // and name the conflicting constraints (D4.2).
            let rejected = self.describe_constraint(cid);
            let conflicts_with = self.find_conflicts(cid, constraint);
            self.sketch.restore(before);
            self.recompute();
            return Err(SessionError::OverConstrained {
                rejected,
                conflicts_with,
            });
        }

        self.analysis = Some(analysis);
        self.push_command(before);
        Ok(AddConstraintResult {
            constraint_id: cid,
            sketch: self.dto(),
        })
    }

    /// Apply a panel-generated constraint set atomically. This is used for
    /// multi-line H/V and similar bulk actions so a late conflict cannot
    /// leave earlier constraints behind, and Undo removes the whole action.
    pub fn add_constraints(
        &mut self,
        constraints: Vec<Constraint>,
    ) -> Result<ToolResult, SessionError> {
        if constraints.is_empty() {
            return Err(SessionError::InvalidConstraint(
                "no constraints to apply".to_string(),
            ));
        }
        let before = self.sketch.snapshot();
        let mut added = Vec::with_capacity(constraints.len());
        for constraint in constraints {
            if let Err(error) = self.validate_constraint(&constraint) {
                self.sketch.restore(before);
                self.recompute();
                return Err(error);
            }
            let cid = self.sketch.add_constraint(constraint);
            if let Constraint::Fix { entity } = constraint {
                let targets = self.unknown_values(entity);
                self.sketch.set_fix_targets(cid, targets);
            }
            added.push((cid, constraint));
        }

        let analysis = solver::solve(&mut self.sketch, &[]);
        let rejected = added
            .iter()
            .find(|(cid, _)| solver::constraint_residual(&self.sketch, *cid) > INCONSISTENT_EPS);
        if !analysis.converged || rejected.is_some() {
            let (cid, constraint) = rejected
                .copied()
                .or_else(|| added.last().copied())
                .expect("non-empty batch");
            let rejected = self.describe_constraint(cid);
            let conflicts_with = self.find_conflicts(cid, constraint);
            self.sketch.restore(before);
            self.recompute();
            return Err(SessionError::OverConstrained {
                rejected,
                conflicts_with,
            });
        }

        self.analysis = Some(analysis);
        self.push_command(before);
        let entities = added
            .iter()
            .flat_map(|(_, constraint)| constraint.referenced_entities())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        Ok(ToolResult {
            entities,
            sketch: self.dto(),
        })
    }

    /// Fix/Unfix toggle: removes an existing Fix on the entity, else adds
    /// one.
    pub fn toggle_fix(&mut self, entity: EntityId) -> Result<AddConstraintResult, SessionError> {
        if self.sketch.entity(entity).is_none() {
            return Err(SessionError::EntityNotFound(entity));
        }
        if let Some(cid) = self.sketch.fix_constraint_on(entity) {
            let before = self.sketch.snapshot();
            self.sketch.remove_constraint(cid);
            self.recompute();
            self.push_command(before);
            return Ok(AddConstraintResult {
                constraint_id: cid,
                sketch: self.dto(),
            });
        }
        self.add_constraint(Constraint::Fix { entity })
    }

    /// Multi-selection Fix/Unfix as one transaction and one undo record.
    pub fn toggle_fix_entities(
        &mut self,
        entities: Vec<EntityId>,
    ) -> Result<ToolResult, SessionError> {
        let entities: BTreeSet<EntityId> = entities.into_iter().collect();
        if entities.is_empty() {
            return Err(SessionError::InvalidConstraint(
                "Fix/Unfix needs at least one entity".to_string(),
            ));
        }
        for entity in &entities {
            if self.sketch.entity(*entity).is_none() {
                return Err(SessionError::EntityNotFound(*entity));
            }
        }
        let before = self.sketch.snapshot();
        for entity in &entities {
            if let Some(cid) = self.sketch.fix_constraint_on(*entity) {
                self.sketch.remove_constraint(cid);
            } else {
                let cid = self
                    .sketch
                    .add_constraint(Constraint::Fix { entity: *entity });
                let targets = self.unknown_values(*entity);
                self.sketch.set_fix_targets(cid, targets);
            }
        }
        let analysis = solver::solve(&mut self.sketch, &[]);
        if !analysis.converged {
            self.sketch.restore(before);
            self.recompute();
            return Err(SessionError::InvalidConstraint(
                "Fix/Unfix conflicts with existing constraints".to_string(),
            ));
        }
        self.analysis = Some(analysis);
        self.push_command(before);
        Ok(ToolResult {
            entities: entities.into_iter().collect(),
            sketch: self.dto(),
        })
    }

    /// Identify existing constraints that conflict with the fresh one.
    ///
    /// Constraints propagate through a connected geometry network, so only
    /// checking constraints that directly mention the dimension endpoints
    /// can misleadingly blame the fixed origin. Walk the whole connected
    /// component, then test candidates by re-solving without each one.
    fn find_conflicts(
        &mut self,
        new_cid: ConstraintId,
        new_constraint: Constraint,
    ) -> Vec<ConstraintDesc> {
        let mut component_entities = new_constraint
            .referenced_entities()
            .into_iter()
            .collect::<BTreeSet<_>>();
        let constraints = self
            .sketch
            .constraints()
            .filter(|(cid, _)| *cid != new_cid)
            .map(|(cid, constraint)| (cid, *constraint))
            .collect::<Vec<_>>();
        let mut candidates = BTreeSet::new();
        loop {
            let mut changed = false;
            for (cid, constraint) in &constraints {
                let referenced = constraint.referenced_entities();
                if referenced
                    .iter()
                    .any(|entity| component_entities.contains(entity))
                {
                    changed |= candidates.insert(*cid);
                    for entity in referenced {
                        changed |= component_entities.insert(entity);
                    }
                }
            }
            if !changed {
                break;
            }
        }

        let mut conflicts = Vec::new();
        for cid in &candidates {
            let snapshot = self.sketch.snapshot();
            self.sketch.remove_constraint(*cid);
            let analysis = solver::solve(&mut self.sketch, &[]);
            let residual = solver::constraint_residual(&self.sketch, new_cid);
            self.sketch.restore(snapshot);
            if analysis.converged && residual <= INCONSISTENT_EPS {
                conflicts.push(self.describe_constraint(*cid));
            }
        }
        let non_anchor_conflicts = conflicts
            .iter()
            .filter(|description| description.kind != "fix")
            .cloned()
            .collect::<Vec<_>>();
        if !non_anchor_conflicts.is_empty() {
            return non_anchor_conflicts;
        }
        if conflicts.is_empty() {
            // A conflict may require removing more than one redundant
            // relation. Name the connected non-anchor constraints instead
            // of falsely presenting the origin Fix as the sole cause.
            let fallback = candidates
                .iter()
                .map(|cid| self.describe_constraint(*cid))
                .filter(|description| description.kind != "fix")
                .collect::<Vec<_>>();
            if fallback.is_empty() {
                for cid in candidates {
                    conflicts.push(self.describe_constraint(cid));
                }
            } else {
                conflicts = fallback;
            }
        }
        conflicts
    }

    /// Human-readable description of a constraint for the conflict report.
    fn describe_constraint(&self, cid: ConstraintId) -> ConstraintDesc {
        let Some((_, constraint)) = self.sketch.constraints().find(|(id, _)| *id == cid) else {
            return ConstraintDesc {
                id: cid,
                kind: "unknown".to_string(),
                entities: Vec::new(),
            };
        };
        let entities = constraint
            .referenced_entities()
            .iter()
            .filter_map(|id| {
                let kind = match self.sketch.entity(*id)? {
                    Entity::Point { .. } => "Point",
                    Entity::Line { .. } => "Line",
                    Entity::Circle { .. } => "Circle",
                    Entity::Arc { .. } => "Arc",
                    Entity::Spline { .. } => "Spline",
                };
                Some(EntityDesc {
                    id: *id,
                    label: format!("{}{}", kind, id.0),
                })
            })
            .collect();
        ConstraintDesc {
            id: cid,
            kind: constraint.kind_str().to_string(),
            entities,
        }
    }

    // --- Undo / redo (per-session command stack) ---

    fn push_command(&mut self, before: SketchSnapshot) {
        let after = self.sketch.snapshot();
        self.undo.push(Command { before, after });
        self.redo.clear();
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn undo(&mut self) -> Result<UndoResult, SessionError> {
        let Some(command) = self.undo.pop() else {
            return Err(SessionError::NothingToUndo);
        };
        self.sketch.restore(command.before.clone());
        self.recompute();
        self.redo.push(command);
        Ok(UndoResult { sketch: self.dto() })
    }

    pub fn redo(&mut self) -> Result<UndoResult, SessionError> {
        let Some(command) = self.redo.pop() else {
            return Err(SessionError::NothingToRedo);
        };
        self.sketch.restore(command.after.clone());
        self.recompute();
        self.undo.push(command);
        Ok(UndoResult { sketch: self.dto() })
    }

    // --- DTO ---

    pub fn dto(&self) -> SketchDto {
        let analysis = self.analysis();
        let fd = |id: EntityId| analysis.fully_defined(id);
        let entities = self
            .sketch
            .entities()
            .filter_map(|(id, e)| match e {
                Entity::Point { position } => Some(EntityDto::Point {
                    id,
                    position: *position,
                    fully_defined: fd(id),
                }),
                Entity::Line { start, end } => {
                    let (a, b) = self.sketch.resolved_line(id)?;
                    Some(EntityDto::Line {
                        id,
                        start_id: *start,
                        end_id: *end,
                        start: a,
                        end: b,
                        fully_defined: fd(id),
                        consumed: crate::solver::line_is_consumed_trim_carrier(&self.sketch, id),
                    })
                }
                Entity::Arc {
                    center,
                    radius,
                    start_angle,
                    end_angle,
                } => Some(EntityDto::Arc {
                    id,
                    center: *center,
                    radius: *radius,
                    start_angle: *start_angle,
                    end_angle: *end_angle,
                    fully_defined: fd(id),
                }),
                Entity::Circle { center, radius } => Some(EntityDto::Circle {
                    id,
                    center: *center,
                    radius: *radius,
                    fully_defined: fd(id),
                }),
                Entity::Spline { points } => Some(EntityDto::Spline {
                    id,
                    tessellation: crate::geomops::spline::tessellate_spline(points, 16),
                    points: points.clone(),
                    fully_defined: fd(id),
                }),
            })
            .collect();
        let constraints = self
            .sketch
            .constraints()
            .map(|(id, c)| ConstraintDto { id, constraint: *c })
            .collect();
        SketchDto {
            name: self.name.clone(),
            plane: self.plane,
            basis: self.basis,
            entities,
            constraints,
            reference_midpoints: self
                .reference_midpoints
                .iter()
                .map(|(edge_id, position)| ReferenceMidpointDto {
                    edge_id: *edge_id,
                    position: *position,
                })
                .collect(),
            dimensions: self.dimension_dtos(),
            dimension_style: self.dimension_style,
            dof: DofDto {
                value: analysis.dof,
                fully_defined: analysis.dof == 0 && analysis.unknowns > 0,
            },
            can_undo: self.can_undo(),
            can_redo: self.can_redo(),
        }
    }
}
