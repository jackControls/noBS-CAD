//! Workpiece-only 3-axis G-code interpreter.
//!
//! This is deliberately not a machine emulator. It interprets the final NC
//! text into the same controller-neutral motion consumed by the CAM simulator
//! and fails closed on motion semantics it cannot prove. Machine-coordinate
//! positioning, PLC/macros, tool length offsets, and machine kinematics stay
//! outside the workpiece simulation boundary and are reported explicitly.

use serde::{Deserialize, Serialize};

use crate::model::{
    CamDocumentDto, CamSetupDto, CoolantMode, Point3Dto, SpindleDirection, WorkOffset,
};
use crate::planner::{
    CamArcPlane, CamCommandDto, CamPlanError, CamProgramDto, CamProgramStatsDto,
    RAPID_FEED_ESTIMATE_MM_PER_MIN,
};
use crate::simulation::{
    simulate_program, CamSimulationRequestDto, CamSimulationResultDto, CamSimulationSourceDto,
    CamSimulationTargetDto, CamStockMeshDto,
};

const MAX_GCODE_BYTES: usize = 8 * 1024 * 1024;
const MAX_GCODE_LINES: usize = 500_000;
const MAX_GCODE_COMMANDS: usize = 300_000;
const EPSILON: f64 = 1.0e-9;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamGcodeDialectDto {
    #[default]
    Auto,
    Iso,
    Fanuc,
    Siemens828d,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamGcodeSimulationRequestDto {
    pub setup_id: u64,
    pub source: String,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub dialect: CamGcodeDialectDto,
    #[serde(default)]
    pub voxel_size: Option<f64>,
    #[serde(default)]
    pub max_voxels: Option<usize>,
    #[serde(default)]
    pub stock_mesh: Option<CamStockMeshDto>,
    #[serde(default)]
    pub target: Option<CamSimulationTargetDto>,
    #[serde(default)]
    pub completed_steps: Option<usize>,
}

pub fn simulate_gcode(
    document: &CamDocumentDto,
    request: &CamGcodeSimulationRequestDto,
) -> Result<CamSimulationResultDto, CamPlanError> {
    document.validate().map_err(CamPlanError)?;
    let setup = document.setup(request.setup_id).ok_or_else(|| {
        CamPlanError(format!(
            "CAM setup {} does not exist for G-code simulation",
            request.setup_id
        ))
    })?;
    let parsed = parse_gcode(document, setup, request)?;
    let simulation_request = CamSimulationRequestDto {
        setup_id: request.setup_id,
        voxel_size: request.voxel_size,
        max_voxels: request.max_voxels,
        stock_mesh: request.stock_mesh.clone(),
        target: request.target.clone(),
        through_operation_id: None,
        completed_steps: request.completed_steps,
    };
    simulate_program(
        document,
        setup,
        &parsed.program,
        &simulation_request,
        CamSimulationSourceDto::GCode,
        &parsed.source_lines,
    )
}

struct ParsedGcode {
    program: CamProgramDto,
    source_lines: Vec<Option<u32>>,
}

#[derive(Debug, Clone)]
struct Word {
    address: String,
    value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MotionMode {
    Rapid,
    Linear,
    ClockwiseArc,
    CounterclockwiseArc,
}

#[derive(Debug, Clone, Copy)]
struct Cycle81State {
    retract_plane: f64,
    reference_plane: f64,
    safety_distance: f64,
    depth: f64,
    feed: f64,
}

struct Interpreter<'a> {
    document: &'a CamDocumentDto,
    setup: &'a CamSetupDto,
    dialect: CamGcodeDialectDto,
    commands: Vec<CamCommandDto>,
    source_lines: Vec<Option<u32>>,
    warnings: Vec<String>,
    warned_words: Vec<String>,
    unit_scale: f64,
    absolute: bool,
    plane: CamArcPlane,
    motion: Option<MotionMode>,
    position: Point3Dto,
    known_axes: [bool; 3],
    feed: Option<f64>,
    spindle_rpm: u32,
    pending_tool_id: Option<u64>,
    active_tool_id: Option<u64>,
    active_offset: WorkOffset,
    cycle81: Option<Cycle81State>,
}

fn parse_gcode(
    document: &CamDocumentDto,
    setup: &CamSetupDto,
    request: &CamGcodeSimulationRequestDto,
) -> Result<ParsedGcode, CamPlanError> {
    if request.source.len() > MAX_GCODE_BYTES {
        return Err(CamPlanError(format!(
            "G-code source exceeds the {MAX_GCODE_BYTES}-byte safety limit"
        )));
    }
    let line_count = request.source.lines().count();
    if line_count > MAX_GCODE_LINES {
        return Err(CamPlanError(format!(
            "G-code source exceeds the {MAX_GCODE_LINES}-line safety limit"
        )));
    }
    let dialect = resolve_dialect(request);
    let program_name = request
        .file_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("G-code simulation")
        .to_string();
    let mut interpreter = Interpreter {
        document,
        setup,
        dialect,
        commands: vec![CamCommandDto::ProgramStart {
            name: program_name.clone(),
            work_offset: setup.work_offset,
        }],
        source_lines: vec![None],
        warnings: vec![
            "G-code simulation is workpiece-only: machine-coordinate positioning, PLC/macros, tool-length offsets, fixtures, and machine kinematics are not executed."
                .to_string(),
        ],
        warned_words: Vec::new(),
        unit_scale: 1.0,
        absolute: true,
        plane: CamArcPlane::Xy,
        motion: None,
        position: Point3Dto::new(0.0, 0.0, 0.0),
        known_axes: [false; 3],
        feed: None,
        spindle_rpm: 0,
        pending_tool_id: None,
        active_tool_id: None,
        active_offset: setup.work_offset,
        cycle81: None,
    };
    interpreter.push(
        CamCommandDto::WorkOffset {
            offset: setup.work_offset,
        },
        None,
    );

    let mut comment_depth = 0usize;
    for (index, raw) in request.source.lines().enumerate() {
        let physical_line = u32::try_from(index + 1).unwrap_or(u32::MAX);
        if comment_depth == 0
            && interpreter.interpret_siemens_cycle_control(physical_line, raw.trim())?
        {
            interpreter.check_command_limit(physical_line)?;
            continue;
        }
        let stripped = strip_comments(raw, &mut comment_depth);
        interpreter.interpret_line(physical_line, stripped.trim())?;
        interpreter.check_command_limit(physical_line)?;
    }
    if comment_depth != 0 {
        return Err(CamPlanError(
            "G-code source ends inside a parenthesized comment".to_string(),
        ));
    }
    interpreter.finish(program_name)
}

fn resolve_dialect(request: &CamGcodeSimulationRequestDto) -> CamGcodeDialectDto {
    if request.dialect != CamGcodeDialectDto::Auto {
        return request.dialect;
    }
    let upper = request.source.to_ascii_uppercase();
    let siemens_name = request
        .file_name
        .as_deref()
        .is_some_and(|name| name.to_ascii_lowercase().ends_with(".mpf"));
    if siemens_name
        || upper.contains("G710")
        || contains_nc_word(&upper, "SUPA")
        || upper.contains("CR=")
        || upper.contains("NORM")
    {
        CamGcodeDialectDto::Siemens828d
    } else {
        CamGcodeDialectDto::Iso
    }
}

fn contains_nc_word(source: &str, needle: &str) -> bool {
    source.match_indices(needle).any(|(index, value)| {
        let before = source[..index].chars().next_back();
        let after = source[index + value.len()..].chars().next();
        before.is_none_or(|character| !character.is_ascii_alphanumeric() && character != '_')
            && after.is_none_or(|character| !character.is_ascii_alphanumeric() && character != '_')
    })
}

impl Interpreter<'_> {
    fn push(&mut self, command: CamCommandDto, source_line: Option<u32>) {
        self.commands.push(command);
        self.source_lines.push(source_line);
    }

    fn warn_once(&mut self, key: impl Into<String>, message: impl Into<String>) {
        let key = key.into();
        if self.warned_words.iter().any(|seen| seen == &key) {
            return;
        }
        self.warned_words.push(key);
        self.warnings.push(message.into());
    }

    fn check_command_limit(&self, line: u32) -> Result<(), CamPlanError> {
        if self.commands.len() > MAX_GCODE_COMMANDS {
            return Err(line_error(
                line,
                format!("interpreted motion exceeds the {MAX_GCODE_COMMANDS}-command safety limit"),
            ));
        }
        Ok(())
    }

    fn interpret_siemens_cycle_control(
        &mut self,
        physical_line: u32,
        raw: &str,
    ) -> Result<bool, CamPlanError> {
        if self.dialect != CamGcodeDialectDto::Siemens828d {
            return Ok(false);
        }
        let block = raw.split(';').next().unwrap_or(raw).trim();
        let upper = block.to_ascii_uppercase();
        let Some(mcall_index) = upper.find("MCALL") else {
            return Ok(false);
        };
        let before = upper[..mcall_index].trim();
        if !(before.is_empty()
            || before.starts_with('N') && before[1..].chars().all(|value| value.is_ascii_digit()))
        {
            return Ok(false);
        }
        let source_line = before
            .strip_prefix('N')
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(physical_line);
        let after = block[mcall_index + "MCALL".len()..].trim();
        if after.is_empty() {
            self.cycle81 = None;
            return Ok(true);
        }
        let upper_after = after.to_ascii_uppercase();
        if !upper_after.starts_with("CYCLE81") {
            return Err(line_error(
                source_line,
                "only modal CYCLE81 drilling is implemented in this simulator slice",
            ));
        }
        if self.plane != CamArcPlane::Xy {
            return Err(line_error(
                source_line,
                "CYCLE81 is currently supported only with the normal G17 drilling axis",
            ));
        }
        let open = after.find('(').ok_or_else(|| {
            line_error(
                source_line,
                "CYCLE81 requires a parenthesized parameter list",
            )
        })?;
        let close = after
            .rfind(')')
            .ok_or_else(|| line_error(source_line, "CYCLE81 parameter list is not closed"))?;
        if close <= open || !after[close + 1..].trim().is_empty() {
            return Err(line_error(source_line, "invalid CYCLE81 call syntax"));
        }
        let parameters = after[open + 1..close]
            .split(',')
            .map(|parameter| {
                let parameter = parameter.trim();
                if parameter.is_empty() {
                    Ok(None)
                } else {
                    parameter.parse::<f64>().map(Some).map_err(|_| {
                        line_error(
                            source_line,
                            format!("CYCLE81 parameter '{parameter}' is not numeric"),
                        )
                    })
                }
            })
            .collect::<Result<Vec<_>, _>>()?;
        if parameters.len() < 5 || parameters.len() > 8 {
            return Err(line_error(
                source_line,
                "CYCLE81 requires five standard parameters and at most three extended-mode parameters",
            ));
        }
        if parameters.len() > 5 {
            let extended = parameters[5..]
                .iter()
                .map(|value| value.unwrap_or(0.0))
                .collect::<Vec<_>>();
            if extended != [0.0, 0.0, 10.0] {
                return Err(line_error(
                    source_line,
                    "this CYCLE81 extended mode is not yet supported (expected GMODE=0, DMODE=0, AMODE=10)",
                ));
            }
        }
        let required = |index: usize, name: &str| {
            parameters[index]
                .filter(|value| value.is_finite())
                .ok_or_else(|| line_error(source_line, format!("CYCLE81 {name} is required")))
        };
        let scale = self.unit_scale;
        let retract_plane = required(0, "RTP")? * scale;
        let reference_plane = required(1, "RFP")? * scale;
        let safety_distance = required(2, "SDIS")? * scale;
        if safety_distance < 0.0 {
            return Err(line_error(
                source_line,
                "CYCLE81 SDIS safety distance must be non-negative",
            ));
        }
        let direction = (retract_plane - reference_plane).signum();
        if direction.abs() <= EPSILON {
            return Err(line_error(
                source_line,
                "CYCLE81 retract and reference planes must be different",
            ));
        }
        let absolute_depth = parameters[3].filter(|value| value.is_finite());
        let relative_depth = parameters[4].filter(|value| value.is_finite());
        let depth = match (absolute_depth, relative_depth) {
            (Some(value), _) => value * scale,
            (None, Some(value)) if value >= 0.0 => reference_plane - direction * value * scale,
            _ => {
                return Err(line_error(
                    source_line,
                    "CYCLE81 needs absolute DP or non-negative relative DPR",
                ));
            }
        };
        if (depth - reference_plane) * direction >= -EPSILON {
            return Err(line_error(
                source_line,
                "CYCLE81 final depth must lie beyond the reference plane, away from the retract plane",
            ));
        }
        let feed = self
            .feed
            .ok_or_else(|| line_error(source_line, "CYCLE81 has no modal feed F for drilling"))?;
        if self.active_tool_id.is_none() {
            return Err(line_error(
                source_line,
                "CYCLE81 occurs before a library tool is activated by T... M6",
            ));
        }
        self.cycle81 = Some(Cycle81State {
            retract_plane,
            reference_plane,
            safety_distance,
            depth,
            feed,
        });
        self.warn_once(
            "cycle81-expanded",
            "Modal Siemens CYCLE81 drilling is expanded to explicit rapid/feed/retract motion for workpiece simulation.",
        );
        Ok(true)
    }

    fn interpret_line(&mut self, physical_line: u32, line: &str) -> Result<(), CamPlanError> {
        if line.is_empty() || line == "%" || line.starts_with('%') || line.starts_with("$PATH") {
            return Ok(());
        }
        let words = lex_words(line).map_err(|message| line_error(physical_line, message))?;
        if words.is_empty() {
            return Ok(());
        }
        let source_line = words
            .iter()
            .find(|word| word.address == "N")
            .and_then(|word| word.value.parse::<u32>().ok())
            .unwrap_or(physical_line);

        let mut g_codes = Vec::<i32>::new();
        let mut m_codes = Vec::<i32>::new();
        let mut axes = [None::<f64>; 3];
        let mut centers = [None::<f64>; 3];
        let mut radius = None::<f64>;
        let mut feed_word = None::<f64>;
        let mut spindle_word = None::<f64>;
        let mut p_dwell_word = None::<f64>;
        let mut tool_word = None::<String>;
        let mut machine_coordinate_block = false;
        let mut comp_change = None::<Option<bool>>;
        let mut unknown = Vec::<String>::new();

        for word in &words {
            let number = || parse_word_number(word, source_line);
            match word.address.as_str() {
                "N" => {}
                "G" => {
                    let value = number()?;
                    let rounded = value.round();
                    if (value - rounded).abs() > EPSILON {
                        return Err(line_error(
                            source_line,
                            format!("fractional G code G{} is not supported", word.value),
                        ));
                    }
                    g_codes.push(rounded as i32);
                }
                "M" => {
                    let value = number()?;
                    let rounded = value.round();
                    if (value - rounded).abs() > EPSILON {
                        return Err(line_error(
                            source_line,
                            format!("fractional M code M{} is not supported", word.value),
                        ));
                    }
                    m_codes.push(rounded as i32);
                }
                "X" => axes[0] = Some(number()?),
                "Y" => axes[1] = Some(number()?),
                "Z" => axes[2] = Some(number()?),
                "I" => centers[0] = Some(number()?),
                "J" => centers[1] = Some(number()?),
                "K" => centers[2] = Some(number()?),
                "R" | "CR" => radius = Some(number()?),
                "F" => {
                    let value = number()?;
                    feed_word = Some(value);
                }
                "P" => p_dwell_word = Some(number()?),
                "S" => spindle_word = Some(number()?),
                "T" => tool_word = Some(word.value.clone()),
                "D" | "H" => {
                    self.warn_once(
                        "tool-offset-register",
                        "D/H tool-offset registers are acknowledged but not applied; the selected library tool supplies the physical cutter envelope.",
                    );
                }
                "SUPA" => machine_coordinate_block = true,
                "NORM" => {}
                "KONT" | "KONTC" | "KONTT" => {
                    return Err(line_error(
                        source_line,
                        format!(
                            "{} compensation transition is controller-specific; use NORM or supply already compensated tool-center motion",
                            word.address
                        ),
                    ));
                }
                "A" | "B" | "C" | "U" | "V" | "W" => {
                    return Err(line_error(
                        source_line,
                        format!(
                            "{}-axis motion is outside the 3-axis workpiece simulator",
                            word.address
                        ),
                    ));
                }
                "L" | "Q" => unknown.push(word.address.clone()),
                address
                    if address.starts_with("CYCLE")
                        || address == "MCALL"
                        || address == "CALL"
                        || address == "IF"
                        || address == "GOTO"
                        || address == "REPEAT" =>
                {
                    return Err(line_error(
                        source_line,
                        format!(
                            "{address} requires controller execution and is not yet interpretable"
                        ),
                    ));
                }
                address => unknown.push(address.to_string()),
            }
        }

        for code in g_codes {
            match code {
                0 => self.motion = Some(MotionMode::Rapid),
                1 => self.motion = Some(MotionMode::Linear),
                2 => self.motion = Some(MotionMode::ClockwiseArc),
                3 => self.motion = Some(MotionMode::CounterclockwiseArc),
                4 => {}
                17 => self.plane = CamArcPlane::Xy,
                18 => self.plane = CamArcPlane::Xz,
                19 => self.plane = CamArcPlane::Yz,
                20 | 70 | 700 => self.unit_scale = 25.4,
                21 | 71 | 710 => self.unit_scale = 1.0,
                40 => comp_change = Some(None),
                41 => comp_change = Some(Some(true)),
                42 => comp_change = Some(Some(false)),
                53 => machine_coordinate_block = true,
                54..=59 => {
                    let offset = WorkOffset::from_index((code - 54) as u8)
                        .expect("G54..G59 map directly");
                    self.active_offset = offset;
                    self.push(CamCommandDto::WorkOffset { offset }, Some(source_line));
                    if offset != self.setup.work_offset {
                        self.warn_once(
                            format!("work-offset-{code}"),
                            format!(
                                "G{code} is interpreted in the selected setup frame; machine fixture-offset displacement is not available to the workpiece-only simulator."
                            ),
                        );
                    }
                }
                64 | 645 | 60 | 601 | 602 | 603 | 9 | 61 | 80 => self.warn_once(
                    format!("g{code}"),
                    format!("G{code} path-control behavior does not change the geometric workpiece simulation."),
                ),
                90 => self.absolute = true,
                91 => self.absolute = false,
                94 => {}
                43 | 44 | 49 => self.warn_once(
                    "tool-length-compensation",
                    "Tool-length compensation is not applied in workpiece-only mode; programmed XYZ is treated as the tool-tip path.",
                ),
                93 | 95 => {
                    return Err(line_error(
                        source_line,
                        format!("G{code} feed mode is not supported; use feed-per-minute G94"),
                    ));
                }
                81..=89 => {
                    return Err(line_error(
                        source_line,
                        format!("G{code} canned-cycle expansion is not implemented yet"),
                    ));
                }
                _ => {
                    return Err(line_error(
                        source_line,
                        format!("G{code} is not supported by the workpiece interpreter"),
                    ));
                }
            }
        }

        if let Some(raw) = tool_word {
            self.pending_tool_id = Some(
                resolve_tool(self.document, &raw)
                    .map_err(|message| line_error(source_line, message))?,
            );
        }

        if let Some(value) = spindle_word {
            if !value.is_finite() || value < 0.0 || value > u32::MAX as f64 {
                return Err(line_error(
                    source_line,
                    "spindle speed must be finite and non-negative",
                ));
            }
            self.spindle_rpm = value.round() as u32;
        }

        for code in m_codes {
            match code {
                3 => self.push(
                    CamCommandDto::Spindle {
                        direction: SpindleDirection::Clockwise,
                        rpm: self.spindle_rpm,
                    },
                    Some(source_line),
                ),
                4 => self.push(
                    CamCommandDto::Spindle {
                        direction: SpindleDirection::Counterclockwise,
                        rpm: self.spindle_rpm,
                    },
                    Some(source_line),
                ),
                5 => self.push(
                    CamCommandDto::Spindle {
                        direction: SpindleDirection::Off,
                        rpm: 0,
                    },
                    Some(source_line),
                ),
                6 => {
                    let tool_id = self.pending_tool_id.ok_or_else(|| {
                        line_error(source_line, "M6 has no preceding T tool call")
                    })?;
                    let tool = self.document.tool(tool_id).ok_or_else(|| {
                        line_error(source_line, "resolved tool disappeared from the library")
                    })?;
                    self.push(
                        CamCommandDto::ToolChange {
                            tool_id,
                            tool_number: tool.number,
                            tool_name: tool.name.clone(),
                        },
                        Some(source_line),
                    );
                    self.active_tool_id = Some(tool_id);
                    // Tool-change station motion and the new length offset are
                    // machine responsibilities. Re-establish the workpiece
                    // tool-tip pose from subsequent programmed XYZ instead of
                    // inventing a sweep across that hidden machine motion.
                    self.known_axes = [false; 3];
                }
                7 => self.push(
                    CamCommandDto::Coolant {
                        mode: CoolantMode::Mist,
                    },
                    Some(source_line),
                ),
                8 => self.push(
                    CamCommandDto::Coolant {
                        mode: CoolantMode::Flood,
                    },
                    Some(source_line),
                ),
                9 => self.push(
                    CamCommandDto::Coolant {
                        mode: CoolantMode::Off,
                    },
                    Some(source_line),
                ),
                0 | 1 => self.warn_once(
                    format!("m{code}"),
                    format!("M{code} program stop is represented in the timeline without operator-resume timing."),
                ),
                17 | 30 => {}
                _ => self.warn_once(
                    format!("m{code}"),
                    format!("M{code} is machine/PLC behavior and is not executed by workpiece-only simulation."),
                ),
            }
        }

        if machine_coordinate_block {
            if axes.iter().any(Option::is_some) {
                for (axis, value) in axes.iter().enumerate() {
                    if value.is_some() {
                        self.known_axes[axis] = false;
                    }
                }
                self.warn_once(
                    "machine-coordinate-motion",
                    "SUPA/G53 machine-coordinate motion is excluded; playback begins after a complete XYZ tool-tip position is established in the selected workpiece frame.",
                );
            }
            return Ok(());
        }

        if !unknown.is_empty() {
            let list = unknown.join(", ");
            if axes.iter().any(Option::is_some) {
                return Err(line_error(
                    source_line,
                    format!("unrecognized words on a motion block: {list}"),
                ));
            }
            self.warn_once(
                format!("unknown-{list}"),
                format!("Non-motion controller word(s) ignored: {list}."),
            );
        }

        if let Some(change) = comp_change {
            self.push(
                match change {
                    Some(left) => CamCommandDto::CutterCompensationOn { left },
                    None => CamCommandDto::CutterCompensationOff,
                },
                Some(source_line),
            );
        }

        let dwell_block = words
            .iter()
            .any(|word| word.address == "G" && word.value.parse::<f64>().ok() == Some(4.0));
        if let Some(raw) = feed_word.filter(|_| !dwell_block) {
            if !raw.is_finite() || raw <= 0.0 {
                return Err(line_error(source_line, "feed must be finite and positive"));
            }
            self.feed = Some(raw * self.unit_scale);
        }

        if dwell_block {
            let seconds = match self.dialect {
                CamGcodeDialectDto::Siemens828d => p_dwell_word.or(feed_word).ok_or_else(|| {
                    line_error(source_line, "Siemens G4 dwell requires P or F seconds")
                })?,
                CamGcodeDialectDto::Fanuc => {
                    p_dwell_word.ok_or_else(|| {
                        line_error(source_line, "Fanuc G4 dwell requires P milliseconds")
                    })? / 1_000.0
                }
                CamGcodeDialectDto::Auto | CamGcodeDialectDto::Iso => p_dwell_word
                    .ok_or_else(|| line_error(source_line, "ISO G4 dwell requires P seconds"))?,
            };
            if !seconds.is_finite() || seconds < 0.0 {
                return Err(line_error(
                    source_line,
                    "dwell time must be finite and non-negative",
                ));
            }
            self.push(CamCommandDto::Dwell { seconds }, Some(source_line));
            return Ok(());
        }

        if self.cycle81.is_some() && axes.iter().any(Option::is_some) {
            if centers.iter().any(Option::is_some) || radius.is_some() {
                return Err(line_error(
                    source_line,
                    "a modal CYCLE81 position block cannot also contain arc geometry",
                ));
            }
            return self.execute_cycle81_position(axes, source_line);
        }

        if axes.iter().all(Option::is_none) {
            return Ok(());
        }
        let had_complete_pose = self.known_axes.iter().all(|known| *known);
        let arc_plane = self.arc_plane_for_block(axes);
        let target = self.resolve_target(axes, source_line)?;
        if !had_complete_pose {
            self.position = target;
            if self.known_axes.iter().all(|known| *known) {
                // Establish the workpiece pose without inventing a physical
                // sweep across excluded machine/tool-change motion.
                self.push(CamCommandDto::SetPosition { to: target }, Some(source_line));
            }
            self.warn_once(
                "initial-pose",
                "The first incomplete workpiece moves establish the initial XYZ tool-tip pose and are not swept through stock.",
            );
            return Ok(());
        }

        let motion = self.motion.ok_or_else(|| {
            line_error(
                source_line,
                "axis words appear before a G0/G1/G2/G3 motion mode",
            )
        })?;
        let command = match motion {
            MotionMode::Rapid => CamCommandDto::Rapid { to: target },
            MotionMode::Linear => {
                if self.active_tool_id.is_none() {
                    return Err(line_error(
                        source_line,
                        "cutting motion occurs before a library tool is activated by T... M6",
                    ));
                }
                CamCommandDto::Linear {
                    to: target,
                    feed: self
                        .feed
                        .ok_or_else(|| line_error(source_line, "G1 motion has no modal feed F"))?,
                }
            }
            MotionMode::ClockwiseArc | MotionMode::CounterclockwiseArc => {
                if self.active_tool_id.is_none() {
                    return Err(line_error(
                        source_line,
                        "circular cutting motion occurs before a library tool is activated by T... M6",
                    ));
                }
                let clockwise = motion == MotionMode::ClockwiseArc;
                let center = resolve_arc_center(
                    self.position,
                    target,
                    ArcGeometryWords {
                        offsets: centers,
                        radius,
                    },
                    self.unit_scale,
                    arc_plane,
                    clockwise,
                    source_line,
                )?;
                CamCommandDto::Circular {
                    clockwise,
                    plane: arc_plane,
                    center,
                    to: target,
                    feed: self.feed.ok_or_else(|| {
                        line_error(source_line, "G2/G3 motion has no modal feed F")
                    })?,
                }
            }
        };
        self.push(command, Some(source_line));
        self.position = target;
        Ok(())
    }

    fn execute_cycle81_position(
        &mut self,
        axes: [Option<f64>; 3],
        source_line: u32,
    ) -> Result<(), CamPlanError> {
        let cycle = self
            .cycle81
            .expect("caller checks that the modal cycle is active");
        if axes[2].is_some() {
            return Err(line_error(
                source_line,
                "G17 CYCLE81 position blocks may program X/Y but not a separate Z target",
            ));
        }
        let had_complete_pose = self.known_axes.iter().all(|known| *known);
        let position_target = self.resolve_target(axes, source_line)?;
        if !had_complete_pose {
            return Err(line_error(
                source_line,
                "CYCLE81 needs a complete XYZ tool-tip pose before its first hole",
            ));
        }
        if distance(self.position, position_target) > EPSILON {
            let positioning = match self.motion {
                Some(MotionMode::Rapid) => CamCommandDto::Rapid {
                    to: position_target,
                },
                Some(MotionMode::Linear) => CamCommandDto::Linear {
                    to: position_target,
                    feed: self.feed.ok_or_else(|| {
                        line_error(source_line, "cycle-positioning G1 move has no modal feed F")
                    })?,
                },
                Some(MotionMode::ClockwiseArc | MotionMode::CounterclockwiseArc) => {
                    return Err(line_error(
                        source_line,
                        "CYCLE81 hole positioning cannot use a modal circular move",
                    ));
                }
                None => {
                    return Err(line_error(
                        source_line,
                        "CYCLE81 hole positioning has no modal G0/G1 motion",
                    ));
                }
            };
            self.push(positioning, Some(source_line));
        }
        let direction = (cycle.retract_plane - cycle.reference_plane).signum();
        let approach_z = cycle.reference_plane + direction * cycle.safety_distance;
        let approach = Point3Dto::new(position_target.x, position_target.y, approach_z);
        if distance(position_target, approach) > EPSILON {
            self.push(CamCommandDto::Rapid { to: approach }, Some(source_line));
        }
        let depth = Point3Dto::new(position_target.x, position_target.y, cycle.depth);
        self.push(
            CamCommandDto::Linear {
                to: depth,
                feed: cycle.feed,
            },
            Some(source_line),
        );
        let retract = Point3Dto::new(position_target.x, position_target.y, cycle.retract_plane);
        self.push(CamCommandDto::Rapid { to: retract }, Some(source_line));
        self.position = retract;
        Ok(())
    }

    /// SINUMERIK permits a circular block outside the modal working plane:
    /// when exactly two endpoint axes are programmed, those axis identifiers
    /// define the circle plane. Three explicitly programmed axes retain the
    /// modal plane and form a helix. ISO mode remains deliberately strict and
    /// always follows G17/G18/G19.
    fn arc_plane_for_block(&self, axes: [Option<f64>; 3]) -> CamArcPlane {
        if self.dialect != CamGcodeDialectDto::Siemens828d {
            return self.plane;
        }
        match axes.map(|axis| axis.is_some()) {
            [true, true, false] => CamArcPlane::Xy,
            [true, false, true] => CamArcPlane::Xz,
            [false, true, true] => CamArcPlane::Yz,
            _ => self.plane,
        }
    }

    fn resolve_target(
        &mut self,
        axes: [Option<f64>; 3],
        line: u32,
    ) -> Result<Point3Dto, CamPlanError> {
        let mut values = [self.position.x, self.position.y, self.position.z];
        for axis in 0..3 {
            let Some(raw) = axes[axis] else {
                continue;
            };
            if !raw.is_finite() {
                return Err(line_error(line, "axis coordinates must be finite"));
            }
            let value = raw * self.unit_scale;
            if self.absolute {
                values[axis] = value;
            } else {
                if !self.known_axes[axis] {
                    return Err(line_error(
                        line,
                        "incremental motion cannot establish an unknown initial axis",
                    ));
                }
                values[axis] += value;
            }
            self.known_axes[axis] = true;
        }
        Ok(Point3Dto::new(values[0], values[1], values[2]))
    }

    fn finish(mut self, program_name: String) -> Result<ParsedGcode, CamPlanError> {
        self.push(CamCommandDto::ProgramEnd, None);
        if self.commands.iter().all(|command| {
            !matches!(
                command,
                CamCommandDto::Rapid { .. }
                    | CamCommandDto::Linear { .. }
                    | CamCommandDto::Circular { .. }
            )
        }) {
            return Err(CamPlanError(
                "G-code program contains no interpretable 3-axis motion".to_string(),
            ));
        }
        let stats = program_stats(&self.commands);
        Ok(ParsedGcode {
            program: CamProgramDto {
                setup_id: self.setup.id,
                name: program_name,
                commands: self.commands,
                stats,
                per_operation: Vec::new(),
                work_offsets: vec![self.active_offset],
                warnings: self.warnings,
            },
            source_lines: self.source_lines,
        })
    }
}

