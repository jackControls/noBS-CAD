use serde::{Deserialize, Serialize};

use crate::model::{
    CamDocumentDto, CoolantMode, Point3Dto, PostDialect, Siemens828dPostConfigDto,
    Siemens828dToolChangePositioning, SpindleDirection, WorkOffset,
};
use crate::planner::{plan_setup, CamCommandDto, CamPlanError, CamProgramDto};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamPostRequestDto {
    pub setup_id: u64,
    #[serde(default)]
    pub dialect: Option<PostDialect>,
    #[serde(default)]
    pub program_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamPostResultDto {
    pub program: CamProgramDto,
    pub dialect: PostDialect,
    pub extension: String,
    pub nc: String,
    pub warnings: Vec<String>,
}

/// Plan and post one setup with either its saved dialect or a one-shot
/// override. Built-in posts intentionally cover a conservative 3-axis subset;
/// controller-specific customization remains isolated behind this boundary.
pub fn post_setup(
    document: &CamDocumentDto,
    request: &CamPostRequestDto,
) -> Result<CamPostResultDto, CamPlanError> {
    let program = plan_setup(document, request.setup_id)?;
    let setup = document
        .setup(request.setup_id)
        .ok_or_else(|| CamPlanError(format!("CAM setup {} does not exist", request.setup_id)))?;
    let dialect = request.dialect.unwrap_or(setup.post.dialect);
    let name = request
        .program_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(&program.name);
    let nc = render_program(
        &program,
        dialect,
        name,
        setup.post.program_number,
        setup.post.sequence_numbers,
        setup.post.siemens_828d.as_ref(),
    )?;
    let mut warnings = program.warnings.clone();
    warnings.push(match dialect {
        PostDialect::Grbl => {
            "GRBL output pauses for manual tool changes; confirm the tool and re-zero policy before resuming."
                .to_string()
        }
        PostDialect::LinuxCnc => {
            "LinuxCNC output assumes standard G54, M6, spindle, and coolant mappings."
                .to_string()
        }
        PostDialect::Fanuc => {
            "Generic Fanuc output is a starting point only; verify controller options, tool-change position, and M-codes."
                .to_string()
        }
        PostDialect::Siemens828d => {
            if let Some(profile) = setup.post.siemens_828d.as_ref() {
                format!(
                    "Siemens 828D native output uses G0 SUPA Z{} D0 for machine-coordinate retracts; verify that position, D{}, tool calls, and M-codes on the control before running.",
                    coordinate(profile.supa_retract_z),
                    profile.tool_length_offset,
                )
            } else {
                // Rendering already fails closed above when the profile is
                // absent; retain a non-panicking fallback for future refactors.
                "Siemens 828D native output requires a confirmed machine profile."
                    .to_string()
            }
        }
    });
    if dialect == PostDialect::Siemens828d {
        warnings.push(
            "The standard Siemens profile emits no shop-specific spindle slowdown or other custom machine macro. Add such behavior only through an explicit machine profile after validation."
                .to_string(),
        );
        warnings.push(
            "ATC style is descriptive only; generated positioning and next-tool preloading follow separate, explicit machine-profile settings."
                .to_string(),
        );
        if let Some(profile) = setup.post.siemens_828d.as_ref() {
            warnings.push(match profile.tool_change_positioning {
                Siemens828dToolChangePositioning::SupaZ => format!(
                    "Before later tool changes, the post commands G0 SUPA Z{} D0 and then M6.",
                    coordinate(profile.supa_retract_z)
                ),
                Siemens828dToolChangePositioning::ControllerManaged => {
                    "Before later tool changes, the post emits no machine-axis station move and assumes the machine builder's M6/PLC cycle owns positioning."
                        .to_string()
                }
                Siemens828dToolChangePositioning::SupaZThenXy => format!(
                    "Before later tool changes, the post commands SUPA Z first and then the verified machine station X{} Y{} before M6.",
                    coordinate(profile.station_x.unwrap_or_default()),
                    coordinate(profile.station_y.unwrap_or_default())
                ),
            });
            warnings.push(if profile.preload_next_tool {
                "Next-tool T preloading is enabled. The post emits the next T call immediately after M6/D and wraps the final preload to the first program tool when different; verify that early T calls cannot move this magazine unsafely."
                    .to_string()
            } else {
                "Next-tool T preloading is disabled. Every executable T call is emitted only for the M6 immediately following it."
                    .to_string()
            });
        }
    }
    Ok(CamPostResultDto {
        program,
        dialect,
        extension: dialect.extension().to_string(),
        nc,
        warnings,
    })
}

fn render_program(
    program: &CamProgramDto,
    dialect: PostDialect,
    program_name: &str,
    program_number: Option<u32>,
    sequence_numbers: bool,
    siemens_profile: Option<&Siemens828dPostConfigDto>,
) -> Result<String, CamPlanError> {
    if dialect == PostDialect::Siemens828d {
        let profile = siemens_profile.ok_or_else(|| {
            CamPlanError(
                "Siemens 828D posting requires an explicitly confirmed machine profile with a safe SUPA retract Z"
                    .to_string(),
            )
        })?;
        return render_siemens828d_program(program, program_name, sequence_numbers, profile);
    }
    let mut writer = NcWriter::new(sequence_numbers, 10);
    let mut position: Option<Point3Dto> = None;
    for command in &program.commands {
        match command {
            CamCommandDto::ProgramStart { work_offset, .. } => {
                if dialect == PostDialect::Fanuc {
                    writer.raw("%");
                    writer.raw(&format!("O{:04}", program_number.unwrap_or(1001) % 10_000));
                }
                writer.comment(program_name);
                writer.comment("GENERATED BY NOBS CAD - VERIFY AND DRY RUN");
                writer.block("G90 G17 G21 G40 G49 G80");
                writer.block(work_offset.code());
                writer.block("M5");
                writer.block("M9");
            }
            CamCommandDto::SectionStart { name, .. } => writer.comment(name),
            CamCommandDto::ToolChange {
                tool_number,
                tool_name,
                ..
            } => match dialect {
                PostDialect::Grbl => {
                    writer.block("M5");
                    writer.comment(&format!("MANUAL TOOL CHANGE: T{tool_number} {tool_name}"));
                    writer.block("M0");
                }
                PostDialect::LinuxCnc | PostDialect::Fanuc | PostDialect::Siemens828d => {
                    writer.comment(tool_name);
                    writer.block(&format!("T{tool_number} M6"));
                }
            },
            CamCommandDto::Spindle { direction, rpm } => match direction {
                SpindleDirection::Off => writer.block("M5"),
                SpindleDirection::Clockwise => writer.block(&format!("S{rpm} M3")),
                SpindleDirection::Counterclockwise => writer.block(&format!("S{rpm} M4")),
            },
            CamCommandDto::Coolant { mode } => match mode {
                CoolantMode::Off => writer.block("M9"),
                CoolantMode::Mist => writer.block("M7"),
                CoolantMode::Flood => writer.block("M8"),
            },
            CamCommandDto::Rapid { to } => {
                if position.is_none() {
                    // A combined XYZ rapid from an unknown start can move
                    // diagonally through stock. Establish clearance in Z
                    // before the first XY positioning move.
                    writer.block(&format!("G0 Z{}", coordinate(to.z)));
                    writer.block(&format!("G0 X{} Y{}", coordinate(to.x), coordinate(to.y)));
                } else {
                    writer.block(&format!(
                        "G0 X{} Y{} Z{}",
                        coordinate(to.x),
                        coordinate(to.y),
                        coordinate(to.z)
                    ));
                }
                position = Some(*to);
            }
            CamCommandDto::Linear { to, feed } => {
                writer.block(&format!(
                    "G1 X{} Y{} Z{} F{}",
                    coordinate(to.x),
                    coordinate(to.y),
                    coordinate(to.z),
                    feedrate(*feed)
                ));
                position = Some(*to);
            }
            CamCommandDto::Circular {
                clockwise,
                center,
                to,
                feed,
            } => {
                let from = position.ok_or_else(|| {
                    CamPlanError("a circular post record needs a known start position".to_string())
                })?;
                if (center.z - from.z).abs() > 1.0e-6 || (to.z - from.z).abs() > 1.0e-6 {
                    return Err(CamPlanError(
                        "built-in posts currently support circular interpolation in XY only"
                            .to_string(),
                    ));
                }
                writer.block(&format!(
                    "{} X{} Y{} Z{} I{} J{} F{}",
                    if *clockwise { "G2" } else { "G3" },
                    coordinate(to.x),
                    coordinate(to.y),
                    coordinate(to.z),
                    coordinate(center.x - from.x),
                    coordinate(center.y - from.y),
                    feedrate(*feed)
                ));
                position = Some(*to);
            }
            CamCommandDto::Dwell { seconds } => {
                let value = if dialect == PostDialect::Fanuc {
                    format!("P{}", (seconds * 1_000.0).round() as u64)
                } else {
                    format!("P{}", coordinate(*seconds))
                };
                writer.block(&format!("G4 {value}"));
            }
            CamCommandDto::SectionEnd => {}
            CamCommandDto::ProgramEnd => {
                writer.block("M30");
                if dialect == PostDialect::Fanuc {
                    writer.raw("%");
                }
            }
        }
    }
    Ok(format!("{}\n", writer.lines.join("\n")))
}

/// Native fixed-axis SINUMERIK program calibrated against an
/// operator-provided, known-good 828D MPF and public Siemens programming
/// syntax. It deliberately excludes all machine-builder/shop macros.
fn render_siemens828d_program(
    program: &CamProgramDto,
    program_name: &str,
    sequence_numbers: bool,
    profile: &Siemens828dPostConfigDto,
) -> Result<String, CamPlanError> {
    if profile.tool_change_positioning == Siemens828dToolChangePositioning::SupaZThenXy
        && (profile.station_x.is_none() || profile.station_y.is_none())
    {
        return Err(CamPlanError(
            "Siemens 828D fixed-station positioning requires machine X and Y coordinates"
                .to_string(),
        ));
    }
    let mut writer = NcWriter::new(sequence_numbers, 1);
    let mut position: Option<Point3Dto> = None;
    let mut work_offset = WorkOffset::G54;
    let mut pending_section: Option<String> = None;
    let mut tool_change_count = 0_u32;

    for (index, command) in program.commands.iter().enumerate() {
        match command {
            CamCommandDto::ProgramStart {
                work_offset: offset,
                ..
            } => {
                work_offset = *offset;
                writer.raw(&format!("; %_N_{}_MPF", siemens_program_name(program_name)));
                writer.raw("; GENERATED BY NOBS CAD - VERIFY, SIMULATE, AND DRY RUN");
                writer.block(work_offset.code());
                writer.block("G17 G710 G90 G94");
                writer.block("G64");
                writer.block(&siemens_supa_retract(profile));
            }
            CamCommandDto::SectionStart { name, .. } => {
                let changes_tool = program.commands[index + 1..]
                    .iter()
                    .take_while(|next| !matches!(next, CamCommandDto::SectionEnd))
                    .any(|next| matches!(next, CamCommandDto::ToolChange { .. }));
                if changes_tool {
                    pending_section = Some(name.clone());
                } else {
                    write_siemens_section(&mut writer, name, work_offset);
                }
            }
            CamCommandDto::ToolChange {
                tool_number,
                tool_name,
                ..
            } => {
                if tool_change_count > 0 {
                    if write_siemens_tool_change_positioning(&mut writer, profile)? {
                        writer.block(&format!("D{}", profile.tool_length_offset));
                    }
                }
                if let Some(name) = pending_section.take() {
                    writer.raw("");
                    write_siemens_message(&mut writer, &name);
                }
                if tool_change_count > 0 && profile.optional_stop_on_tool_change {
                    writer.block("M1");
                }
                writer.raw(&format!(
                    "; T{} {}",
                    tool_number,
                    siemens_plain_text(tool_name)
                ));
                writer.block(&format!("T{tool_number}"));
                writer.block("M6");
                writer.block(&format!("D{}", profile.tool_length_offset));
                if profile.preload_next_tool {
                    if let Some(next_tool_number) =
                        siemens_next_preload_tool(program, index, *tool_number)
                    {
                        writer.block(&format!("T{next_tool_number}"));
                    }
                }
                writer.block("G17 G90 G94");
                writer.block(work_offset.code());
                position = None;
                tool_change_count = tool_change_count.saturating_add(1);
            }
            CamCommandDto::Spindle { direction, rpm } => match direction {
                SpindleDirection::Off => writer.block("M5"),
                SpindleDirection::Clockwise => writer.block(&format!("S{rpm} M3")),
                SpindleDirection::Counterclockwise => writer.block(&format!("S{rpm} M4")),
            },
            CamCommandDto::Coolant { mode } => match mode {
                CoolantMode::Off => writer.block("M9"),
                CoolantMode::Mist => writer.block("M7"),
                CoolantMode::Flood => writer.block("M8"),
            },
            CamCommandDto::Rapid { to } => {
                if position.is_none() {
                    writer.block(&format!("G0 Z{}", siemens_coordinate(to.z)));
                    writer.block(&format!(
                        "G0 X{} Y{}",
                        siemens_coordinate(to.x),
                        siemens_coordinate(to.y)
                    ));
                } else {
                    writer.block(&format!(
                        "G0 X{} Y{} Z{}",
                        siemens_coordinate(to.x),
                        siemens_coordinate(to.y),
                        siemens_coordinate(to.z)
                    ));
                }
                position = Some(*to);
            }
            CamCommandDto::Linear { to, feed } => {
                writer.block(&format!(
                    "G1 X{} Y{} Z{} F{}",
                    siemens_coordinate(to.x),
                    siemens_coordinate(to.y),
                    siemens_coordinate(to.z),
                    feedrate(*feed)
                ));
                position = Some(*to);
            }
            CamCommandDto::Circular {
                clockwise,
                center,
                to,
                feed,
            } => {
                let from = position.ok_or_else(|| {
                    CamPlanError("a circular post record needs a known start position".to_string())
                })?;
                if (center.z - from.z).abs() > 1.0e-6 || (to.z - from.z).abs() > 1.0e-6 {
                    return Err(CamPlanError(
                        "the Siemens 828D built-in post currently supports circular interpolation in XY only"
                            .to_string(),
                    ));
                }
                writer.block(&format!(
                    "{} X{} Y{} Z{} I{} J{} F{}",
                    if *clockwise { "G2" } else { "G3" },
                    siemens_coordinate(to.x),
                    siemens_coordinate(to.y),
                    siemens_coordinate(to.z),
                    siemens_coordinate(center.x - from.x),
                    siemens_coordinate(center.y - from.y),
                    feedrate(*feed)
                ));
                position = Some(*to);
            }
            CamCommandDto::Dwell { seconds } => {
                // Native SINUMERIK specifies G4 F... in seconds. The F word
                // applies to this dwell block only and does not replace the
                // modal machining feed.
                writer.block(&format!("G4 F{}", siemens_coordinate(*seconds)));
            }
            CamCommandDto::SectionEnd => {
                pending_section = None;
            }
            CamCommandDto::ProgramEnd => {
                writer.block(&siemens_supa_retract(profile));
                writer.block(&format!("D{}", profile.tool_length_offset));
                writer.block("M30");
            }
        }
    }

    Ok(format!("{}\n", writer.lines.join("\n")))
}

fn write_siemens_section(writer: &mut NcWriter, name: &str, work_offset: WorkOffset) {
    writer.raw("");
    write_siemens_message(writer, name);
    writer.block("G17 G90 G94");
    writer.block(work_offset.code());
}

fn write_siemens_message(writer: &mut NcWriter, name: &str) {
    writer.raw(&format!("MSG (\"{}\")", siemens_plain_text(name)));
}

fn siemens_supa_retract(profile: &Siemens828dPostConfigDto) -> String {
    format!("G0 SUPA Z{} D0", siemens_coordinate(profile.supa_retract_z))
}

/// Emit only the positioning behavior explicitly confirmed in the machine
/// profile. Physical magazine style is intentionally not consulted here.
fn write_siemens_tool_change_positioning(
    writer: &mut NcWriter,
    profile: &Siemens828dPostConfigDto,
) -> Result<bool, CamPlanError> {
    match profile.tool_change_positioning {
        Siemens828dToolChangePositioning::SupaZ => {
            writer.block(&siemens_supa_retract(profile));
            Ok(true)
        }
        Siemens828dToolChangePositioning::ControllerManaged => {
            writer.raw("; M6/PLC CONTROLS TOOL-CHANGE POSITIONING");
            Ok(false)
        }
        Siemens828dToolChangePositioning::SupaZThenXy => {
            let (Some(x), Some(y)) = (profile.station_x, profile.station_y) else {
                return Err(CamPlanError(
                    "Siemens 828D fixed-station positioning requires machine X and Y coordinates"
                        .to_string(),
                ));
            };
            writer.block(&siemens_supa_retract(profile));
            writer.block(&format!(
                "G0 SUPA X{} Y{}",
                siemens_coordinate(x),
                siemens_coordinate(y)
            ));
            Ok(true)
        }
    }
}

/// Return the next actual tool change, wrapping to the program's first tool so
/// repeated program runs can stage it too. A one-tool program never emits a
/// redundant/self preload.
fn siemens_next_preload_tool(
    program: &CamProgramDto,
    current_index: usize,
    current_tool_number: u32,
) -> Option<u32> {
    program.commands[current_index + 1..]
        .iter()
        .find_map(|command| match command {
            CamCommandDto::ToolChange { tool_number, .. } => Some(*tool_number),
            _ => None,
        })
        .or_else(|| {
            program.commands[..current_index]
                .iter()
                .find_map(|command| match command {
                    CamCommandDto::ToolChange { tool_number, .. } => Some(*tool_number),
                    _ => None,
                })
        })
        .filter(|tool_number| *tool_number != current_tool_number)
}

fn siemens_program_name(value: &str) -> String {
    let mut result = String::new();
    let mut previous_separator = false;
    for character in value.trim().chars() {
        let normalized = if character.is_ascii_alphanumeric() {
            character.to_ascii_uppercase()
        } else {
            '_'
        };
        if normalized == '_' {
            if previous_separator || result.is_empty() {
                continue;
            }
            previous_separator = true;
        } else {
            previous_separator = false;
        }
        result.push(normalized);
        if result.len() >= 24 {
            break;
        }
    }
    while result.ends_with('_') {
        result.pop();
    }
    if let Some(without_suffix) = result.strip_suffix("_MPF") {
        result = without_suffix.trim_end_matches('_').to_string();
    }
    if result.is_empty() {
        "PROGRAM".to_string()
    } else {
        result
    }
}

fn siemens_plain_text(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '"' => '\'',
            '\r' | '\n' | ';' => ' ',
            character if character.is_ascii_graphic() || character == ' ' => character,
            _ => '?',
        })
        .take(80)
        .collect::<String>()
        .trim()
        .to_string()
}

