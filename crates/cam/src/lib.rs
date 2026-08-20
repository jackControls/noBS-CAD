//! Host-neutral 3-axis CAM foundation.
//!
//! The persistent job model stores manufacturing intent: setups, WCS/stock,
//! tools, and operations. [`plan_setup`] deterministically expands that intent
//! into controller-neutral motion. Posts consume only that motion program, so
//! machine dialects and third-party post adapters never leak into geometry or
//! path planning.

mod model;
mod nbpost;
mod planner;
mod post;
mod post_events;
mod simulation;

pub use model::{
    CamDocumentDto, CamOperationDto, CamPostConfigDto, CamSetupDto, CamToolDto, CamToolKind,
    ContourCompensation, CoolantMode, CuttingParametersDto, Point2Dto, Point3Dto, PostDialect,
    Rect2Dto, Siemens828dAtcStyle, Siemens828dPostConfigDto, Siemens828dToolChangePositioning,
    SpindleDirection, StockBoxDto, WorkCoordinateSystemDto, WorkOffset,
};
pub use nbpost::{
    analyze_nbpost, NbPostAnalysisDto, NbPostAnalysisRequestDto, NbPostCompatibilityLevel,
    NbPostSourceKind,
};
pub use planner::{
    plan_setup, CamCommandDto, CamPlanError, CamProgramDto, CamProgramStatsDto, MotionKind,
};
pub use post::{post_setup, CamPostRequestDto, CamPostResultDto};
pub use post_events::{post_event_stream, PostEventDto, PostEventStreamDto};
pub use simulation::{
    simulate_setup, CamSimulationCollisionDto, CamSimulationMeshDto, CamSimulationRequestDto,
    CamSimulationResultDto, CamSimulationStepDto, CamSimulationStepKind,
};
