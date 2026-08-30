//! Host-neutral 3-axis CAM foundation.
//!
//! The persistent job model stores manufacturing intent: setups, WCS/stock,
//! tools, and operations. [`plan_setup`] deterministically expands that intent
//! into controller-neutral motion. Posts consume only that motion program, so
//! machine dialects and third-party post adapters never leak into geometry or
//! path planning.

mod gcode;
mod model;
mod nbpost;
mod planner;
mod post;
mod post_events;
mod simulation;

#[cfg(test)]
mod stabilization_tests;

pub use gcode::{simulate_gcode, CamGcodeDialectDto, CamGcodeSimulationRequestDto};
pub use model::{
    BoxAnchor, CamChainRefDto, CamChainSource, CamDocumentDto, CamLoadWarningDto, CamOperationDto,
    CamPostConfigDto, CamResolvedStockDto, CamSetupDto, CamStockFace, CamStockOffsetsDto,
    CamStockPlacementDto, CamStockShape, CamStockSpecDto, CamToolDto, CamToolKind, CamUnits,
    CompensationMode, ContourCompensation, CoolantMode, CuttingParametersDto, FaceDirection,
    MillingDirection, Point2Dto, Point3Dto, PostDialect, Rect2Dto, Siemens828dAtcStyle,
    Siemens828dPostConfigDto, Siemens828dToolChangePositioning, SpindleDirection, StockBoxDto,
    WcsOriginSpecDto, WorkCoordinateSystemDto, WorkOffset,
};
pub use nbpost::{
    analyze_nbpost, NbPostAnalysisDto, NbPostAnalysisRequestDto, NbPostCompatibilityLevel,
    NbPostSourceKind,
};
pub use planner::{
    plan_setup, CamArcPlane, CamCommandDto, CamPlanError, CamProgramDto, CamProgramStatsDto,
    MotionKind,
};
pub use post::{post_setup, CamPostRequestDto, CamPostResultDto};
pub use post_events::{post_event_stream, PostEventDto, PostEventStreamDto};
pub use simulation::{
    simulate_setup, simulate_setup_with_cancellation, CamSimulationCancellation,
    CamSimulationCollisionDto, CamSimulationCollisionKindDto, CamSimulationComparisonDto,
    CamSimulationMeshDto, CamSimulationRequestDto, CamSimulationResultDto, CamSimulationSourceDto,
    CamSimulationStepDto, CamSimulationStepKind, CamSimulationTargetDto, CamStockMeshDto,
};