fn resolve_tool(document: &CamDocumentDto, raw: &str) -> Result<u64, String> {
    let trimmed = raw.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        return Err("T tool call is empty".to_string());
    }
    if let Ok(number) = trimmed.parse::<u32>() {
        return document
            .tools
            .iter()
            .find(|tool| tool.number == Some(number))
            .map(|tool| tool.id)
            .ok_or_else(|| {
                format!("T{number} has no matching tool number in the project library")
            });
    }
    let wanted = normalized_tool_name(trimmed);
    document
        .tools
        .iter()
        .find(|tool| normalized_tool_name(&tool.name) == wanted)
        .map(|tool| tool.id)
        .ok_or_else(|| format!("T=\"{trimmed}\" has no matching project-library tool name"))
}

fn normalized_tool_name(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .split('_')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("_")
}

#[derive(Debug, Clone, Copy)]
struct ArcGeometryWords {
    offsets: [Option<f64>; 3],
    radius: Option<f64>,
}

fn resolve_arc_center(
    start: Point3Dto,
    end: Point3Dto,
    geometry: ArcGeometryWords,
    unit_scale: f64,
    plane: CamArcPlane,
    clockwise: bool,
    line: u32,
) -> Result<Point3Dto, CamPlanError> {
    let ArcGeometryWords { offsets, radius } = geometry;
    let has_offsets = offsets.iter().any(Option::is_some);
    if has_offsets && radius.is_some() {
        return Err(line_error(line, "arc cannot specify both I/J/K and R/CR"));
    }
    if has_offsets {
        let offset = offsets.map(|value| value.unwrap_or(0.0) * unit_scale);
        let mut center = start;
        let required = match plane {
            CamArcPlane::Xy => {
                center.x += offset[0];
                center.y += offset[1];
                offsets[0].is_some() || offsets[1].is_some()
            }
            CamArcPlane::Xz => {
                center.x += offset[0];
                center.z += offset[2];
                offsets[0].is_some() || offsets[2].is_some()
            }
            CamArcPlane::Yz => {
                center.y += offset[1];
                center.z += offset[2];
                offsets[1].is_some() || offsets[2].is_some()
            }
        };
        if !required {
            return Err(line_error(
                line,
                "arc center has no offsets in the active plane",
            ));
        }
        return Ok(center);
    }
    let radius = radius.ok_or_else(|| line_error(line, "G2/G3 requires I/J/K or R/CR"))?;
    center_from_radius(start, end, radius * unit_scale, plane, clockwise)
        .map_err(|message| line_error(line, message))
}

