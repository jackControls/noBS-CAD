use serde::{Deserialize, Serialize};

use crate::model::{
    signed_area, CamDocumentDto, CamOperationDto, CamSetupDto, CamToolDto, ContourCompensation,
    CoolantMode, Point2Dto, Point3Dto, SpindleDirection, WorkOffset,
};

const EPSILON: f64 = 1.0e-9;
const MAX_GENERATED_STEPS: usize = 250_000;
const MAX_PROGRAM_COMMANDS: usize = 300_000;

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
    SectionStart {
        operation_id: u64,
        name: String,
        tool_id: u64,
    },
    ToolChange {
        tool_id: u64,
        tool_number: u32,
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

    let mut builder = ProgramBuilder::new(setup);
    builder.commands.push(CamCommandDto::ProgramStart {
        name: setup.name.clone(),
        work_offset: setup.work_offset,
    });

    let mut active_tool: Option<u64> = None;
    let mut active_spindle: Option<(SpindleDirection, u32)> = None;
    let mut active_coolant = CoolantMode::Off;
    for operation in operations {
        let tool = document
            .tool(operation.tool_id())
            .ok_or_else(|| CamPlanError("validated operation tool disappeared".to_string()))?;
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
        }
        builder.commands.push(CamCommandDto::SectionEnd);
        builder.stats.operation_count += 1;
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
        warnings: vec![
            "Toolpaths are stock-aware but are not yet collision-checked against fixtures or holders."
                .to_string(),
            "Posted programs retract Z before the first XY move, but still require a verified WCS and machine-safe start position."
                .to_string(),
            "Simulate, inspect, and dry-run every posted program before machining.".to_string(),
        ],
    })
}

struct ProgramBuilder<'a> {
    setup: &'a CamSetupDto,
    commands: Vec<CamCommandDto>,
    stats: CamProgramStatsDto,
    position: Option<Point3Dto>,
}

impl<'a> ProgramBuilder<'a> {
    fn new(setup: &'a CamSetupDto) -> Self {
        Self {
            setup,
            commands: Vec::new(),
            stats: CamProgramStatsDto::default(),
            position: None,
        }
    }

