use std::collections::HashSet;

use nbcad_core::BodyId;
use serde::{Deserialize, Serialize};

const MAX_SETUPS: usize = 64;
const MAX_TOOLS: usize = 256;
const MAX_OPERATIONS_PER_SETUP: usize = 2_048;
const MAX_PATH_POINTS: usize = 250_000;
const EPSILON: f64 = 1.0e-9;

fn first_id() -> u64 {
    1
}

fn default_true() -> bool {
    true
}

fn default_rapid_feed() -> f64 {
    3_000.0
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point2Dto {
    pub x: f64,
    pub y: f64,
}

impl Point2Dto {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub(crate) fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point3Dto {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Point3Dto {
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub(crate) fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect2Dto {
    pub min: Point2Dto,
    pub max: Point2Dto,
}

impl Rect2Dto {
    pub fn validate(self, label: &str) -> Result<(), String> {
        if !self.min.is_finite() || !self.max.is_finite() {
            return Err(format!("{label} must contain finite coordinates"));
        }
        if self.max.x - self.min.x <= EPSILON || self.max.y - self.min.y <= EPSILON {
            return Err(format!("{label} must have positive width and height"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct StockBoxDto {
    pub min: Point3Dto,
    pub max: Point3Dto,
}

impl StockBoxDto {
    pub fn validate(self) -> Result<(), String> {
        if !self.min.is_finite() || !self.max.is_finite() {
            return Err("stock bounds must contain finite coordinates".to_string());
        }
        if self.max.x - self.min.x <= EPSILON
            || self.max.y - self.min.y <= EPSILON
            || self.max.z - self.min.z <= EPSILON
        {
            return Err("stock must have positive X, Y, and Z dimensions".to_string());
        }
        Ok(())
    }

    pub fn xy_bounds(self) -> Rect2Dto {
        Rect2Dto {
            min: Point2Dto::new(self.min.x, self.min.y),
            max: Point2Dto::new(self.max.x, self.max.y),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WorkCoordinateSystemDto {
    /// WCS origin in model coordinates, expressed in model millimetres.
    pub origin: Point3Dto,
    /// Orthonormal fixed-axis milling frame in model coordinates.
    pub x_axis: [f64; 3],
    pub y_axis: [f64; 3],
    pub z_axis: [f64; 3],
}

impl Default for WorkCoordinateSystemDto {
    fn default() -> Self {
        Self {
            origin: Point3Dto::new(0.0, 0.0, 0.0),
            x_axis: [1.0, 0.0, 0.0],
            y_axis: [0.0, 1.0, 0.0],
            z_axis: [0.0, 0.0, 1.0],
        }
    }
}

impl WorkCoordinateSystemDto {
    fn validate(self) -> Result<(), String> {
        if !self.origin.is_finite()
            || !self
                .x_axis
                .iter()
                .chain(self.y_axis.iter())
                .chain(self.z_axis.iter())
                .all(|value| value.is_finite())
        {
            return Err("WCS origin and axes must be finite".to_string());
        }
        let norm = |axis: [f64; 3]| axis.iter().map(|v| v * v).sum::<f64>().sqrt();
        let dot = |a: [f64; 3], b: [f64; 3]| {
            a.iter()
                .zip(b)
                .map(|(left, right)| left * right)
                .sum::<f64>()
        };
        for (name, axis) in [("X", self.x_axis), ("Y", self.y_axis), ("Z", self.z_axis)] {
            if (norm(axis) - 1.0).abs() > 1.0e-6 {
                return Err(format!("WCS {name} axis must be normalized"));
            }
        }
        if dot(self.x_axis, self.y_axis).abs() > 1.0e-6
            || dot(self.x_axis, self.z_axis).abs() > 1.0e-6
            || dot(self.y_axis, self.z_axis).abs() > 1.0e-6
        {
            return Err("WCS axes must be mutually perpendicular".to_string());
        }
        let cross_xy = [
            self.x_axis[1] * self.y_axis[2] - self.x_axis[2] * self.y_axis[1],
            self.x_axis[2] * self.y_axis[0] - self.x_axis[0] * self.y_axis[2],
            self.x_axis[0] * self.y_axis[1] - self.x_axis[1] * self.y_axis[0],
        ];
        if dot(cross_xy, self.z_axis) < 0.999_999 {
            return Err("WCS axes must form a right-handed frame".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkOffset {
    #[default]
    G54,
    G55,
    G56,
    G57,
    G58,
    G59,
}

impl WorkOffset {
    pub fn code(self) -> &'static str {
        match self {
            Self::G54 => "G54",
            Self::G55 => "G55",
            Self::G56 => "G56",
            Self::G57 => "G57",
            Self::G58 => "G58",
            Self::G59 => "G59",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PostDialect {
    #[default]
    Grbl,
    LinuxCnc,
    Fanuc,
    /// Native SINUMERIK language for Siemens 828D controls.
    Siemens828d,
}

impl PostDialect {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Grbl => "nc",
            Self::LinuxCnc => "ngc",
            Self::Fanuc => "nc",
            Self::Siemens828d => "mpf",
        }
    }
}

fn default_siemens_tool_length_offset() -> u32 {
    1
}

/// Physical magazine/changer layout. This is descriptive metadata used for
/// guidance and examples; it must not silently choose machine motion.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Siemens828dAtcStyle {
    #[default]
    DoubleArm,
    Umbrella,
    CarouselChain,
    Other,
}

/// Verified responsibility for positioning the spindle before `M6`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Siemens828dToolChangePositioning {
    /// The NC program retracts Z in machine coordinates, then calls `M6`.
    #[default]
    SupaZ,
    /// The machine builder's `M6` PLC/cycle owns all station positioning.
    ControllerManaged,
    /// The NC program retracts Z first, then moves to a verified machine XY
    /// station before calling `M6`.
    SupaZThenXy,
}

/// Machine-specific safety values used by the native SINUMERIK 828D post.
///
/// `SUPA` addresses the machine coordinate system, so a value that is safe on
/// one 828D machine must never be silently assumed safe on another. The
/// profile is optional in persisted projects and the post fails closed when
/// it is absent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Siemens828dPostConfigDto {
    /// Informational changer layout. This never selects motion by itself.
    #[serde(default)]
    pub atc_style: Siemens828dAtcStyle,
    /// Explicit, machine-manual-verified positioning behavior.
    #[serde(default)]
    pub tool_change_positioning: Siemens828dToolChangePositioning,
    /// Machine-coordinate Z used by `G0 SUPA Z... D0` before a tool change and
    /// at program end.
    pub supa_retract_z: f64,
    /// Required only for `supa_z_then_xy`; expressed in machine coordinates.
    #[serde(default)]
    pub station_x: Option<f64>,
    /// Required only for `supa_z_then_xy`; expressed in machine coordinates.
    #[serde(default)]
    pub station_y: Option<f64>,
    /// SINUMERIK tool edge / length-offset number activated after `M6`.
    #[serde(default = "default_siemens_tool_length_offset")]
    pub tool_length_offset: u32,
    /// Emit `M1` before the second and later tool changes.
    #[serde(default = "default_true")]
    pub optional_stop_on_tool_change: bool,
    /// Emit a `T...` call for the next tool immediately after the active
    /// tool's `M6`/`D...` blocks. This may move a magazine, so it is disabled
    /// unless the machine profile explicitly allows it.
    #[serde(default)]
    pub preload_next_tool: bool,
}

impl Default for Siemens828dPostConfigDto {
    fn default() -> Self {
        Self {
            atc_style: Siemens828dAtcStyle::default(),
            tool_change_positioning: Siemens828dToolChangePositioning::default(),
            supa_retract_z: 0.0,
            station_x: None,
            station_y: None,
            tool_length_offset: default_siemens_tool_length_offset(),
            optional_stop_on_tool_change: true,
            preload_next_tool: false,
        }
    }
}

impl Siemens828dPostConfigDto {
    fn validate(&self) -> Result<(), String> {
        if !self.supa_retract_z.is_finite() {
            return Err("Siemens 828D SUPA retract Z must be finite".to_string());
        }
        for (axis, value) in [("X", self.station_x), ("Y", self.station_y)] {
            if value.is_some_and(|coordinate| !coordinate.is_finite()) {
                return Err(format!(
                    "Siemens 828D tool-change station {axis} must be finite"
                ));
            }
        }
        if self.tool_length_offset == 0 || self.tool_length_offset > 999 {
            return Err("Siemens 828D tool length offset must be between D1 and D999".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamPostConfigDto {
    #[serde(default)]
    pub dialect: PostDialect,
    #[serde(default)]
    pub program_number: Option<u32>,
    #[serde(default)]
    pub sequence_numbers: bool,
    /// Present only after a user deliberately selects and confirms a native
    /// Siemens machine profile. Older projects deserialize with `None`.
    #[serde(default)]
    pub siemens_828d: Option<Siemens828dPostConfigDto>,
}

impl Default for CamPostConfigDto {
    fn default() -> Self {
        Self {
            dialect: PostDialect::Grbl,
            program_number: Some(1001),
            sequence_numbers: false,
            siemens_828d: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamToolKind {
    FlatEndMill,
    BallEndMill,
    Drill,
    ChamferMill,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamToolDto {
    pub id: u64,
    pub number: u32,
    pub name: String,
    pub kind: CamToolKind,
    pub diameter: f64,
    pub flute_length: f64,
    pub overall_length: f64,
    #[serde(default = "default_true")]
    pub center_cutting: bool,
}

impl CamToolDto {
    fn validate(&self) -> Result<(), String> {
        if self.id == 0 {
            return Err("CAM tool ids must be non-zero".to_string());
        }
        if self.number == 0 {
            return Err(format!(
                "tool '{}' must have a positive tool number",
                self.name
            ));
        }
        if self.name.trim().is_empty() {
            return Err(format!("CAM tool {} must have a name", self.id));
        }
        for (label, value) in [
            ("diameter", self.diameter),
            ("flute length", self.flute_length),
            ("overall length", self.overall_length),
        ] {
            if !value.is_finite() || value <= 0.0 {
                return Err(format!("tool '{}' {label} must be positive", self.name));
            }
        }
        if self.flute_length > self.overall_length {
            return Err(format!(
                "tool '{}' flute length cannot exceed overall length",
                self.name
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpindleDirection {
    Off,
    Clockwise,
    Counterclockwise,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoolantMode {
    #[default]
    Off,
    Mist,
    Flood,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CuttingParametersDto {
    pub spindle_rpm: u32,
    pub feed_xy: f64,
    pub feed_z: f64,
    #[serde(default)]
    pub coolant: CoolantMode,
}

impl CuttingParametersDto {
    fn validate(self, operation: &str) -> Result<(), String> {
        if self.spindle_rpm == 0 {
            return Err(format!("{operation} spindle speed must be positive"));
        }
        if !self.feed_xy.is_finite() || self.feed_xy <= 0.0 {
            return Err(format!("{operation} cutting feed must be positive"));
        }
        if !self.feed_z.is_finite() || self.feed_z <= 0.0 {
            return Err(format!("{operation} plunge feed must be positive"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContourCompensation {
    /// The stored polyline is already the tool-center path.
    On,
    /// Offset toward the polygon interior by the tool radius.
    Inside,
    /// Offset away from the polygon interior by the tool radius.
    Outside,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CamOperationDto {
    Face {
        id: u64,
        name: String,
        #[serde(default = "default_true")]
        enabled: bool,
        tool_id: u64,
        bounds: Rect2Dto,
        top_z: f64,
        target_z: f64,
        step_over: f64,
        step_down: f64,
        cutting: CuttingParametersDto,
    },
    Contour2d {
        id: u64,
        name: String,
        #[serde(default = "default_true")]
        enabled: bool,
        tool_id: u64,
        path: Vec<Point2Dto>,
        top_z: f64,
        bottom_z: f64,
        step_down: f64,
        compensation: ContourCompensation,
        cutting: CuttingParametersDto,
    },
    Drill {
        id: u64,
        name: String,
        #[serde(default = "default_true")]
        enabled: bool,
        tool_id: u64,
        points: Vec<Point2Dto>,
        top_z: f64,
        bottom_z: f64,
        retract_z: f64,
        #[serde(default)]
        peck_depth: Option<f64>,
        #[serde(default)]
        dwell_seconds: f64,
        cutting: CuttingParametersDto,
    },
}

impl CamOperationDto {
    pub fn id(&self) -> u64 {
        match self {
            Self::Face { id, .. } | Self::Contour2d { id, .. } | Self::Drill { id, .. } => *id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Self::Face { name, .. } | Self::Contour2d { name, .. } | Self::Drill { name, .. } => {
                name
            }
        }
    }

    pub fn enabled(&self) -> bool {
        match self {
            Self::Face { enabled, .. }
            | Self::Contour2d { enabled, .. }
            | Self::Drill { enabled, .. } => *enabled,
        }
    }

    pub fn tool_id(&self) -> u64 {
        match self {
            Self::Face { tool_id, .. }
            | Self::Contour2d { tool_id, .. }
            | Self::Drill { tool_id, .. } => *tool_id,
        }
    }

    pub fn cutting(&self) -> CuttingParametersDto {
        match self {
            Self::Face { cutting, .. }
            | Self::Contour2d { cutting, .. }
            | Self::Drill { cutting, .. } => *cutting,
        }
    }

    fn validate(&self, setup: &CamSetupDto, tools: &[CamToolDto]) -> Result<(), String> {
        let label = self.name().trim();
        if self.id() == 0 {
            return Err("CAM operation ids must be non-zero".to_string());
        }
        if label.is_empty() {
            return Err(format!("CAM operation {} must have a name", self.id()));
        }
        let tool = tools
            .iter()
            .find(|tool| tool.id == self.tool_id())
            .ok_or_else(|| format!("operation '{label}' references a missing tool"))?;
        self.cutting().validate(label)?;

        let within_z = |value: f64| {
            value.is_finite()
                && value >= setup.stock.min.z - EPSILON
                && value <= setup.stock.max.z + EPSILON
        };
        let within_xy = |point: Point2Dto| {
            point.is_finite()
                && point.x >= setup.stock.min.x - EPSILON
                && point.x <= setup.stock.max.x + EPSILON
                && point.y >= setup.stock.min.y - EPSILON
                && point.y <= setup.stock.max.y + EPSILON
        };

        match self {
            Self::Face {
                bounds,
                top_z,
                target_z,
                step_over,
                step_down,
                ..
            } => {
                if tool.kind != CamToolKind::FlatEndMill || !tool.center_cutting {
                    return Err(format!(
                        "face operation '{label}' requires a center-cutting flat end mill until ramp entries are supported"
                    ));
                }
                bounds.validate(&format!("face operation '{label}' bounds"))?;
                if bounds.min.x < setup.stock.min.x - EPSILON
                    || bounds.min.y < setup.stock.min.y - EPSILON
                    || bounds.max.x > setup.stock.max.x + EPSILON
                    || bounds.max.y > setup.stock.max.y + EPSILON
                {
                    return Err(format!(
                        "face operation '{label}' bounds must lie within stock"
                    ));
                }
                validate_depth_range(label, *top_z, *target_z, *step_down, within_z)?;
                if !step_over.is_finite() || *step_over <= 0.0 || *step_over > tool.diameter {
                    return Err(format!(
                        "face operation '{label}' stepover must be positive and no larger than the tool diameter"
                    ));
                }
            }
            Self::Contour2d {
                path,
                top_z,
                bottom_z,
                step_down,
                ..
            } => {
                if tool.kind == CamToolKind::Drill || !tool.center_cutting {
                    return Err(format!(
                        "contour operation '{label}' requires a center-cutting milling tool until ramp or lead-in entries are supported"
                    ));
                }
                if path.len() < 3 || path.len() > MAX_PATH_POINTS {
                    return Err(format!(
                        "contour operation '{label}' needs 3..={MAX_PATH_POINTS} path points"
                    ));
                }
                if !path.iter().copied().all(within_xy) {
                    return Err(format!(
                        "contour operation '{label}' path must lie within stock"
                    ));
                }
                if signed_area(path).abs() <= EPSILON {
                    return Err(format!("contour operation '{label}' path has zero area"));
                }
                validate_depth_range(label, *top_z, *bottom_z, *step_down, within_z)?;
            }
            Self::Drill {
                points,
                top_z,
                bottom_z,
                retract_z,
                peck_depth,
                dwell_seconds,
                ..
            } => {
                if tool.kind != CamToolKind::Drill && !tool.center_cutting {
                    return Err(format!(
                        "drill operation '{label}' requires a drill or center-cutting tool"
                    ));
                }
                if points.is_empty() || points.len() > MAX_PATH_POINTS {
                    return Err(format!(
                        "drill operation '{label}' needs 1..={MAX_PATH_POINTS} points"
                    ));
                }
                if !points.iter().copied().all(within_xy) {
                    return Err(format!(
                        "drill operation '{label}' points must lie within stock"
                    ));
                }
                validate_depth_range(label, *top_z, *bottom_z, *top_z - *bottom_z, within_z)?;
                if !retract_z.is_finite()
                    || *retract_z < setup.retract_z
                    || *retract_z > setup.clearance_z
                {
                    return Err(format!(
                        "drill operation '{label}' retract Z must be at or above the setup retract plane and no higher than setup clearance"
                    ));
                }
                if let Some(peck) = peck_depth {
                    if !peck.is_finite() || *peck <= 0.0 {
                        return Err(format!(
                            "drill operation '{label}' peck depth must be positive"
                        ));
                    }
                }
                if !dwell_seconds.is_finite() || *dwell_seconds < 0.0 || *dwell_seconds > 60.0 {
                    return Err(format!(
                        "drill operation '{label}' dwell must be between 0 and 60 seconds"
                    ));
                }
            }
        }
        Ok(())
    }
}

fn validate_depth_range(
    label: &str,
    top_z: f64,
    bottom_z: f64,
    step_down: f64,
    within_z: impl Fn(f64) -> bool,
) -> Result<(), String> {
    if !within_z(top_z) || !within_z(bottom_z) || bottom_z >= top_z - EPSILON {
        return Err(format!(
            "operation '{label}' depth range must descend within the stock"
        ));
    }
    if !step_down.is_finite() || step_down <= 0.0 {
        return Err(format!("operation '{label}' stepdown must be positive"));
    }
    Ok(())
}

pub(crate) fn signed_area(points: &[Point2Dto]) -> f64 {
    points
        .iter()
        .zip(points.iter().cycle().skip(1))
        .take(points.len())
        .map(|(a, b)| a.x * b.y - b.x * a.y)
        .sum::<f64>()
        * 0.5
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamSetupDto {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub wcs: WorkCoordinateSystemDto,
    #[serde(default)]
    pub work_offset: WorkOffset,
    pub stock: StockBoxDto,
    #[serde(default)]
    pub body_ids: Vec<BodyId>,
    pub clearance_z: f64,
    pub retract_z: f64,
    #[serde(default = "default_rapid_feed")]
    pub rapid_feed: f64,
    #[serde(default)]
    pub post: CamPostConfigDto,
    #[serde(default)]
    pub operations: Vec<CamOperationDto>,
}

impl CamSetupDto {
    fn validate(&self, tools: &[CamToolDto]) -> Result<(), String> {
        if self.id == 0 {
            return Err("CAM setup ids must be non-zero".to_string());
        }
        if self.name.trim().is_empty() {
            return Err(format!("CAM setup {} must have a name", self.id));
        }
        self.wcs.validate()?;
        self.stock.validate()?;
        if !self.clearance_z.is_finite() || self.clearance_z <= self.stock.max.z {
            return Err(format!(
                "setup '{}' clearance Z must be above the stock",
                self.name
            ));
        }
        if !self.retract_z.is_finite()
            || self.retract_z <= self.stock.max.z
            || self.retract_z > self.clearance_z
        {
            return Err(format!(
                "setup '{}' retract Z must be above stock and no higher than clearance",
                self.name
            ));
        }
        if !self.rapid_feed.is_finite() || self.rapid_feed <= 0.0 {
            return Err(format!("setup '{}' rapid feed must be positive", self.name));
        }
        if let Some(profile) = &self.post.siemens_828d {
            profile.validate()?;
        }
        if self.operations.len() > MAX_OPERATIONS_PER_SETUP {
            return Err(format!(
                "setup '{}' can contain at most {MAX_OPERATIONS_PER_SETUP} operations",
                self.name
            ));
        }
        let mut body_ids = HashSet::new();
        for id in &self.body_ids {
            if id.0 == 0 || !body_ids.insert(*id) {
                return Err(format!(
                    "setup '{}' contains a duplicate or zero body id",
                    self.name
                ));
            }
        }
        for operation in &self.operations {
            operation.validate(self, tools)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamDocumentDto {
    #[serde(default)]
    pub setups: Vec<CamSetupDto>,
    #[serde(default)]
    pub active_setup_id: Option<u64>,
    #[serde(default)]
    pub tools: Vec<CamToolDto>,
    #[serde(default = "first_id")]
    pub next_setup_id: u64,
    #[serde(default = "first_id")]
    pub next_operation_id: u64,
    #[serde(default = "first_id")]
    pub next_tool_id: u64,
}

impl Default for CamDocumentDto {
    fn default() -> Self {
        Self {
            setups: Vec::new(),
            active_setup_id: None,
            tools: Vec::new(),
            next_setup_id: 1,
            next_operation_id: 1,
            next_tool_id: 1,
        }
    }
}

impl CamDocumentDto {
    pub fn validate(&self) -> Result<(), String> {
        if self.setups.len() > MAX_SETUPS {
            return Err(format!(
                "a project can contain at most {MAX_SETUPS} CAM setups"
            ));
        }
        if self.tools.len() > MAX_TOOLS {
            return Err(format!(
                "a project can contain at most {MAX_TOOLS} CAM tools"
            ));
        }
        if self.next_setup_id == 0 || self.next_operation_id == 0 || self.next_tool_id == 0 {
            return Err("CAM id counters must be non-zero".to_string());
        }

        let mut tool_ids = HashSet::new();
        let mut tool_numbers = HashSet::new();
        let mut max_tool_id = 0;
        for tool in &self.tools {
            tool.validate()?;
            if !tool_ids.insert(tool.id) {
                return Err(format!("duplicate CAM tool id {}", tool.id));
            }
            if !tool_numbers.insert(tool.number) {
                return Err(format!("duplicate CAM tool number {}", tool.number));
            }
            max_tool_id = max_tool_id.max(tool.id);
        }

        let mut setup_ids = HashSet::new();
        let mut operation_ids = HashSet::new();
        let mut max_setup_id = 0;
        let mut max_operation_id = 0;
        for setup in &self.setups {
            if !setup_ids.insert(setup.id) {
                return Err(format!("duplicate CAM setup id {}", setup.id));
            }
            setup.validate(&self.tools)?;
            max_setup_id = max_setup_id.max(setup.id);
            for operation in &setup.operations {
                if !operation_ids.insert(operation.id()) {
                    return Err(format!("duplicate CAM operation id {}", operation.id()));
                }
                max_operation_id = max_operation_id.max(operation.id());
            }
        }
        if let Some(active) = self.active_setup_id {
            if !setup_ids.contains(&active) {
                return Err("active CAM setup does not exist".to_string());
            }
        } else if !self.setups.is_empty() {
            return Err("a CAM document with setups must select an active setup".to_string());
        }
        if self.next_setup_id <= max_setup_id
            || self.next_operation_id <= max_operation_id
            || self.next_tool_id <= max_tool_id
        {
            return Err("CAM id counters must be greater than every saved id".to_string());
        }
        Ok(())
    }

    pub fn setup(&self, id: u64) -> Option<&CamSetupDto> {
        self.setups.iter().find(|setup| setup.id == id)
    }

    pub fn tool(&self, id: u64) -> Option<&CamToolDto> {
        self.tools.iter().find(|tool| tool.id == id)
    }
}