struct NcWriter {
    lines: Vec<String>,
    sequence_numbers: bool,
    next_sequence: u32,
    sequence_increment: u32,
}

impl NcWriter {
    fn new(sequence_numbers: bool, sequence_increment: u32) -> Self {
        Self {
            lines: Vec::new(),
            sequence_numbers,
            next_sequence: 10,
            sequence_increment: sequence_increment.max(1),
        }
    }

    fn raw(&mut self, line: &str) {
        self.lines.push(line.to_string());
    }

    fn comment(&mut self, text: &str) {
        let clean = text
            .chars()
            .map(|character| match character {
                '(' | ')' | '\r' | '\n' => ' ',
                other => other,
            })
            .collect::<String>();
        self.raw(&format!("({})", clean.trim()));
    }

    fn block(&mut self, words: &str) {
        if self.sequence_numbers {
            self.lines.push(format!("N{} {words}", self.next_sequence));
            self.next_sequence = self.next_sequence.saturating_add(self.sequence_increment);
        } else {
            self.lines.push(words.to_string());
        }
    }
}

fn coordinate(value: f64) -> String {
    decimal(value, 3)
}

fn siemens_coordinate(value: f64) -> String {
    decimal(value, 5)
}

fn decimal(value: f64, precision: usize) -> String {
    let zero_threshold = 0.5 * 10_f64.powi(-(precision as i32));
    let normalized = if value.abs() < zero_threshold {
        0.0
    } else {
        value
    };
    let mut formatted = format!("{normalized:.precision$}");
    while formatted.contains('.') && formatted.ends_with('0') {
        formatted.pop();
    }
    if formatted.ends_with('.') {
        formatted.pop();
    }
    formatted
}

