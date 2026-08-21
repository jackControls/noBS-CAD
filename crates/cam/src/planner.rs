use serde::{Deserialize, Serialize};

use crate::model::{
    signed_area, CamDocumentDto, CamOperationDto, CamToolDto, ContourCompensation, CoolantMode,
    DrillCycle, Point2Dto, Point3Dto, SpindleDirection, WorkOffset,
};

const EPSILON: f64 = 1.0e-9;
const MAX_GENERATED_STEPS: usize = 250_000;
const MAX_PROGRAM_COMMANDS: usize = 300_000;
/// G0 rapid is a full-speed machine move; standard G-code has no programmable
/// rapid feed. This estimate only feeds the cycle-time statistic.
pub(crate) const RAPID_FEED_ESTIMATE_MM_PER_MIN: f64 = 8_000.0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CamPlanError(pub String);

impl std::fmt::Display for CamPlanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for CamPlanError {}

impl From<String> for CamPlanError {
    fn from(value: String) -> Self {
        Self(value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MotionKind {
    Rapid,
    Cutting,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CamCommandDto {
    ProgramStart {
        name: String,
        work_offset: WorkOffset,
    },
    /// Selects the fixture offset for the motion that follows. Emitted once
    /// per repeated work-offset copy of the program.
    WorkOffset {
        offset: WorkOffset,
    },
    SectionStart {
        operation_id: u64,
        name: String,
        tool_id: u64,
    },
    ToolChange {
        tool_id: u64,
        /// Machine-facing tool number when the library assigns one. Posts
        /// that call tools numerically fail closed on `None`; name-capable
        /// posts (Siemens 828D) use `tool_name` instead.
        tool_number: Option<u32>,
        tool_name: String,
    },
    Spindle {
        direction: SpindleDirection,
        rpm: u32,
    },
    Coolant {
        mode: CoolantMode,
    },
    Rapid {
        to: Point3Dto,
    },
    Linear {
        to: Point3Dto,
        feed: f64,
    },
    Circular {
        clockwise: bool,
        center: Point3Dto,
        to: Point3Dto,
        feed: f64,
    },
    Dwell {
        seconds: f64,
    },
    SectionEnd,
    ProgramEnd,
}

impl CamCommandDto {
    pub fn endpoint(&self) -> Option<Point3Dto> {
        match self {
            Self::Rapid { to } | Self::Linear { to, .. } | Self::Circular { to, .. } => Some(*to),
            _ => None,
        }
    }

    pub fn motion_kind(&self) -> Option<MotionKind> {
        match self {
            Self::Rapid { .. } => Some(MotionKind::Rapid),
            Self::Linear { .. } | Self::Circular { .. } => Some(MotionKind::Cutting),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct CamProgramStatsDto {
    pub rapid_distance: f64,
    pub cutting_distance: f64,
    pub estimated_seconds: f64,
    pub operation_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamProgramDto {
    pub setup_id: u64,
    pub name: String,
    pub commands: Vec<CamCommandDto>,
    pub stats: CamProgramStatsDto,
    /// Work offsets the program repeats with, in posted order.
    #[serde(default)]
    pub work_offsets: Vec<WorkOffset>,
    pub warnings: Vec<String>,
}

/// Expand one fixed-axis setup into deterministic, controller-neutral motion.
/// All coordinates are millimetres in setup/WCS coordinates; Z+ points away
/// from the stock and the spindle axis remains parallel to setup Z.
pub fn plan_setup(document: &CamDocumentDto, setup_id: u64) -> Result<CamProgramDto, CamPlanError> {
    document.validate().map_err(CamPlanError)?;
    let setup = document
        .setup(setup_id)
        .ok_or_else(|| CamPlanError(format!("CAM setup {setup_id} does not exist")))?;
    let operations = setup
        .operations
        .iter()
        .filter(|operation| operation.enabled())
        .collect::<Vec<_>>();
    if operations.is_empty() {
        return Err(CamPlanError(format!(
            "CAM setup '{}' has no enabled operations",
            setup.name
        )));
    }

    let mut builder = ProgramBuilder::new();
    let work_offsets = setup.work_offsets();
    builder.commands.push(CamCommandDto::ProgramStart {
        name: setup.name.clone(),
        work_offset: setup.work_offset,
    });

    let mut active_tool: Option<u64> = None;
    let mut active_spindle: Option<(SpindleDirection, u32)> = None;
    let mut active_coolant = CoolantMode::Off;
    // The program is planned once per consecutive work offset: the same
    // toolpath repeats under G54, G55, ... inside a single program. Modal
    // state (tool/spindle/coolant) carries across the copies, so the second
    // part only re-issues words that actually change.
    for offset in work_offsets.iter().copied() {
        builder.commands.push(CamCommandDto::WorkOffset { offset });
        for operation in &operations {
            let tool = document
                .tool(operation.tool_id())
                .ok_or_else(|| CamPlanError("validated operation tool disappeared".to_string()))?;
            builder.set_safe_heights(operation);
            builder.commands.push(CamCommandDto::SectionStart {
                operation_id: operation.id(),
                name: operation.name().to_string(),
                tool_id: tool.id,
            });

            if active_tool != Some(tool.id) {
                builder.retract_to_clearance();
                if active_coolant != CoolantMode::Off {
                    builder.commands.push(CamCommandDto::Coolant {
                        mode: CoolantMode::Off,
                    });
                    active_coolant = CoolantMode::Off;
                }
                if active_spindle.is_some() {
                    builder.commands.push(CamCommandDto::Spindle {
                        direction: SpindleDirection::Off,
                        rpm: 0,
                    });
                    active_spindle = None;
                    builder.spindle = None;
                }
                builder.commands.push(CamCommandDto::ToolChange {
                    tool_id: tool.id,
                    tool_number: tool.number,
                    tool_name: tool.name.clone(),
                });
                active_tool = Some(tool.id);
            }

            let cutting = operation.cutting();
            let desired_spindle = (SpindleDirection::Clockwise, cutting.spindle_rpm);
            if active_spindle != Some(desired_spindle) {
                builder.commands.push(CamCommandDto::Spindle {
                    direction: desired_spindle.0,
                    rpm: desired_spindle.1,
                });
                active_spindle = Some(desired_spindle);
                builder.spindle = Some(desired_spindle);
            }
            if active_coolant != cutting.coolant {
                builder.commands.push(CamCommandDto::Coolant {
                    mode: cutting.coolant,
                });
                active_coolant = cutting.coolant;
            }

            match operation {
                CamOperationDto::Face { .. } => plan_face(&mut builder, operation, tool)?,
                CamOperationDto::Contour2d { .. } => plan_contour(&mut builder, operation, tool)?,
                CamOperationDto::Drill { .. } => plan_drill(&mut builder, operation, tool)?,
                CamOperationDto::Pocket2d { .. } => plan_pocket(&mut builder, operation, tool)?,
                CamOperationDto::Chamfer2d { .. } => plan_chamfer(&mut builder, operation, tool)?,
            }
            builder.commands.push(CamCommandDto::SectionEnd);
            builder.stats.operation_count += 1;
        }
    }

    builder.retract_to_clearance();
    if active_coolant != CoolantMode::Off {
        builder.commands.push(CamCommandDto::Coolant {
            mode: CoolantMode::Off,
        });
    }
    if active_spindle.is_some() {
        builder.commands.push(CamCommandDto::Spindle {
            direction: SpindleDirection::Off,
            rpm: 0,
        });
    }
    builder.commands.push(CamCommandDto::ProgramEnd);

    Ok(CamProgramDto {
        setup_id,
        name: setup.name.clone(),
        commands: builder.commands,
        stats: builder.stats,
        work_offsets,
        warnings: vec![
            "Toolpaths are stock-aware but are not yet collision-checked against fixtures or holders."
                .to_string(),
            "Posted programs retract Z before the first XY move, but still require a verified WCS and machine-safe start position."
                .to_string(),
            "Simulate, inspect, and dry-run every posted program before machining.".to_string(),
        ],
    })
}

struct ProgramBuilder {
    commands: Vec<CamCommandDto>,
    stats: CamProgramStatsDto,
    position: Option<Point3Dto>,
    /// Safe travel planes of the operation currently being planned.
    clearance_z: f64,
    retract_z: f64,
    /// Last spindle word emitted, so mid-operation reversals (tapping) only
    /// emit blocks when the state actually changes.
    spindle: Option<(SpindleDirection, u32)>,
}

impl ProgramBuilder {
    fn new() -> Self {
        Self {
            commands: Vec::new(),
            stats: CamProgramStatsDto::default(),
            position: None,
            clearance_z: 0.0,
            retract_z: 0.0,
            spindle: None,
        }
    }

    fn set_safe_heights(&mut self, operation: &CamOperationDto) {
        self.clearance_z = operation.clearance_z();
        self.retract_z = operation.retract_z();
    }

    fn rapid(&mut self, to: Point3Dto) {
        if self.position == Some(to) {
            return;
        }
        if let Some(from) = self.position {
            let distance = distance(from, to);
            self.stats.rapid_distance += distance;
            // G0 is a full-speed machine move with no programmable feed; this
            // constant only feeds the rough time estimate, never the program.
            self.stats.estimated_seconds += distance / RAPID_FEED_ESTIMATE_MM_PER_MIN * 60.0;
        }
        self.commands.push(CamCommandDto::Rapid { to });
        self.position = Some(to);
    }

    fn linear(&mut self, to: Point3Dto, feed: f64) {
        if self.position == Some(to) {
            return;
        }
        if let Some(from) = self.position {
            let distance = distance(from, to);
            self.stats.cutting_distance += distance;
            self.stats.estimated_seconds += distance / feed * 60.0;
        }
        self.commands.push(CamCommandDto::Linear { to, feed });
        self.position = Some(to);
    }

    fn dwell(&mut self, seconds: f64) {
        if seconds <= EPSILON {
            return;
        }
        self.commands.push(CamCommandDto::Dwell { seconds });
        self.stats.estimated_seconds += seconds;
    }

    /// Emit a spindle word only when the state changes. Tapping cycles
    /// reverse the spindle mid-operation; tracking keeps redundant M3/M4
    /// blocks out of the stream.
    fn spindle(&mut self, direction: SpindleDirection, rpm: u32) {
        if self.spindle == Some((direction, rpm)) {
            return;
        }
        self.commands.push(CamCommandDto::Spindle { direction, rpm });
        self.spindle = Some((direction, rpm));
    }

    fn retract_to_clearance(&mut self) {
        let Some(position) = self.position else {
            return;
        };
        if (position.z - self.clearance_z).abs() > EPSILON {
            self.rapid(Point3Dto::new(position.x, position.y, self.clearance_z));
        }
    }

    fn approach(&mut self, point: Point2Dto, depth: f64, plunge_feed: f64) {
        self.retract_to_clearance();
        self.rapid(Point3Dto::new(point.x, point.y, self.clearance_z));
        self.rapid(Point3Dto::new(point.x, point.y, self.retract_z));
        self.linear(Point3Dto::new(point.x, point.y, depth), plunge_feed);
    }
}

fn plan_face(
    builder: &mut ProgramBuilder,
    operation: &CamOperationDto,
    tool: &CamToolDto,
) -> Result<(), CamPlanError> {
    let CamOperationDto::Face {
        bounds,
        top_z,
        target_z,
        step_over,
        step_down,
        cutting,
        name,
        ..
    } = operation
    else {
        unreachable!();
    };
    require_flute_length(tool, top_z - target_z, name)?;
    let radius = tool.diameter * 0.5;
    let rows = inclusive_steps(bounds.min.y, bounds.max.y, *step_over)?;
    let depths = depth_levels(*top_z, *target_z, *step_down)?;
    ensure_program_budget(
        builder.commands.len(),
        depths
            .len()
            .saturating_mul(rows.len().saturating_mul(2).saturating_add(4)),
        name,
    )?;
    let start_x = bounds.min.x - radius;
    let end_x = bounds.max.x + radius;
    for depth in depths {
        let first = Point2Dto::new(start_x, rows[0]);
        builder.approach(first, depth, cutting.feed_z);
        for (index, y) in rows.iter().copied().enumerate() {
            let x = if index % 2 == 0 { end_x } else { start_x };
            builder.linear(Point3Dto::new(x, y, depth), cutting.feed_xy);
            if let Some(next_y) = rows.get(index + 1) {
                builder.linear(Point3Dto::new(x, *next_y, depth), cutting.feed_xy);
            }
        }
        builder.retract_to_clearance();
    }
    Ok(())
}

fn plan_contour(
    builder: &mut ProgramBuilder,
    operation: &CamOperationDto,
    tool: &CamToolDto,
) -> Result<(), CamPlanError> {
    let CamOperationDto::Contour2d {
        path,
        top_z,
        bottom_z,
        step_down,
        compensation,
        cutting,
        name,
        ..
    } = operation
    else {
        unreachable!();
    };
    require_flute_length(tool, top_z - bottom_z, name)?;
    let source = without_duplicate_closure(path);
    let center_path = match compensation {
        ContourCompensation::On => source,
        ContourCompensation::Inside => offset_polygon(&source, tool.diameter * 0.5, true)?,
        ContourCompensation::Outside => offset_polygon(&source, tool.diameter * 0.5, false)?,
    };
    let depths = depth_levels(*top_z, *bottom_z, *step_down)?;
    ensure_program_budget(
        builder.commands.len(),
        depths
            .len()
            .saturating_mul(center_path.len().saturating_add(5)),
        name,
    )?;
    for depth in depths {
        let first = center_path[0];
        builder.approach(first, depth, cutting.feed_z);
        for point in center_path.iter().copied().skip(1) {
            builder.linear(Point3Dto::new(point.x, point.y, depth), cutting.feed_xy);
        }
        builder.linear(Point3Dto::new(first.x, first.y, depth), cutting.feed_xy);
        builder.retract_to_clearance();
    }
    Ok(())
}

fn plan_drill(
    builder: &mut ProgramBuilder,
    operation: &CamOperationDto,
    tool: &CamToolDto,
) -> Result<(), CamPlanError> {
    let CamOperationDto::Drill {
        points,
        top_z,
        bottom_z,
        retract_z,
        cycle,
        peck_depth,
        peck_retract,
        thread_pitch,
        feed_out,
        dwell_seconds,
        cutting,
        name,
        ..
    } = operation
    else {
        unreachable!();
    };
    require_flute_length(tool, top_z - bottom_z, name)?;
    let pecking = matches!(cycle, DrillCycle::ChipBreaking | DrillCycle::DeepHole);
    // Validation already enforces these invariants; fail closed here too so a
    // mis-built operation can never reach motion generation.
    let peck = if pecking {
        Some(peck_depth.ok_or_else(|| {
            CamPlanError(format!(
                "drill operation '{name}' pecking cycles require a peck depth"
            ))
        })?)
    } else {
        None
    };
    let depths = match peck {
        Some(peck) => depth_levels(*top_z, *bottom_z, peck)?,
        None => vec![*bottom_z],
    };
    let partial_retract = match cycle {
        // Default partial retract: 0.5 mm, never more than half the peck.
        DrillCycle::ChipBreaking => Some(peck_retract.unwrap_or(0.5).min(peck.expect("pecking cycle") * 0.5)),
        _ => None,
    };
    let tap_feed = match cycle {
        DrillCycle::TappingRight | DrillCycle::TappingLeft => {
            let pitch = thread_pitch.ok_or_else(|| {
                CamPlanError(format!("tapping operation '{name}' requires a thread pitch"))
            })?;
            // Tapping feeds are pitch-synchronised: mm/rev x rpm = mm/min.
            Some(pitch * f64::from(cutting.spindle_rpm))
        }
        _ => None,
    };
    ensure_program_budget(
        builder.commands.len(),
        points
            .len()
            .saturating_mul(depths.len().saturating_mul(3).saturating_add(5)),
        name,
    )?;
    for point in points {
        builder.retract_to_clearance();
        builder.rapid(Point3Dto::new(point.x, point.y, builder.clearance_z));
        builder.rapid(Point3Dto::new(point.x, point.y, *retract_z));
        match cycle {
            DrillCycle::Drill => {
                builder.linear(Point3Dto::new(point.x, point.y, *bottom_z), cutting.feed_z);
                builder.dwell(*dwell_seconds);
                builder.rapid(Point3Dto::new(point.x, point.y, *retract_z));
            }
            DrillCycle::ChipBreaking | DrillCycle::DeepHole => {
                for (index, depth) in depths.iter().copied().enumerate() {
                    builder.linear(Point3Dto::new(point.x, point.y, depth), cutting.feed_z);
                    builder.dwell(*dwell_seconds);
                    if index + 1 < depths.len() {
                        let back = match partial_retract {
                            // Partial retract stays inside the drilled hole,
                            // only breaking the chip.
                            Some(retract) => depth + retract,
                            // Full retract clears the chips out of the hole.
                            None => *retract_z,
                        };
                        builder.rapid(Point3Dto::new(point.x, point.y, back));
                    }
                }
                builder.rapid(Point3Dto::new(point.x, point.y, *retract_z));
            }
            DrillCycle::TappingRight | DrillCycle::TappingLeft => {
                let feed = tap_feed.expect("tap feed computed above");
                let (in_direction, out_direction) = match cycle {
                    DrillCycle::TappingRight => (
                        SpindleDirection::Clockwise,
                        SpindleDirection::Counterclockwise,
                    ),
                    _ => (
                        SpindleDirection::Counterclockwise,
                        SpindleDirection::Clockwise,
                    ),
                };
                builder.spindle(in_direction, cutting.spindle_rpm);
                builder.linear(Point3Dto::new(point.x, point.y, *bottom_z), feed);
                builder.spindle(out_direction, cutting.spindle_rpm);
                builder.linear(Point3Dto::new(point.x, point.y, *retract_z), feed);
                // Restore the section's clockwise spindle so following
                // operations and modal tracking stay consistent.
                builder.spindle(SpindleDirection::Clockwise, cutting.spindle_rpm);
            }
            DrillCycle::Reaming | DrillCycle::Boring => {
                builder.linear(Point3Dto::new(point.x, point.y, *bottom_z), cutting.feed_z);
                builder.dwell(*dwell_seconds);
                builder.linear(
                    Point3Dto::new(point.x, point.y, *retract_z),
                    feed_out.unwrap_or(cutting.feed_z),
                );
            }
        }
    }
    builder.retract_to_clearance();
    Ok(())
}

/// Clear a closed pocket with zigzag scanlines and finish the wall with a
/// boundary pass at every depth. The operator-selected outline is offset
/// inward by the tool radius, so every generated point keeps the tool fully
/// inside the pocket; entry is a plunge, which validation restricts to
/// center-cutting tools until ramp or helical entries exist.
fn plan_pocket(
    builder: &mut ProgramBuilder,
    operation: &CamOperationDto,
    tool: &CamToolDto,
) -> Result<(), CamPlanError> {
    let CamOperationDto::Pocket2d {
        outline,
        top_z,
        bottom_z,
        step_down,
        step_over,
        cutting,
        name,
        ..
    } = operation
    else {
        unreachable!();
    };
    require_flute_length(tool, top_z - bottom_z, name)?;
    let boundary = without_duplicate_closure(outline);
    let clearing = offset_polygon(&boundary, tool.diameter * 0.5, true)?;
    // A miter offset folds into a phantom polygon when the tool nearly fills
    // the outline: orientation can survive while vertices sit closer than
    // one tool radius to a non-adjacent edge. Require every offset vertex to
    // respect the radius from every boundary segment; anything less means
    // the tool would reach past the pocket wall, so fail closed.
    if signed_area(&clearing) * signed_area(&boundary) <= EPSILON
        || !inward_offset_is_clear(&clearing, &boundary, tool.diameter * 0.5)
    {
        return Err(CamPlanError(format!(
            "pocket operation '{name}' is too small for tool {}'s {:.3} mm diameter",
            tool.label(),
            tool.diameter
        )));
    }
    let bounds = polygon_bounds(&clearing);
    let rows = inclusive_steps(bounds.min.y, bounds.max.y, *step_over)?;
    let spans_per_row = rows
        .iter()
        .map(|y| scanline_spans(&clearing, *y))
        .collect::<Vec<_>>();
    let depths = depth_levels(*top_z, *bottom_z, *step_down)?;
    ensure_program_budget(
        builder.commands.len(),
        depths.len().saturating_mul(
            spans_per_row
                .iter()
                .map(|spans| spans.len().saturating_mul(2))
                .sum::<usize>()
                .saturating_add(clearing.len())
                .saturating_add(6),
        ),
        name,
    )?;
    for depth in depths {
        let mut span_index = 0usize;
        let mut entered = false;
        for (row_index, y) in rows.iter().copied().enumerate() {
            for (x0, x1) in spans_per_row[row_index].iter().copied() {
                // Alternate sweep direction so consecutive spans connect
                // without crossing uncleared material more than necessary.
                let (start_x, end_x) = if span_index % 2 == 0 {
                    (x0, x1)
                } else {
                    (x1, x0)
                };
                if !entered {
                    builder.approach(Point2Dto::new(start_x, y), depth, cutting.feed_z);
                    entered = true;
                } else {
                    builder.linear(Point3Dto::new(start_x, y, depth), cutting.feed_xy);
                }
                builder.linear(Point3Dto::new(end_x, y, depth), cutting.feed_xy);
                span_index += 1;
            }
        }
        if !entered {
            return Err(CamPlanError(format!(
                "pocket operation '{name}' has no machinable area at the selected stepover"
            )));
        }
        // Wall finish pass along the radius-compensated boundary.
        let first = clearing[0];
        builder.linear(Point3Dto::new(first.x, first.y, depth), cutting.feed_xy);
        for point in clearing.iter().copied().skip(1) {
            builder.linear(Point3Dto::new(point.x, point.y, depth), cutting.feed_xy);
        }
        builder.linear(Point3Dto::new(first.x, first.y, depth), cutting.feed_xy);
        builder.retract_to_clearance();
    }
    Ok(())
}

/// Single-pass 45 degree chamfer with a 90 degree chamfer mill. With the tip
/// `tip_offset` past the chamfer root, the tool axis stands `tip_offset` off
/// the finished profile (away from the material) and the tip runs
/// `chamfer_width + tip_offset` below the top edge.
fn plan_chamfer(
    builder: &mut ProgramBuilder,
    operation: &CamOperationDto,
    _tool: &CamToolDto,
) -> Result<(), CamPlanError> {
    let CamOperationDto::Chamfer2d {
        path,
        top_z,
        chamfer_width,
        tip_offset,
        wall_side,
        cutting,
        ..
    } = operation
    else {
        unreachable!();
    };
    let source = without_duplicate_closure(path);
    let material_inside = matches!(wall_side, ContourCompensation::Inside);
    let center_path = offset_polygon(&source, *tip_offset, !material_inside)?;
    let depth = top_z - (chamfer_width + tip_offset);
    let first = center_path[0];
    builder.approach(first, depth, cutting.feed_z);
    for point in center_path.iter().copied().skip(1) {
        builder.linear(Point3Dto::new(point.x, point.y, depth), cutting.feed_xy);
    }
    builder.linear(Point3Dto::new(first.x, first.y, depth), cutting.feed_xy);
    builder.retract_to_clearance();
    Ok(())
}

fn polygon_bounds(points: &[Point2Dto]) -> crate::model::Rect2Dto {
    let mut min = Point2Dto::new(f64::INFINITY, f64::INFINITY);
    let mut max = Point2Dto::new(f64::NEG_INFINITY, f64::NEG_INFINITY);
    for point in points {
        min.x = min.x.min(point.x);
        min.y = min.y.min(point.y);
        max.x = max.x.max(point.x);
        max.y = max.y.max(point.y);
    }
    crate::model::Rect2Dto { min, max }
}

/// Verify an inward miter offset truly fits: every offset vertex must stay at
/// least one tool radius from every boundary segment, including non-adjacent
/// ones. This rejects phantom polygons produced when the offset overshoots
/// the polygon's inradius.
fn inward_offset_is_clear(offset: &[Point2Dto], boundary: &[Point2Dto], radius: f64) -> bool {
    let tolerance = radius - 1.0e-6;
    offset.iter().all(|point| {
        point_in_polygon(*point, boundary)
            && (0..boundary.len()).all(|index| {
                let a = boundary[index];
                let b = boundary[(index + 1) % boundary.len()];
                segment_distance(*point, a, b) >= tolerance
            })
    })
}

fn segment_distance(point: Point2Dto, a: Point2Dto, b: Point2Dto) -> f64 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let length_sq = dx * dx + dy * dy;
    if length_sq <= EPSILON {
        return distance_2d(point, a);
    }
    let t = (((point.x - a.x) * dx + (point.y - a.y) * dy) / length_sq).clamp(0.0, 1.0);
    distance_2d(
        point,
        Point2Dto::new(a.x + dx * t, a.y + dy * t),
    )
}

/// Ray-cast containment for a simple closed polygon, boundary inclusive.
fn point_in_polygon(point: Point2Dto, polygon: &[Point2Dto]) -> bool {
    let mut inside = false;
    for index in 0..polygon.len() {
        let a = polygon[index];
        let b = polygon[(index + 1) % polygon.len()];
        let on_segment = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
        let within_x = (point.x >= a.x.min(b.x) - EPSILON) && (point.x <= a.x.max(b.x) + EPSILON);
        let within_y = (point.y >= a.y.min(b.y) - EPSILON) && (point.y <= a.y.max(b.y) + EPSILON);
        if on_segment.abs() <= EPSILON && within_x && within_y {
            return true;
        }
        if (a.y > point.y) != (b.y > point.y) {
            let crossing_x = a.x + (point.y - a.y) * (b.x - a.x) / (b.y - a.y);
            if point.x < crossing_x {
                inside = !inside;
            }
        }
    }
    inside
}

/// Intersect a horizontal scanline with a simple closed polygon and return
/// the interior X spans. Uses the half-open edge rule so rows through a
/// vertex are not double counted.
fn scanline_spans(polygon: &[Point2Dto], y: f64) -> Vec<(f64, f64)> {
    let mut crossings = Vec::new();
    for index in 0..polygon.len() {
        let a = polygon[index];
        let b = polygon[(index + 1) % polygon.len()];
        let (low, high) = if a.y <= b.y { (a, b) } else { (b, a) };
        if y < low.y || y >= high.y {
            continue;
        }
        let t = (y - low.y) / (high.y - low.y);
        crossings.push(low.x + t * (high.x - low.x));
    }
    crossings.sort_by(|left, right| left.total_cmp(right));
    let mut spans = Vec::with_capacity(crossings.len() / 2);
    for pair in crossings.chunks_exact(2) {
        let (x0, x1) = (pair[0], pair[1]);
        if x1 - x0 > EPSILON {
            spans.push((x0, x1));
        }
    }
    spans
}

fn require_flute_length(
    tool: &CamToolDto,
    depth: f64,
    operation: &str,
) -> Result<(), CamPlanError> {
    if depth > tool.flute_length + EPSILON {
        return Err(CamPlanError(format!(
            "operation '{operation}' cuts {:.3} mm deep, beyond tool {}'s {:.3} mm flute length",
            depth,
            tool.label(),
            tool.flute_length
        )));
    }
    Ok(())
}

fn depth_levels(top: f64, bottom: f64, step_down: f64) -> Result<Vec<f64>, CamPlanError> {
    let mut levels = Vec::new();
    let mut depth = top;
    loop {
        if levels.len() >= MAX_GENERATED_STEPS {
            return Err(CamPlanError(format!(
                "toolpath needs more than {MAX_GENERATED_STEPS} depth steps; increase the stepdown or peck depth"
            )));
        }
        let next = (depth - step_down).max(bottom);
        levels.push(next);
        if next <= bottom + EPSILON {
            break;
        }
        depth = next;
    }
    Ok(levels)
}

fn inclusive_steps(min: f64, max: f64, step: f64) -> Result<Vec<f64>, CamPlanError> {
    let mut values = vec![min];
    let mut value = min;
    while value + step < max - EPSILON {
        if values.len() >= MAX_GENERATED_STEPS {
            return Err(CamPlanError(format!(
                "toolpath needs more than {MAX_GENERATED_STEPS} stepover rows; increase the stepover"
            )));
        }
        value += step;
        values.push(value);
    }
    if max - values[values.len() - 1] > EPSILON {
        values.push(max);
    }
    Ok(values)
}

fn ensure_program_budget(
    current_commands: usize,
    estimated_commands: usize,
    operation: &str,
) -> Result<(), CamPlanError> {
    if current_commands.saturating_add(estimated_commands) > MAX_PROGRAM_COMMANDS {
        return Err(CamPlanError(format!(
            "operation '{operation}' would exceed the {MAX_PROGRAM_COMMANDS}-command planning limit; simplify the path or use larger cutting steps"
        )));
    }
    Ok(())
}

fn without_duplicate_closure(points: &[Point2Dto]) -> Vec<Point2Dto> {
    let mut result = points.to_vec();
    if result.len() > 3 && distance_2d(result[0], result[result.len() - 1]) <= EPSILON {
        result.pop();
    }
    result
}

/// Mitered polyline offset for simple closed contours. The stored polygon
/// orientation is preserved; `inside` selects the material-facing side
/// independent of clockwise/counter-clockwise point order.
fn offset_polygon(
    points: &[Point2Dto],
    radius: f64,
    inside: bool,
) -> Result<Vec<Point2Dto>, CamPlanError> {
    let area = signed_area(points);
    let left_is_inside = area > 0.0;
    let side = if inside == left_is_inside { 1.0 } else { -1.0 };
    let offset = radius * side;
    let mut result = Vec::with_capacity(points.len());
    for index in 0..points.len() {
        let previous = points[(index + points.len() - 1) % points.len()];
        let current = points[index];
        let next = points[(index + 1) % points.len()];
        let first_direction = unit_direction(previous, current)?;
        let second_direction = unit_direction(current, next)?;
        let first_normal = Point2Dto::new(-first_direction.y, first_direction.x);
        let second_normal = Point2Dto::new(-second_direction.y, second_direction.x);
        let first_line = Point2Dto::new(
            current.x + first_normal.x * offset,
            current.y + first_normal.y * offset,
        );
        let second_line = Point2Dto::new(
            current.x + second_normal.x * offset,
            current.y + second_normal.y * offset,
        );
        let denominator = cross(first_direction, second_direction);
        let candidate = if denominator.abs() <= EPSILON {
            Point2Dto::new(
                (first_line.x + second_line.x) * 0.5,
                (first_line.y + second_line.y) * 0.5,
            )
        } else {
            let between =
                Point2Dto::new(second_line.x - first_line.x, second_line.y - first_line.y);
            let t = cross(between, second_direction) / denominator;
            Point2Dto::new(
                first_line.x + first_direction.x * t,
                first_line.y + first_direction.y * t,
            )
        };
        if !candidate.is_finite() || distance_2d(candidate, current) > radius * 25.0 {
            return Err(CamPlanError(
                "contour offset produced an excessive miter; simplify the path or use an on-path contour"
                    .to_string(),
            ));
        }
        result.push(candidate);
    }
    if signed_area(&result).abs() <= EPSILON {
        return Err(CamPlanError(
            "tool is too large for the selected contour offset".to_string(),
        ));
    }
    Ok(result)
}

fn unit_direction(from: Point2Dto, to: Point2Dto) -> Result<Point2Dto, CamPlanError> {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let length = (dx * dx + dy * dy).sqrt();
    if length <= EPSILON {
        return Err(CamPlanError(
            "contour contains consecutive duplicate points".to_string(),
        ));
    }
    Ok(Point2Dto::new(dx / length, dy / length))
}

fn cross(a: Point2Dto, b: Point2Dto) -> f64 {
    a.x * b.y - a.y * b.x
}

fn distance_2d(a: Point2Dto, b: Point2Dto) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn distance(a: Point3Dto, b: Point3Dto) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2) + (a.z - b.z).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        CamResolvedStockDto, CamSetupDto, CamStockSpecDto, CamToolKind, CuttingParametersDto,
        Rect2Dto, StockBoxDto, WcsOriginSpecDto, WorkCoordinateSystemDto,
    };

    fn cutting() -> CuttingParametersDto {
        CuttingParametersDto {
            spindle_rpm: 12_000,
            feed_xy: 800.0,
            feed_z: 200.0,
            coolant: CoolantMode::Flood,
        }
    }

    fn tool(id: u64, kind: CamToolKind, diameter: f64) -> CamToolDto {
        CamToolDto {
            id,
            number: Some(id as u32),
            name: format!("Tool {id}"),
            kind,
            diameter,
            flute_length: 20.0,
            overall_length: 50.0,
            center_cutting: true,
            flute_count: 4,
            point_angle_degrees: (kind == CamToolKind::ChamferMill).then_some(90.0),
            cutting: CuttingParametersDto::default(),
        }
    }

    fn document(operations: Vec<CamOperationDto>, tools: Vec<CamToolDto>) -> CamDocumentDto {
        CamDocumentDto {
            setups: vec![CamSetupDto {
                id: 1,
                name: "Setup 1".into(),
                wcs: WorkCoordinateSystemDto::default(),
                wcs_origin: WcsOriginSpecDto::Explicit,
                work_offset: WorkOffset::G54,
                work_offset_count: 1,
                stock_spec: CamStockSpecDto::LegacyBox,
                resolved_stock: CamResolvedStockDto::Box,
                stock: StockBoxDto {
                    min: Point3Dto::new(0.0, 0.0, -20.0),
                    max: Point3Dto::new(40.0, 30.0, 0.0),
                },
                stock_model_box: None,
                body_ids: vec![],
                legacy_clearance_z: None,
                legacy_retract_z: None,
                operations,
            }],
            active_setup_id: Some(1),
            next_setup_id: 2,
            next_operation_id: 10,
            next_tool_id: tools.iter().map(|tool| tool.id).max().unwrap_or(0) + 1,
            tools,
            units: crate::model::CamUnits::Millimeters,
            post_defaults: crate::model::CamPostConfigDto::default(),
        }
    }

    #[test]
    fn facing_is_zigzagged_at_each_depth_and_never_rapids_below_retract() {
        let operation = CamOperationDto::Face {
            id: 1,
            name: "Face".into(),
            enabled: true,
            tool_id: 1,
            bounds: Rect2Dto {
                min: Point2Dto::new(0.0, 0.0),
                max: Point2Dto::new(40.0, 30.0),
            },
            top_z: 0.0,
            target_z: -2.0,
            step_over: 3.0,
            step_down: 1.0,
            clearance_z: 10.0,
            retract_z: 3.0,
            cutting: cutting(),
        };
        let program = plan_setup(
            &document(
                vec![operation],
                vec![tool(1, CamToolKind::FlatEndMill, 6.0)],
            ),
            1,
        )
        .unwrap();
        let cut_depths = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { to, .. } if to.z < 0.0 => Some(to.z),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(cut_depths.contains(&-1.0));
        assert!(cut_depths.contains(&-2.0));
        assert!(program.commands.iter().all(|command| match command {
            CamCommandDto::Rapid { to } => to.z >= 3.0,
            _ => true,
        }));
        assert_eq!(program.stats.operation_count, 1);
        assert!(program.stats.cutting_distance > 0.0);
    }

    #[test]
    fn outside_contour_offsets_a_ccw_rectangle_by_tool_radius() {
        let points = vec![
            Point2Dto::new(10.0, 10.0),
            Point2Dto::new(30.0, 10.0),
            Point2Dto::new(30.0, 20.0),
            Point2Dto::new(10.0, 20.0),
        ];
        let offset = offset_polygon(&points, 2.0, false).unwrap();
        assert_eq!(offset[0], Point2Dto::new(8.0, 8.0));
        assert_eq!(offset[2], Point2Dto::new(32.0, 22.0));
    }

    #[test]
    fn peck_drill_fully_retracts_between_pecks() {
        let operation = CamOperationDto::Drill {
            id: 1,
            name: "Drill".into(),
            enabled: true,
            tool_id: 2,
            points: vec![Point2Dto::new(20.0, 15.0)],
            top_z: 0.0,
            bottom_z: -7.0,
            retract_z: 3.0,
            peck_depth: Some(3.0),
            dwell_seconds: 0.1,
            clearance_z: 10.0,
            cycle: DrillCycle::DeepHole,
            peck_retract: None,
            thread_pitch: None,
            feed_out: None,
            cutting: cutting(),
        };
        let program = plan_setup(
            &document(vec![operation], vec![tool(2, CamToolKind::Drill, 5.0)]),
            1,
        )
        .unwrap();
        let plunge_depths = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { to, .. } => Some(to.z),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(plunge_depths, vec![-3.0, -6.0, -7.0]);
        assert_eq!(
            program
                .commands
                .iter()
                .filter(|command| matches!(command, CamCommandDto::Dwell { .. }))
                .count(),
            3
        );
    }

    #[test]
    fn flute_length_is_a_hard_planning_limit() {
        let operation = CamOperationDto::Contour2d {
            id: 1,
            name: "Deep contour".into(),
            enabled: true,
            tool_id: 1,
            path: vec![
                Point2Dto::new(5.0, 5.0),
                Point2Dto::new(35.0, 5.0),
                Point2Dto::new(35.0, 25.0),
                Point2Dto::new(5.0, 25.0),
            ],
            top_z: 0.0,
            bottom_z: -15.0,
            step_down: 2.0,
            compensation: ContourCompensation::Outside,
            clearance_z: 10.0,
            retract_z: 3.0,
            cutting: cutting(),
        };
        let mut short_tool = tool(1, CamToolKind::FlatEndMill, 6.0);
        short_tool.flute_length = 10.0;
        let error = plan_setup(&document(vec![operation], vec![short_tool]), 1).unwrap_err();
        assert!(error.0.contains("flute length"));
    }

    #[test]
    fn drill_retract_must_stay_between_cut_top_and_clearance() {
        // Retracting below the hole top would rapid inside the drilled hole.
        let operation = CamOperationDto::Drill {
            id: 1,
            name: "Unsafe drill".into(),
            enabled: true,
            tool_id: 2,
            points: vec![Point2Dto::new(20.0, 15.0)],
            top_z: -5.0,
            bottom_z: -10.0,
            retract_z: -6.0,
            peck_depth: Some(2.0),
            dwell_seconds: 0.0,
            clearance_z: 10.0,
            cycle: DrillCycle::DeepHole,
            peck_retract: None,
            thread_pitch: None,
            feed_out: None,
            cutting: cutting(),
        };
        let error = plan_setup(
            &document(vec![operation], vec![tool(2, CamToolKind::Drill, 5.0)]),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("retract Z must be above the cut top"));
    }

    fn drill_operation(cycle: DrillCycle) -> CamOperationDto {
        CamOperationDto::Drill {
            id: 1,
            name: "Hole cycle".into(),
            enabled: true,
            tool_id: 2,
            points: vec![Point2Dto::new(20.0, 15.0)],
            top_z: 0.0,
            bottom_z: -7.0,
            retract_z: 3.0,
            clearance_z: 10.0,
            cycle,
            peck_depth: None,
            peck_retract: None,
            thread_pitch: None,
            feed_out: None,
            dwell_seconds: 0.0,
            cutting: CuttingParametersDto {
                spindle_rpm: 400,
                feed_xy: 300.0,
                feed_z: 120.0,
                coolant: CoolantMode::Off,
            },
        }
    }

    #[test]
    fn chip_breaking_partially_retracts_inside_the_hole() {
        let mut operation = drill_operation(DrillCycle::ChipBreaking);
        let CamOperationDto::Drill {
            peck_depth,
            peck_retract,
            ..
        } = &mut operation
        else {
            unreachable!();
        };
        *peck_depth = Some(3.0);
        *peck_retract = Some(0.8);
        let program = plan_setup(
            &document(vec![operation], vec![tool(2, CamToolKind::Drill, 5.0)]),
            1,
        )
        .unwrap();
        let rapid_zs: Vec<f64> = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Rapid { to } => Some(to.z),
                _ => None,
            })
            .collect();
        // Approach planes, then partial retracts that stay inside the hole
        // (peck + 0.8 mm), then the retract plane and final clearance.
        let expected = [10.0, 3.0, -2.2, -5.2, 3.0, 10.0];
        assert_eq!(rapid_zs.len(), expected.len());
        for (actual, expected) in rapid_zs.iter().zip(expected.iter()) {
            assert!(
                (actual - expected).abs() < 1.0e-9,
                "rapid at {actual} should be {expected}"
            );
        }
    }

    #[test]
    fn tapping_feeds_at_pitch_and_reverses_the_spindle() {
        let mut operation = drill_operation(DrillCycle::TappingRight);
        let CamOperationDto::Drill { thread_pitch, .. } = &mut operation else {
            unreachable!();
        };
        *thread_pitch = Some(1.25);
        let program = plan_setup(
            &document(vec![operation], vec![tool(2, CamToolKind::Tap, 6.0)]),
            1,
        )
        .unwrap();
        // Pitch-synchronised feed: 1.25 mm/rev at 400 rpm = 500 mm/min.
        let feeds: Vec<f64> = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { feed, .. } => Some(*feed),
                _ => None,
            })
            .collect();
        assert_eq!(feeds, vec![500.0, 500.0]);
        let spindle_turns: Vec<SpindleDirection> = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Spindle { direction, .. } => Some(*direction),
                _ => None,
            })
            .collect();
        assert_eq!(
            spindle_turns,
            vec![
                SpindleDirection::Clockwise,
                SpindleDirection::Counterclockwise,
                SpindleDirection::Clockwise,
                SpindleDirection::Off
            ]
        );
    }

    #[test]
    fn left_hand_tapping_enters_counterclockwise() {
        let mut operation = drill_operation(DrillCycle::TappingLeft);
        let CamOperationDto::Drill { thread_pitch, .. } = &mut operation else {
            unreachable!();
        };
        *thread_pitch = Some(1.0);
        let program = plan_setup(
            &document(vec![operation], vec![tool(2, CamToolKind::Tap, 6.0)]),
            1,
        )
        .unwrap();
        let spindle_turns: Vec<SpindleDirection> = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Spindle { direction, .. } => Some(*direction),
                _ => None,
            })
            .collect();
        // Section start is CW; the left-hand cycle swaps to CCW for entry,
        // CW for the feed out, and restores CW afterwards.
        assert_eq!(
            spindle_turns,
            vec![
                SpindleDirection::Clockwise,
                SpindleDirection::Counterclockwise,
                SpindleDirection::Clockwise,
                SpindleDirection::Off
            ]
        );
    }

    #[test]
    fn reaming_feeds_back_out_at_the_feed_out_rate() {
        let mut operation = drill_operation(DrillCycle::Reaming);
        let CamOperationDto::Drill { feed_out, .. } = &mut operation else {
            unreachable!();
        };
        *feed_out = Some(60.0);
        let program = plan_setup(
            &document(vec![operation], vec![tool(2, CamToolKind::Reamer, 6.0)]),
            1,
        )
        .unwrap();
        let moves: Vec<(f64, f64)> = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { to, feed } => Some((to.z, *feed)),
                _ => None,
            })
            .collect();
        // Feed in at the plunge feed, feed back out at the feed-out rate.
        assert_eq!(moves, vec![(-7.0, 120.0), (3.0, 60.0)]);
    }

    #[test]
    fn cycle_specific_fields_fail_closed_when_mismatched() {
        // Tapping needs a pitch and a tap tool.
        let tapping = drill_operation(DrillCycle::TappingRight);
        let error = plan_setup(
            &document(vec![tapping.clone()], vec![tool(2, CamToolKind::Tap, 6.0)]),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("thread pitch"));
        let error = plan_setup(
            &document(vec![tapping], vec![tool(2, CamToolKind::Drill, 6.0)]),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("requires a tap tool"));
        // Pecking cycles need a peck depth...
        let error = plan_setup(
            &document(
                vec![drill_operation(DrillCycle::ChipBreaking)],
                vec![tool(2, CamToolKind::Drill, 5.0)],
            ),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("peck depth"));
        // ...and a plain drill must not carry one.
        let mut plain = drill_operation(DrillCycle::Drill);
        let CamOperationDto::Drill { peck_depth, .. } = &mut plain else {
            unreachable!();
        };
        *peck_depth = Some(2.0);
        let error = plan_setup(
            &document(vec![plain], vec![tool(2, CamToolKind::Drill, 5.0)]),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("only pecking cycles"));
    }

    #[test]
    fn repeated_work_offsets_duplicate_motion_under_each_offset_code() {
        let face = || CamOperationDto::Face {
            id: 1,
            name: "Face".into(),
            enabled: true,
            tool_id: 1,
            bounds: Rect2Dto {
                min: Point2Dto::new(0.0, 0.0),
                max: Point2Dto::new(40.0, 30.0),
            },
            top_z: 0.0,
            target_z: -1.0,
            step_over: 5.0,
            step_down: 1.0,
            clearance_z: 10.0,
            retract_z: 3.0,
            cutting: cutting(),
        };
        let tools = || vec![tool(1, CamToolKind::FlatEndMill, 6.0)];
        let mut repeated = document(vec![face()], tools());
        repeated.setups[0].work_offset_count = 3;
        let program = plan_setup(&repeated, 1).unwrap();
        assert_eq!(
            program.work_offsets,
            vec![WorkOffset::G54, WorkOffset::G55, WorkOffset::G56]
        );
        let offset_commands = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::WorkOffset { offset } => Some(*offset),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            offset_commands,
            vec![WorkOffset::G54, WorkOffset::G55, WorkOffset::G56]
        );
        // Three executed copies of one operation.
        assert_eq!(program.stats.operation_count, 3);
        // The single tool stays loaded across copies: exactly one tool change.
        assert_eq!(
            program
                .commands
                .iter()
                .filter(|command| matches!(command, CamCommandDto::ToolChange { .. }))
                .count(),
            1
        );
        // Each copy cuts the full face: cutting distance triples one copy.
        let single = plan_setup(&document(vec![face()], tools()), 1).unwrap();
        assert!(
            (program.stats.cutting_distance - single.stats.cutting_distance * 3.0).abs() < 1.0e-6
        );
    }

    #[test]
    fn tiny_stepover_fails_closed_before_generating_an_unbounded_path() {
        let operation = CamOperationDto::Face {
            id: 1,
            name: "Too many rows".into(),
            enabled: true,
            tool_id: 1,
            bounds: Rect2Dto {
                min: Point2Dto::new(0.0, 0.0),
                max: Point2Dto::new(40.0, 30.0),
            },
            top_z: 0.0,
            target_z: -1.0,
            step_over: 0.000_001,
            step_down: 1.0,
            clearance_z: 10.0,
            retract_z: 3.0,
            cutting: cutting(),
        };
        let error = plan_setup(
            &document(
                vec![operation],
                vec![tool(1, CamToolKind::FlatEndMill, 6.0)],
            ),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("stepover rows"));
    }

    #[test]
    fn pocket_clears_every_depth_and_finishes_the_wall_inside_the_outline() {
        let operation = CamOperationDto::Pocket2d {
            id: 1,
            name: "Pocket".into(),
            enabled: true,
            tool_id: 1,
            outline: vec![
                Point2Dto::new(10.0, 5.0),
                Point2Dto::new(30.0, 5.0),
                Point2Dto::new(30.0, 25.0),
                Point2Dto::new(10.0, 25.0),
            ],
            top_z: 0.0,
            bottom_z: -2.0,
            step_down: 1.0,
            step_over: 2.4,
            clearance_z: 10.0,
            retract_z: 3.0,
            cutting: cutting(),
        };
        let program = plan_setup(
            &document(
                vec![operation],
                vec![tool(1, CamToolKind::FlatEndMill, 6.0)],
            ),
            1,
        )
        .unwrap();
        // Tool radius is 3 mm, so all cutting XY motion stays inside the
        // outline shrunk by 3 mm: X in 13..=27, Y in 8..=22.
        let mut cut_depths = Vec::new();
        for command in &program.commands {
            if let CamCommandDto::Linear { to, .. } = command {
                if to.z < 0.0 {
                    assert!((13.0 - 1.0e-9..=27.0 + 1.0e-9).contains(&to.x));
                    assert!((8.0 - 1.0e-9..=22.0 + 1.0e-9).contains(&to.y));
                    cut_depths.push(to.z);
                }
            }
        }
        assert!(cut_depths.contains(&-1.0));
        assert!(cut_depths.contains(&-2.0));
        assert!(program.commands.iter().all(|command| match command {
            CamCommandDto::Rapid { to } => to.z >= 3.0,
            _ => true,
        }));
    }

    #[test]
    fn pocket_rejects_a_tool_that_cannot_fit_the_outline() {
        let operation = CamOperationDto::Pocket2d {
            id: 1,
            name: "Tiny pocket".into(),
            enabled: true,
            tool_id: 1,
            outline: vec![
                Point2Dto::new(10.0, 10.0),
                Point2Dto::new(14.0, 10.0),
                Point2Dto::new(14.0, 14.0),
                Point2Dto::new(10.0, 14.0),
            ],
            top_z: 0.0,
            bottom_z: -1.0,
            step_down: 1.0,
            step_over: 1.0,
            clearance_z: 10.0,
            retract_z: 3.0,
            cutting: cutting(),
        };
        let error = plan_setup(
            &document(
                vec![operation],
                vec![tool(1, CamToolKind::FlatEndMill, 6.0)],
            ),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("too small") || error.0.contains("miter"));
    }

    #[test]
    fn chamfer_offsets_by_tip_offset_and_cuts_width_plus_tip_offset_deep() {
        // CCW square with the material inside the path (a boss top edge), so
        // the tool stands off outward by the tip offset and cuts one pass at
        // top - (width + tip offset).
        let operation = CamOperationDto::Chamfer2d {
            id: 1,
            name: "Chamfer".into(),
            enabled: true,
            tool_id: 3,
            path: vec![
                Point2Dto::new(10.0, 10.0),
                Point2Dto::new(30.0, 10.0),
                Point2Dto::new(30.0, 20.0),
                Point2Dto::new(10.0, 20.0),
            ],
            top_z: 0.0,
            chamfer_width: 1.0,
            tip_offset: 0.5,
            wall_side: ContourCompensation::Inside,
            clearance_z: 10.0,
            retract_z: 3.0,
            cutting: cutting(),
        };
        let program = plan_setup(
            &document(
                vec![operation],
                vec![tool(3, CamToolKind::ChamferMill, 10.0)],
            ),
            1,
        )
        .unwrap();
        let cuts = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { to, .. } if to.z < 0.0 => Some(*to),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(!cuts.is_empty());
        assert!(cuts
            .iter()
            .all(|point| (point.z - (-1.5)).abs() < 1.0e-9));
        // Outward offset of 0.5 mm on a CCW square: X range 9.5..=30.5.
        assert!(cuts
            .iter()
            .any(|point| (point.x - 30.5).abs() < 1.0e-9));
        assert!(cuts.iter().all(|point| point.x >= 9.5 - 1.0e-9));
    }

    #[test]
    fn chamfer_requires_a_chamfer_mill() {
        let operation = CamOperationDto::Chamfer2d {
            id: 1,
            name: "Wrong tool".into(),
            enabled: true,
            tool_id: 1,
            path: vec![
                Point2Dto::new(10.0, 10.0),
                Point2Dto::new(30.0, 10.0),
                Point2Dto::new(30.0, 20.0),
                Point2Dto::new(10.0, 20.0),
            ],
            top_z: 0.0,
            chamfer_width: 1.0,
            tip_offset: 0.5,
            wall_side: ContourCompensation::Outside,
            clearance_z: 10.0,
            retract_z: 3.0,
            cutting: cutting(),
        };
        let error = plan_setup(
            &document(
                vec![operation],
                vec![tool(1, CamToolKind::FlatEndMill, 6.0)],
            ),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("chamfer mill"));
    }
}
