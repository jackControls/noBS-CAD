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

fn one_u8() -> u8 {
    1
}

fn default_flute_count() -> u32 {
    2
}

/// Unit system a CAM document is displayed and posted in.
///
/// All persisted geometry and the neutral motion program stay canonical
/// millimetres regardless of this setting; the unit converts operator-facing
/// input/output and posted controller words. Switching units therefore never
/// rewrites saved coordinates and cannot accumulate rounding error.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamUnits {
    #[default]
    Millimeters,
    Inches,
}

impl CamUnits {
    /// Multiply a canonical millimetre value by this to obtain document units.
    pub fn from_mm(self, value_mm: f64) -> f64 {
        match self {
            Self::Millimeters => value_mm,
            Self::Inches => value_mm / 25.4,
        }
    }

    /// Multiply a document-unit value by this to obtain canonical millimetres.
    pub fn to_mm(self, value: f64) -> f64 {
        match self {
            Self::Millimeters => value,
            Self::Inches => value * 25.4,
        }
    }

    pub fn length_label(self) -> &'static str {
        match self {
            Self::Millimeters => "mm",
            Self::Inches => "in",
        }
    }

    pub fn feed_label(self) -> &'static str {
        match self {
            Self::Millimeters => "mm/min",
            Self::Inches => "in/min",
        }
    }
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

    pub fn index(self) -> u8 {
        match self {
            Self::G54 => 0,
            Self::G55 => 1,
            Self::G56 => 2,
            Self::G57 => 3,
            Self::G58 => 4,
            Self::G59 => 5,
        }
    }

    pub fn from_index(index: u8) -> Option<Self> {
        match index {
            0 => Some(Self::G54),
            1 => Some(Self::G55),
            2 => Some(Self::G56),
            3 => Some(Self::G57),
            4 => Some(Self::G58),
            5 => Some(Self::G59),
            _ => None,
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
    pub(crate) fn validate(&self) -> Result<(), String> {
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
    Tap,
    Reamer,
    BoringBar,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamToolDto {
    /// Internal identity. Operations reference tools by this id, never by the
    /// machine-facing number or name, so renumbering or renaming a tool never
    /// breaks existing operations.
    pub id: u64,
    /// Machine-facing tool number. Optional because not every control calls
    /// tools numerically: number-based posts (Fanuc/GRBL/LinuxCNC style) fail
    /// closed when it is missing, while the Siemens 828D post prefers calling
    /// by name (`T="..."`).
    #[serde(default)]
    pub number: Option<u32>,
    /// Operator-facing name; also the call identifier on name-capable
    /// controls. Always required.
    pub name: String,
    pub kind: CamToolKind,
    pub diameter: f64,
    pub flute_length: f64,
    pub overall_length: f64,
    #[serde(default = "default_true")]
    pub center_cutting: bool,
    /// Cutting edge count. Drives chip-load reasoning and is shown in the
    /// library; it never changes motion by itself.
    #[serde(default = "default_flute_count")]
    pub flute_count: u32,
    /// Point angle for chamfer mills, in degrees. A chamfer operation
    /// currently supports 90 degree tools only; other kinds store `None`.
    #[serde(default)]
    pub point_angle_degrees: Option<f64>,
    /// Library cutting defaults captured with the tool. Creating an
    /// operation copies these into the operation, where they remain
    /// independently editable; later library edits never rewrite existing
    /// operations.
    #[serde(default)]
    pub cutting: CuttingParametersDto,
}

impl CamToolDto {
    /// Human-facing label for diagnostics: `T<number>` when a machine number
    /// is assigned, otherwise the tool name.
    pub fn label(&self) -> String {
        match self.number {
            Some(number) => format!("T{number}"),
            None => self.name.clone(),
        }
    }

    fn validate(&self) -> Result<(), String> {
        if self.id == 0 {
            return Err("CAM tool ids must be non-zero".to_string());
        }
        if let Some(number) = self.number {
            if number == 0 {
                return Err(format!(
                    "tool '{}' tool number must be positive when assigned",
                    self.name
                ));
            }
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
        if self.flute_count == 0 || self.flute_count > 12 {
            return Err(format!(
                "tool '{}' flute count must be between 1 and 12",
                self.name
            ));
        }
        if let Some(angle) = self.point_angle_degrees {
            if !angle.is_finite() || !(10.0..=170.0).contains(&angle) {
                return Err(format!(
                    "tool '{}' point angle must be between 10 and 170 degrees",
                    self.name
                ));
            }
        }
        if self.kind == CamToolKind::ChamferMill && self.point_angle_degrees.is_none() {
            return Err(format!(
                "chamfer mill '{}' must declare a point angle",
                self.name
            ));
        }
        self.cutting
            .validate(&format!("tool '{}' library cutting data", self.name))?;
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

/// Conservative placeholder used when a pre-tool-library project is loaded.
/// Operators are expected to replace these with their own proven values; the
/// library UI never treats them as recommendations.
impl Default for CuttingParametersDto {
    fn default() -> Self {
        Self {
            spindle_rpm: 5_000,
            feed_xy: 500.0,
            feed_z: 150.0,
            coolant: CoolantMode::Off,
        }
    }
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

/// Canned-cycle family of a drill operation. The planner expands every cycle
/// to explicit longhand motion (plus spindle reversals for tapping), so the
/// neutral program never depends on a control's canned-cycle dialect.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrillCycle {
    /// Single feed to depth, optional dwell, rapid out.
    #[default]
    Drill,
    /// Peck with a small partial retract that stays inside the hole, only
    /// breaking the chip. Requires `peck_depth`; the partial retract distance
    /// is `peck_retract` (default 0.5 mm).
    ChipBreaking,
    /// Peck with a full retract to the retract plane to clear chips.
    /// Requires `peck_depth`.
    DeepHole,
    /// Right-hand tapping: feed in at pitch x rpm, spindle reverse, feed out
    /// at the same pitch feed. Requires `thread_pitch` and a tap tool.
    TappingRight,
    /// Left-hand tapping: the same with both spindle senses swapped.
    TappingLeft,
    /// Feed in, optional dwell, feed back out at `feed_out` (default: the
    /// plunge feed). Requires a reamer.
    Reaming,
    /// Feed in, dwell, feed back out at `feed_out` (default: the plunge
    /// feed). Requires a boring bar.
    Boring,
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
        /// Safe travel heights for this operation (setup Z, mm).
        #[serde(default)]
        clearance_z: f64,
        #[serde(default)]
        retract_z: f64,
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
        #[serde(default)]
        clearance_z: f64,
        #[serde(default)]
        retract_z: f64,
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
        clearance_z: f64,
        /// Hole-machining cycle family; see `DrillCycle`.
        #[serde(default)]
        cycle: DrillCycle,
        #[serde(default)]
        peck_depth: Option<f64>,
        /// Partial retract distance for `ChipBreaking` (setup Z, mm).
        #[serde(default)]
        peck_retract: Option<f64>,
        /// Thread pitch (mm/rev) for tapping cycles; the in/out feed is
        /// derived as pitch x spindle rpm.
        #[serde(default)]
        thread_pitch: Option<f64>,
        /// Feed-out rate (mm/min) for reaming/boring; defaults to the plunge
        /// feed when unset.
        #[serde(default)]
        feed_out: Option<f64>,
        #[serde(default)]
        dwell_seconds: f64,
        cutting: CuttingParametersDto,
    },
    Pocket2d {
        id: u64,
        name: String,
        #[serde(default = "default_true")]
        enabled: bool,
        tool_id: u64,
        /// Closed pocket boundary selected by the operator, in setup XY.
        outline: Vec<Point2Dto>,
        top_z: f64,
        bottom_z: f64,
        step_down: f64,
        step_over: f64,
        #[serde(default)]
        clearance_z: f64,
        #[serde(default)]
        retract_z: f64,
        cutting: CuttingParametersDto,
    },
    Chamfer2d {
        id: u64,
        name: String,
        #[serde(default = "default_true")]
        enabled: bool,
        tool_id: u64,
        /// Finished vertical profile the chamfer breaks, in setup XY.
        path: Vec<Point2Dto>,
        /// Z of the sharp top edge being chamfered.
        top_z: f64,
        /// Radial width of the 45 degree chamfer leg.
        chamfer_width: f64,
        /// Extra distance the tool tip travels past the chamfer root so the
        /// tip never rubs the corner. Also the radial offset of the tool
        /// axis from the finished profile for a 90 degree tool.
        tip_offset: f64,
        /// Which side of the path the remaining material wall is on.
        wall_side: ContourCompensation,
        #[serde(default)]
        clearance_z: f64,
        #[serde(default)]
        retract_z: f64,
        cutting: CuttingParametersDto,
    },
}

impl CamOperationDto {
    pub fn id(&self) -> u64 {
        match self {
            Self::Face { id, .. }
            | Self::Contour2d { id, .. }
            | Self::Drill { id, .. }
            | Self::Pocket2d { id, .. }
            | Self::Chamfer2d { id, .. } => *id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Self::Face { name, .. }
            | Self::Contour2d { name, .. }
            | Self::Drill { name, .. }
            | Self::Pocket2d { name, .. }
            | Self::Chamfer2d { name, .. } => name,
        }
    }

    pub fn enabled(&self) -> bool {
        match self {
            Self::Face { enabled, .. }
            | Self::Contour2d { enabled, .. }
            | Self::Drill { enabled, .. }
            | Self::Pocket2d { enabled, .. }
            | Self::Chamfer2d { enabled, .. } => *enabled,
        }
    }

    pub fn tool_id(&self) -> u64 {
        match self {
            Self::Face { tool_id, .. }
            | Self::Contour2d { tool_id, .. }
            | Self::Drill { tool_id, .. }
            | Self::Pocket2d { tool_id, .. }
            | Self::Chamfer2d { tool_id, .. } => *tool_id,
        }
    }

    pub fn cutting(&self) -> CuttingParametersDto {
        match self {
            Self::Face { cutting, .. }
            | Self::Contour2d { cutting, .. }
            | Self::Drill { cutting, .. }
            | Self::Pocket2d { cutting, .. }
            | Self::Chamfer2d { cutting, .. } => *cutting,
        }
    }

    /// Per-operation clearance plane (setup Z, mm): safe travel height.
    pub fn clearance_z(&self) -> f64 {
        match self {
            Self::Face { clearance_z, .. }
            | Self::Contour2d { clearance_z, .. }
            | Self::Drill { clearance_z, .. }
            | Self::Pocket2d { clearance_z, .. }
            | Self::Chamfer2d { clearance_z, .. } => *clearance_z,
        }
    }

    /// Per-operation retract plane (setup Z, mm): approach/peck-return height.
    pub fn retract_z(&self) -> f64 {
        match self {
            Self::Face { retract_z, .. }
            | Self::Contour2d { retract_z, .. }
            | Self::Drill { retract_z, .. }
            | Self::Pocket2d { retract_z, .. }
            | Self::Chamfer2d { retract_z, .. } => *retract_z,
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

        // Safe heights are defined per operation: the clearance plane must
        // clear the stock top, and the retract plane sits between the
        // operation's cut top and its clearance plane.
        let clearance_z = self.clearance_z();
        if !clearance_z.is_finite() || clearance_z <= setup.stock.max.z {
            return Err(format!(
                "operation '{label}' clearance Z must be above the stock"
            ));
        }
        let cut_top = match self {
            Self::Face { top_z, .. }
            | Self::Contour2d { top_z, .. }
            | Self::Drill { top_z, .. }
            | Self::Pocket2d { top_z, .. }
            | Self::Chamfer2d { top_z, .. } => *top_z,
        };
        let retract_z = self.retract_z();
        if !retract_z.is_finite() || retract_z <= cut_top || retract_z > clearance_z {
            return Err(format!(
                "operation '{label}' retract Z must be above the cut top and no higher than its clearance Z"
            ));
        }

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
                cycle,
                peck_depth,
                peck_retract,
                thread_pitch,
                feed_out,
                dwell_seconds,
                ..
            } => {
                match cycle {
                    DrillCycle::Drill | DrillCycle::ChipBreaking | DrillCycle::DeepHole => {
                        if tool.kind != CamToolKind::Drill && !tool.center_cutting {
                            return Err(format!(
                                "drill operation '{label}' requires a drill or center-cutting tool"
                            ));
                        }
                    }
                    DrillCycle::TappingRight | DrillCycle::TappingLeft => {
                        if tool.kind != CamToolKind::Tap {
                            return Err(format!(
                                "tapping operation '{label}' requires a tap tool"
                            ));
                        }
                    }
                    DrillCycle::Reaming => {
                        if tool.kind != CamToolKind::Reamer {
                            return Err(format!(
                                "reaming operation '{label}' requires a reamer tool"
                            ));
                        }
                    }
                    DrillCycle::Boring => {
                        if tool.kind != CamToolKind::BoringBar {
                            return Err(format!(
                                "boring operation '{label}' requires a boring bar tool"
                            ));
                        }
                    }
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
                let pecking = matches!(cycle, DrillCycle::ChipBreaking | DrillCycle::DeepHole);
                if pecking && peck_depth.is_none() {
                    return Err(format!(
                        "drill operation '{label}' pecking cycles require a peck depth"
                    ));
                }
                if !pecking && peck_depth.is_some() {
                    return Err(format!(
                        "drill operation '{label}' only pecking cycles take a peck depth"
                    ));
                }
                if let Some(peck) = peck_depth {
                    if !peck.is_finite() || *peck <= 0.0 {
                        return Err(format!(
                            "drill operation '{label}' peck depth must be positive"
                        ));
                    }
                }
                if let Some(retract) = peck_retract {
                    let valid = retract.is_finite()
                        && *retract > 0.0
                        && peck_depth.is_some_and(|peck| *retract < peck);
                    if *cycle != DrillCycle::ChipBreaking || !valid {
                        return Err(format!(
                            "drill operation '{label}' peck retract only applies to chip breaking and must be positive and smaller than the peck depth"
                        ));
                    }
                }
                match cycle {
                    DrillCycle::TappingRight | DrillCycle::TappingLeft => {
                        let valid =
                            thread_pitch.is_some_and(|pitch| pitch.is_finite() && pitch > 0.0);
                        if !valid {
                            return Err(format!(
                                "tapping operation '{label}' requires a positive thread pitch"
                            ));
                        }
                    }
                    _ => {
                        if thread_pitch.is_some() {
                            return Err(format!(
                                "drill operation '{label}' only tapping cycles take a thread pitch"
                            ));
                        }
                    }
                }
                if let Some(out) = feed_out {
                    let feeds_out =
                        matches!(cycle, DrillCycle::Reaming | DrillCycle::Boring);
                    if !feeds_out || !out.is_finite() || *out <= 0.0 {
                        return Err(format!(
                            "drill operation '{label}' feed-out only applies to reaming/boring and must be positive"
                        ));
                    }
                }
                if !dwell_seconds.is_finite() || *dwell_seconds < 0.0 || *dwell_seconds > 60.0 {
                    return Err(format!(
                        "drill operation '{label}' dwell must be between 0 and 60 seconds"
                    ));
                }
            }
            Self::Pocket2d {
                outline,
                top_z,
                bottom_z,
                step_down,
                step_over,
                ..
            } => {
                if tool.kind == CamToolKind::Drill || !tool.center_cutting {
                    return Err(format!(
                        "pocket operation '{label}' requires a center-cutting milling tool until ramp or helical entries are supported"
                    ));
                }
                if outline.len() < 3 || outline.len() > MAX_PATH_POINTS {
                    return Err(format!(
                        "pocket operation '{label}' needs 3..={MAX_PATH_POINTS} outline points"
                    ));
                }
                if !outline.iter().copied().all(within_xy) {
                    return Err(format!(
                        "pocket operation '{label}' outline must lie within stock"
                    ));
                }
                if signed_area(outline).abs() <= EPSILON {
                    return Err(format!("pocket operation '{label}' outline has zero area"));
                }
                validate_depth_range(label, *top_z, *bottom_z, *step_down, within_z)?;
                if !step_over.is_finite() || *step_over <= 0.0 || *step_over > tool.diameter {
                    return Err(format!(
                        "pocket operation '{label}' stepover must be positive and no larger than the tool diameter"
                    ));
                }
            }
            Self::Chamfer2d {
                path,
                top_z,
                chamfer_width,
                tip_offset,
                wall_side,
                ..
            } => {
                if tool.kind != CamToolKind::ChamferMill {
                    return Err(format!(
                        "chamfer operation '{label}' requires a chamfer mill"
                    ));
                }
                let point_angle = tool.point_angle_degrees.unwrap_or(90.0);
                if (point_angle - 90.0).abs() > 1.0e-6 {
                    return Err(format!(
                        "chamfer operation '{label}' supports 90 degree chamfer mills only"
                    ));
                }
                if matches!(wall_side, ContourCompensation::On) {
                    return Err(format!(
                        "chamfer operation '{label}' must declare which side of the path the material wall is on"
                    ));
                }
                if path.len() < 3 || path.len() > MAX_PATH_POINTS {
                    return Err(format!(
                        "chamfer operation '{label}' needs 3..={MAX_PATH_POINTS} path points"
                    ));
                }
                if !path.iter().copied().all(within_xy) {
                    return Err(format!(
                        "chamfer operation '{label}' path must lie within stock"
                    ));
                }
                if signed_area(path).abs() <= EPSILON {
                    return Err(format!("chamfer operation '{label}' path has zero area"));
                }
                if !chamfer_width.is_finite() || *chamfer_width <= 0.0 {
                    return Err(format!(
                        "chamfer operation '{label}' width must be positive"
                    ));
                }
                if !tip_offset.is_finite() || *tip_offset <= 0.0 || *tip_offset > *chamfer_width {
                    return Err(format!(
                        "chamfer operation '{label}' tip offset must be positive and no larger than the chamfer width"
                    ));
                }
                let tip_depth = chamfer_width + tip_offset;
                if tip_depth > tool.diameter * 0.5 + EPSILON {
                    return Err(format!(
                        "chamfer operation '{label}' width plus tip offset exceeds the tool radius"
                    ));
                }
                if !within_z(*top_z) || !within_z(top_z - tip_depth) {
                    return Err(format!(
                        "chamfer operation '{label}' cut depth must stay within the stock"
                    ));
                }
                if tip_depth > tool.flute_length + EPSILON {
                    return Err(format!(
                        "chamfer operation '{label}' reaches beyond the tool's flute length"
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

/// Per-axis anchor on a bounding box, used when an operator picks a WCS
/// origin from a stock or model box.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BoxAnchor {
    #[default]
    Min,
    Center,
    Max,
}

/// Stock geometry family the operator chooses for a setup.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamStockShape {
    /// Rectangular billet.
    #[default]
    Box,
    /// Cylindrical bar, axis along setup Z.
    Cylinder,
    /// Hexagonal bar (across-flats), axis along setup Z.
    Hex,
    /// A modeled solid body used as the stock, voxelized from its mesh.
    ModelBody,
}

/// A bounding-box face of the model, used to park the model against one
/// stock face instead of centering it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CamStockFace {
    XMin,
    XMax,
    YMin,
    YMax,
    ZMin,
    ZMax,
}

/// How a fixed-size stock holds the model: centered in XY (bottom of the
/// stock at the model's Z floor unless a Z face is chosen), or pushed
/// against one named model-box face with an explicit gap.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CamStockPlacementDto {
    #[serde(default = "default_true")]
    pub center: bool,
    #[serde(default)]
    pub face: Option<CamStockFace>,
    #[serde(default)]
    pub offset: f64,
}

impl Default for CamStockPlacementDto {
    fn default() -> Self {
        Self {
            center: true,
            face: None,
            offset: 0.0,
        }
    }
}

/// Per-face allowances when stock grows out of the model bounding box.
/// Cylinder/hex shapes consume `x_min..y_max` as the radial allowance and
/// `z_min`/`z_max` as the axial allowances.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct CamStockOffsetsDto {
    #[serde(default)]
    pub x_min: f64,
    #[serde(default)]
    pub x_max: f64,
    #[serde(default)]
    pub y_min: f64,
    #[serde(default)]
    pub y_max: f64,
    #[serde(default)]
    pub z_min: f64,
    #[serde(default)]
    pub z_max: f64,
}

/// How the operator defines the stock. Resolution to concrete geometry
/// happens where the model scene is available (the workspace host); the
/// resolved envelope and shape are persisted on the setup.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum CamStockSpecDto {
    /// Fixed-size stock; the model is placed inside it.
    Fixed {
        shape: CamStockShape,
        /// Box: full XYZ size. Cylinder: X = diameter, Z = height.
        /// Hex: X = across-flats, Z = height.
        size: Point3Dto,
        #[serde(default)]
        placement: CamStockPlacementDto,
    },
    /// Stock grown from the model bounding box by per-face allowances.
    FromModel {
        shape: CamStockShape,
        #[serde(default)]
        offsets: CamStockOffsetsDto,
    },
    /// Continue from the remaining stock of an earlier setup that shares
    /// this setup's WCS (same clamping, second operation group).
    RestFromSetup {
        setup_id: u64,
    },
    /// A modeled body used as the stock solid.
    ModelBody {
        body_id: u64,
    },
    /// Legacy documents predate the spec; the resolved box in `stock` is
    /// authoritative for them.
    #[default]
    LegacyBox,
}

/// Resolved stock geometry in setup coordinates, persisted so the planner,
/// simulator, and viewport never re-derive it behind the operator's back.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "shape", rename_all = "snake_case")]
pub enum CamResolvedStockDto {
    /// Rectangular billet filling the `stock` box.
    #[default]
    Box,
    /// Cylinder along setup Z within the `stock` Z range.
    Cylinder { center: Point2Dto, radius: f64 },
    /// Hexagonal bar along setup Z within the `stock` Z range.
    Hex { center: Point2Dto, across_flats: f64 },
    /// Remaining stock inherited from another setup's simulation. The
    /// `stock` box equals the source setup's envelope.
    Rest { source_setup_id: u64 },
    /// A modeled body, voxelized at simulation time from the mesh the host
    /// supplies in the simulation request.
    ModelBody { body_id: u64 },
}

/// Records how the operator chose the WCS origin. The resolved frame stays in
/// `CamSetupDto::wcs`; this provenance lets the workspace re-resolve the
/// origin on demand without any hidden recomputation behind the operator's
/// back.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum WcsOriginSpecDto {
    /// Raw model-space coordinates entered by the operator.
    #[default]
    Explicit,
    /// A corner/edge/center point of the operator-defined stock box.
    StockBoxPoint {
        x: BoxAnchor,
        y: BoxAnchor,
        z: BoxAnchor,
    },
    /// A point on the bounding box of the setup's selected model bodies.
    ModelBoxPoint {
        x: BoxAnchor,
        y: BoxAnchor,
        z: BoxAnchor,
    },
    /// A point entity drawn earlier in a sketch.
    SketchPoint { sketch: String, entity_id: u32 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CamSetupDto {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub wcs: WorkCoordinateSystemDto,
    /// How the operator picked the WCS origin. Display and re-resolution
    /// metadata only; planners always use the resolved `wcs` frame.
    #[serde(default)]
    pub wcs_origin: WcsOriginSpecDto,
    /// First work offset this setup posts with. `G54` is the conventional
    /// first fixture offset on most controls.
    #[serde(default)]
    pub work_offset: WorkOffset,
    /// How many consecutive work offsets the posted program repeats the
    /// toolpath with (`G54`, `G55`, ... from `work_offset`). One means the
    /// parts are machined one at a time in a single clamping position.
    #[serde(default = "one_u8")]
    pub work_offset_count: u8,
    /// How the operator defined the stock, kept for re-editing.
    #[serde(default)]
    pub stock_spec: CamStockSpecDto,
    /// Resolved stock shape the planner, simulator, and viewport consume.
    /// The Z extent always comes from `stock`.
    #[serde(default)]
    pub resolved_stock: CamResolvedStockDto,
    pub stock: StockBoxDto,
    /// The operator-entered stock box in model coordinates, kept so the setup
    /// dialog can re-edit and re-anchor it. `stock` (setup coordinates)
    /// remains the value planners and simulators consume.
    #[serde(default)]
    pub stock_model_box: Option<StockBoxDto>,
    #[serde(default)]
    pub body_ids: Vec<BodyId>,
    /// Pre-per-operation documents stored one clearance plane on the setup.
    /// Captured only to seed operation heights during migration; never
    /// serialized back out.
    #[serde(default, rename = "clearance_z", skip_serializing)]
    pub legacy_clearance_z: Option<f64>,
    #[serde(default, rename = "retract_z", skip_serializing)]
    pub legacy_retract_z: Option<f64>,
    #[serde(default)]
    pub operations: Vec<CamOperationDto>,
}

impl CamSetupDto {
    /// Consecutive work offsets the posted program repeats with, starting at
    /// `work_offset`.
    pub fn work_offsets(&self) -> Vec<WorkOffset> {
        (0..self.work_offset_count)
            .filter_map(|step| WorkOffset::from_index(self.work_offset.index() + step))
            .collect()
    }

    fn validate(&self, tools: &[CamToolDto]) -> Result<(), String> {
        if self.id == 0 {
            return Err("CAM setup ids must be non-zero".to_string());
        }
        if self.name.trim().is_empty() {
            return Err(format!("CAM setup {} must have a name", self.id));
        }
        self.wcs.validate()?;
        if let WcsOriginSpecDto::SketchPoint { sketch, .. } = &self.wcs_origin {
            if sketch.trim().is_empty() {
                return Err(format!(
                    "setup '{}' WCS sketch-point reference must name a sketch",
                    self.name
                ));
            }
        }
        if self.work_offset_count == 0
            || self.work_offset.index() + self.work_offset_count > 6
        {
            return Err(format!(
                "setup '{}' work offsets must stay within G54..=G59",
                self.name
            ));
        }
        if let Some(model_box) = &self.stock_model_box {
            model_box.validate()?;
        }
        self.stock.validate()?;
        self.validate_stock_shape()?;
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

    /// The operator-facing stock spec and the persisted resolved geometry
    /// must tell the same story; the host resolves one from the other, and a
    /// disagreement means a hand-edited or corrupted document.
    fn validate_stock_shape(&self) -> Result<(), String> {
        let consistent = match (&self.stock_spec, &self.resolved_stock) {
            (CamStockSpecDto::LegacyBox, CamResolvedStockDto::Box) => true,
            (
                CamStockSpecDto::Fixed { shape, size, placement },
                resolved,
            ) => {
                let shape_matches = matches!(
                    (shape, resolved),
                    (CamStockShape::Box, CamResolvedStockDto::Box)
                        | (CamStockShape::Cylinder, CamResolvedStockDto::Cylinder { .. })
                        | (CamStockShape::Hex, CamResolvedStockDto::Hex { .. })
                );
                if !shape_matches || !size.is_finite() || size.x <= 0.0 || size.z <= 0.0 {
                    return Err(format!(
                        "setup '{}' fixed stock needs a box/cylinder/hex shape with positive size",
                        self.name
                    ));
                }
                if matches!(shape, CamStockShape::Box) && size.y <= 0.0 {
                    return Err(format!(
                        "setup '{}' fixed box stock needs a positive Y size",
                        self.name
                    ));
                }
                if !placement.offset.is_finite() || (!placement.center && placement.face.is_none())
                {
                    return Err(format!(
                        "setup '{}' fixed stock placement must center the model or name a face",
                        self.name
                    ));
                }
                true
            }
            (CamStockSpecDto::FromModel { shape, offsets }, resolved) => {
                let shape_matches = matches!(
                    (shape, resolved),
                    (CamStockShape::Box, CamResolvedStockDto::Box)
                        | (CamStockShape::Cylinder, CamResolvedStockDto::Cylinder { .. })
                        | (CamStockShape::Hex, CamResolvedStockDto::Hex { .. })
                );
                if !shape_matches {
                    return Err(format!(
                        "setup '{}' model-grown stock needs a box/cylinder/hex shape",
                        self.name
                    ));
                }
                for value in [
                    offsets.x_min,
                    offsets.x_max,
                    offsets.y_min,
                    offsets.y_max,
                    offsets.z_min,
                    offsets.z_max,
                ] {
                    if !value.is_finite() || value < 0.0 {
                        return Err(format!(
                            "setup '{}' stock allowances must be finite and non-negative",
                            self.name
                        ));
                    }
                }
                true
            }
            (
                CamStockSpecDto::RestFromSetup { setup_id },
                CamResolvedStockDto::Rest { source_setup_id },
            ) => {
                if setup_id != source_setup_id {
                    return Err(format!(
                        "setup '{}' rest-stock spec and resolved source disagree",
                        self.name
                    ));
                }
                if *setup_id == self.id {
                    return Err(format!(
                        "setup '{}' cannot inherit remaining stock from itself",
                        self.name
                    ));
                }
                true
            }
            (
                CamStockSpecDto::ModelBody { body_id },
                CamResolvedStockDto::ModelBody { body_id: resolved_body },
            ) => {
                if body_id != resolved_body || *body_id == 0 {
                    return Err(format!(
                        "setup '{}' model-body stock must reference a non-zero body",
                        self.name
                    ));
                }
                true
            }
            _ => false,
        };
        if !consistent {
            return Err(format!(
                "setup '{}' stock definition and resolved stock shape disagree",
                self.name
            ));
        }
        // The resolved profile must fit inside the persisted stock envelope.
        match &self.resolved_stock {
            CamResolvedStockDto::Cylinder { center, radius } => {
                if !center.is_finite() || !radius.is_finite() || *radius <= 0.0 {
                    return Err(format!(
                        "setup '{}' cylinder stock needs a finite center and positive radius",
                        self.name
                    ));
                }
                if center.x - radius < self.stock.min.x - EPSILON
                    || center.x + radius > self.stock.max.x + EPSILON
                    || center.y - radius < self.stock.min.y - EPSILON
                    || center.y + radius > self.stock.max.y + EPSILON
                {
                    return Err(format!(
                        "setup '{}' cylinder stock must lie inside the stock envelope",
                        self.name
                    ));
                }
            }
            CamResolvedStockDto::Hex {
                center,
                across_flats,
            } => {
                if !center.is_finite() || !across_flats.is_finite() || *across_flats <= 0.0 {
                    return Err(format!(
                        "setup '{}' hex stock needs a finite center and positive across-flats size",
                        self.name
                    ));
                }
                // Flats perpendicular to X; vertices reach across_flats / sqrt(3) in Y.
                let half = across_flats / 2.0;
                let vertex = across_flats / 3.0_f64.sqrt();
                if center.x - half < self.stock.min.x - EPSILON
                    || center.x + half > self.stock.max.x + EPSILON
                    || center.y - vertex < self.stock.min.y - EPSILON
                    || center.y + vertex > self.stock.max.y + EPSILON
                {
                    return Err(format!(
                        "setup '{}' hex stock must lie inside the stock envelope",
                        self.name
                    ));
                }
            }
            CamResolvedStockDto::Box
            | CamResolvedStockDto::Rest { .. }
            | CamResolvedStockDto::ModelBody { .. } => {}
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
    /// Operator-facing unit system. Persisted geometry and planned motion
    /// remain canonical millimetres; posts convert controller words when
    /// this is inches.
    #[serde(default)]
    pub units: CamUnits,
    /// Post settings remembered from the last export. Posting always asks
    /// again; these only pre-fill the dialog so the machine profile choice
    /// is an explicit, at-export decision.
    #[serde(default)]
    pub post_defaults: CamPostConfigDto,
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
            units: CamUnits::Millimeters,
            post_defaults: CamPostConfigDto::default(),
            next_setup_id: 1,
            next_operation_id: 1,
            next_tool_id: 1,
        }
    }
}

impl CamDocumentDto {
    /// Seed per-operation safe heights on documents saved before heights
    /// moved from the setup onto each operation. The legacy setup planes are
    /// copied into every operation still at zero (zero is never a valid
    /// plane) and then cleared; validation reports any operation left
    /// without heights, so nothing silently plans with a zero plane.
    pub fn migrate_legacy(&mut self) {
        for setup in &mut self.setups {
            let legacy_clearance = setup.legacy_clearance_z.take();
            let legacy_retract = setup.legacy_retract_z.take();
            if legacy_clearance.is_none() && legacy_retract.is_none() {
                continue;
            }
            for operation in &mut setup.operations {
                match operation {
                    CamOperationDto::Face {
                        clearance_z,
                        retract_z,
                        ..
                    }
                    | CamOperationDto::Contour2d {
                        clearance_z,
                        retract_z,
                        ..
                    }
                    | CamOperationDto::Pocket2d {
                        clearance_z,
                        retract_z,
                        ..
                    }
                    | CamOperationDto::Chamfer2d {
                        clearance_z,
                        retract_z,
                        ..
                    } => {
                        if *clearance_z == 0.0 {
                            if let Some(value) = legacy_clearance {
                                *clearance_z = value;
                            }
                        }
                        if *retract_z == 0.0 {
                            if let Some(value) = legacy_retract {
                                *retract_z = value;
                            }
                        }
                    }
                    // Drill operations always carried their own retract
                    // plane; only the clearance plane is new to them.
                    CamOperationDto::Drill { clearance_z, .. } => {
                        if *clearance_z == 0.0 {
                            if let Some(value) = legacy_clearance {
                                *clearance_z = value;
                            }
                        }
                    }
                }
            }
        }
    }

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
            if let Some(number) = tool.number {
                if !tool_numbers.insert(number) {
                    return Err(format!("duplicate CAM tool number {number}"));
                }
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
        if let Some(profile) = &self.post_defaults.siemens_828d {
            profile.validate()?;
        }

        // Rest-stock links between setups: the source setup must exist with
        // the same WCS (same clamping) and the same stock envelope, and the
        // link graph must be acyclic so simulation can resolve it.
        for setup in &self.setups {
            let CamResolvedStockDto::Rest { source_setup_id } = &setup.resolved_stock else {
                continue;
            };
            let source = self.setup(*source_setup_id).ok_or_else(|| {
                format!(
                    "setup '{}' inherits remaining stock from a missing setup",
                    setup.name
                )
            })?;
            let frames_match = [setup.wcs.origin, source.wcs.origin]
                .into_iter()
                .all(|point| point.is_finite())
                && (setup.wcs.origin.x - source.wcs.origin.x).abs() <= 1.0e-6
                && (setup.wcs.origin.y - source.wcs.origin.y).abs() <= 1.0e-6
                && (setup.wcs.origin.z - source.wcs.origin.z).abs() <= 1.0e-6
                && setup
                    .wcs
                    .x_axis
                    .iter()
                    .zip(source.wcs.x_axis.iter())
                    .chain(setup.wcs.y_axis.iter().zip(source.wcs.y_axis.iter()))
                    .chain(setup.wcs.z_axis.iter().zip(source.wcs.z_axis.iter()))
                    .all(|(left, right)| (left - right).abs() <= 1.0e-6);
            if !frames_match {
                return Err(format!(
                    "setup '{}' rest stock requires the same WCS as setup '{}'",
                    setup.name, source.name
                ));
            }
            let envelope_matches = [
                (setup.stock.min.x, source.stock.min.x),
                (setup.stock.min.y, source.stock.min.y),
                (setup.stock.min.z, source.stock.min.z),
                (setup.stock.max.x, source.stock.max.x),
                (setup.stock.max.y, source.stock.max.y),
                (setup.stock.max.z, source.stock.max.z),
            ]
            .into_iter()
            .all(|(left, right)| (left - right).abs() <= 1.0e-6);
            if !envelope_matches {
                return Err(format!(
                    "setup '{}' rest stock requires the same stock envelope as setup '{}'",
                    setup.name, source.name
                ));
            }
            // Walk the chain; revisiting a node means a cycle.
            let mut seen = HashSet::from([setup.id]);
            let mut cursor = source;
            while let CamResolvedStockDto::Rest { source_setup_id } = &cursor.resolved_stock {
                if !seen.insert(*source_setup_id) {
                    return Err(format!(
                        "setup '{}' rest-stock chain loops back on itself",
                        setup.name
                    ));
                }
                cursor = self.setup(*source_setup_id).ok_or_else(|| {
                    format!(
                        "setup '{}' rest-stock chain references a missing setup",
                        setup.name
                    )
                })?;
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn cutting() -> CuttingParametersDto {
        CuttingParametersDto {
            spindle_rpm: 8_000,
            feed_xy: 600.0,
            feed_z: 180.0,
            coolant: CoolantMode::Off,
        }
    }

    fn tool() -> CamToolDto {
        CamToolDto {
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
        }
    }

    fn face(id: u64, clearance_z: f64, retract_z: f64) -> CamOperationDto {
        CamOperationDto::Face {
            id,
            name: format!("Face {id}"),
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
            clearance_z,
            retract_z,
            cutting: cutting(),
        }
    }

    fn setup(id: u64, stock_spec: CamStockSpecDto, resolved_stock: CamResolvedStockDto) -> CamSetupDto {
        CamSetupDto {
            id,
            name: format!("Setup {id}"),
            wcs: WorkCoordinateSystemDto::default(),
            wcs_origin: WcsOriginSpecDto::Explicit,
            work_offset: WorkOffset::G54,
            work_offset_count: 1,
            stock_spec,
            resolved_stock,
            stock: StockBoxDto {
                min: Point3Dto::new(0.0, 0.0, -10.0),
                max: Point3Dto::new(20.0, 20.0, 0.0),
            },
            stock_model_box: None,
            body_ids: vec![],
            legacy_clearance_z: None,
            legacy_retract_z: None,
            operations: vec![face(id, 8.0, 2.0)],
        }
    }

    fn document_with(setups: Vec<CamSetupDto>) -> CamDocumentDto {
        let next_setup_id = setups.iter().map(|setup| setup.id).max().unwrap_or(0) + 1;
        CamDocumentDto {
            active_setup_id: setups.first().map(|setup| setup.id),
            next_setup_id,
            next_operation_id: 100,
            next_tool_id: 2,
            tools: vec![tool()],
            setups,
            ..CamDocumentDto::default()
        }
    }

    #[test]
    fn legacy_setup_heights_migrate_into_operations() {
        // A pre-per-operation document: heights live on the setup, operations
        // carry none, and the removed rapid/post fields are ignored.
        let legacy = r#"{
            "setups": [{
                "id": 1,
                "name": "Old setup",
                "wcs": {
                    "origin": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "x_axis": [1.0, 0.0, 0.0],
                    "y_axis": [0.0, 1.0, 0.0],
                    "z_axis": [0.0, 0.0, 1.0]
                },
                "work_offset": "g54",
                "stock": {
                    "min": {"x": 0.0, "y": 0.0, "z": -10.0},
                    "max": {"x": 20.0, "y": 20.0, "z": 0.0}
                },
                "clearance_z": 8.0,
                "retract_z": 2.0,
                "rapid_feed": 3000.0,
                "post": {"dialect": "grbl", "program_number": 7},
                "operations": [{
                    "kind": "face",
                    "id": 1,
                    "name": "Face",
                    "tool_id": 1,
                    "bounds": {"min": {"x": 0.0, "y": 0.0}, "max": {"x": 20.0, "y": 20.0}},
                    "top_z": 0.0,
                    "target_z": -1.0,
                    "step_over": 3.0,
                    "step_down": 1.0,
                    "cutting": {"spindle_rpm": 8000, "feed_xy": 600.0, "feed_z": 180.0}
                }]
            }],
            "active_setup_id": 1,
            "tools": [{
                "id": 1,
                "number": 1,
                "name": "6 mm flat",
                "kind": "flat_end_mill",
                "diameter": 6.0,
                "flute_length": 15.0,
                "overall_length": 50.0
            }],
            "next_setup_id": 2,
            "next_operation_id": 2,
            "next_tool_id": 2
        }"#;
        let mut document: CamDocumentDto = serde_json::from_str(legacy).unwrap();
        assert_eq!(document.setups[0].legacy_clearance_z, Some(8.0));
        document.migrate_legacy();
        document.validate().unwrap();
        let operation = &document.setups[0].operations[0];
        assert_eq!(operation.clearance_z(), 8.0);
        assert_eq!(operation.retract_z(), 2.0);
        assert_eq!(document.setups[0].legacy_clearance_z, None);
        // Migrated documents never serialize the legacy setup planes back out.
        let serialized = serde_json::to_string(&document).unwrap();
        let setup_json: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        let setup_json = setup_json["setups"][0].clone();
        assert!(setup_json.get("clearance_z").is_none());
        assert!(setup_json.get("rapid_feed").is_none());
        assert!(setup_json.get("post").is_none());
    }

    #[test]
    fn rest_stock_requires_matching_wcs_and_envelope() {
        let first = setup(1, CamStockSpecDto::LegacyBox, CamResolvedStockDto::Box);
        let mut second = setup(
            2,
            CamStockSpecDto::RestFromSetup { setup_id: 1 },
            CamResolvedStockDto::Rest {
                source_setup_id: 1,
            },
        );
        document_with(vec![first.clone(), second.clone()]).validate().unwrap();

        // Same clamping only: a different WCS breaks the rest link.
        second.wcs.origin = Point3Dto::new(1.0, 0.0, 0.0);
        let error = document_with(vec![first.clone(), second.clone()])
            .validate()
            .unwrap_err();
        assert!(error.contains("same WCS"));

        // The envelopes must agree cell for cell.
        second.wcs.origin = Point3Dto::new(0.0, 0.0, 0.0);
        second.stock.max.x = 25.0;
        let error = document_with(vec![first.clone(), second.clone()])
            .validate()
            .unwrap_err();
        assert!(error.contains("same stock envelope"));

        // Cycles fail closed.
        let mut looping_a = setup(
            1,
            CamStockSpecDto::RestFromSetup { setup_id: 2 },
            CamResolvedStockDto::Rest {
                source_setup_id: 2,
            },
        );
        looping_a.operations = vec![face(1, 8.0, 2.0)];
        let looping_b = setup(
            2,
            CamStockSpecDto::RestFromSetup { setup_id: 1 },
            CamResolvedStockDto::Rest {
                source_setup_id: 1,
            },
        );
        let error = document_with(vec![looping_a, looping_b])
            .validate()
            .unwrap_err();
        assert!(error.contains("loops back"));
    }

    #[test]
    fn work_offset_repetition_stays_within_g59() {
        let mut setup = setup(1, CamStockSpecDto::LegacyBox, CamResolvedStockDto::Box);
        setup.work_offset = WorkOffset::G58;
        setup.work_offset_count = 2;
        document_with(vec![setup.clone()]).validate().unwrap();
        assert_eq!(setup.work_offsets(), vec![WorkOffset::G58, WorkOffset::G59]);
        setup.work_offset_count = 3;
        let error = document_with(vec![setup]).validate().unwrap_err();
        assert!(error.contains("G54..=G59"));
    }

    #[test]
    fn stock_spec_and_resolved_shape_must_agree() {
        let mut setup = setup(
            1,
            CamStockSpecDto::FromModel {
                shape: CamStockShape::Cylinder,
                offsets: CamStockOffsetsDto::default(),
            },
            CamResolvedStockDto::Cylinder {
                center: Point2Dto::new(10.0, 10.0),
                radius: 9.0,
            },
        );
        document_with(vec![setup.clone()]).validate().unwrap();

        setup.resolved_stock = CamResolvedStockDto::Box;
        let error = document_with(vec![setup.clone()]).validate().unwrap_err();
        assert!(error.contains("box/cylinder/hex"));

        // The resolved profile must fit inside the persisted envelope.
        setup.resolved_stock = CamResolvedStockDto::Cylinder {
            center: Point2Dto::new(10.0, 10.0),
            radius: 12.0,
        };
        setup.stock_spec = CamStockSpecDto::FromModel {
            shape: CamStockShape::Cylinder,
            offsets: CamStockOffsetsDto::default(),
        };
        let error = document_with(vec![setup]).validate().unwrap_err();
        assert!(error.contains("inside the stock envelope"));
    }
}
