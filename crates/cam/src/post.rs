use serde::{Deserialize, Serialize};

use crate::model::{
    CamDocumentDto, CamPostConfigDto, CamUnits, CoolantMode, Point3Dto, PostDialect,
    Siemens828dPostConfigDto, Siemens828dToolChangePositioning, SpindleDirection, WorkOffset,
};
use crate::planner::{plan_setup, CamCommandDto, CamPlanError, CamProgramDto};

/// Converts canonical millimetre motion into the document's output units and
/// formats controller words. Seconds and RPM pass through unchanged.
#[derive(Debug, Clone, Copy)]
struct PostUnits(CamUnits);

impl PostUnits {
    fn len(self, value_mm: f64) -> String {
        coordinate(self.0.from_mm(value_mm))
    }

    fn feed(self, value_mm_per_min: f64) -> String {
        feedrate(self.0.from_mm(value_mm_per_min))
    }

    fn siemens_len(self, value_mm: f64) -> String {
        siemens_coordinate(self.0.from_mm(value_mm))
    }

    /// Modal unit word for the ISO-style posts (`G21` metric / `G20` inch).
    fn iso_mode_word(self) -> &'static str {
        match self.0 {
            CamUnits::Millimeters => "G21",
            CamUnits::Inches => "G20",
        }
    }

    /// SINUMERIK dimensional mode (`G710` metric / `G70` inch).
    fn siemens_mode_word(self) -> &'static str {
        match self.0 {
            CamUnits::Millimeters => "G710",
            CamUnits::Inches => "G70",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamPostRequestDto {
    pub setup_id: u64,
    /// Post configuration chosen at export time. When omitted, the document's
    /// remembered defaults are used. The neutral toolpath program is
    /// dialect-independent; any post can render it.
    #[serde(default)]
    pub post: Option<CamPostConfigDto>,
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

/// Plan and post one setup. The post configuration is chosen at export time
/// (falling back to the document's remembered defaults); the planned motion
/// program itself stays controller-neutral, so any post can render it.
pub fn post_setup(
    document: &CamDocumentDto,
    request: &CamPostRequestDto,
) -> Result<CamPostResultDto, CamPlanError> {
    let program = plan_setup(document, request.setup_id)?;
    if document.setup(request.setup_id).is_none() {
        return Err(CamPlanError(format!(
            "CAM setup {} does not exist",
            request.setup_id
        )));
    }
    let post = request
        .post
        .clone()
        .unwrap_or_else(|| document.post_defaults.clone());
    if let Some(profile) = &post.siemens_828d {
        profile.validate().map_err(CamPlanError)?;
    }
    let dialect = post.dialect;
    let units = PostUnits(document.units);
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
        post.program_number,
        post.sequence_numbers,
        post.siemens_828d.as_ref(),
        units,
    )?;
    let mut warnings = program.warnings.clone();
    if document.units == CamUnits::Inches {
        warnings.push(
            "Posted in inches (G20/G70); confirm the control's dimensional mode and every offset before running."
                .to_string(),
        );
    }
    if program.work_offsets.len() > 1 {
        warnings.push(format!(
            "Program repeats the toolpath under {} ({} parts); verify every fixture offset on the control.",
            program
                .work_offsets
                .iter()
                .map(|offset| offset.code())
                .collect::<Vec<_>>()
                .join(", "),
            program.work_offsets.len(),
        ));
    }
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
            if let Some(profile) = post.siemens_828d.as_ref() {
                format!(
                    "Siemens 828D native output uses G0 SUPA Z{} D0 for machine-coordinate retracts; verify that position, D{}, tool calls, and M-codes on the control before running.",
                    units.len(profile.supa_retract_z),
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
        if let Some(profile) = post.siemens_828d.as_ref() {
            warnings.push(match profile.tool_change_positioning {
                Siemens828dToolChangePositioning::SupaZ => format!(
                    "Before later tool changes, the post commands G0 SUPA Z{} D0 and then M6.",
                    units.len(profile.supa_retract_z)
                ),
                Siemens828dToolChangePositioning::ControllerManaged => {
                    "Before later tool changes, the post emits no machine-axis station move and assumes the machine builder's M6/PLC cycle owns positioning."
                        .to_string()
                }
                Siemens828dToolChangePositioning::SupaZThenXy => format!(
                    "Before later tool changes, the post commands SUPA Z first and then the verified machine station X{} Y{} before M6.",
                    units.len(profile.station_x.unwrap_or_default()),
                    units.len(profile.station_y.unwrap_or_default())
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
    units: PostUnits,
) -> Result<String, CamPlanError> {
    if dialect == PostDialect::Siemens828d {
        let profile = siemens_profile.ok_or_else(|| {
            CamPlanError(
                "Siemens 828D posting requires an explicitly confirmed machine profile with a safe SUPA retract Z"
                    .to_string(),
            )
        })?;
        return render_siemens828d_program(program, program_name, sequence_numbers, profile, units);
    }
    let mut writer = NcWriter::new(sequence_numbers, 10);
    let mut position: Option<Point3Dto> = None;
    for command in &program.commands {
        match command {
            CamCommandDto::ProgramStart { .. } => {
                if dialect == PostDialect::Fanuc {
                    writer.raw("%");
                    writer.raw(&format!("O{:04}", program_number.unwrap_or(1001) % 10_000));
                }
                writer.comment(program_name);
                writer.comment("GENERATED BY NOBS CAD - VERIFY AND DRY RUN");
                writer.block(&format!(
                    "G90 G17 {} G40 G49 G80",
                    units.iso_mode_word()
                ));
                writer.block("M5");
                writer.block("M9");
            }
            CamCommandDto::WorkOffset { offset } => {
                writer.block(offset.code());
            }
            CamCommandDto::SectionStart { name, .. } => writer.comment(name),
            CamCommandDto::ToolChange {
                tool_number,
                tool_name,
                ..
            } => {
                // ISO-style posts call tools numerically (T<n>). A library
                // tool without a number cannot be called this way; fail
                // closed instead of silently emitting a bad block.
                let Some(tool_number) = tool_number else {
                    return Err(CamPlanError(format!(
                        "tool '{tool_name}' has no tool number, but this post calls tools numerically; assign a number in the tool library or post with a name-capable control"
                    )));
                };
                match dialect {
                    PostDialect::Grbl => {
                        writer.block("M5");
                        writer.comment(&format!(
                            "MANUAL TOOL CHANGE: T{tool_number} {tool_name}"
                        ));
                        writer.block("M0");
                    }
                    PostDialect::LinuxCnc | PostDialect::Fanuc | PostDialect::Siemens828d => {
                        writer.comment(tool_name);
                        writer.block(&format!("T{tool_number} M6"));
                    }
                }
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
                    // A combined XYZ rapid from an unknown start can move
                    // diagonally through stock. Establish clearance in Z
                    // before the first XY positioning move.
                    writer.block(&format!("G0 Z{}", units.len(to.z)));
                    writer.block(&format!("G0 X{} Y{}", units.len(to.x), units.len(to.y)));
                } else {
                    writer.block(&format!(
                        "G0 X{} Y{} Z{}",
                        units.len(to.x),
                        units.len(to.y),
                        units.len(to.z)
                    ));
                }
                position = Some(*to);
            }
            CamCommandDto::Linear { to, feed } => {
                writer.block(&format!(
                    "G1 X{} Y{} Z{} F{}",
                    units.len(to.x),
                    units.len(to.y),
                    units.len(to.z),
                    units.feed(*feed)
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
                    units.len(to.x),
                    units.len(to.y),
                    units.len(to.z),
                    units.len(center.x - from.x),
                    units.len(center.y - from.y),
                    units.feed(*feed)
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
    units: PostUnits,
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
            CamCommandDto::ProgramStart { .. } => {
                writer.raw(&format!("; %_N_{}_MPF", siemens_program_name(program_name)));
                writer.raw("; GENERATED BY NOBS CAD - VERIFY, SIMULATE, AND DRY RUN");
                writer.block(&format!("G17 {} G90 G94", units.siemens_mode_word()));
                writer.block("G64");
                writer.block(&siemens_supa_retract(profile, units));
            }
            CamCommandDto::WorkOffset { offset } => {
                work_offset = *offset;
                writer.block(work_offset.code());
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
                    if write_siemens_tool_change_positioning(&mut writer, profile, units)? {
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
                // SINUMERIK calls tools by name (T="..."); the tool number is
                // only the fallback for tools whose name cannot be called.
                let tool_call = siemens_tool_call(tool_name, *tool_number)?;
                writer.raw(&format!(
                    "; {} {}",
                    tool_call,
                    siemens_plain_text(tool_name)
                ));
                writer.block(&tool_call);
                writer.block("M6");
                writer.block(&format!("D{}", profile.tool_length_offset));
                if profile.preload_next_tool {
                    if let Some(next_call) =
                        siemens_next_preload_call(program, index, &tool_call)
                    {
                        writer.block(&next_call);
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
                    writer.block(&format!("G0 Z{}", units.siemens_len(to.z)));
                    writer.block(&format!(
                        "G0 X{} Y{}",
                        units.siemens_len(to.x),
                        units.siemens_len(to.y)
                    ));
                } else {
                    writer.block(&format!(
                        "G0 X{} Y{} Z{}",
                        units.siemens_len(to.x),
                        units.siemens_len(to.y),
                        units.siemens_len(to.z)
                    ));
                }
                position = Some(*to);
            }
            CamCommandDto::Linear { to, feed } => {
                writer.block(&format!(
                    "G1 X{} Y{} Z{} F{}",
                    units.siemens_len(to.x),
                    units.siemens_len(to.y),
                    units.siemens_len(to.z),
                    units.feed(*feed)
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
                    units.siemens_len(to.x),
                    units.siemens_len(to.y),
                    units.siemens_len(to.z),
                    units.siemens_len(center.x - from.x),
                    units.siemens_len(center.y - from.y),
                    units.feed(*feed)
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
                writer.block(&siemens_supa_retract(profile, units));
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

fn siemens_supa_retract(profile: &Siemens828dPostConfigDto, units: PostUnits) -> String {
    format!("G0 SUPA Z{} D0", units.siemens_len(profile.supa_retract_z))
}

/// Emit only the positioning behavior explicitly confirmed in the machine
/// profile. Physical magazine style is intentionally not consulted here.
fn write_siemens_tool_change_positioning(
    writer: &mut NcWriter,
    profile: &Siemens828dPostConfigDto,
    units: PostUnits,
) -> Result<bool, CamPlanError> {
    match profile.tool_change_positioning {
        Siemens828dToolChangePositioning::SupaZ => {
            writer.block(&siemens_supa_retract(profile, units));
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
            writer.block(&siemens_supa_retract(profile, units));
            writer.block(&format!(
                "G0 SUPA X{} Y{}",
                units.siemens_len(x),
                units.siemens_len(y)
            ));
            Ok(true)
        }
    }
}

/// Build the SINUMERIK tool call word. Named tools are called by name
/// (`T="NAME"`, the control's native identifier); the number is the fallback
/// when the name carries no usable identifier, and the call fails closed when
/// the tool has neither.
fn siemens_tool_call(tool_name: &str, tool_number: Option<u32>) -> Result<String, CamPlanError> {
    let mut identifier = String::new();
    for character in tool_name.trim().chars() {
        if identifier.chars().count() >= 31 {
            break;
        }
        if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
            identifier.push(character.to_ascii_uppercase());
        } else {
            identifier.push('_');
        }
    }
    let identifier = identifier.trim_matches('_').to_string();
    if !identifier.is_empty() {
        return Ok(format!("T=\"{identifier}\""));
    }
    match tool_number {
        Some(number) => Ok(format!("T{number}")),
        None => Err(CamPlanError(format!(
            "tool '{tool_name}' has neither a callable name nor a tool number for the Siemens 828D post"
        ))),
    }
}

/// Return the next actual tool change call, wrapping to the program's first
/// tool so repeated program runs can stage it too. A one-tool program never
/// emits a redundant/self preload.
fn siemens_next_preload_call(
    program: &CamProgramDto,
    current_index: usize,
    current_call: &str,
) -> Option<String> {
    let find_call = |commands: &[CamCommandDto]| {
        commands.iter().find_map(|command| match command {
            CamCommandDto::ToolChange {
                tool_number,
                tool_name,
                ..
            } => siemens_tool_call(tool_name, *tool_number).ok(),
            _ => None,
        })
    };
    find_call(&program.commands[current_index + 1..])
        .or_else(|| find_call(&program.commands[..current_index]))
        .filter(|call| call != current_call)
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
        CamOperationDto, CamPostConfigDto, CamSetupDto, CamToolDto, CamToolKind, CamUnits,
        CuttingParametersDto, DrillCycle, Point2Dto, Rect2Dto, Siemens828dAtcStyle, StockBoxDto,
        WcsOriginSpecDto, WorkCoordinateSystemDto, WorkOffset,
    };

    fn document(dialect: PostDialect) -> CamDocumentDto {
        CamDocumentDto {
            setups: vec![CamSetupDto {
                id: 1,
                name: "Fixture A".into(),
                wcs: WorkCoordinateSystemDto::default(),
                wcs_origin: WcsOriginSpecDto::Explicit,
                work_offset: WorkOffset::G54,
                work_offset_count: 1,
                stock_spec: crate::model::CamStockSpecDto::LegacyBox,
                resolved_stock: crate::model::CamResolvedStockDto::Box,
                stock: StockBoxDto {
                    min: Point3Dto::new(0.0, 0.0, -10.0),
                    max: Point3Dto::new(20.0, 20.0, 0.0),
                },
                stock_model_box: None,
                body_ids: vec![],
                legacy_clearance_z: None,
                legacy_retract_z: None,
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
                    clearance_z: 8.0,
                    retract_z: 2.0,
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
                number: Some(1),
                name: "6 mm flat".into(),
                kind: CamToolKind::FlatEndMill,
                diameter: 6.0,
                flute_length: 15.0,
                overall_length: 50.0,
                center_cutting: true,
                flute_count: 4,
                point_angle_degrees: None,
                cutting: CuttingParametersDto::default(),
            }],
            units: CamUnits::Millimeters,
            post_defaults: CamPostConfigDto {
                dialect,
                program_number: Some(42),
                sequence_numbers: false,
                siemens_828d: (dialect == PostDialect::Siemens828d)
                    .then(Siemens828dPostConfigDto::default),
            },
            next_setup_id: 2,
            next_operation_id: 2,
            next_tool_id: 2,
        }
    }

    fn two_tool_siemens_document() -> CamDocumentDto {
        let mut source = document(PostDialect::Siemens828d);
        source.tools.push(CamToolDto {
            id: 2,
            number: Some(19),
            name: "5 mm drill".into(),
            kind: CamToolKind::Drill,
            diameter: 5.0,
            flute_length: 25.0,
            overall_length: 55.0,
            center_cutting: true,
            flute_count: 2,
            point_angle_degrees: None,
            cutting: CuttingParametersDto::default(),
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
            clearance_z: 8.0,
            peck_depth: None,
            dwell_seconds: 0.25,
            cycle: DrillCycle::Drill,
            peck_retract: None,
            thread_pitch: None,
            feed_out: None,
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
                post: None,
                program_name: Some("FACE SAMPLE".into()),
            },
        )
        .unwrap();
        assert!(posted.nc.contains("G90 G17 G21 G40 G49 G80"));
        assert!(posted.nc.contains("M5\nM9\nG54"));
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
                post: None,
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
        source.post_defaults.sequence_numbers = true;
        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                post: None,
                program_name: Some("61047097 op1 v4".to_string()),
            },
        )
        .unwrap();

        assert!(posted.nc.starts_with("; %_N_61047097_OP1_V4_MPF\n"));
        assert!(posted.nc.contains("N10 G17 G710 G90 G94\nN11 G64"));
    assert!(posted.nc.contains("N13 G58\n"));
        assert!(posted.nc.contains("G0 SUPA Z0 D0"));
        assert!(posted.nc.contains("MSG (\"Face top\")"));
        // The 828D calls the tool by its library name, not a bare number.
        assert!(posted.nc.contains("T=\"6_MM_FLAT\"\n"));
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
        source.post_defaults.siemens_828d = None;
        let error = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                post: None,
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
                post: None,
                program_name: None,
            },
        )
        .unwrap();

        let shutdown = posted.nc.find("M9\nM5\nG0 SUPA Z0 D0").unwrap();
        let message = posted.nc.find("MSG (\"Drill holes\")").unwrap();
        let optional_stop = posted.nc[message..].find("M1").unwrap() + message;
        let tool_change = posted.nc[optional_stop..].find("T=\"5_MM_DRILL\"").unwrap() + optional_stop;
        assert!(shutdown < message && message < optional_stop && optional_stop < tool_change);
        assert!(posted.nc.contains("G4 F0.25"));
        assert_eq!(posted.nc.matches("G0 SUPA Z0 D0").count(), 3);
        assert!(!posted.nc.contains("M6\nD1\nT=\"5_MM_DRILL\"\n"));
        assert!(!posted.nc.contains("SP_RP_D"));
    }

    #[test]
    fn siemens_next_tool_preload_is_explicit_and_wraps_to_the_first_tool() {
        let mut source = two_tool_siemens_document();
        source.post_defaults
            .siemens_828d
            .as_mut()
            .unwrap()
            .preload_next_tool = true;

        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                post: None,
                program_name: None,
            },
        )
        .unwrap();

        assert!(posted.nc.contains("T=\"6_MM_FLAT\"\nM6\nD1\nT=\"5_MM_DRILL\"\nG17 G90 G94"));
        assert!(posted.nc.contains("T=\"5_MM_DRILL\"\nM6\nD1\nT=\"6_MM_FLAT\"\nG17 G90 G94"));
    }

    #[test]
    fn siemens_next_tool_preload_never_repeats_the_only_tool() {
        let mut source = document(PostDialect::Siemens828d);
        source.post_defaults
            .siemens_828d
            .as_mut()
            .unwrap()
            .preload_next_tool = true;

        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                post: None,
                program_name: None,
            },
        )
        .unwrap();

        assert_eq!(posted.nc.matches("\nT=\"6_MM_FLAT\"\n").count(), 1);
    }

    #[test]
    fn number_based_posts_fail_closed_when_a_tool_has_no_number() {
        let mut source = document(PostDialect::Fanuc);
        source.tools[0].number = None;
        let error = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                post: None,
                program_name: None,
            },
        )
        .expect_err("a numberless tool must not reach a numeric tool call");
        assert!(error.to_string().contains("no tool number"));
    }

    #[test]
    fn siemens_falls_back_to_the_number_when_the_name_is_not_callable() {
        let mut source = document(PostDialect::Siemens828d);
        source.tools[0].name = "!!!".into();
        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                post: None,
                program_name: None,
            },
        )
        .unwrap();
        assert!(posted.nc.contains("T1\n"));
        assert!(!posted.nc.contains("T=\""));
    }

    #[test]
    fn siemens_named_tool_call_survives_a_missing_number() {
        let mut source = document(PostDialect::Siemens828d);
        source.tools[0].number = None;
        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                post: None,
                program_name: None,
            },
        )
        .unwrap();
        assert!(posted.nc.contains("T=\"6_MM_FLAT\"\n"));
    }

    #[test]
    fn siemens_controller_managed_strategy_leaves_station_motion_to_m6() {
        let mut source = two_tool_siemens_document();
        source.post_defaults
            .siemens_828d
            .as_mut()
            .unwrap()
            .tool_change_positioning = Siemens828dToolChangePositioning::ControllerManaged;

        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                post: None,
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
        let profile = source.post_defaults.siemens_828d.as_mut().unwrap();
        profile.tool_change_positioning = Siemens828dToolChangePositioning::SupaZThenXy;
        profile.station_x = Some(123.4);
        profile.station_y = Some(-56.7);

        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                post: None,
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
        source.post_defaults
            .siemens_828d
            .as_mut()
            .unwrap()
            .tool_change_positioning = Siemens828dToolChangePositioning::SupaZThenXy;

        let error = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                post: None,
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
                post: None,
                program_name: None,
            },
        )
        .unwrap();
        let mut umbrella = source;
        umbrella
            .post_defaults
            .siemens_828d
            .as_mut()
            .unwrap()
            .atc_style = Siemens828dAtcStyle::Umbrella;
        let changed = post_setup(
            &umbrella,
            &CamPostRequestDto {
                setup_id: 1,
                post: None,
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

    #[test]
    fn inch_documents_post_g20_with_converted_lengths_and_feeds() {
        let mut source = document(PostDialect::Grbl);
        source.units = CamUnits::Inches;
        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                post: None,
                program_name: None,
            },
        )
        .unwrap();
        assert!(posted.nc.contains("G90 G17 G20 G40 G49 G80"));
        // 8 mm clearance -> 0.315 in; 600 mm/min -> 23.622 in/min.
        assert!(posted.nc.contains("G0 Z0.315"));
        assert!(posted.nc.contains("F23.622"));
        assert!(!posted.nc.contains("G21"));
        assert!(posted
            .warnings
            .iter()
            .any(|warning| warning.contains("inches")));
    }

    #[test]
    fn inch_documents_post_g70_on_the_siemens_profile() {
        let mut source = document(PostDialect::Siemens828d);
        source.units = CamUnits::Inches;
        let posted = post_setup(
            &source,
            &CamPostRequestDto {
                setup_id: 1,
                post: None,
                program_name: None,
            },
        )
        .unwrap();
        assert!(posted.nc.contains("G17 G70 G90 G94"));
        assert!(!posted.nc.contains("G710"));
    }
}