fn center_from_radius(
    start: Point3Dto,
    end: Point3Dto,
    signed_radius: f64,
    plane: CamArcPlane,
    clockwise: bool,
) -> Result<Point3Dto, String> {
    if !signed_radius.is_finite() || signed_radius.abs() <= EPSILON {
        return Err("arc radius must be finite and non-zero".to_string());
    }
    let [su, sv, sw] = arc_components(start, plane);
    let [eu, ev, _] = arc_components(end, plane);
    let du = eu - su;
    let dv = ev - sv;
    let chord = du.hypot(dv);
    let radius = signed_radius.abs();
    if chord <= EPSILON {
        return Err("radius-form full circles are ambiguous; use I/J/K".to_string());
    }
    if chord > 2.0 * radius + 1.0e-7 {
        return Err(format!(
            "arc chord {chord:.6} exceeds diameter {:.6}",
            radius * 2.0
        ));
    }
    let midpoint = [(su + eu) * 0.5, (sv + ev) * 0.5];
    let height = (radius * radius - (chord * 0.5).powi(2)).max(0.0).sqrt();
    let perpendicular = [-dv / chord, du / chord];
    let candidates = [
        [
            midpoint[0] + perpendicular[0] * height,
            midpoint[1] + perpendicular[1] * height,
        ],
        [
            midpoint[0] - perpendicular[0] * height,
            midpoint[1] - perpendicular[1] * height,
        ],
    ];
    let wants_long = signed_radius < 0.0;
    let selected = candidates
        .iter()
        .find(|candidate| {
            let sweep = oriented_sweep(su, sv, eu, ev, candidate[0], candidate[1], clockwise);
            if wants_long {
                sweep.abs() > std::f64::consts::PI + 1.0e-7
            } else {
                sweep.abs() <= std::f64::consts::PI + 1.0e-7
            }
        })
        .copied()
        .unwrap_or(candidates[0]);
    Ok(point_from_arc_components(
        selected[0],
        selected[1],
        sw,
        plane,
    ))
}