fn feedrate(value: f64) -> String {
    coordinate(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        CamOperationDto, CamPostConfigDto, CamSetupDto, CamToolDto, CamToolKind,
        CuttingParametersDto, Point2Dto, Rect2Dto, Siemens828dAtcStyle, StockBoxDto,
        WorkCoordinateSystemDto, WorkOffset,
    };

    fn document(dialect: PostDialect) -> CamDocumentDto {
        CamDocumentDto {
            setups: vec![CamSetupDto {
                id: 1,
                name: "Fixture A".into(),
                wcs: WorkCoordinateSystemDto::default(),
                work_offset: WorkOffset::G54,
                stock: StockBoxDto {
                    min: Point3Dto::new(0.0, 0.0, -10.0),
                    max: Point3Dto::new(20.0, 20.0, 0.0),
                },
                body_ids: vec![],
                clearance_z: 8.0,
                retract_z: 2.0,
                rapid_feed: 3_000.0,
                post: CamPostConfigDto {
                    dialect,
                    program_number: Some(42),
                    sequence_numbers: false,
                    siemens_828d: (dialect == PostDialect::Siemens828d)
                        .then(Siemens828dPostConfigDto::default),
                },
                operations: vec![CamOperationDto::Face {
                    id: 1,
                    name: "Face top".into(),
                    enabled: true,
                    tool_id: 1,
                    bounds: Rect2Dto {
                        min: Point2Dto::new(0.0, 0.0),
                        max: Point2Dto::new(20.0, 20.0),
                    },
                    top_z: 0.0,
                    target_z: -1.0,
                    step_over: 3.0,
                    step_down: 1.0,
                    cutting: CuttingParametersDto {
                        spindle_rpm: 10_000,
                        feed_xy: 600.0,
                        feed_z: 150.0,
                        coolant: CoolantMode::Flood,
                    },
                }],
            }],
            active_setup_id: Some(1),
            tools: vec![CamToolDto {
                id: 1,
                number: 1,
                name: "6 mm flat".into(),
                kind: CamToolKind::FlatEndMill,
                diameter: 6.0,
                flute_length: 15.0,
                overall_length: 50.0,
                center_cutting: true,
            }],
            next_setup_id: 2,
            next_operation_id: 2,
            next_tool_id: 2,
        }
    }

    fn two_tool_siemens_document() -> CamDocumentDto {
        let mut source = document(PostDialect::Siemens828d);
        source.tools.push(CamToolDto {
            id: 2,
            number: 19,
            name: "5 mm drill".into(),
            kind: CamToolKind::Drill,
            diameter: 5.0,
            flute_length: 25.0,
            overall_length: 55.0,
            center_cutting: true,
        });
        source.setups[0].operations.push(CamOperationDto::Drill {
            id: 2,
            name: "Drill holes".into(),
            enabled: true,
            tool_id: 2,
            points: vec![Point2Dto::new(10.0, 10.0)],
            top_z: 0.0,
            bottom_z: -3.0,
            retract_z: 2.0,
            peck_depth: None,
            dwell_seconds: 0.25,
            cutting: CuttingParametersDto {
                spindle_rpm: 2_500,
                feed_xy: 300.0,
                feed_z: 100.0,
                coolant: CoolantMode::Flood,
            },
        });
        source.next_tool_id = 3;
        source.next_operation_id = 3;
        source
    }

    #[test]
    fn grbl_post_is_metric_absolute_and_pauses_for_manual_tool_change() {
        let posted = post_setup(
            &document(PostDialect::Grbl),
            &CamPostRequestDto {
                setup_id: 1,
                dialect: None,
                program_name: Some("FACE SAMPLE".into()),
            },
        )
        .unwrap();
        assert!(posted.nc.contains("G90 G17 G21 G40 G49 G80"));
        assert!(posted.nc.contains("G54\nM5\nM9"));
        assert!(posted.nc.contains("(MANUAL TOOL CHANGE: T1 6 mm flat)"));
        assert!(posted.nc.contains("M0"));
        assert!(posted.nc.contains("G1 X"));
        let z_clearance = posted.nc.find("G0 Z8").unwrap();
        let xy_position = posted.nc.find("G0 X-3 Y0").unwrap();
        assert!(z_clearance < xy_position);
        assert!(posted.nc.ends_with("M30\n"));
    }

    #[test]
    fn fanuc_post_wraps_program_and_uses_program_number() {
        let posted = post_setup(
            &document(PostDialect::Fanuc),
            &CamPostRequestDto {
                setup_id: 1,
                dialect: None,
                program_name: None,
            },
        )
        .unwrap();
        assert!(posted.nc.starts_with("%\nO0042\n"));
        assert!(posted.nc.contains("T1 M6"));
        assert!(posted.nc.ends_with("M30\n%\n"));
    }

    #[test]
    fn siemens_native_post_matches_the_validated_828d_envelope_without_shop_macros() {
        let mut source = document(PostDialect::Siemens828d);
        source.setups[0].work_offset = WorkOffset::G58;
        source.setups[0].post.sequence_numbers = true;
        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                dialect: None,
                program_name: Some("61047097 op1 v4".to_string()),
            },
        )
        .unwrap();

        assert!(posted.nc.starts_with("; %_N_61047097_OP1_V4_MPF\n"));
        assert!(posted.nc.contains("N10 G58\nN11 G17 G710 G90 G94\nN12 G64"));
        assert!(posted.nc.contains("G0 SUPA Z0 D0"));
        assert!(posted.nc.contains("MSG (\"Face top\")"));
        assert!(posted.nc.contains("T1\n"));
        assert!(posted.nc.contains("M6\n"));
        assert!(posted.nc.contains("D1\n"));
        assert!(posted.nc.contains("S10000 M3"));
        assert!(posted.nc.contains("M8"));
        assert!(posted.nc.ends_with("M30\n"));
        assert!(!posted.nc.contains("SP_RP_D"));
        assert_eq!(posted.extension, "mpf");
    }

    #[test]
    fn siemens_native_post_fails_closed_without_a_confirmed_machine_profile() {
        let mut source = document(PostDialect::Siemens828d);
        source.setups[0].post.siemens_828d = None;
        let error = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                dialect: None,
                program_name: None,
            },
        )
        .expect_err("a Siemens post without a machine-safe SUPA value must fail closed");

        assert!(error
            .to_string()
            .contains("explicitly confirmed machine profile"));
        assert!(error.to_string().contains("SUPA retract Z"));
    }

    #[test]
    fn siemens_later_tool_change_uses_standard_shutdown_and_native_dwell() {
        let source = two_tool_siemens_document();

        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                dialect: None,
                program_name: None,
            },
        )
        .unwrap();

        let shutdown = posted.nc.find("M9\nM5\nG0 SUPA Z0 D0").unwrap();
        let message = posted.nc.find("MSG (\"Drill holes\")").unwrap();
        let optional_stop = posted.nc[message..].find("M1").unwrap() + message;
        let tool_change = posted.nc[optional_stop..].find("T19").unwrap() + optional_stop;
        assert!(shutdown < message && message < optional_stop && optional_stop < tool_change);
        assert!(posted.nc.contains("G4 F0.25"));
        assert_eq!(posted.nc.matches("G0 SUPA Z0 D0").count(), 3);
        assert!(!posted.nc.contains("M6\nD1\nT19\n"));
        assert!(!posted.nc.contains("SP_RP_D"));
    }

    #[test]
    fn siemens_next_tool_preload_is_explicit_and_wraps_to_the_first_tool() {
        let mut source = two_tool_siemens_document();
        source.setups[0]
            .post
            .siemens_828d
            .as_mut()
            .unwrap()
            .preload_next_tool = true;

        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                dialect: None,
                program_name: None,
            },
        )
        .unwrap();

        assert!(posted.nc.contains("T1\nM6\nD1\nT19\nG17 G90 G94"));
        assert!(posted.nc.contains("T19\nM6\nD1\nT1\nG17 G90 G94"));
    }

    #[test]
    fn siemens_next_tool_preload_never_repeats_the_only_tool() {
        let mut source = document(PostDialect::Siemens828d);
        source.setups[0]
            .post
            .siemens_828d
            .as_mut()
            .unwrap()
            .preload_next_tool = true;

        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                dialect: None,
                program_name: None,
            },
        )
        .unwrap();

        assert_eq!(posted.nc.matches("\nT1\n").count(), 1);
    }

    #[test]
    fn siemens_controller_managed_strategy_leaves_station_motion_to_m6() {
        let mut source = two_tool_siemens_document();
        source.setups[0]
            .post
            .siemens_828d
            .as_mut()
            .unwrap()
            .tool_change_positioning = Siemens828dToolChangePositioning::ControllerManaged;

        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                dialect: None,
                program_name: None,
            },
        )
        .unwrap();

        assert!(posted
            .nc
            .contains("M9\nM5\n; M6/PLC CONTROLS TOOL-CHANGE POSITIONING"));
        assert_eq!(posted.nc.matches("G0 SUPA Z0 D0").count(), 2);
    }

    #[test]
    fn siemens_fixed_station_strategy_moves_z_before_machine_xy() {
        let mut source = two_tool_siemens_document();
        let profile = source.setups[0].post.siemens_828d.as_mut().unwrap();
        profile.tool_change_positioning = Siemens828dToolChangePositioning::SupaZThenXy;
        profile.station_x = Some(123.4);
        profile.station_y = Some(-56.7);

        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                dialect: None,
                program_name: None,
            },
        )
        .unwrap();

        assert!(posted
            .nc
            .contains("M9\nM5\nG0 SUPA Z0 D0\nG0 SUPA X123.4 Y-56.7\nD1"));
    }

    #[test]
    fn siemens_fixed_station_strategy_fails_closed_until_both_axes_are_entered() {
        let mut source = two_tool_siemens_document();
        source.setups[0]
            .post
            .siemens_828d
            .as_mut()
            .unwrap()
            .tool_change_positioning = Siemens828dToolChangePositioning::SupaZThenXy;

        let error = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                dialect: None,
                program_name: None,
            },
        )
        .unwrap_err();
        assert!(error.to_string().contains("requires machine X and Y"));
    }

    #[test]
    fn siemens_atc_style_is_informational_and_cannot_silently_change_motion() {
        let source = two_tool_siemens_document();
        let baseline = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                dialect: None,
                program_name: None,
            },
        )
        .unwrap();
        let mut umbrella = source;
        umbrella.setups[0]
            .post
            .siemens_828d
            .as_mut()
            .unwrap()
            .atc_style = Siemens828dAtcStyle::Umbrella;
        let changed = post_setup(
            &umbrella,
            &CamPostRequestDto {
                setup_id: 1,
                dialect: None,
                program_name: None,
            },
        )
        .unwrap();
        assert_eq!(baseline.nc, changed.nc);
    }

    #[test]
    fn older_siemens_profiles_keep_the_original_supa_z_behavior() {
        let profile: Siemens828dPostConfigDto = serde_json::from_str(
            r#"{"supa_retract_z":0.0,"tool_length_offset":1,"optional_stop_on_tool_change":true}"#,
        )
        .unwrap();
        assert_eq!(profile.atc_style, Siemens828dAtcStyle::DoubleArm);
        assert_eq!(
            profile.tool_change_positioning,
            Siemens828dToolChangePositioning::SupaZ
        );
        assert_eq!(profile.station_x, None);
        assert_eq!(profile.station_y, None);
        assert!(!profile.preload_next_tool);
    }

    #[test]
    fn coordinate_format_suppresses_negative_zero_and_noise() {
        assert_eq!(coordinate(-0.000_1), "0");
        assert_eq!(coordinate(12.340), "12.34");
        assert_eq!(coordinate(-2.5), "-2.5");
        assert_eq!(siemens_coordinate(1.234_567), "1.23457");
        assert_eq!(siemens_program_name(" Part 12.mpf "), "PART_12");
    }
}
