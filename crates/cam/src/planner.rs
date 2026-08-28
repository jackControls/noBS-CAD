use serde::{Deserialize, Serialize};

use crate::model::{
    signed_area, CamDocumentDto, CamOperationDto, CamToolDto, CompensationMode,
    ContourCompensation, CoolantMode, DrillCycle, FaceDirection, MillingDirection, Point2Dto,
    Point3Dto, SpindleDirection, ThreadHand, WorkOffset,
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
    /// Activates machine-side cutter radius compensation: `left` true means
    /// the tool shifts left of the programmed travel direction (G41), false
    /// means right (G42). Takes effect on the LINEAR move that follows — the
    /// lead-in — and stays active until `CutterCompensationOff`. Only
    /// emitted for contour operations whose compensation mode is in control;
    /// the programmed path then stays the part contour and the diameter
    /// register is a machine-side value the post resolves.
    CutterCompensationOn {
        left: bool,
    },
    /// Cancels machine-side cutter radius compensation on the LINEAR move
    /// that follows — the lead-out (G40).
    CutterCompensationOff,
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

/// Motion totals of one operation within a single work-offset copy of the
/// program. Programs repeated across consecutive work offsets report the
/// first copy, which every duplicate shares.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct CamOperationStatsDto {
    pub operation_id: u64,
    pub rapid_distance: f64,
    pub cutting_distance: f64,
    pub estimated_seconds: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamProgramDto {
    pub setup_id: u64,
    pub name: String,
    pub commands: Vec<CamCommandDto>,
    pub stats: CamProgramStatsDto,
    /// Per-operation motion totals for the manufacturing status readout.
    #[serde(default)]
    pub per_operation: Vec<CamOperationStatsDto>,
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
    let mut per_operation: Vec<CamOperationStatsDto> = Vec::new();
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
            let section_stats = builder.stats;

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
                CamOperationDto::Thread { .. } => plan_thread(&mut builder, operation, tool)?,
            }
            builder.commands.push(CamCommandDto::SectionEnd);
            builder.stats.operation_count += 1;
            // Duplicated work offsets repeat identical motion; keep the first
            // copy's totals as the operation's machining-time readout.
            if !per_operation
                .iter()
                .any(|entry| entry.operation_id == operation.id())
            {
                per_operation.push(CamOperationStatsDto {
                    operation_id: operation.id(),
                    rapid_distance: builder.stats.rapid_distance - section_stats.rapid_distance,
                    cutting_distance: builder.stats.cutting_distance
                        - section_stats.cutting_distance,
                    estimated_seconds: builder.stats.estimated_seconds
                        - section_stats.estimated_seconds,
                });
            }
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
        per_operation,
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
    /// Feed-engagement plane of the current operation: rapids never go below
    /// it (clamped to the cut depth), everything underneath is feed rate.
    feed_height_z: f64,
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
            feed_height_z: 0.0,
            spindle: None,
        }
    }

    fn set_safe_heights(&mut self, operation: &CamOperationDto) {
        self.clearance_z = operation.clearance_z();
        self.retract_z = operation.retract_z();
        self.feed_height_z = operation.feed_height_z();
    }

    /// The lowest plane a rapid may reach when the cut goes to `depth`: the
    /// feed-engagement plane, but never below the target depth itself.
    fn feed_plane(&self, depth: f64) -> f64 {
        self.feed_height_z.max(depth)
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

    /// Circular interpolation in the setup XY plane. `to` may carry a
    /// different Z than the current position, producing a helical move
    /// (thread milling). The arc length, including the Z travel, feeds the
    /// distance and time estimates.
    fn circular(&mut self, to: Point3Dto, center: Point2Dto, clockwise: bool, feed: f64) {
        let Some(from) = self.position else {
            // An arc needs an established start point; position first.
            self.linear(to, feed);
            return;
        };
        if from == to {
            return;
        }
        let radius = distance_2d(Point2Dto { x: from.x, y: from.y }, center);
        let start_angle = (from.y - center.y).atan2(from.x - center.x);
        let end_angle = (to.y - center.y).atan2(to.x - center.x);
        let mut sweep = end_angle - start_angle;
        if clockwise {
            while sweep >= 0.0 {
                sweep -= std::f64::consts::TAU;
            }
        } else {
            while sweep <= 0.0 {
                sweep += std::f64::consts::TAU;
            }
        }
        let arc = radius * sweep.abs();
        let length = arc.hypot(to.z - from.z);
        self.stats.cutting_distance += length;
        self.stats.estimated_seconds += length / feed * 60.0;
        self.commands.push(CamCommandDto::Circular {
            clockwise,
            center: Point3Dto::new(center.x, center.y, from.z),
            to,
            feed,
        });
        self.position = Some(to);
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
        // Rapids stop at the feed-engagement plane; the rest of the way down
        // runs at plunge feed.
        let feed_plane = self.feed_plane(depth);
        self.rapid(Point3Dto::new(point.x, point.y, feed_plane));
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
        safe_distance,
        direction,
        cutting,
        name,
        ..
    } = operation
    else {
        unreachable!();
    };
    require_flute_length(tool, top_z - target_z, name)?;
    let radius = tool.diameter * 0.5;
    // Rows are centered on the face: cutter bands extend one radius past
    // each row's center, so the minimal row count spans the face, and a
    // face one band already covers gets exactly one pass through the
    // middle — never a row hugging the near edge.
    let width = bounds.max.y - bounds.min.y;
    let span_needed = (width - tool.diameter).max(0.0);
    let mut row_count = 1usize;
    while span_needed > EPSILON && (row_count - 1) as f64 * step_over < span_needed - EPSILON {
        row_count += 1;
        if row_count >= MAX_GENERATED_STEPS {
            return Err(CamPlanError(format!(
                "toolpath needs more than {MAX_GENERATED_STEPS} stepover rows; increase the stepover"
            )));
        }
    }
    let center_y = (bounds.min.y + bounds.max.y) * 0.5;
    let rows: Vec<f64> = (0..row_count)
        .map(|index| center_y + (index as f64 - (row_count - 1) as f64 * 0.5) * step_over)
        .collect();
    let depths = depth_levels(*top_z, *target_z, *step_down)?;
    ensure_program_budget(
        builder.commands.len(),
        depths
            .len()
            .saturating_mul(rows.len().saturating_mul(2).saturating_add(4)),
        name,
    )?;
    // The plunge point sits one radius plus the operator's safe distance
    // clear of the stock's min-X edge: the cutter always descends in free
    // air, never into material (no plunge-milling on entry). One-way cutting
    // (climb/conventional) enters on the side that gives the requested
    // engagement instead: rows step from min to max Y with fresh material on
    // the +Y side, so with a clockwise spindle the climb row runs +X.
    let start_x = bounds.min.x - radius - safe_distance;
    let end_x = bounds.max.x + radius;
    let return_x = bounds.max.x + radius + safe_distance;
    let one_way = !matches!(direction, FaceDirection::BothWays);
    for depth in depths {
        if one_way {
            // Every row cuts the same direction; between rows the tool lifts
            // to the feed plane and repositions in free air beyond the stock
            // edge before feeding back down.
            let climb = matches!(direction, FaceDirection::Climb);
            let (enter_x, exit_x) = if climb {
                (start_x, end_x)
            } else {
                (return_x, start_x)
            };
            builder.approach(Point2Dto::new(enter_x, rows[0]), depth, cutting.feed_z);
            for (index, y) in rows.iter().copied().enumerate() {
                builder.linear(Point3Dto::new(exit_x, y, depth), cutting.feed_xy);
                if let Some(next_y) = rows.get(index + 1) {
                    let feed_plane = builder.feed_plane(depth);
                    builder.rapid(Point3Dto::new(exit_x, y, feed_plane));
                    builder.rapid(Point3Dto::new(enter_x, *next_y, feed_plane));
                    builder.linear(Point3Dto::new(enter_x, *next_y, depth), cutting.feed_z);
                }
            }
        } else {
            let first = Point2Dto::new(start_x, rows[0]);
            builder.approach(first, depth, cutting.feed_z);
            for (index, y) in rows.iter().copied().enumerate() {
                let x = if index % 2 == 0 { end_x } else { start_x };
                builder.linear(Point3Dto::new(x, y, depth), cutting.feed_xy);
                if let Some(next_y) = rows.get(index + 1) {
                    builder.linear(Point3Dto::new(x, *next_y, depth), cutting.feed_xy);
                }
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
        closed,
        top_z,
        bottom_z,
        step_down,
        compensation,
        compensation_mode,
        lead_in,
        lead_out,
        lead_arc_radius,
        direction,
        roughing_passes,
        roughing_step_over,
        finishing_pass,
        finish_allowance,
        finish_feed,
        spring_pass,
        cutting,
        name,
        ..
    } = operation
    else {
        unreachable!();
    };
    require_flute_length(tool, top_z - bottom_z, name)?;
    let radius = tool.diameter * 0.5;
    let source = without_duplicate_closure(path);

    // --- Travel direction (climb/conventional); the spindle is assumed
    // clockwise (M3), counter-clockwise spindles flip every case and are a
    // documented limitation of this round.
    // Closed loops: climb is counter-clockwise travel on an outside profile
    // and clockwise on an inside one. Re-winding keeps the start corner
    // first so lead geometry does not move. Open chains: climb keeps the
    // tool on the RIGHT of travel; reversing the chain flips the effective
    // compensation side so the physical tool side the operator picked never
    // changes.
    let mut oriented = source.clone();
    let mut chain_reversed = false;
    if *closed && !matches!(compensation, ContourCompensation::On) {
        let want_ccw = matches!(
            (direction, compensation),
            (MillingDirection::Climb, ContourCompensation::Outside)
                | (MillingDirection::Conventional, ContourCompensation::Inside)
        );
        if (signed_area(&source) > 0.0) != want_ccw {
            oriented = std::iter::once(source[0])
                .chain(source[1..].iter().rev().copied())
                .collect();
            chain_reversed = true;
        }
    } else if !*closed
        && matches!(
            compensation,
            ContourCompensation::Left | ContourCompensation::Right
        )
    {
        let physical_left = matches!(compensation, ContourCompensation::Left);
        let want_left = matches!(direction, MillingDirection::Conventional);
        if physical_left != want_left {
            oriented.reverse();
            chain_reversed = true;
        }
    }
    // Compensation side relative to the (possibly re-oriented) travel.
    let effective_left = match compensation {
        ContourCompensation::Left => Some(!chain_reversed),
        ContourCompensation::Right => Some(chain_reversed),
        _ => None,
    };
    let oriented_area = signed_area(&oriented);

    // The tool EDGE tracks the contour, never the centerline. In software the
    // planner shifts the center path by the radius; in control the path stays
    // the part contour and the machine applies the offset — the post emits
    // G41/G42 on the lead-in and G40 on the lead-out.
    let comp_left = match (compensation_mode, compensation) {
        (CompensationMode::InControl, ContourCompensation::Left | ContourCompensation::Right) => {
            effective_left
        }
        (CompensationMode::InControl, ContourCompensation::Inside) => Some(oriented_area > 0.0),
        (CompensationMode::InControl, ContourCompensation::Outside) => Some(oriented_area <= 0.0),
        _ => None,
    };

    // --- Radial pass plan. Extras are the radial distances BEYOND the finish
    // offset at which roughing passes run, largest first so every following
    // pass has the previous pass's air beside it. The profile pass (extra 0)
    // always runs last; with machine compensation it is also the only pass
    // that carries G41/G42 — roughing passes are pre-offset here.
    let step = if *roughing_passes > 1 {
        roughing_step_over.unwrap_or(0.0)
    } else {
        0.0
    };
    let mut extras: Vec<f64> = (0..*roughing_passes)
        .rev()
        .map(|index| {
            let mut extra = f64::from(index) * step;
            if *finishing_pass {
                extra += finish_allowance;
            }
            extra
        })
        .collect();
    if *finishing_pass {
        extras.push(0.0);
    }

    let inside_closed = *closed && matches!(compensation, ContourCompensation::Inside);
    // The side the lead arc bends toward is the side AWAY from the material:
    // the outside of an outside-compensated ring, or the tool side of an
    // open chain. (Inside-compensated closed loops keep their bisector
    // leads; validation rejects arc radii there.)
    let bend_left = if inside_closed {
        false
    } else if *closed {
        oriented_area < 0.0
    } else {
        effective_left.unwrap_or(false)
    };

    let depths = depth_levels(*top_z, *bottom_z, *step_down)?;
    ensure_program_budget(
        builder.commands.len(),
        depths.len().saturating_mul(
            extras
                .len()
                .saturating_mul(source.len().saturating_add(14)),
        ),
        name,
    )?;

    for depth in depths {
        for extra in extras.iter().copied() {
            let profile_pass = extra <= EPSILON;
            let use_comp = comp_left.is_some() && profile_pass;
            // Center path of this pass: the machine-compensated profile pass
            // programs the part contour itself; every other pass is offset
            // here by the tool radius plus the pass's extra allowance.
            let center_path = if use_comp || matches!(compensation, ContourCompensation::On) {
                oriented.clone()
            } else {
                match compensation {
                    ContourCompensation::On => unreachable!(),
                    ContourCompensation::Inside => {
                        offset_polygon(&oriented, radius + extra, true)?
                    }
                    ContourCompensation::Outside => {
                        offset_polygon(&oriented, radius + extra, false)?
                    }
                    ContourCompensation::Left | ContourCompensation::Right => {
                        offset_polyline_open(&oriented, radius + extra, effective_left.unwrap())?
                    }
                }
            };
            let feed = if profile_pass && *finishing_pass {
                finish_feed.unwrap_or(cutting.feed_xy)
            } else {
                cutting.feed_xy
            };
            let leads = contour_leads(
                &center_path,
                *closed,
                inside_closed,
                *lead_in,
                *lead_out,
                *lead_arc_radius,
                bend_left,
            )?;
            // The plunge happens at the lead start — in free air for
            // compensated paths — never on the profile itself.
            builder.approach(leads.start, depth, cutting.feed_z);
            if let Some(left) = comp_left.filter(|_| use_comp) {
                builder
                    .commands
                    .push(CamCommandDto::CutterCompensationOn { left });
            }
            builder.linear(
                Point3Dto::new(leads.line_end.x, leads.line_end.y, depth),
                feed,
            );
            if let Some(arc) = &leads.start_arc {
                builder.circular(
                    Point3Dto::new(center_path[0].x, center_path[0].y, depth),
                    arc.center,
                    arc.clockwise,
                    feed,
                );
            }
            emit_profile_lap(builder, &center_path, *closed, depth, feed);
            // Spring pass: repeat the final profile lap once, same depth and
            // feed, while compensation is still active.
            if *spring_pass && profile_pass {
                emit_profile_lap(builder, &center_path, *closed, depth, feed);
            }
            if let Some(arc) = &leads.end_arc {
                builder.circular(
                    Point3Dto::new(arc.arc_end.x, arc.arc_end.y, depth),
                    arc.center,
                    arc.clockwise,
                    feed,
                );
            }
            if use_comp {
                builder.commands.push(CamCommandDto::CutterCompensationOff);
            }
            builder.linear(Point3Dto::new(leads.end.x, leads.end.y, depth), feed);
            builder.retract_to_clearance();
        }
    }
    Ok(())
}

/// One trip around (or along) the profile at a constant depth.
fn emit_profile_lap(
    builder: &mut ProgramBuilder,
    center_path: &[Point2Dto],
    closed: bool,
    depth: f64,
    feed: f64,
) {
    for point in center_path.iter().copied().skip(1) {
        builder.linear(Point3Dto::new(point.x, point.y, depth), feed);
    }
    // A closed contour returns to its start; an open chain ends where the
    // operator's geometry ends — never invent a closing cut across air
    // (it would slice the part if the chain straddles a wall).
    if closed {
        builder.linear(
            Point3Dto::new(center_path[0].x, center_path[0].y, depth),
            feed,
        );
    }
}

/// A 90 degree horizontal arc closing a lead onto (or off) the profile.
struct LeadArc {
    center: Point2Dto,
    clockwise: bool,
    /// Where the lead-OUT arc ends (the straight lead-out continues from
    /// here); unused on the lead-in, whose arc ends at the profile start.
    arc_end: Point2Dto,
}

/// Entry/exit geometry of one contour pass: the straight lead segment
/// (carrying the compensation activation/cancellation), optionally rounded
/// into a 90 degree tangential arc, and the endpoints.
struct ContourLeads {
    /// Plunge point: the far end of the straight lead-in.
    start: Point2Dto,
    /// Where the straight lead-in ends: the arc start, or the profile start
    /// when no arc is used.
    line_end: Point2Dto,
    start_arc: Option<LeadArc>,
    end_arc: Option<LeadArc>,
    /// Final lead-out point.
    end: Point2Dto,
}

/// Build the lead geometry for one contour pass. Tangent leads extend the
/// end segments straight — safe for outside compensation and open chains,
/// where the extension reaches into free air. A closed loop compensated
/// INSIDE (pocket and slot walls) cannot use them: the tangent runs along
/// the wall past the corner, so the entry plunge and the compensation-
/// activation move would cut through the material outside the ring.
/// Inside-closed leads instead leave the start corner along the interior
/// angle bisector, into the region a roughing pass has already cleared.
/// Everywhere else an optional 90 degree arc rounds the straight lead into
/// a tangential meet with the profile, so the tool arrives (and leaves) at
/// full offset without sliding along the wall line.
fn contour_leads(
    center_path: &[Point2Dto],
    closed: bool,
    inside_closed: bool,
    lead_in: f64,
    lead_out: f64,
    lead_arc_radius: Option<f64>,
    bend_left: bool,
) -> Result<ContourLeads, CamPlanError> {
    let first = center_path[0];
    let start_tangent = unit_direction(center_path[0], center_path[1])?;
    let last_index = center_path.len() - 1;
    let (end_anchor, end_tangent) = if closed {
        (
            first,
            unit_direction(center_path[last_index], first)?,
        )
    } else {
        (
            center_path[last_index],
            unit_direction(center_path[last_index - 1], center_path[last_index])?,
        )
    };
    if inside_closed {
        // Interior angle bisector at the start corner. The ring's interior
        // lies left of CCW travel, right of CW travel.
        let inward = if signed_area(center_path) > 0.0 { 1.0 } else { -1.0 };
        let inward_normal = |direction: Point2Dto| {
            Point2Dto::new(-direction.y * inward, direction.x * inward)
        };
        let normal_in = inward_normal(end_tangent);
        let normal_out = inward_normal(start_tangent);
        let raw = Point2Dto::new(normal_in.x + normal_out.x, normal_in.y + normal_out.y);
        let length = (raw.x * raw.x + raw.y * raw.y).sqrt();
        // Collinear adjacent edges (a straight "corner") leave no bisector;
        // the edge's inward normal is the safe direction then.
        let bisector = if length <= EPSILON {
            normal_out
        } else {
            Point2Dto::new(raw.x / length, raw.y / length)
        };
        return Ok(ContourLeads {
            start: Point2Dto::new(first.x + bisector.x * lead_in, first.y + bisector.y * lead_in),
            line_end: first,
            start_arc: None,
            end_arc: None,
            end: Point2Dto::new(first.x + bisector.x * lead_out, first.y + bisector.y * lead_out),
        });
    }
    let arc = lead_arc_radius.filter(|radius| radius.is_finite() && *radius > EPSILON);
    let normal = |tangent: Point2Dto| {
        // Unit normal on the side the arc bends toward.
        if bend_left {
            Point2Dto::new(-tangent.y, tangent.x)
        } else {
            Point2Dto::new(tangent.y, -tangent.x)
        }
    };
    let (start, line_end, start_arc) = match arc {
        Some(radius) => {
            // The arc meets the profile start tangentially; its center sits
            // one arc radius to the bend side, and the straight lead arrives
            // at the arc start perpendicular to the profile from that side.
            let n = normal(start_tangent);
            let center = Point2Dto::new(first.x + n.x * radius, first.y + n.y * radius);
            let v0 = Point2Dto::new(first.x - center.x, first.y - center.y);
            // One quarter turn backwards along the arc finds its start.
            let vs = if bend_left {
                Point2Dto::new(v0.y, -v0.x)
            } else {
                Point2Dto::new(-v0.y, v0.x)
            };
            let arc_start = Point2Dto::new(center.x + vs.x, center.y + vs.y);
            (
                Point2Dto::new(arc_start.x + n.x * lead_in, arc_start.y + n.y * lead_in),
                arc_start,
                Some(LeadArc {
                    center,
                    clockwise: !bend_left,
                    arc_end: first,
                }),
            )
        }
        None => (
            Point2Dto::new(first.x - start_tangent.x * lead_in, first.y - start_tangent.y * lead_in),
            first,
            None,
        ),
    };
    let (end, end_arc) = match arc {
        Some(radius) => {
            let n = normal(end_tangent);
            let center = Point2Dto::new(
                end_anchor.x + n.x * radius,
                end_anchor.y + n.y * radius,
            );
            let w0 = Point2Dto::new(end_anchor.x - center.x, end_anchor.y - center.y);
            // One quarter turn forwards along the arc finds its end.
            let w1 = if bend_left {
                Point2Dto::new(-w0.y, w0.x)
            } else {
                Point2Dto::new(w0.y, -w0.x)
            };
            let arc_end = Point2Dto::new(center.x + w1.x, center.y + w1.y);
            (
                Point2Dto::new(arc_end.x + n.x * lead_out, arc_end.y + n.y * lead_out),
                Some(LeadArc {
                    center,
                    clockwise: !bend_left,
                    arc_end,
                }),
            )
        }
        None => (
            Point2Dto::new(
                end_anchor.x + end_tangent.x * lead_out,
                end_anchor.y + end_tangent.y * lead_out,
            ),
            None,
        ),
    };
    Ok(ContourLeads {
        start,
        line_end,
        start_arc,
        end_arc,
        end,
    })
}

fn plan_drill(
    builder: &mut ProgramBuilder,
    operation: &CamOperationDto,
    tool: &CamToolDto,
) -> Result<(), CamPlanError> {
    let CamOperationDto::Drill {
        points,
        holes,
        top_z,
        bottom_z,
        retract_z,
        cycle,
        peck_depth,
        peck_retract,
        thread_pitch,
        feed_out,
        dwell_seconds,
        drill_tip_through,
        breakthrough_depth,
        cutting,
        name,
        ..
    } = operation
    else {
        unreachable!();
    };
    // Every target is (center, cut top, cut bottom): viewport-picked holes
    // bring their own face heights, manual centers use the operation planes.
    let mut targets: Vec<(Point2Dto, f64, f64)> = holes
        .iter()
        .map(|hole| (hole.point, hole.top_z, hole.bottom_z))
        .collect();
    targets.extend(points.iter().map(|point| (*point, *top_z, *bottom_z)));
    // Tip-through travels the point length plus the break-through allowance
    // past the bottom plane so the drill's full diameter clears the hole
    // bottom; the point length follows the stored point angle (118 degrees
    // when the tool does not record one).
    let tip_length = if *drill_tip_through {
        let half_angle = tool
            .point_angle_degrees
            .unwrap_or(118.0)
            .to_radians()
            * 0.5;
        (tool.diameter * 0.5) / half_angle.tan().max(1.0e-6) + *breakthrough_depth
    } else {
        0.0
    };
    let deepest_travel = targets
        .iter()
        .map(|(_, top, bottom)| top - bottom + tip_length)
        .fold(0.0_f64, f64::max);
    require_flute_length(tool, deepest_travel, name)?;
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
    let partial_retract = match cycle {
        // Default partial retract: 0.5 mm, never more than half the peck.
        DrillCycle::ChipBreaking => {
            Some(peck_retract.unwrap_or(0.5).min(peck.expect("pecking cycle") * 0.5))
        }
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
    for (point, hole_top, hole_bottom) in targets {
        // Peck levels descend from THIS hole's top; the cut bottom rides the
        // point past the bottom plane when tip-through is on.
        let cut_bottom = hole_bottom - tip_length;
        let depths = match peck {
            Some(peck) => depth_levels(hole_top, cut_bottom, peck)?,
            None => vec![cut_bottom],
        };
        ensure_program_budget(
            builder.commands.len(),
            depths.len().saturating_mul(3).saturating_add(5),
            name,
        )?;
        builder.retract_to_clearance();
        builder.rapid(Point3Dto::new(point.x, point.y, builder.clearance_z));
        builder.rapid(Point3Dto::new(point.x, point.y, *retract_z));
        // Rapids stop at the feed-engagement plane; from there every move
        // down runs at feed rate.
        let first_depth = depths.first().copied().unwrap_or(cut_bottom);
        builder.rapid(Point3Dto::new(
            point.x,
            point.y,
            builder.feed_plane(first_depth),
        ));
        match cycle {
            DrillCycle::Drill => {
                builder.linear(Point3Dto::new(point.x, point.y, cut_bottom), cutting.feed_z);
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
                        // Re-entry rapids down the cleared hole to just above
                        // the last peck bottom; feeding through the empty
                        // bore would burn cycle time for nothing.
                        let re_entry = (depth + 0.5).min(*retract_z);
                        builder.rapid(Point3Dto::new(point.x, point.y, re_entry));
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
                builder.linear(Point3Dto::new(point.x, point.y, cut_bottom), feed);
                builder.spindle(out_direction, cutting.spindle_rpm);
                builder.linear(Point3Dto::new(point.x, point.y, *retract_z), feed);
                // Restore the section's clockwise spindle so following
                // operations and modal tracking stay consistent.
                builder.spindle(SpindleDirection::Clockwise, cutting.spindle_rpm);
            }
            DrillCycle::Reaming | DrillCycle::Boring => {
                builder.linear(Point3Dto::new(point.x, point.y, cut_bottom), cutting.feed_z);
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
        direction,
        cutting,
        name,
        ..
    } = operation
    else {
        unreachable!();
    };
    require_flute_length(tool, top_z - bottom_z, name)?;
    let boundary = without_duplicate_closure(outline);
    let mut clearing = offset_polygon(&boundary, tool.diameter * 0.5, true)?;
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
    // Wall finish pass direction: a pocket wall is an inside profile, so
    // with a clockwise spindle climb milling runs clockwise around it. The
    // zigzag clearing itself always alternates. Re-winding keeps the start
    // point first; the scanline spans do not care about winding.
    let want_ccw = matches!(direction, MillingDirection::Conventional);
    if (signed_area(&clearing) > 0.0) != want_ccw {
        clearing = std::iter::once(clearing[0])
            .chain(clearing[1..].iter().rev().copied())
            .collect();
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
        direction,
        cutting,
        ..
    } = operation
    else {
        unreachable!();
    };
    let source = without_duplicate_closure(path);
    let material_inside = matches!(wall_side, ContourCompensation::Inside);
    let mut center_path = offset_polygon(&source, *tip_offset, !material_inside)?;
    // Climb/conventional along the profile: with a clockwise spindle climb
    // keeps the material wall on the right of travel — counter-clockwise
    // when the wall is the loop interior, clockwise when it is outside.
    let want_ccw = matches!(
        (direction, material_inside),
        (MillingDirection::Climb, true) | (MillingDirection::Conventional, false)
    );
    if (signed_area(&center_path) > 0.0) != want_ccw {
        center_path = std::iter::once(center_path[0])
            .chain(center_path[1..].iter().rev().copied())
            .collect();
    }
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

/// Mill an internal thread with a helical orbit: one pitch of Z travel per
/// revolution, split into semicircular arc records. Radial stock is removed
/// in orbital passes from the smallest radius out, so the finishing pass is
/// last. With a clockwise spindle, climb milling orbits clockwise; the thread
/// hand then fixes the Z sense of travel (a right-hand groove descends in the
/// clockwise direction, a left-hand groove ascends), so a conventional pass
/// starts at the bottom and climbs back out. The spiral overtravels half a
/// pitch past each end so the thread is fully formed at both faces.
fn plan_thread(
    builder: &mut ProgramBuilder,
    operation: &CamOperationDto,
    tool: &CamToolDto,
) -> Result<(), CamPlanError> {
    let CamOperationDto::Thread {
        points,
        holes,
        top_z,
        bottom_z,
        pitch,
        major_diameter,
        radial_passes,
        step_over,
        hand,
        direction,
        cutting,
        name,
        ..
    } = operation
    else {
        unreachable!();
    };
    // Every target is (center, cut top, cut bottom): viewport-picked holes
    // bring their own face heights, manual centers use the operation planes.
    let mut targets: Vec<(Point2Dto, f64, f64)> = holes
        .iter()
        .map(|hole| (hole.point, hole.top_z, hole.bottom_z))
        .collect();
    targets.extend(points.iter().map(|point| (*point, *top_z, *bottom_z)));
    let deepest_travel = targets
        .iter()
        .map(|(_, top, bottom)| top - bottom + pitch)
        .fold(0.0_f64, f64::max);
    require_flute_length(tool, deepest_travel, name)?;
    let orbit = (major_diameter - tool.diameter) * 0.5;
    if orbit <= EPSILON {
        return Err(CamPlanError(format!(
            "thread operation '{name}' has no orbit radius; the tool must be smaller than the major diameter"
        )));
    }
    let step = if *radial_passes > 1 {
        Some(step_over.ok_or_else(|| {
            CamPlanError(format!(
                "thread operation '{name}' with multiple radial passes needs a stepover"
            ))
        })?)
    } else {
        None
    };
    // Smallest orbit first, the finishing pass at the full orbit last.
    let radii = (0..*radial_passes)
        .map(|index| orbit - f64::from(*radial_passes - 1 - index) * step.unwrap_or(0.0))
        .collect::<Vec<_>>();
    let clockwise = matches!(direction, MillingDirection::Climb);
    let descending = matches!(
        (clockwise, hand),
        (true, ThreadHand::Right) | (false, ThreadHand::Left)
    );
    ensure_program_budget(
        builder.commands.len(),
        targets
            .len()
            .saturating_mul(radii.len())
            .saturating_mul(4),
        name,
    )?;
    for (point, hole_top, hole_bottom) in targets {
        let (z_start, z_end) = if descending {
            (hole_top + pitch * 0.5, hole_bottom - pitch * 0.5)
        } else {
            (hole_bottom - pitch * 0.5, hole_top + pitch * 0.5)
        };
        let revolutions = (z_end - z_start).abs() / pitch;
        let arcs_per_pass = (revolutions * 2.0).ceil() as usize + 2;
        ensure_program_budget(
            builder.commands.len(),
            radii.len().saturating_mul(arcs_per_pass.saturating_add(3)),
            name,
        )?;
        let center = Point2Dto {
            x: point.x,
            y: point.y,
        };
        builder.retract_to_clearance();
        builder.rapid(Point3Dto::new(point.x, point.y, builder.clearance_z));
        builder.rapid(Point3Dto::new(point.x, point.y, builder.retract_z));
        for radius in radii.iter().copied() {
            // Rapids stop at the feed-engagement plane (or the spiral start
            // when that sits higher); the plunge itself runs at hole center,
            // inside the pre-machined hole's clear bore.
            let entry_z = builder.feed_plane(z_start);
            builder.rapid(Point3Dto::new(point.x, point.y, entry_z));
            builder.linear(Point3Dto::new(point.x, point.y, z_start), cutting.feed_z);
            // Straight lead-out to the orbit radius at the spiral's start
            // angle; helical lead arcs remain on the roadmap.
            builder.linear(
                Point3Dto::new(point.x + radius, point.y, z_start),
                cutting.feed_xy,
            );
            let total_angle = revolutions * std::f64::consts::TAU;
            let mut covered = 0.0;
            let mut angle = 0.0;
            while covered < total_angle - EPSILON {
                let step_angle = (total_angle - covered).min(std::f64::consts::PI);
                let next_angle = if clockwise {
                    angle - step_angle
                } else {
                    angle + step_angle
                };
                let next_z = z_start + (z_end - z_start) * ((covered + step_angle) / total_angle);
                builder.circular(
                    Point3Dto::new(
                        point.x + radius * next_angle.cos(),
                        point.y + radius * next_angle.sin(),
                        next_z,
                    ),
                    center,
                    clockwise,
                    cutting.feed_xy,
                );
                angle = next_angle;
                covered += step_angle;
            }
            // Lead back to the hole center at the exit Z, then clear the hole
            // for the next pass or the next center.
            builder.linear(Point3Dto::new(point.x, point.y, z_end), cutting.feed_xy);
            builder.rapid(Point3Dto::new(point.x, point.y, builder.retract_z));
        }
    }
    builder.retract_to_clearance();
    Ok(())
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

/// Mitered offset of an OPEN polyline to one side of its travel direction.
/// `left` picks the left-hand normal (travel-direction +90 degrees); the
/// endpoints shift along their single segment's normal, interior vertices
/// miter exactly like the closed-polygon case. Unlike `offset_polygon` there
/// is no interior to collapse, so the only failure is a degenerate miter.
/// Also used by the simulator to reproduce the machine's compensated path
/// for in-control contour sections.
pub(crate) fn offset_polyline_open(
    points: &[Point2Dto],
    radius: f64,
    left: bool,
) -> Result<Vec<Point2Dto>, CamPlanError> {
    if points.len() < 2 {
        return Err(CamPlanError(
            "open contour chains need at least two points".to_string(),
        ));
    }
    let side = if left { 1.0 } else { -1.0 };
    let offset = radius * side;
    let segment_direction = |index: usize| unit_direction(points[index], points[index + 1]);
    let shifted = |point: Point2Dto, direction: Point2Dto| {
        Point2Dto::new(point.x - direction.y * offset, point.y + direction.x * offset)
    };
    let mut result = Vec::with_capacity(points.len());
    // Start endpoint: the first segment's normal only.
    result.push(shifted(points[0], segment_direction(0)?));
    for index in 1..points.len() - 1 {
        let current = points[index];
        let first_direction = segment_direction(index - 1)?;
        let second_direction = segment_direction(index)?;
        let first_line = shifted(current, first_direction);
        let second_line = shifted(current, second_direction);
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
    // End endpoint: the last segment's normal only.
    result.push(shifted(points[points.len() - 1], segment_direction(points.len() - 2)?));
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
        CamHoleDto, CamResolvedStockDto, CamSetupDto, CamStockSpecDto, CamToolKind,
        CuttingParametersDto, Rect2Dto, StockBoxDto, WcsOriginSpecDto, WorkCoordinateSystemDto,
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
            corner_radius: None,
            cutting: CuttingParametersDto::default(),
            cutting_presets: vec![],
            default_step_down: None,
            default_step_over: None,
        }
    }

    fn document(operations: Vec<CamOperationDto>, tools: Vec<CamToolDto>) -> CamDocumentDto {
        CamDocumentDto {
            load_warnings: Vec::new(),
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
    fn facing_is_zigzagged_at_each_depth_and_never_rapids_below_the_feed_plane() {
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
            safe_distance: 5.0,
            direction: FaceDirection::BothWays,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
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
        // Rapids travel at clearance/retract and may reach down to the feed
        // plane (1.0), never into cutting depth.
        assert!(program.commands.iter().all(|command| match command {
            CamCommandDto::Rapid { to } => to.z >= 1.0,
            _ => true,
        }));
        assert_eq!(program.stats.operation_count, 1);
        assert!(program.stats.cutting_distance > 0.0);
    }

    #[test]
    fn face_makes_a_single_pass_when_one_band_spans_the_face() {
        // 63 mm face mill, 19 mm wide strip, 31 mm stepover: the first row's
        // cutter band already covers the far edge, so there is exactly one
        // working stroke — no redundant return pass.
        let operation = CamOperationDto::Face {
            id: 1,
            name: "Face".into(),
            enabled: true,
            tool_id: 1,
            bounds: Rect2Dto {
                min: Point2Dto::new(0.0, 0.0),
                max: Point2Dto::new(40.0, 19.0),
            },
            top_z: 0.0,
            target_z: -1.0,
            step_over: 31.0,
            step_down: 1.0,
            safe_distance: 5.0,
            direction: FaceDirection::BothWays,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
            cutting: cutting(),
        };
        let program = plan_setup(
            &document(vec![operation], vec![tool(1, CamToolKind::FaceMill, 63.0)]),
            1,
        )
        .unwrap();
        let cuts: Vec<Point3Dto> = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { to, .. } if to.z < 0.0 => Some(*to),
                _ => None,
            })
            .collect();
        // The plunge plus exactly one stroke across X, both on the single
        // row — centered on the 19 mm face (y = 9.5), not hugging an edge.
        assert_eq!(cuts.len(), 2);
        assert!(cuts.iter().all(|point| (point.y - 9.5).abs() < 1.0e-9));
    }

    #[test]
    fn face_entry_moves_outward_with_safe_distance() {
        // The entry plunge must sit one cutter radius plus the safe distance
        // clear of the stock's min-X edge, so the value is directly visible
        // in the first cutting move's X.
        let plan_with = |safe_distance: f64| {
            let operation = CamOperationDto::Face {
                id: 1,
                name: "Face".into(),
                enabled: true,
                tool_id: 1,
                bounds: Rect2Dto {
                    min: Point2Dto::new(0.0, 0.0),
                    max: Point2Dto::new(40.0, 19.0),
                },
                top_z: 0.0,
                target_z: -1.0,
                step_over: 31.0,
                step_down: 1.0,
                safe_distance,
                direction: FaceDirection::BothWays,
                clearance_z: 10.0,
                retract_z: 3.0,
                feed_height_z: 1.0,
                cutting: cutting(),
            };
            plan_setup(
                &document(vec![operation], vec![tool(1, CamToolKind::FaceMill, 63.0)]),
                1,
            )
            .unwrap()
        };
        let first_cut_x = |program: &CamProgramDto| {
            program
                .commands
                .iter()
                .find_map(|command| match command {
                    CamCommandDto::Linear { to, .. } if to.z < 0.0 => Some(to.x),
                    _ => None,
                })
                .unwrap()
        };
        let radius = 63.0 * 0.5;
        assert!((first_cut_x(&plan_with(5.0)) - (-radius - 5.0)).abs() < 1.0e-9);
        assert!((first_cut_x(&plan_with(20.0)) - (-radius - 20.0)).abs() < 1.0e-9);
    }

    #[test]
    fn face_centers_a_single_row_when_one_band_spans_the_strip() {
        // 30 mm wide strip, 28 mm stepover, 32 mm tool: one centered band
        // (y = 15) already reaches both edges, so no second row is forced.
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
            target_z: -1.0,
            step_over: 28.0,
            step_down: 1.0,
            safe_distance: 5.0,
            direction: FaceDirection::BothWays,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
            cutting: cutting(),
        };
        let program = plan_setup(
            &document(vec![operation], vec![tool(1, CamToolKind::FlatEndMill, 32.0)]),
            1,
        )
        .unwrap();
        let row_ys: Vec<f64> = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { to, .. } if to.z < 0.0 => Some(to.y),
                _ => None,
            })
            .collect();
        assert_eq!(row_ys, vec![15.0, 15.0]);
    }

    #[test]
    fn face_centers_multi_row_layouts_on_the_face() {
        // 30 mm face (the test stock's full depth), 10 mm tool, 8 mm
        // stepover: four centered rows at 3 / 11 / 19 / 27 — the outer bands
        // reach past both edges (3-5 < 0, 27+5 > 30) with even overlap and
        // no edge hugging.
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
            target_z: -1.0,
            step_over: 8.0,
            step_down: 1.0,
            safe_distance: 5.0,
            direction: FaceDirection::BothWays,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
            cutting: cutting(),
        };
        let program = plan_setup(
            &document(vec![operation], vec![tool(1, CamToolKind::FlatEndMill, 10.0)]),
            1,
        )
        .unwrap();
        let row_ys: Vec<f64> = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { to, .. } if to.z < 0.0 => Some(to.y),
                _ => None,
            })
            .collect();
        assert_eq!(row_ys, vec![3.0, 3.0, 11.0, 11.0, 19.0, 19.0, 27.0, 27.0]);
    }

    #[test]
    fn face_accepts_a_non_center_cutting_face_mill() {
        // Indexable face mills rarely cut to the center; facing still works
        // because the plunge point sits outside the stock boundary.
        let operation = CamOperationDto::Face {
            id: 1,
            name: "Face".into(),
            enabled: true,
            tool_id: 1,
            bounds: Rect2Dto {
                min: Point2Dto::new(0.0, 0.0),
                max: Point2Dto::new(40.0, 19.0),
            },
            top_z: 0.0,
            target_z: -1.0,
            step_over: 31.0,
            step_down: 1.0,
            safe_distance: 5.0,
            direction: FaceDirection::BothWays,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
            cutting: cutting(),
        };
        let mut shell_mill = tool(1, CamToolKind::FaceMill, 63.0);
        shell_mill.center_cutting = false;
        let program = plan_setup(&document(vec![operation], vec![shell_mill]), 1).unwrap();
        // The plunge target is the last linear move onto depth before the
        // first working stroke: fully clear of the stock's min-X edge.
        let plunge = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { to, .. } if to.z < 0.0 => Some(*to),
                _ => None,
            })
            .next()
            .expect("a facing plunge");
        let radius = 63.0 * 0.5;
        assert!(
            plunge.x + radius < 0.0,
            "plunge at x={} must keep the cutter clear of the stock edge",
            plunge.x
        );
    }

    #[test]
    fn face_kind_gate_admits_flat_bottom_mills_only() {
        let make_op = || CamOperationDto::Face {
            id: 1,
            name: "Face".into(),
            enabled: true,
            tool_id: 1,
            bounds: Rect2Dto {
                min: Point2Dto::new(0.0, 0.0),
                max: Point2Dto::new(40.0, 19.0),
            },
            top_z: 0.0,
            target_z: -1.0,
            step_over: 12.0,
            step_down: 1.0,
            safe_distance: 5.0,
            direction: FaceDirection::BothWays,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
            cutting: cutting(),
        };
        // Flat-bottom mills face even without center-cutting inserts.
        for kind in [
            CamToolKind::FlatEndMill,
            CamToolKind::BullNoseEndMill,
            CamToolKind::FaceMill,
        ] {
            let mut milling = tool(1, kind, 16.0);
            milling.center_cutting = false;
            if kind == CamToolKind::BullNoseEndMill {
                milling.corner_radius = Some(3.0);
            }
            plan_setup(&document(vec![make_op()], vec![milling]), 1)
                .unwrap_or_else(|err| panic!("{kind:?} should face: {err}"));
        }
        // Everything else is out: scallops, angled edges, non-slotting tooth
        // profiles, hole-making tools, and turning tools cannot face.
        for kind in [
            CamToolKind::BallEndMill,
            CamToolKind::ChamferMill,
            CamToolKind::ThreadMill,
            CamToolKind::Drill,
            CamToolKind::Tap,
            CamToolKind::Reamer,
            CamToolKind::BoringBar,
            CamToolKind::TurningGeneral,
        ] {
            let milling = tool(1, kind, 16.0);
            let err = plan_setup(&document(vec![make_op()], vec![milling]), 1)
                .expect_err(&format!("{kind:?} must not face"));
            assert!(
                err.to_string().contains("flat, bull-nose, or face mill"),
                "{kind:?} should hit the kind gate: {err}"
            );
        }
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
            holes: Vec::new(),
            top_z: 0.0,
            bottom_z: -7.0,
            retract_z: 3.0,
            drill_tip_through: false,
            breakthrough_depth: 0.0,
            peck_depth: Some(3.0),
            dwell_seconds: 0.1,
            clearance_z: 10.0,
            feed_height_z: 1.0,
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
            closed: true,
            top_z: 0.0,
            bottom_z: -15.0,
            step_down: 2.0,
            compensation: ContourCompensation::Outside,
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
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
            cutting: cutting(),
        };
        let mut short_tool = tool(1, CamToolKind::FlatEndMill, 6.0);
        short_tool.flute_length = 10.0;
        let error = plan_setup(&document(vec![operation], vec![short_tool]), 1).unwrap_err();
        assert!(error.0.contains("flute length"));
    }

    fn open_chain_operation(compensation: ContourCompensation) -> CamOperationDto {
        CamOperationDto::Contour2d {
            id: 1,
            name: "Open wall".into(),
            enabled: true,
            tool_id: 1,
            // An open L: +X leg, then +Y leg.
            path: vec![
                Point2Dto::new(5.0, 5.0),
                Point2Dto::new(30.0, 5.0),
                Point2Dto::new(30.0, 20.0),
            ],
            closed: false,
            top_z: 0.0,
            bottom_z: -2.0,
            step_down: 2.0,
            compensation,
            compensation_mode: CompensationMode::InSoftware,
            lead_in: 5.0,
            lead_out: 5.0,
            lead_arc_radius: None,
            // Pin the direction that keeps the authored travel for each side:
            // climb wants the tool right of travel, conventional left —
            // picking per side means no reversal, so these assertions measure
            // pure offset geometry.
            direction: if matches!(compensation, ContourCompensation::Left) {
                MillingDirection::Conventional
            } else {
                MillingDirection::Climb
            },
            roughing_passes: 1,
            roughing_step_over: None,
            finishing_pass: false,
            finish_allowance: 0.0,
            finish_feed: None,
            spring_pass: false,
            chain_ref: None,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
            cutting: cutting(),
        }
    }

    fn cutting_targets(program: &CamProgramDto) -> Vec<Point3Dto> {
        program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { to, .. } => Some(*to),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn open_contour_chain_never_closes() {
        let program = plan_setup(
            &document(
                vec![open_chain_operation(ContourCompensation::On)],
                vec![tool(1, CamToolKind::FlatEndMill, 6.0)],
            ),
            1,
        )
        .expect("plan");
        let targets = cutting_targets(&program);
        let near = |point: Point3Dto, x: f64, y: f64| {
            (point.x - x).abs() < 1.0e-9 && (point.y - y).abs() < 1.0e-9
        };
        // One depth level: exactly one visit to the chain start (the lead-in
        // reaches it). A closed contour would cut back to it a second time.
        assert_eq!(
            targets.iter().filter(|point| near(**point, 5.0, 5.0)).count(),
            1
        );
        // The chain ends at its own last point and leaves on the tangential
        // lead-out — never back at the start.
        let last = targets.last().expect("cutting moves");
        assert!(near(*last, 30.0, 25.0));
        assert!(near(targets[targets.len() - 2], 30.0, 20.0));
    }

    #[test]
    fn open_contour_chain_offsets_left_and_right_of_travel() {
        // r = 3. Travel +X then +Y: left of +X is +Y, left of +Y is -X.
        let left = plan_setup(
            &document(
                vec![open_chain_operation(ContourCompensation::Left)],
                vec![tool(1, CamToolKind::FlatEndMill, 6.0)],
            ),
            1,
        )
        .expect("left plan");
        let targets = cutting_targets(&left);
        let bottom = targets
            .iter()
            .filter(|point| (point.z + 2.0).abs() < 1.0e-9)
            .copied()
            .collect::<Vec<_>>();
        // Offset path: (5,8) -> (27,8) -> (27,20), wrapped by the tangential
        // leads: the plunge lands on the lead start (0,8), the lead-in ends
        // on the offset start, and the lead-out extends past (27,20) to
        // (27,25).
        assert!((bottom[0].x - 0.0).abs() < 1.0e-9 && (bottom[0].y - 8.0).abs() < 1.0e-9);
        assert!((bottom[1].x - 5.0).abs() < 1.0e-9 && (bottom[1].y - 8.0).abs() < 1.0e-9);
        let last = bottom.last().expect("offset moves");
        assert!((last.x - 27.0).abs() < 1.0e-9 && (last.y - 25.0).abs() < 1.0e-9);
        let chain_end = bottom[bottom.len() - 2];
        assert!((chain_end.x - 27.0).abs() < 1.0e-9 && (chain_end.y - 20.0).abs() < 1.0e-9);

        let right = plan_setup(
            &document(
                vec![open_chain_operation(ContourCompensation::Right)],
                vec![tool(1, CamToolKind::FlatEndMill, 6.0)],
            ),
            1,
        )
        .expect("right plan");
        let bottom_right = cutting_targets(&right)
            .into_iter()
            .filter(|point| (point.z + 2.0).abs() < 1.0e-9)
            .collect::<Vec<_>>();
        assert!((bottom_right[1].x - 5.0).abs() < 1.0e-9 && (bottom_right[1].y - 2.0).abs() < 1.0e-9);
        let chain_end_right = bottom_right[bottom_right.len() - 2];
        assert!((chain_end_right.x - 33.0).abs() < 1.0e-9 && (chain_end_right.y - 20.0).abs() < 1.0e-9);
    }

    #[test]
    fn open_chain_with_inside_compensation_fails_closed() {
        let error = plan_setup(
            &document(
                vec![open_chain_operation(ContourCompensation::Inside)],
                vec![tool(1, CamToolKind::FlatEndMill, 6.0)],
            ),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("no interior"));
    }

    fn closed_boss_operation(
        mode: CompensationMode,
        compensation: ContourCompensation,
    ) -> CamOperationDto {
        CamOperationDto::Contour2d {
            id: 1,
            name: "Boss wall".into(),
            enabled: true,
            tool_id: 1,
            // A CCW 10 x 10 square.
            path: vec![
                Point2Dto::new(5.0, 5.0),
                Point2Dto::new(15.0, 5.0),
                Point2Dto::new(15.0, 15.0),
                Point2Dto::new(5.0, 15.0),
            ],
            closed: true,
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
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
            cutting: cutting(),
        }
    }

    #[test]
    fn in_control_compensation_keeps_the_part_contour_in_the_program() {
        let program = plan_setup(
            &document(
                vec![closed_boss_operation(
                    CompensationMode::InControl,
                    ContourCompensation::Outside,
                )],
                vec![tool(1, CamToolKind::FlatEndMill, 6.0)],
            ),
            1,
        )
        .expect("plan");
        // CCW travel keeps the interior left, so an outside offset is right
        // of travel: exactly one activation and one cancellation, each
        // immediately before its linear lead move.
        let on_index = program
            .commands
            .iter()
            .position(|command| matches!(command, CamCommandDto::CutterCompensationOn { .. }))
            .expect("activation");
        let off_index = program
            .commands
            .iter()
            .position(|command| matches!(command, CamCommandDto::CutterCompensationOff))
            .expect("cancellation");
        assert!(matches!(
            program.commands[on_index],
            CamCommandDto::CutterCompensationOn { left: false }
        ));
        assert!(matches!(
            program.commands[on_index + 1],
            CamCommandDto::Linear { .. }
        ));
        assert!(matches!(
            program.commands[off_index + 1],
            CamCommandDto::Linear { .. }
        ));
        // The programmed path is the part contour itself — no radius offset —
        // wrapped by the tangential leads: plunge at the lead start (0,5),
        // exit along the closing segment to (5,0).
        let targets = cutting_targets(&program);
        let near = |point: Point3Dto, x: f64, y: f64| {
            (point.x - x).abs() < 1.0e-9 && (point.y - y).abs() < 1.0e-9
        };
        assert!(near(targets[0], 0.0, 5.0));
        assert!(targets.iter().any(|point| near(*point, 15.0, 5.0)));
        assert!(targets.iter().any(|point| near(*point, 15.0, 15.0)));
        assert!(!targets.iter().any(|point| near(*point, 18.0, 2.0)));
        assert!(near(*targets.last().expect("cutting moves"), 5.0, 0.0));
    }

    #[test]
    fn in_software_compensation_offsets_the_path_and_emits_no_compensation_words() {
        let program = plan_setup(
            &document(
                vec![closed_boss_operation(
                    CompensationMode::InSoftware,
                    ContourCompensation::Outside,
                )],
                vec![tool(1, CamToolKind::FlatEndMill, 6.0)],
            ),
            1,
        )
        .expect("plan");
        assert!(program.commands.iter().all(|command| {
            !matches!(
                command,
                CamCommandDto::CutterCompensationOn { .. } | CamCommandDto::CutterCompensationOff
            )
        }));
        // r = 3 outward: the mitered offset square runs (2,2) -> (18,2) ->
        // (18,18) -> (2,18).
        let targets = cutting_targets(&program);
        let near = |point: Point3Dto, x: f64, y: f64| {
            (point.x - x).abs() < 1.0e-9 && (point.y - y).abs() < 1.0e-9
        };
        assert!(targets.iter().any(|point| near(*point, 18.0, 2.0)));
        assert!(targets.iter().any(|point| near(*point, 18.0, 18.0)));
    }

    #[test]
    fn in_control_compensation_allows_leads_shorter_than_the_tool_radius() {
        // Leads carry no tool-diameter rule: a short lead with in-control
        // compensation is the operator's call (the control owns its own
        // activation minimum), so planning must still succeed with the
        // compensation move riding the short lead.
        let mut operation = closed_boss_operation(
            CompensationMode::InControl,
            ContourCompensation::Outside,
        );
        if let CamOperationDto::Contour2d { lead_in, .. } = &mut operation {
            *lead_in = 2.0;
        }
        let program = plan_setup(
            &document(vec![operation], vec![tool(1, CamToolKind::FlatEndMill, 6.0)]),
            1,
        )
        .unwrap();
        assert!(program
            .commands
            .iter()
            .any(|command| matches!(command, CamCommandDto::CutterCompensationOn { .. })));
    }

    #[test]
    fn contour_requires_positive_leads() {
        let mut operation = closed_boss_operation(
            CompensationMode::InSoftware,
            ContourCompensation::On,
        );
        if let CamOperationDto::Contour2d { lead_out, .. } = &mut operation {
            *lead_out = 0.0;
        }
        let error = plan_setup(
            &document(vec![operation], vec![tool(1, CamToolKind::FlatEndMill, 6.0)]),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("positive lead-in and lead-out"));
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
            holes: Vec::new(),
            top_z: -5.0,
            bottom_z: -10.0,
            retract_z: -6.0,
            drill_tip_through: false,
            breakthrough_depth: 0.0,
            peck_depth: Some(2.0),
            dwell_seconds: 0.0,
            clearance_z: 10.0,
            feed_height_z: -5.0,
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
            drill_tip_through: false,
            breakthrough_depth: 0.0,
            points: vec![Point2Dto::new(20.0, 15.0)],
            holes: Vec::new(),
            top_z: 0.0,
            bottom_z: -7.0,
            retract_z: 3.0,
            clearance_z: 10.0,
            feed_height_z: 1.0,
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

    fn picked_hole(x: f64, y: f64, top: f64, bottom: f64) -> CamHoleDto {
        CamHoleDto {
            point: Point2Dto::new(x, y),
            top_z: top,
            bottom_z: bottom,
            axis: [0.0, 0.0, -1.0],
            face_key: Some("hole-face".into()),
        }
    }

    /// Z targets of every feed-rate descent, in program order.
    fn drill_cut_depths(program: &CamProgramDto, feed_z: f64) -> Vec<f64> {
        program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { to, feed } if (*feed - feed_z).abs() < 1.0e-9 => {
                    Some(to.z)
                }
                _ => None,
            })
            .collect()
    }

    #[test]
    fn picked_holes_peck_from_their_own_top_and_bottom_planes() {
        let mut operation = drill_operation(DrillCycle::ChipBreaking);
        let CamOperationDto::Drill {
            points,
            holes,
            peck_depth,
            ..
        } = &mut operation
        else {
            unreachable!();
        };
        points.clear();
        holes.push(picked_hole(10.0, 10.0, 0.0, -5.0));
        holes.push(picked_hole(30.0, 20.0, -2.0, -9.0));
        *peck_depth = Some(4.0);
        let program = plan_setup(
            &document(vec![operation], vec![tool(2, CamToolKind::Drill, 5.0)]),
            1,
        )
        .unwrap();
        // Peck levels descend from each hole's own top: 0 -> -4, -5 then
        // -2 -> -6, -9. Operation-plane heights never enter the picture.
        assert_eq!(drill_cut_depths(&program, 120.0), [-4.0, -5.0, -6.0, -9.0]);
    }

    #[test]
    fn tip_through_drives_the_point_below_the_hole_bottom() {
        let mut operation = drill_operation(DrillCycle::Drill);
        let CamOperationDto::Drill {
            points,
            holes,
            drill_tip_through,
            breakthrough_depth,
            ..
        } = &mut operation
        else {
            unreachable!();
        };
        points.clear();
        holes.push(picked_hole(20.0, 15.0, 0.0, -7.0));
        *drill_tip_through = true;
        *breakthrough_depth = 1.0;
        // 10 mm drill, conventional 118-degree point: tip 5 / tan(59 deg).
        let program = plan_setup(
            &document(vec![operation.clone()], vec![tool(2, CamToolKind::Drill, 10.0)]),
            1,
        )
        .unwrap();
        let expected = -7.0 - 5.0 / 59.0_f64.to_radians().tan() - 1.0;
        let depths = drill_cut_depths(&program, 120.0);
        assert_eq!(depths.len(), 1);
        assert!(
            (depths[0] - expected).abs() < 1.0e-9,
            "cut bottom {} should be {expected}",
            depths[0]
        );
        // A stored 90-degree point lengthens the tip exactly.
        let mut flat = tool(2, CamToolKind::Drill, 10.0);
        flat.point_angle_degrees = Some(90.0);
        let program = plan_setup(&document(vec![operation], vec![flat]), 1).unwrap();
        let depths = drill_cut_depths(&program, 120.0);
        assert_eq!(depths.len(), 1);
        assert!(
            (depths[0] - -13.0).abs() < 1.0e-9,
            "cut bottom {} should be -13",
            depths[0]
        );
    }

    #[test]
    fn drill_without_any_target_is_rejected() {
        let mut operation = drill_operation(DrillCycle::Drill);
        let CamOperationDto::Drill { points, holes, .. } = &mut operation else {
            unreachable!();
        };
        points.clear();
        holes.clear();
        let error = plan_setup(
            &document(vec![operation], vec![tool(2, CamToolKind::Drill, 5.0)]),
            1,
        )
        .unwrap_err();
        assert!(
            error.to_string().contains("needs 1..="),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn tip_through_is_rejected_outside_the_drilling_cycle_family() {
        let mut operation = drill_operation(DrillCycle::TappingRight);
        let CamOperationDto::Drill {
            drill_tip_through,
            thread_pitch,
            ..
        } = &mut operation
        else {
            unreachable!();
        };
        *drill_tip_through = true;
        *thread_pitch = Some(1.0);
        let error = plan_setup(
            &document(vec![operation], vec![tool(2, CamToolKind::Tap, 5.0)]),
            1,
        )
        .unwrap_err();
        assert!(
            error.to_string().contains("tip-through applies to the drilling cycle family"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn negative_breakthrough_depth_is_rejected() {
        let mut operation = drill_operation(DrillCycle::Drill);
        let CamOperationDto::Drill {
            breakthrough_depth, ..
        } = &mut operation
        else {
            unreachable!();
        };
        *breakthrough_depth = -0.5;
        let error = plan_setup(
            &document(vec![operation], vec![tool(2, CamToolKind::Drill, 5.0)]),
            1,
        )
        .unwrap_err();
        assert!(
            error.to_string().contains("break-through depth must be zero or positive"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn picked_hole_with_tilted_axis_is_rejected() {
        let mut operation = drill_operation(DrillCycle::Drill);
        let CamOperationDto::Drill { points, holes, .. } = &mut operation else {
            unreachable!();
        };
        points.clear();
        let mut hole = picked_hole(20.0, 15.0, 0.0, -7.0);
        hole.axis = [0.0, 0.5, -0.866];
        holes.push(hole);
        let error = plan_setup(
            &document(vec![operation], vec![tool(2, CamToolKind::Drill, 5.0)]),
            1,
        )
        .unwrap_err();
        assert!(
            error.to_string().contains("parallel to setup Z"),
            "unexpected error: {error}"
        );
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
        // Approach planes (clearance, retract, feed plane), then partial
        // retracts that stay inside the hole (peck + 0.8 mm) each followed
        // by a re-entry rapid to just above the peck bottom, then the
        // retract plane and final clearance.
        let expected = [10.0, 3.0, 1.0, -2.2, -2.5, -5.2, -5.5, 3.0, 10.0];
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
            safe_distance: 5.0,
            direction: FaceDirection::BothWays,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
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
            safe_distance: 5.0,
            direction: FaceDirection::BothWays,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
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
            direction: MillingDirection::Climb,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
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
        // Rapids stop at the feed plane (1.0), never below it.
        assert!(program.commands.iter().all(|command| match command {
            CamCommandDto::Rapid { to } => to.z >= 1.0,
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
            direction: MillingDirection::Climb,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
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
            direction: MillingDirection::Climb,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
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
            direction: MillingDirection::Climb,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
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

    fn thread_operation(hand: ThreadHand, direction: MillingDirection) -> CamOperationDto {
        CamOperationDto::Thread {
            id: 3,
            name: "Thread".into(),
            enabled: true,
            tool_id: 7,
            points: vec![Point2Dto::new(20.0, 15.0)],
            holes: Vec::new(),
            top_z: 0.0,
            bottom_z: -8.0,
            pitch: 1.0,
            major_diameter: 6.0,
            minor_diameter: 5.035,
            hand,
            direction,
            radial_passes: 1,
            step_over: None,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
            cutting: cutting(),
        }
    }

    fn thread_program(operation: CamOperationDto, tool: CamToolDto) -> CamProgramDto {
        plan_setup(&document(vec![operation], vec![tool]), 1).unwrap()
    }

    #[test]
    fn picked_holes_thread_from_their_own_top_and_bottom_planes() {
        let mut operation = thread_operation(ThreadHand::Right, MillingDirection::Climb);
        let CamOperationDto::Thread { points, holes, .. } = &mut operation else {
            unreachable!();
        };
        points.clear();
        holes.push(picked_hole(10.0, 10.0, 0.0, -6.0));
        holes.push(picked_hole(30.0, 20.0, -1.0, -8.0));
        let program = thread_program(operation, tool(7, CamToolKind::ThreadMill, 4.8));
        // Descending right-hand/climb spirals start half a pitch above each
        // hole's own top: 0.5 and -0.5. Plunges run at feed_z.
        let plunge_zs: Vec<f64> = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { to, feed } if (*feed - 200.0).abs() < 1.0e-9 => {
                    Some(to.z)
                }
                _ => None,
            })
            .collect();
        assert_eq!(plunge_zs, [0.5, -0.5]);
        // Each spiral bottoms out half a pitch below its own hole bottom.
        let arcs = circular_moves(&program);
        let deepest = |center_x: f64| {
            arcs.iter()
                .filter(|(_, command, _)| match command {
                    CamCommandDto::Circular { center, .. } => {
                        (center.x - center_x).abs() < 1.0e-9
                    }
                    _ => false,
                })
                .map(|(_, command, _)| match command {
                    CamCommandDto::Circular { to, .. } => to.z,
                    _ => unreachable!(),
                })
                .fold(f64::INFINITY, f64::min)
        };
        assert!((deepest(10.0) - -6.5).abs() < 1.0e-9);
        assert!((deepest(30.0) - -8.5).abs() < 1.0e-9);
    }

    /// Circular commands with their start points and sweep angles, walking the
    /// program's motion so each arc can be measured.
    fn circular_moves(program: &CamProgramDto) -> Vec<(Point3Dto, CamCommandDto, f64)> {
        let mut position = Point3Dto::new(0.0, 0.0, 0.0);
        let mut moves = Vec::new();
        for command in &program.commands {
            match command {
                CamCommandDto::Rapid { to } | CamCommandDto::Linear { to, .. } => position = *to,
                CamCommandDto::Circular {
                    to,
                    center,
                    clockwise,
                    ..
                } => {
                    let start = (position.y - center.y).atan2(position.x - center.x);
                    let end = (to.y - center.y).atan2(to.x - center.x);
                    let mut sweep = end - start;
                    if *clockwise {
                        while sweep >= 0.0 {
                            sweep -= std::f64::consts::TAU;
                        }
                    } else {
                        while sweep <= 0.0 {
                            sweep += std::f64::consts::TAU;
                        }
                    }
                    moves.push((position, command.clone(), sweep));
                    position = *to;
                }
                _ => {}
            }
        }
        moves
    }

    #[test]
    fn right_hand_climb_thread_orbits_clockwise_and_descends() {
        let program = thread_program(
            thread_operation(ThreadHand::Right, MillingDirection::Climb),
            tool(7, CamToolKind::ThreadMill, 4.8),
        );
        let arcs = circular_moves(&program);
        assert!(arcs.len() >= 18, "9 revolutions split into semicircles");
        // The spiral overtravels half a pitch past each end: 0.5 down to -8.5.
        let zs: Vec<f64> = arcs
            .iter()
            .map(|(_, command, _)| match command {
                CamCommandDto::Circular { to, .. } => to.z,
                _ => unreachable!(),
            })
            .collect();
        // The spiral overtravels half a pitch past each end: it starts at
        // 0.5 and the last arc lands exactly at -8.5, monotonically
        // descending. The first arc endpoint sits within one pitch of the
        // start (per-arc Z travel is total travel / arc count).
        assert!(zs[0] <= 0.5 + 1.0e-9 && zs[0] > 0.5 - 1.0);
        assert!((zs[zs.len() - 1] - (-8.5)).abs() < 1.0e-9);
        assert!(zs.windows(2).all(|pair| pair[1] <= pair[0] + 1.0e-9));
        for (_, command, sweep) in &arcs {
            let CamCommandDto::Circular { clockwise, .. } = command else {
                unreachable!();
            };
            assert!(clockwise, "climb milling orbits clockwise");
            assert!(
                sweep.abs() <= std::f64::consts::PI + 1.0e-9,
                "arcs split at 180 degrees, got {sweep}"
            );
        }
    }

    #[test]
    fn right_hand_conventional_thread_orbits_counterclockwise_and_ascends() {
        // Conventional milling reverses the orbit; the right-hand groove then
        // ascends in the counterclockwise direction, so the pass starts at
        // the bottom and climbs out.
        let program = thread_program(
            thread_operation(ThreadHand::Right, MillingDirection::Conventional),
            tool(7, CamToolKind::ThreadMill, 4.8),
        );
        let arcs = circular_moves(&program);
        assert!(!arcs.is_empty());
        let zs: Vec<f64> = arcs
            .iter()
            .map(|(_, command, _)| match command {
                CamCommandDto::Circular { to, .. } => to.z,
                _ => unreachable!(),
            })
            .collect();
        assert!(zs[0] >= -8.5 - 1.0e-9 && zs[0] < -8.5 + 1.0);
        assert!((zs[zs.len() - 1] - 0.5).abs() < 1.0e-9);
        assert!(zs.windows(2).all(|pair| pair[1] >= pair[0] - 1.0e-9));
        for (_, command, _) in &arcs {
            let CamCommandDto::Circular { clockwise, .. } = command else {
                unreachable!();
            };
            assert!(!clockwise, "conventional milling orbits counterclockwise");
        }
    }

    #[test]
    fn left_hand_thread_reverses_the_z_travel() {
        // Same climb orbit as the right-hand case, but the left-hand groove
        // ascends in the clockwise direction, so the pass starts at the
        // bottom.
        let program = thread_program(
            thread_operation(ThreadHand::Left, MillingDirection::Climb),
            tool(7, CamToolKind::ThreadMill, 4.8),
        );
        let arcs = circular_moves(&program);
        assert!(!arcs.is_empty());
        let zs: Vec<f64> = arcs
            .iter()
            .map(|(_, command, _)| match command {
                CamCommandDto::Circular { to, .. } => to.z,
                _ => unreachable!(),
            })
            .collect();
        assert!(zs[0] >= -8.5 - 1.0e-9 && zs[0] < -8.5 + 1.0);
        assert!((zs[zs.len() - 1] - 0.5).abs() < 1.0e-9);
        assert!(zs.windows(2).all(|pair| pair[1] >= pair[0] - 1.0e-9));
    }

    #[test]
    fn thread_radial_passes_open_up_and_finish_at_the_full_orbit() {
        let mut operation = thread_operation(ThreadHand::Right, MillingDirection::Climb);
        let CamOperationDto::Thread {
            radial_passes,
            step_over,
            ..
        } = &mut operation
        else {
            unreachable!();
        };
        *radial_passes = 3;
        *step_over = Some(0.2);
        let program = thread_program(operation, tool(7, CamToolKind::ThreadMill, 4.8));
        // The straight lead-out from the hole center marks each pass's orbit
        // radius: (6 - 4.8) / 2 = 0.6, stepped in by 0.2 per pass.
        let lead_radii: Vec<f64> = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { to, feed }
                    if *feed == 800.0
                        && (to.z - 0.5).abs() < 1.0e-9
                        && (to.y - 15.0).abs() < 1.0e-9
                        && to.x > 20.0 + 1.0e-9 =>
                {
                    Some(to.x - 20.0)
                }
                _ => None,
            })
            .collect();
        assert_eq!(lead_radii.len(), 3);
        for (actual, expected) in lead_radii.iter().zip([0.2, 0.4, 0.6].iter()) {
            assert!(
                (actual - expected).abs() < 1.0e-9,
                "orbit radius {actual} should be {expected}"
            );
        }
    }

    #[test]
    fn thread_motion_is_reported_per_operation() {
        let program = thread_program(
            thread_operation(ThreadHand::Right, MillingDirection::Climb),
            tool(7, CamToolKind::ThreadMill, 4.8),
        );
        let entry = program
            .per_operation
            .iter()
            .find(|entry| entry.operation_id == 3)
            .expect("the thread operation reports its own totals");
        assert!(entry.cutting_distance > 0.0);
        assert!(entry.estimated_seconds > 0.0);
    }

    #[test]
    fn thread_validation_fails_closed() {
        // A thread operation needs a thread mill.
        let error = plan_setup(
            &document(
                vec![thread_operation(ThreadHand::Right, MillingDirection::Climb)],
                vec![tool(7, CamToolKind::FlatEndMill, 4.8)],
            ),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("thread mill"));
        // The tool body must fit the pre-machined minor diameter.
        let error = plan_setup(
            &document(
                vec![thread_operation(ThreadHand::Right, MillingDirection::Climb)],
                vec![tool(7, CamToolKind::ThreadMill, 5.5)],
            ),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("minor diameter"));
        // Multiple radial passes need a stepover...
        let mut operation = thread_operation(ThreadHand::Right, MillingDirection::Climb);
        let CamOperationDto::Thread { radial_passes, .. } = &mut operation else {
            unreachable!();
        };
        *radial_passes = 2;
        let error = plan_setup(
            &document(
                vec![operation],
                vec![tool(7, CamToolKind::ThreadMill, 4.8)],
            ),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("needs a stepover"));
        // ...that leaves a finishing orbit.
        let mut operation = thread_operation(ThreadHand::Right, MillingDirection::Climb);
        let CamOperationDto::Thread {
            radial_passes,
            step_over,
            ..
        } = &mut operation
        else {
            unreachable!();
        };
        *radial_passes = 3;
        *step_over = Some(0.5);
        let error = plan_setup(
            &document(
                vec![operation],
                vec![tool(7, CamToolKind::ThreadMill, 4.8)],
            ),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("consume the whole orbit"));
        // A single pass takes no stepover.
        let mut operation = thread_operation(ThreadHand::Right, MillingDirection::Climb);
        let CamOperationDto::Thread { step_over, .. } = &mut operation else {
            unreachable!();
        };
        *step_over = Some(0.2);
        let error = plan_setup(
            &document(
                vec![operation],
                vec![tool(7, CamToolKind::ThreadMill, 4.8)],
            ),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("takes a stepover only"));
    }

    // ---- Radial passes, milling direction, arc leads, feed plane ----

    fn contour_pass_program(operation: CamOperationDto) -> CamProgramDto {
        plan_setup(
            &document(vec![operation], vec![tool(1, CamToolKind::FlatEndMill, 6.0)]),
            1,
        )
        .expect("plan")
    }

    /// Linear moves (target, feed) at the given depth.
    fn linears_at(program: &CamProgramDto, depth: f64) -> Vec<(Point3Dto, f64)> {
        program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Linear { to, feed } if (to.z - depth).abs() < 1.0e-9 => {
                    Some((*to, *feed))
                }
                _ => None,
            })
            .collect()
    }

    #[test]
    fn contour_roughing_passes_step_to_the_wall_then_finish_and_spring() {
        let mut operation = closed_boss_operation(
            CompensationMode::InSoftware,
            ContourCompensation::Outside,
        );
        let CamOperationDto::Contour2d {
            roughing_passes,
            roughing_step_over,
            finishing_pass,
            finish_allowance,
            finish_feed,
            spring_pass,
            ..
        } = &mut operation
        else {
            unreachable!();
        };
        *roughing_passes = 2;
        *roughing_step_over = Some(2.0);
        *finishing_pass = true;
        *finish_allowance = 0.5;
        *finish_feed = Some(300.0);
        *spring_pass = true;
        let program = contour_pass_program(operation);
        let cuts = linears_at(&program, -2.0);
        // r = 3: the roughing passes run 3 + 0.5 + 2 = 5.5 and 3.5 mm out
        // from the 10 x 10 square (x = -0.5 and x = 1.5 on the near wall);
        // the finish pass takes the last 0.5 at 3.0 mm out (x = 2.0).
        assert!(cuts.iter().any(|(p, _)| (p.x + 0.5).abs() < 1.0e-9));
        assert!(cuts.iter().any(|(p, _)| (p.x - 1.5).abs() < 1.0e-9));
        assert!(cuts.iter().any(|(p, _)| (p.x - 2.0).abs() < 1.0e-9));
        // Finish feed: lead-in + 4 lap sides + 4 spring-lap sides + lead-out.
        assert_eq!(
            cuts.iter()
                .filter(|(_, feed)| (*feed - 300.0).abs() < 1.0e-9)
                .count(),
            10
        );
        // Roughing feed: two passes of lead-in + lap + lead-out each.
        assert_eq!(
            cuts.iter()
                .filter(|(_, feed)| (*feed - 800.0).abs() < 1.0e-9)
                .count(),
            12
        );
    }

    #[test]
    fn climb_direction_rewinds_a_cw_loop_around_its_start() {
        let mut operation = closed_boss_operation(
            CompensationMode::InSoftware,
            ContourCompensation::Outside,
        );
        let CamOperationDto::Contour2d { path, .. } = &mut operation else {
            unreachable!();
        };
        // The same 10 x 10 square stored clockwise, still starting at (5,5).
        *path = vec![
            Point2Dto::new(5.0, 5.0),
            Point2Dto::new(5.0, 15.0),
            Point2Dto::new(15.0, 15.0),
            Point2Dto::new(15.0, 5.0),
        ];
        let program = contour_pass_program(operation);
        let cuts = linears_at(&program, -2.0);
        // Climb on an outside profile wants CCW travel: the planner re-winds
        // the loop keeping (5,5) first, so the r = 3 offset lap runs
        // (2,2) -> (18,2) -> ... The first target is the plunge at the lead
        // start (-3,2).
        assert!((cuts[0].0.x + 3.0).abs() < 1.0e-9 && (cuts[0].0.y - 2.0).abs() < 1.0e-9);
        assert!((cuts[1].0.x - 2.0).abs() < 1.0e-9 && (cuts[1].0.y - 2.0).abs() < 1.0e-9);
        assert!((cuts[2].0.x - 18.0).abs() < 1.0e-9 && (cuts[2].0.y - 2.0).abs() < 1.0e-9);
    }

    #[test]
    fn climb_reverses_an_open_chain_but_keeps_the_physical_tool_side() {
        let mut operation = open_chain_operation(ContourCompensation::Left);
        let CamOperationDto::Contour2d { direction, .. } = &mut operation else {
            unreachable!();
        };
        *direction = MillingDirection::Climb;
        let program = contour_pass_program(operation);
        let cuts = linears_at(&program, -2.0);
        // The L chain (5,5)-(30,5)-(30,20) with the tool on its left is
        // conventional as authored, so climb reverses the travel: the lead
        // start lands past the far end at (27,25) (r = 3 offset). The band
        // itself is the original left-side band — (27,8) and (5,8) appear.
        assert!((cuts[0].0.x - 27.0).abs() < 1.0e-9 && (cuts[0].0.y - 25.0).abs() < 1.0e-9);
        assert!(cuts
            .iter()
            .any(|(p, _)| (p.x - 27.0).abs() < 1.0e-9 && (p.y - 8.0).abs() < 1.0e-9));
        assert!(cuts
            .iter()
            .any(|(p, _)| (p.x - 5.0).abs() < 1.0e-9 && (p.y - 8.0).abs() < 1.0e-9));
    }

    #[test]
    fn arc_leads_round_the_straight_lead_onto_the_profile() {
        let mut operation = closed_boss_operation(
            CompensationMode::InSoftware,
            ContourCompensation::Outside,
        );
        let CamOperationDto::Contour2d {
            lead_arc_radius, ..
        } = &mut operation
        else {
            unreachable!();
        };
        *lead_arc_radius = Some(2.0);
        let program = contour_pass_program(operation);
        // CCW square, outside compensation: the arcs bend right (clockwise).
        // The r = 3 offset lap starts at (2,2) heading +X: the entry arc has
        // center (2,0) and starts at (0,0), reached by the straight lead
        // from (0,-5). The exit arc around (0,2) ends at (0,0), and the
        // straight lead-out runs to (-5,0).
        let arcs: Vec<(Point3Dto, Point3Dto, bool)> = program
            .commands
            .iter()
            .filter_map(|command| match command {
                CamCommandDto::Circular {
                    to,
                    center,
                    clockwise,
                    ..
                } => Some((*to, *center, *clockwise)),
                _ => None,
            })
            .collect();
        assert_eq!(arcs.len(), 2);
        assert!((arcs[0].0.x - 2.0).abs() < 1.0e-9 && (arcs[0].0.y - 2.0).abs() < 1.0e-9);
        assert!((arcs[0].1.x - 2.0).abs() < 1.0e-9 && arcs[0].1.y.abs() < 1.0e-9);
        assert!(arcs[0].2);
        assert!(arcs[1].0.x.abs() < 1.0e-9 && arcs[1].0.y.abs() < 1.0e-9);
        assert!(arcs[1].1.x.abs() < 1.0e-9 && (arcs[1].1.y - 2.0).abs() < 1.0e-9);
        assert!(arcs[1].2);
        let cuts = linears_at(&program, -2.0);
        assert!(cuts
            .iter()
            .any(|(p, _)| p.x.abs() < 1.0e-9 && (p.y + 5.0).abs() < 1.0e-9));
        assert!(cuts
            .iter()
            .any(|(p, _)| p.x.abs() < 1.0e-9 && p.y.abs() < 1.0e-9));
        assert!(cuts
            .iter()
            .any(|(p, _)| (p.x + 5.0).abs() < 1.0e-9 && p.y.abs() < 1.0e-9));
    }

    #[test]
    fn in_control_arc_lead_keeps_activation_on_the_straight_lead() {
        let mut operation = closed_boss_operation(
            CompensationMode::InControl,
            ContourCompensation::Outside,
        );
        let CamOperationDto::Contour2d {
            lead_arc_radius, ..
        } = &mut operation
        else {
            unreachable!();
        };
        *lead_arc_radius = Some(2.0);
        let program = contour_pass_program(operation);
        let on_index = program
            .commands
            .iter()
            .position(|command| matches!(command, CamCommandDto::CutterCompensationOn { .. }))
            .expect("activation");
        let off_index = program
            .commands
            .iter()
            .position(|command| matches!(command, CamCommandDto::CutterCompensationOff))
            .expect("cancellation");
        // Controls activate and cancel compensation on linear moves only;
        // the arcs run inside the compensated region.
        assert!(matches!(
            program.commands[on_index + 1],
            CamCommandDto::Linear { .. }
        ));
        assert!(matches!(
            program.commands[off_index + 1],
            CamCommandDto::Linear { .. }
        ));
        assert!(program.commands[on_index..off_index]
            .iter()
            .any(|command| matches!(command, CamCommandDto::Circular { .. })));
        // The programmed path is still the part contour.
        let cuts = linears_at(&program, -2.0);
        assert!(cuts
            .iter()
            .any(|(p, _)| (p.x - 15.0).abs() < 1.0e-9 && (p.y - 5.0).abs() < 1.0e-9));
        assert!(!cuts
            .iter()
            .any(|(p, _)| (p.x - 18.0).abs() < 1.0e-9 && (p.y - 2.0).abs() < 1.0e-9));
    }

    #[test]
    fn one_way_facing_cuts_one_direction_and_repositions_at_the_feed_plane() {
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
            target_z: -1.0,
            step_over: 6.0,
            step_down: 1.0,
            safe_distance: 5.0,
            direction: FaceDirection::Climb,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
            cutting: cutting(),
        };
        let program = contour_pass_program(operation);
        // Walk the motion at the cut depth: every horizontal move runs +X
        // (climb with a clockwise spindle), and between rows the tool lifts
        // to the feed plane (z = 1) before repositioning in free air.
        let mut position: Option<Point3Dto> = None;
        let mut saw_feed_plane_return = false;
        for command in &program.commands {
            match command {
                CamCommandDto::Rapid { to } => {
                    if let Some(from) = position {
                        if (to.z - 1.0).abs() < 1.0e-9 && from.z < -0.5 {
                            saw_feed_plane_return = true;
                        }
                    }
                    position = Some(*to);
                }
                CamCommandDto::Linear { to, .. } => {
                    if let Some(from) = position {
                        let horizontal = (to.z - from.z).abs() < 1.0e-9 && from.z < -0.5;
                        if horizontal && (to.x - from.x).abs() > 1.0 {
                            assert!(
                                to.x > from.x,
                                "climb facing rows must all run +X: {from:?} -> {to:?}"
                            );
                        }
                    }
                    position = Some(*to);
                }
                _ => {}
            }
        }
        assert!(saw_feed_plane_return);
    }

    #[test]
    fn pocket_wall_finish_follows_the_milling_direction() {
        let operation = CamOperationDto::Pocket2d {
            id: 1,
            name: "Pocket".into(),
            enabled: true,
            tool_id: 1,
            // CCW outline; the wall is an inside profile, so climb milling
            // (clockwise spindle) runs the finish pass clockwise.
            outline: vec![
                Point2Dto::new(10.0, 5.0),
                Point2Dto::new(30.0, 5.0),
                Point2Dto::new(30.0, 25.0),
                Point2Dto::new(10.0, 25.0),
            ],
            top_z: 0.0,
            bottom_z: -1.0,
            step_down: 1.0,
            step_over: 6.0,
            direction: MillingDirection::Climb,
            clearance_z: 10.0,
            retract_z: 3.0,
            feed_height_z: 1.0,
            cutting: cutting(),
        };
        let program = contour_pass_program(operation);
        let cuts = linears_at(&program, -1.0);
        // r = 3 clearing ring (13,8)-(27,8)-(27,22)-(13,22), re-wound
        // clockwise around its start: the finish lap is the last five moves.
        let tail = &cuts[cuts.len() - 5..];
        let expected = [
            (13.0, 8.0),
            (13.0, 22.0),
            (27.0, 22.0),
            (27.0, 8.0),
            (13.0, 8.0),
        ];
        for ((point, _), (x, y)) in tail.iter().zip(expected.iter()) {
            assert!(
                (point.x - x).abs() < 1.0e-9 && (point.y - y).abs() < 1.0e-9,
                "finish lap point should be ({x}, {y}), got {point:?}"
            );
        }
    }

    #[test]
    fn contour_pass_and_lead_validation_fails_closed() {
        // Spring pass on an open chain.
        let mut operation = open_chain_operation(ContourCompensation::Left);
        let CamOperationDto::Contour2d { spring_pass, .. } = &mut operation else {
            unreachable!();
        };
        *spring_pass = true;
        let error = plan_setup(
            &document(vec![operation], vec![tool(1, CamToolKind::FlatEndMill, 6.0)]),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("spring pass"));
        // Multiple roughing passes without a radial step-over.
        let mut operation = closed_boss_operation(
            CompensationMode::InSoftware,
            ContourCompensation::Outside,
        );
        let CamOperationDto::Contour2d {
            roughing_passes, ..
        } = &mut operation
        else {
            unreachable!();
        };
        *roughing_passes = 2;
        let error = plan_setup(
            &document(vec![operation], vec![tool(1, CamToolKind::FlatEndMill, 6.0)]),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("radial step-over"));
        // Finishing pass without an allowance.
        let mut operation = closed_boss_operation(
            CompensationMode::InSoftware,
            ContourCompensation::Outside,
        );
        let CamOperationDto::Contour2d {
            finishing_pass, ..
        } = &mut operation
        else {
            unreachable!();
        };
        *finishing_pass = true;
        let error = plan_setup(
            &document(vec![operation], vec![tool(1, CamToolKind::FlatEndMill, 6.0)]),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("finish allowance"));
        // Arc leads into an inside closed profile.
        let mut operation = closed_boss_operation(
            CompensationMode::InSoftware,
            ContourCompensation::Inside,
        );
        let CamOperationDto::Contour2d {
            lead_arc_radius, ..
        } = &mut operation
        else {
            unreachable!();
        };
        *lead_arc_radius = Some(2.0);
        let error = plan_setup(
            &document(vec![operation], vec![tool(1, CamToolKind::FlatEndMill, 6.0)]),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("arc leads"));
        // Radial passes on an on-path contour have no material side.
        let mut operation = closed_boss_operation(
            CompensationMode::InSoftware,
            ContourCompensation::On,
        );
        let CamOperationDto::Contour2d {
            roughing_passes,
            roughing_step_over,
            ..
        } = &mut operation
        else {
            unreachable!();
        };
        *roughing_passes = 2;
        *roughing_step_over = Some(2.0);
        let error = plan_setup(
            &document(vec![operation], vec![tool(1, CamToolKind::FlatEndMill, 6.0)]),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("on-path"));
    }
}