    fn rapid(&mut self, to: Point3Dto) {
        if self.position == Some(to) {
            return;
        }
        if let Some(from) = self.position {
            let distance = distance(from, to);
            self.stats.rapid_distance += distance;
            self.stats.estimated_seconds += distance / self.setup.rapid_feed * 60.0;
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

    fn retract_to_clearance(&mut self) {
        let Some(position) = self.position else {
            return;
        };
        if (position.z - self.setup.clearance_z).abs() > EPSILON {
            self.rapid(Point3Dto::new(
                position.x,
                position.y,
                self.setup.clearance_z,
            ));
        }
    }

    fn approach(&mut self, point: Point2Dto, retract_z: f64, depth: f64, plunge_feed: f64) {
        self.retract_to_clearance();
        self.rapid(Point3Dto::new(point.x, point.y, self.setup.clearance_z));
        self.rapid(Point3Dto::new(point.x, point.y, retract_z));
        self.linear(Point3Dto::new(point.x, point.y, depth), plunge_feed);
    }
}

fn plan_face(
    builder: &mut ProgramBuilder<'_>,
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
        builder.approach(first, builder.setup.retract_z, depth, cutting.feed_z);
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
    builder: &mut ProgramBuilder<'_>,
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
        builder.approach(first, builder.setup.retract_z, depth, cutting.feed_z);
        for point in center_path.iter().copied().skip(1) {
            builder.linear(Point3Dto::new(point.x, point.y, depth), cutting.feed_xy);
        }
        builder.linear(Point3Dto::new(first.x, first.y, depth), cutting.feed_xy);
        builder.retract_to_clearance();
    }
    Ok(())
}

fn plan_drill(
    builder: &mut ProgramBuilder<'_>,
    operation: &CamOperationDto,
    tool: &CamToolDto,
) -> Result<(), CamPlanError> {
    let CamOperationDto::Drill {
        points,
        top_z,
        bottom_z,
        retract_z,
        peck_depth,
        dwell_seconds,
        cutting,
        name,
        ..
    } = operation
    else {
        unreachable!();
    };
    require_flute_length(tool, top_z - bottom_z, name)?;
    let depths = if let Some(peck) = peck_depth {
        depth_levels(*top_z, *bottom_z, *peck)?
    } else {
        vec![*bottom_z]
    };
    ensure_program_budget(
        builder.commands.len(),
        points
            .len()
            .saturating_mul(depths.len().saturating_mul(3).saturating_add(4)),
        name,
    )?;
    for point in points {
        builder.retract_to_clearance();
        builder.rapid(Point3Dto::new(point.x, point.y, builder.setup.clearance_z));
        builder.rapid(Point3Dto::new(point.x, point.y, *retract_z));
        if peck_depth.is_some() {
            for depth in depths.iter().copied() {
                builder.linear(Point3Dto::new(point.x, point.y, depth), cutting.feed_z);
                builder.dwell(*dwell_seconds);
                builder.rapid(Point3Dto::new(point.x, point.y, *retract_z));
            }
        } else {
            builder.linear(Point3Dto::new(point.x, point.y, *bottom_z), cutting.feed_z);
            builder.dwell(*dwell_seconds);
            builder.rapid(Point3Dto::new(point.x, point.y, *retract_z));
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
            "operation '{operation}' cuts {:.3} mm deep, beyond tool T{}'s {:.3} mm flute length",
            depth, tool.number, tool.flute_length
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
        CamPostConfigDto, CamToolKind, CuttingParametersDto, Rect2Dto, StockBoxDto,
        WorkCoordinateSystemDto,
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
            number: id as u32,
            name: format!("Tool {id}"),
            kind,
            diameter,
            flute_length: 20.0,
            overall_length: 50.0,
            center_cutting: true,
        }
    }

    fn document(operations: Vec<CamOperationDto>, tools: Vec<CamToolDto>) -> CamDocumentDto {
        CamDocumentDto {
            setups: vec![CamSetupDto {
                id: 1,
                name: "Setup 1".into(),
                wcs: WorkCoordinateSystemDto::default(),
                work_offset: WorkOffset::G54,
                stock: StockBoxDto {
                    min: Point3Dto::new(0.0, 0.0, -20.0),
                    max: Point3Dto::new(40.0, 30.0, 0.0),
                },
                body_ids: vec![],
                clearance_z: 10.0,
                retract_z: 3.0,
                rapid_feed: 3_000.0,
                post: CamPostConfigDto::default(),
                operations,
            }],
            active_setup_id: Some(1),
            next_setup_id: 2,
            next_operation_id: 10,
            next_tool_id: tools.iter().map(|tool| tool.id).max().unwrap_or(0) + 1,
            tools,
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
            cutting: cutting(),
        };
        let mut short_tool = tool(1, CamToolKind::FlatEndMill, 6.0);
        short_tool.flute_length = 10.0;
        let error = plan_setup(&document(vec![operation], vec![short_tool]), 1).unwrap_err();
        assert!(error.0.contains("flute length"));
    }

    #[test]
    fn drill_retract_cannot_rapid_inside_stock() {
        let operation = CamOperationDto::Drill {
            id: 1,
            name: "Unsafe drill".into(),
            enabled: true,
            tool_id: 2,
            points: vec![Point2Dto::new(20.0, 15.0)],
            top_z: -5.0,
            bottom_z: -10.0,
            retract_z: -4.0,
            peck_depth: Some(2.0),
            dwell_seconds: 0.0,
            cutting: cutting(),
        };
        let error = plan_setup(
            &document(vec![operation], vec![tool(2, CamToolKind::Drill, 5.0)]),
            1,
        )
        .unwrap_err();
        assert!(error.0.contains("setup retract plane"));
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
}
