//! Machine resources and controller/output contracts. These are project
//! snapshots, not a machine digital twin or an assertion of commissioning.
use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::model::{CamDocumentDto, CamPostConfigDto, Point3Dto, PostDialect};
use crate::planner::{CamCommandDto, CamPlanError, CamProgramDto};

#[cfg(test)]
#[path = "machine_tests.rs"]
mod tests;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamMachineProcess {
    Milling,
    Turning,
    MillTurn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamMachiningMode {
    Fixed3Axis,
    Indexed,
    Simultaneous,
    Turning,
    MillTurn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamAxisKind {
    Linear,
    Rotary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamMachineAxisDto {
    pub id: String,
    pub kind: CamAxisKind,
    /// Parent joint, or the machine base. Direction and origin are expressed
    /// in that parent's zero-pose frame; linear units are mm, rotary degrees.
    pub parent_axis_id: Option<String>,
    pub direction: Point3Dto,
    pub origin: Point3Dto,
    /// Unknown travel is None, never an invented infinite verified travel.
    pub limits: Option<[f64; 2]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamSpindleRole {
    Tool,
    Workpiece,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamMachineSpindleDto {
    pub id: String,
    pub role: CamSpindleRole,
    pub parent_axis_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamMachineChannelDto {
    pub id: String,
    pub axis_ids: Vec<String>,
    pub spindle_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamControllerFamily {
    Siemens,
    Fanuc,
    Haas,
    Mitsubishi,
    Mazak,
    Syntec,
    Okuma,
    Heidenhain,
    LinuxCnc,
    Grbl,
    Mach,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamControllerLanguage {
    SiemensNative,
    SiemensIso,
    FanucStyle,
    OkumaOsp,
    HeidenhainConversational,
    LinuxCnc,
    Grbl,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamControllerDto {
    pub family: CamControllerFamily,
    pub language: CamControllerLanguage,
    pub model: String,
    pub software_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamMachineProfileDto {
    pub schema_version: u32,
    pub id: String,
    pub revision: u32,
    pub name: String,
    pub process: CamMachineProcess,
    pub axes: Vec<CamMachineAxisDto>,
    pub spindles: Vec<CamMachineSpindleDto>,
    pub channels: Vec<CamMachineChannelDto>,
    pub controller: CamControllerDto,
    /// Output settings belong to this machine snapshot, not a document-wide
    /// dialect preference. Program name/number and line numbering may vary.
    pub post: CamPostConfigDto,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamMachineAssignmentDto {
    pub profile: CamMachineProfileDto,
    /// Legacy mapping metadata retained for old-file round trips only. Output
    /// and NC interpretation now use the project tool library directly.
    #[serde(default)]
    pub tool_calls: Vec<crate::CamMachineToolBindingDto>,
    pub mode: CamMachiningMode,
    pub channel_id: String,
    pub tool_spindle_id: Option<String>,
    pub workpiece_spindle_id: Option<String>,
    /// Attachment for a table-mounted workpiece with no workpiece spindle.
    #[serde(default)]
    pub workpiece_mount_axis_id: Option<String>,
}

impl CamMachineAssignmentDto {
    /// Conservative starter, not a certified machine kit. The UI supplies a
    /// unique shop identity when the operator selects/creates a snapshot.
    pub fn three_axis(post: CamPostConfigDto) -> Self {
        let (family, language, model) = match post.dialect {
            PostDialect::Siemens828d => (
                CamControllerFamily::Siemens,
                CamControllerLanguage::SiemensNative,
                "828D",
            ),
            PostDialect::Fanuc => (
                CamControllerFamily::Fanuc,
                CamControllerLanguage::FanucStyle,
                "Generic FANUC-style",
            ),
            PostDialect::Haas => (
                CamControllerFamily::Haas,
                CamControllerLanguage::FanucStyle,
                "Haas NGC",
            ),
            PostDialect::Mitsubishi => (
                CamControllerFamily::Mitsubishi,
                CamControllerLanguage::FanucStyle,
                "Mitsubishi M80/M800",
            ),
            PostDialect::Mazak => (
                CamControllerFamily::Mazak,
                CamControllerLanguage::FanucStyle,
                "Mazak EIA milling",
            ),
            PostDialect::Syntec => (
                CamControllerFamily::Syntec,
                CamControllerLanguage::FanucStyle,
                "Syntec milling",
            ),
            PostDialect::Okuma => (
                CamControllerFamily::Okuma,
                CamControllerLanguage::OkumaOsp,
                "Okuma OSP milling",
            ),
            PostDialect::Heidenhain => (
                CamControllerFamily::Heidenhain,
                CamControllerLanguage::HeidenhainConversational,
                "Heidenhain TNC",
            ),
            PostDialect::HermleHeidenhain => (
                CamControllerFamily::Heidenhain,
                CamControllerLanguage::HeidenhainConversational,
                "Hermle / Heidenhain TNC — fixed axis",
            ),
            PostDialect::LinuxCnc => (
                CamControllerFamily::LinuxCnc,
                CamControllerLanguage::LinuxCnc,
                "LinuxCNC",
            ),
            PostDialect::Grbl => (
                CamControllerFamily::Grbl,
                CamControllerLanguage::Grbl,
                "GRBL",
            ),
        };
        Self {
            tool_calls: Vec::new(),
            profile: CamMachineProfileDto {
                schema_version: if post
                    .siemens_828d
                    .as_ref()
                    .is_some_and(|s| s.spindle_stop_subprogram.is_some())
                {
                    2
                } else {
                    1
                },
                id: "three-axis-starter".into(),
                revision: 1,
                name: format!("{model} / 3-axis"),
                process: CamMachineProcess::Milling,
                axes: [
                    ("X", [1.0, 0.0, 0.0]),
                    ("Y", [0.0, 1.0, 0.0]),
                    ("Z", [0.0, 0.0, 1.0]),
                ]
                .into_iter()
                .map(|(id, d)| CamMachineAxisDto {
                    id: id.into(),
                    kind: CamAxisKind::Linear,
                    parent_axis_id: None,
                    direction: Point3Dto::new(d[0], d[1], d[2]),
                    origin: Point3Dto::new(0.0, 0.0, 0.0),
                    limits: None,
                })
                .collect(),
                spindles: vec![CamMachineSpindleDto {
                    id: "tool-spindle".into(),
                    role: CamSpindleRole::Tool,
                    parent_axis_id: Some("Z".into()),
                }],
                channels: vec![CamMachineChannelDto {
                    id: "main".into(),
                    axis_ids: vec!["X".into(), "Y".into(), "Z".into()],
                    spindle_ids: vec!["tool-spindle".into()],
                }],
                controller: CamControllerDto {
                    family,
                    language,
                    model: model.into(),
                    software_version: None,
                },
                post,
            },
            mode: CamMachiningMode::Fixed3Axis,
            channel_id: "main".into(),
            tool_spindle_id: Some("tool-spindle".into()),
            workpiece_spindle_id: None,
            workpiece_mount_axis_id: None,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.tool_calls.len() > 4096 {
            return Err("Too much legacy tool-mapping metadata".into());
        }
        let p = &self.profile;
        if !matches!(p.schema_version, 1 | 2) || p.revision == 0 {
            return Err("Unsupported machine profile version or zero revision".into());
        }
        if p.post
            .siemens_828d
            .as_ref()
            .is_some_and(|s| s.spindle_stop_subprogram.is_some())
        {
            if p.schema_version < 2 {
                return Err("Private spindle-stop behavior requires machine profile version 2; older readers must not silently discard it.".into());
            }
            if p.post.dialect != PostDialect::Siemens828d
                || p.controller.family != CamControllerFamily::Siemens
                || p.controller.language != CamControllerLanguage::SiemensNative
            {
                return Err("A native spindle-stop subprogram is supported only on a Siemens-native machine profile.".into());
            }
        }
        for (name, value) in [
            ("id", &p.id),
            ("name", &p.name),
            ("controller model", &p.controller.model),
        ] {
            if value.trim().is_empty() || value.len() > 256 {
                return Err(format!(
                    "Machine {name} must be non-empty and at most 256 bytes"
                ));
            }
        }
        let unique = |ids: Vec<&str>, label: &str| -> Result<(), String> {
            if ids.is_empty()
                || ids.len() > 32
                || ids.iter().any(|s| s.trim().is_empty() || s.len() > 64)
                || ids.iter().collect::<HashSet<_>>().len() != ids.len()
            {
                return Err(format!("Machine {label} must have 1–32 unique, non-empty resource ids (at most 64 bytes)"));
            }
            Ok(())
        };
        unique(p.axes.iter().map(|a| a.id.as_str()).collect(), "axes")?;
        unique(
            p.spindles.iter().map(|s| s.id.as_str()).collect(),
            "spindles",
        )?;
        unique(
            p.channels.iter().map(|c| c.id.as_str()).collect(),
            "channels",
        )?;
        let axis = |id: &str| p.axes.iter().find(|a| a.id == id);
        for a in &p.axes {
            let d = a.direction;
            let norm = d.x * d.x + d.y * d.y + d.z * d.z;
            if !norm.is_finite()
                || (norm - 1.0).abs() > 1e-6
                || ![a.origin.x, a.origin.y, a.origin.z]
                    .iter()
                    .all(|v| v.is_finite())
            {
                return Err(format!(
                    "Machine axis {} needs a unit direction and finite origin",
                    a.id
                ));
            }
            if a.limits
                .is_some_and(|[lo, hi]| !lo.is_finite() || !hi.is_finite() || lo >= hi)
            {
                return Err(format!("Machine axis {} has invalid travel limits", a.id));
            }
            let mut seen = HashSet::from([a.id.as_str()]);
            let mut parent = a.parent_axis_id.as_deref();
            while let Some(id) = parent {
                if !seen.insert(id) {
                    return Err("Machine axis hierarchy contains a cycle".into());
                }
                parent = axis(id)
                    .ok_or_else(|| format!("Missing machine parent axis {id}"))?
                    .parent_axis_id
                    .as_deref();
            }
        }
        for s in &p.spindles {
            if s.parent_axis_id
                .as_deref()
                .is_some_and(|id| axis(id).is_none())
            {
                return Err(format!("Spindle {} references a missing parent axis", s.id));
            }
        }
        for c in &p.channels {
            unique(
                c.axis_ids.iter().map(String::as_str).collect(),
                "channel axes",
            )?;
            unique(
                c.spindle_ids.iter().map(String::as_str).collect(),
                "channel spindles",
            )?;
            if c.axis_ids.iter().any(|id| axis(id).is_none())
                || c.spindle_ids
                    .iter()
                    .any(|id| !p.spindles.iter().any(|s| &s.id == id))
            {
                return Err(format!(
                    "Channel {} references missing machine resources",
                    c.id
                ));
            }
        }
        let channel = p
            .channels
            .iter()
            .find(|c| c.id == self.channel_id)
            .ok_or("Setup references a missing machine channel")?;
        if self
            .workpiece_mount_axis_id
            .as_ref()
            .is_some_and(|id| !channel.axis_ids.contains(id))
        {
            return Err("Workpiece attachment references an axis outside the setup channel".into());
        }
        for (id, role) in [
            (&self.tool_spindle_id, CamSpindleRole::Tool),
            (&self.workpiece_spindle_id, CamSpindleRole::Workpiece),
        ] {
            if let Some(id) = id {
                if !channel.spindle_ids.contains(id)
                    || !p.spindles.iter().any(|s| &s.id == id && s.role == role)
                {
                    return Err(format!(
                        "Setup spindle {id} is unavailable in its channel or has the wrong role"
                    ));
                }
            }
        }
        if let Some(s) = &p.post.siemens_828d {
            s.validate()?;
        }
        if p.post.machine_retract_z.is_some_and(|z| !z.is_finite()) {
            return Err("Machine retract Z must be finite".into());
        }
        Ok(())
    }

    /// Storage is broader than execution. Never interpret a rotary/channel
    /// configuration as an ordinary fixed-Z path by silently dropping axes.
    pub fn ensure_supported_motion(&self) -> Result<(), String> {
        self.validate()?;
        let p = &self.profile;
        if self.mode != CamMachiningMode::Fixed3Axis
            || p.process != CamMachineProcess::Milling
            || p.axes.len() != 3
            || p.axes.iter().any(|a| a.kind != CamAxisKind::Linear)
            || p.channels.len() != 1
            || p.spindles.len() != 1
            || self.tool_spindle_id.is_none()
            || self.workpiece_spindle_id.is_some()
            || self.workpiece_mount_axis_id.is_some()
            || p.channels[0].axis_ids.len() != 3
            || [
                ("X", [1.0, 0.0, 0.0]),
                ("Y", [0.0, 1.0, 0.0]),
                ("Z", [0.0, 0.0, 1.0]),
            ]
            .iter()
            .any(|(id, d)| {
                !p.axes
                    .iter()
                    .any(|a| a.id == *id && a.direction == Point3Dto::new(d[0], d[1], d[2]))
            })
        {
            return Err("This machine configuration is stored, but execution currently supports only fixed 3-axis milling with one channel and one tool spindle. Indexed/rotary, simultaneous, turning and mill-turn motion are not implemented.".into());
        }
        Ok(())
    }

    pub fn ensure_post_matches(&self, post: &CamPostConfigDto) -> Result<(), String> {
        self.ensure_supported_motion()?;
        use CamControllerFamily as F;
        use CamControllerLanguage as L;
        let expected = match (self.profile.controller.family, self.profile.controller.language) {
            (F::Siemens, L::SiemensNative) => PostDialect::Siemens828d,
            (F::Fanuc, L::FanucStyle) => PostDialect::Fanuc,
            (F::Haas, L::FanucStyle) => PostDialect::Haas,
            (F::Mitsubishi, L::FanucStyle) => PostDialect::Mitsubishi,
            (F::Mazak, L::FanucStyle) => PostDialect::Mazak,
            (F::Syntec, L::FanucStyle) => PostDialect::Syntec,
            (F::Okuma, L::OkumaOsp) => PostDialect::Okuma,
            (F::Heidenhain, L::HeidenhainConversational) => match self.profile.post.dialect {
                PostDialect::HermleHeidenhain => PostDialect::HermleHeidenhain,
                _ => PostDialect::Heidenhain,
            },
            (F::LinuxCnc, L::LinuxCnc) => PostDialect::LinuxCnc,
            (F::Grbl, L::Grbl) => PostDialect::Grbl,
            _ => return Err("No supported built-in post for this controller/language combination. Select a matching fixed-axis post; languages and machine-builder options are not interchangeable.".into()),
        };
        if post.dialect != expected || self.profile.post.dialect != expected {
            return Err("Post dialect does not match the setup's machine/controller. Change the setup machine explicitly; existing operations will be kept.".into());
        }
        if post.tool_call_mode == crate::CamToolCallMode::Name && !expected.supports_named_tools() {
            return Err(
                "This post requires numeric tool calls from the project tool library.".into(),
            );
        }
        if post.siemens_828d != self.profile.post.siemens_828d
            || post.tool_call_mode != self.profile.post.tool_call_mode
            || post.machine_retract_z != self.profile.post.machine_retract_z
        {
            return Err("Machine-specific post settings differ from the setup snapshot. Review and save the machine settings before posting.".into());
        }
        if expected.requires_machine_retract() && post.machine_retract_z.is_none() {
            return Err("Set Machine retract Z in Post NC before posting. This is a machine coordinate, not the setup clearance height.".into());
        }
        if expected == PostDialect::Siemens828d && post.siemens_828d.is_none() {
            return Err(
                "Siemens native output requires explicit tool-change and offset settings".into(),
            );
        }
        Ok(())
    }
}

/// Profiles currently constrain output, not neutral fixed-axis motion. Strip
/// them from content-keyed stock evidence without weakening geometry keys.
pub(crate) fn motion_document(document: &CamDocumentDto) -> std::borrow::Cow<'_, CamDocumentDto> {
    if document.setups.iter().all(|s| s.machine.is_none()) {
        return std::borrow::Cow::Borrowed(document);
    }
    let mut intent = document.clone();
    for setup in &mut intent.setups {
        setup.machine = None;
    }
    std::borrow::Cow::Owned(intent)
}

pub(crate) fn ensure_setup_machines_supported(
    document: &CamDocumentDto,
    setup_id: u64,
) -> Result<(), CamPlanError> {
    let mut cursor = setup_id;
    let mut seen = HashSet::new();
    loop {
        if !seen.insert(cursor) {
            return Err(CamPlanError("Rest-stock setup cycle".into()));
        }
        let setup = document
            .setup(cursor)
            .ok_or_else(|| CamPlanError(format!("CAM setup {cursor} does not exist")))?;
        if let Some(machine) = &setup.machine {
            machine.ensure_supported_motion().map_err(CamPlanError)?;
        }
        if let crate::CamResolvedStockDto::Rest { source_setup_id } = setup.resolved_stock {
            cursor = source_setup_id;
        } else {
            return Ok(());
        }
    }
}

pub(crate) fn machine_post_config(
    document: &CamDocumentDto,
    setup_id: u64,
    requested: Option<&CamPostConfigDto>,
) -> Result<CamPostConfigDto, CamPlanError> {
    let setup = document
        .setup(setup_id)
        .ok_or_else(|| CamPlanError(format!("CAM setup {setup_id} does not exist")))?;
    let machine = setup.machine.as_ref().ok_or_else(|| CamPlanError(
        "NC posting blocked: select a machine/controller in Setup and review its post settings. Generic 3-axis programming and CAM simulation remain available.".into()))?;
    let post = requested.unwrap_or(&machine.profile.post);
    machine.ensure_post_matches(post).map_err(CamPlanError)?;
    Ok(post.clone())
}

/// Validate the actual activation/cancellation blocks, not whether a dialog
/// has an arc checkbox. These are conservative output policies, not a model
/// of every controller setting/look-ahead mode. No Z-only startup shortcut.
pub(crate) fn check_compensation_contract(
    document: &CamDocumentDto,
    program: &CamProgramDto,
    dialect: PostDialect,
) -> Result<(), CamPlanError> {
    let mut position: Option<Point3Dto> = None;
    let mut tool_id = None;
    let mut operation_id = 0;
    let mut active = false;
    let mut pending = None;
    let contains_arcs = program
        .commands
        .iter()
        .any(|c| matches!(c, CamCommandDto::Circular { .. }));
    for command in &program.commands {
        match command {
            CamCommandDto::SectionStart {
                operation_id: id,
                tool_id: t,
                ..
            } => {
                operation_id = *id;
                tool_id = Some(*t);
            }
            CamCommandDto::CutterCompensationOn { .. } => {
                if active || pending.is_some() {
                    return Err(CamPlanError("Nested cutter compensation activation".into()));
                }
                if dialect == PostDialect::Grbl {
                    return Err(CamPlanError(format!("Operation {operation_id}: GRBL does not support in-control cutter compensation. Use in-computer compensation.")));
                }
                active = true;
                pending = Some(true);
            }
            CamCommandDto::CutterCompensationOff => {
                if !active || pending.is_some() {
                    return Err(CamPlanError(
                        "Cutter compensation cancelled without a completed activation".into(),
                    ));
                }
                active = false;
                pending = Some(false);
            }
            CamCommandDto::SectionEnd | CamCommandDto::ProgramEnd
                if active || pending.is_some() =>
            {
                return Err(CamPlanError(format!(
                    "Operation {operation_id}: cutter compensation is not safely cancelled"
                )))
            }
            _ => {}
        }
        if let Some(to) = command.endpoint() {
            let to = crate::post::output_point_mm(to, document.units, dialect, contains_arcs);
            if let Some(engage) = pending.take() {
                let from = position.ok_or_else(|| {
                    CamPlanError("Cutter compensation has no established entry position".into())
                })?;
                let xy = (to.x - from.x).hypot(to.y - from.y);
                let radius = document
                    .tools
                    .iter()
                    .find(|t| Some(t.id) == tool_id)
                    .ok_or_else(|| CamPlanError("Cutter compensation has no project tool".into()))?
                    .diameter
                    / 2.0;
                let (minimum, strict) = match (dialect, engage) {
                    (PostDialect::LinuxCnc, false) => (2.0 * radius, true),
                    (
                        PostDialect::LinuxCnc
                        | PostDialect::Fanuc
                        | PostDialect::Haas
                        | PostDialect::Mitsubishi
                        | PostDialect::Mazak
                        | PostDialect::Syntec
                        | PostDialect::Okuma
                        | PostDialect::Heidenhain
                        | PostDialect::HermleHeidenhain,
                        _,
                    ) => (radius, false),
                    _ => (0.0, true),
                };
                if !matches!(command, CamCommandDto::Linear { .. })
                    || !xy.is_finite()
                    || !radius.is_finite()
                    || radius <= 0.0
                    || xy <= 1e-6
                    || if strict {
                        xy <= minimum + 1e-6
                    } else {
                        xy + 1e-6 < minimum
                    }
                {
                    return Err(CamPlanError(format!(
                        "Operation {operation_id}: {} compensation needs a G1 move in XY {} {:.3} mm for this post (actual {:.3} mm). Adjust the linear lead {}; an arc is optional and a Z-only drop does not qualify. Assumes the project tool's full radius is entered at the control.",
                        if engage { "engaging" } else { "cancelling" }, if strict { "longer than" } else { "at least" }, minimum, xy,
                        if engage { "in" } else { "out" },
                    )));
                }
            }
            position = Some(to);
        }
    }
    if active || pending.is_some() {
        return Err(CamPlanError("Unterminated cutter compensation".into()));
    }
    Ok(())
}