fn oriented_sweep(su: f64, sv: f64, eu: f64, ev: f64, cu: f64, cv: f64, clockwise: bool) -> f64 {
    let start = (sv - cv).atan2(su - cu);
    let end = (ev - cv).atan2(eu - cu);
    let mut sweep = end - start;
    if clockwise {
        while sweep >= 0.0 {
            sweep -= std::f64::consts::TAU;
        }
    } else {
        while sweep <= 0.0 {
            sweep += std::f64::consts::TAU;
        }
    }
    sweep
}

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

fn program_stats(commands: &[CamCommandDto]) -> CamProgramStatsDto {
    let mut stats = CamProgramStatsDto::default();
    let mut position = None::<Point3Dto>;
    for command in commands {
        match command {
            CamCommandDto::SetPosition { to } => position = Some(*to),
            CamCommandDto::Rapid { to } => {
                if let Some(from) = position {
                    let length = distance(from, *to);
                    stats.rapid_distance += length;
                    stats.estimated_seconds += length / RAPID_FEED_ESTIMATE_MM_PER_MIN * 60.0;
                }
                position = Some(*to);
            }
            CamCommandDto::Linear { to, feed } => {
                if let Some(from) = position {
                    let length = distance(from, *to);
                    stats.cutting_distance += length;
                    stats.estimated_seconds += length / *feed * 60.0;
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
                if let Some(from) = position {
                    let [su, sv, sw] = arc_components(from, *plane);
                    let [eu, ev, ew] = arc_components(*to, *plane);
                    let [cu, cv, _] = arc_components(*center, *plane);
                    let radius = (su - cu).hypot(sv - cv);
                    let sweep = oriented_sweep(su, sv, eu, ev, cu, cv, *clockwise);
                    let length = (radius * sweep.abs()).hypot(ew - sw);
                    stats.cutting_distance += length;
                    stats.estimated_seconds += length / *feed * 60.0;
                }
                position = Some(*to);
            }
            CamCommandDto::Dwell { seconds } => stats.estimated_seconds += seconds,
            CamCommandDto::SectionStart { .. } => stats.operation_count += 1,
            _ => {}
        }
    }
    stats
}

fn strip_comments(line: &str, depth: &mut usize) -> String {
    let mut result = String::with_capacity(line.len());
    let mut quoted = false;
    for character in line.chars() {
        if character == '"' && *depth == 0 {
            quoted = !quoted;
            result.push(character);
            continue;
        }
        if !quoted {
            if character == ';' && *depth == 0 {
                break;
            }
            if character == '(' {
                *depth += 1;
                continue;
            }
            if character == ')' && *depth > 0 {
                *depth -= 1;
                continue;
            }
        }
        if *depth == 0 {
            result.push(character);
        }
    }
    result
}

fn lex_words(line: &str) -> Result<Vec<Word>, String> {
    let chars = line.chars().collect::<Vec<_>>();
    let mut words = Vec::new();
    let mut index = 0usize;
    while index < chars.len() {
        while index < chars.len() && (chars[index].is_whitespace() || chars[index] == '/') {
            index += 1;
        }
        if index >= chars.len() {
            break;
        }
        if !chars[index].is_ascii_alphabetic() && chars[index] != '_' {
            return Err(format!("unexpected character '{}'", chars[index]));
        }
        let address_start = index;
        index += 1;
        while index < chars.len() && (chars[index].is_ascii_alphabetic() || chars[index] == '_') {
            index += 1;
        }
        let address = chars[address_start..index]
            .iter()
            .collect::<String>()
            .to_ascii_uppercase();
        if index < chars.len() && chars[index] == '=' {
            index += 1;
        }
        let value = if index < chars.len() && chars[index] == '"' {
            index += 1;
            let start = index;
            while index < chars.len() && chars[index] != '"' {
                index += 1;
            }
            if index >= chars.len() {
                return Err(format!("unterminated quoted value after {address}"));
            }
            let value = chars[start..index].iter().collect::<String>();
            index += 1;
            value
        } else {
            let start = index;
            if index < chars.len() && matches!(chars[index], '+' | '-') {
                index += 1;
            }
            let mut exponent = false;
            while index < chars.len() {
                let character = chars[index];
                if character.is_ascii_digit() || character == '.' {
                    index += 1;
                    continue;
                }
                if !exponent && matches!(character, 'E' | 'e') {
                    exponent = true;
                    index += 1;
                    if index < chars.len() && matches!(chars[index], '+' | '-') {
                        index += 1;
                    }
                    continue;
                }
                break;
            }
            chars[start..index].iter().collect::<String>()
        };
        words.push(Word { address, value });
    }
    Ok(words)
}

fn parse_word_number(word: &Word, line: u32) -> Result<f64, CamPlanError> {
    word.value.parse::<f64>().map_err(|_| {
        line_error(
            line,
            format!("{}{} is not a numeric word", word.address, word.value),
        )
    })
}

fn line_error(line: u32, message: impl Into<String>) -> CamPlanError {
    CamPlanError(format!("G-code line {line}: {}", message.into()))
}

fn distance(a: Point3Dto, b: Point3Dto) -> f64 {
    ((b.x - a.x).powi(2) + (b.y - a.y).powi(2) + (b.z - a.z).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        CamPostConfigDto, CamResolvedStockDto, CamStockPlacementDto, CamStockShape,
        CamStockSpecDto, CamToolDto, CamToolKind, CamUnits, CuttingParametersDto, StockBoxDto,
        WcsOriginSpecDto, WorkCoordinateSystemDto,
    };

    fn document() -> CamDocumentDto {
        CamDocumentDto {
            setups: vec![CamSetupDto {
                id: 1,
                name: "G-code stock".to_string(),
                wcs: WorkCoordinateSystemDto::default(),
                wcs_origin: WcsOriginSpecDto::Explicit,
                work_offset: WorkOffset::G54,
                work_offset_count: 1,
                stock_spec: CamStockSpecDto::Fixed {
                    shape: CamStockShape::Box,
                    size: Point3Dto::new(20.0, 20.0, 8.0),
                    placement: CamStockPlacementDto::default(),
                },
                resolved_stock: CamResolvedStockDto::Box,
                stock: StockBoxDto {
                    min: Point3Dto::new(-10.0, -10.0, -8.0),
                    max: Point3Dto::new(10.0, 10.0, 0.0),
                },
                stock_model_box: None,
                body_ids: vec![],
                legacy_clearance_z: None,
                legacy_retract_z: None,
                operations: vec![],
            }],
            active_setup_id: Some(1),
            tools: vec![CamToolDto {
                id: 1,
                number: Some(3),
                name: "6 mm flat".to_string(),
                kind: CamToolKind::FlatEndMill,
                diameter: 6.0,
                flute_length: 20.0,
                overall_length: 55.0,
                center_cutting: true,
                flute_count: 2,
                point_angle_degrees: None,
                corner_radius: None,
                cutting: CuttingParametersDto::default(),
                cutting_presets: vec![],
                default_step_down: None,
                default_step_over: None,
            }],
            load_warnings: vec![],
            units: CamUnits::Millimeters,
            post_defaults: CamPostConfigDto::default(),
            next_setup_id: 2,
            next_operation_id: 1,
            next_tool_id: 2,
        }
    }

    fn request(source: &str) -> CamGcodeSimulationRequestDto {
        CamGcodeSimulationRequestDto {
            setup_id: 1,
            source: source.to_string(),
            file_name: Some("test.mpf".to_string()),
            dialect: CamGcodeDialectDto::Auto,
            voxel_size: Some(1.0),
            max_voxels: None,
            stock_mesh: None,
            target: None,
            completed_steps: None,
        }
    }

    #[test]
    fn siemens_modal_program_uses_project_tool_and_tracks_source_lines() {
        let result = simulate_gcode(
            &document(),
            &request(
                "G17 G710 G90 G94\nG0 SUPA Z0 D0\nT3\nM6\nS5000 M3\nG0 X-6 Y0\nG0 Z2\nG1 Z-2 F300\nG1 X6 F600\nM30",
            ),
        )
        .expect("simulate Siemens workpiece program");
        assert_eq!(result.source, CamSimulationSourceDto::GCode);
        assert!(result.removed_voxels > 0);
        assert!(result.steps.iter().any(|step| step.tool_id == Some(1)));
        assert!(result.steps.iter().any(|step| step.source_line == Some(8)));
        assert!(result
            .warnings
            .iter()
            .any(|warning| warning.contains("machine-coordinate")));
    }

    #[test]
    fn radius_arcs_and_siemens_implicit_vertical_planes_share_the_timeline() {
        let result = simulate_gcode(
            &document(),
            &request(
                "G710 G90 G94\nT=\"6_MM_FLAT\"\nM6\nG0 X-6 Y0\nG0 Z2\nG1 Z-2 F300\nG17 G3 X0 Y6 CR=6 F600\nG2 X6 Z-8 I6 K0 F600\nM30",
            ),
        )
        .expect("simulate multi-plane arcs");
        let arcs = result
            .steps
            .iter()
            .filter(|step| step.kind == crate::simulation::CamSimulationStepKind::Circular)
            .collect::<Vec<_>>();
        assert_eq!(arcs.len(), 2);
        assert_eq!(arcs[0].plane, Some(CamArcPlane::Xy));
        assert_eq!(arcs[1].plane, Some(CamArcPlane::Xz));
    }

    #[test]
    fn playback_frame_runs_only_completed_steps() {
        let source = "G21 G90 G94\nT3 M6\nG0 X-6 Y0 Z2\nG1 Z-2 F300\nG1 X6 F600\nM30";
        let full = simulate_gcode(&document(), &request(source)).expect("full timeline");
        let mut partial_request = request(source);
        partial_request.completed_steps = Some(1);
        let partial = simulate_gcode(&document(), &partial_request).expect("partial frame");
        assert_eq!(partial.completed_steps, Some(1));
        assert_eq!(partial.steps.len(), 1);
        assert!(partial.removed_voxels <= full.removed_voxels);
        assert!(partial.remaining_voxels >= full.remaining_voxels);
    }

    #[test]
    fn g40_on_rapid_consumes_the_compensated_endpoint_before_repositioning() {
        let result = simulate_gcode(
            &document(),
            &request(
                "G21 G90 G94\nT3 M6\nG0 X1 Y0 Z2\nG1 Z-2 F300\nG41 X1 Y4 F600\nG1 X5 Y4\nG0 G40 Z5\nG0 X-9 Y8\nG1 Z-2 F300\nM30",
            ),
        )
        .expect("simulate compensation cancellation on a rapid block");
        let plunge = result
            .steps
            .iter()
            .find(|step| step.source_line == Some(9))
            .expect("final plunge step");
        assert_eq!(plunge.from, Some(Point3Dto::new(-9.0, 8.0, 5.0)));
        assert_eq!(plunge.to, Some(Point3Dto::new(-9.0, 8.0, -2.0)));
    }

    #[test]
    fn fanuc_dwell_p_is_milliseconds_and_p_wins_deterministically() {
        let mut fanuc = request("G21 G90\nT3 M6\nG0 X0 Y0 Z2\nG1 Z0 F100\nG4 F99 P1500\nM30");
        fanuc.file_name = Some("dwell.nc".to_string());
        fanuc.dialect = CamGcodeDialectDto::Fanuc;
        let result = simulate_gcode(&document(), &fanuc).expect("simulate Fanuc dwell");
        let dwell = result
            .steps
            .iter()
            .find(|step| step.kind == crate::simulation::CamSimulationStepKind::Dwell)
            .expect("dwell step");
        assert!((dwell.duration_seconds - 1.5).abs() < EPSILON);

        let mut iso = request("G21 G90\nT3 M6\nG0 X0 Y0 Z2\nG1 Z0 F100\nG4 P2 F99\nM30");
        iso.file_name = Some("dwell.nc".to_string());
        iso.dialect = CamGcodeDialectDto::Iso;
        let result = simulate_gcode(&document(), &iso).expect("simulate ISO dwell");
        let dwell = result
            .steps
            .iter()
            .find(|step| step.kind == crate::simulation::CamSimulationStepKind::Dwell)
            .expect("ISO dwell step");
        assert!((dwell.duration_seconds - 2.0).abs() < EPSILON);
    }

    #[test]
    fn auto_dialect_detects_supa_at_column_zero() {
        let mut input = request("SUPA Z0\nG0 X0 Y0 Z2\nM30");
        input.file_name = Some("program.nc".to_string());
        assert_eq!(resolve_dialect(&input), CamGcodeDialectDto::Siemens828d);
    }

    #[test]
    fn excluded_machine_motion_resets_pose_without_inventing_a_sweep() {
        let result = simulate_gcode(
            &document(),
            &request(
                "G21 G90 G94\nT3 M6\nG0 X-6 Y0 Z2\nG1 Z-1 F300\nG0 SUPA Z0\nG0 X6 Y0\nG0 Z2\nG1 Z-1 F300\nM30",
            ),
        )
        .expect("simulate around excluded machine motion");
        assert_eq!(result.steps.len(), 4);
        assert_eq!(
            result.steps[0].kind,
            crate::simulation::CamSimulationStepKind::Position
        );
        assert_eq!(
            result.steps[2].kind,
            crate::simulation::CamSimulationStepKind::Position
        );
        assert_eq!(result.steps[2].from, None);
        assert_eq!(result.steps[2].to, Some(Point3Dto::new(6.0, 0.0, 2.0)));
        assert_eq!(result.steps[3].from, Some(Point3Dto::new(6.0, 0.0, 2.0)));
    }

    #[test]
    fn modal_siemens_cycle81_expands_each_hole_to_physical_motion() {
        let result = simulate_gcode(
            &document(),
            &request(
                "G17 G710 G90 G94\nT3 M6\nG0 X4 Y0 Z12\nF200\nMCALL CYCLE81(10, 0, 2, -4, , 0, 0, 10)\nX4 Y0\nX-4\nMCALL\nM30",
            ),
        )
        .expect("expand modal drilling");
        let feeds = result
            .steps
            .iter()
            .filter(|step| step.kind == crate::simulation::CamSimulationStepKind::Linear)
            .collect::<Vec<_>>();
        assert_eq!(feeds.len(), 2);
        assert!(feeds
            .iter()
            .all(|step| step.to.is_some_and(|to| to.z == -4.0)));
        assert!(result
            .warnings
            .iter()
            .any(|warning| warning.contains("CYCLE81")));
    }

    #[test]
    fn unsupported_rotary_motion_fails_closed() {
        let error = simulate_gcode(
            &document(),
            &request("G21 G90 G94\nT3 M6\nG0 X0 Y0 Z2\nG1 X1 A90 F100"),
        )
        .unwrap_err();
        assert!(error.0.contains("A-axis motion"));
    }
}
