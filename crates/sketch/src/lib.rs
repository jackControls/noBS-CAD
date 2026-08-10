//! nbcad-sketch — pure-Rust 2D sketch model and session API.
//!
//! - Sketch entities: point, line (endpoints are shared point entities —
//!   structural coincident), arc, circle.
//! - Constraints: the 12 geometric constraints of M1 plus Fix/Unfix and the
//!   dimensional constraints (distance, radius, diameter, angle).
//! - [`solver`]: Newton-based constraint solver with real DOF tracking and
//!   over-constraint rejection.
//! - [`SketchSession`]: drawing behavior — snap, auto-constraint inference,
//!   solver-pinned rubber-band dragging, locked dynamic input, tool ops,
//!   and undo/redo.
//! - [`SketchManager`]: document + session lifecycle, held by both engine
//!   hosts; [`host::handle`] is the shared JSON dispatch both hosts use.
//!
//! This crate never touches OCCT — the sketch solver is pure Rust.

mod constraint;
mod drawing;
mod dto;
mod entity;
mod expr;
mod geometry;
mod geomops;
mod manager;
mod params;
mod plane;
mod project;
mod session;
mod sketch;
mod solver;

pub mod host;

pub use constraint::{Constraint, ConstraintId, ConstraintKind};
pub use drawing::{
    DrawingAnnotationDto, DrawingCircularRefDto, DrawingDocumentDto, DrawingEdgeEndpoint,
    DrawingLineRefDto, DrawingLinearDimensionMode, DrawingProjectionMethod,
    DrawingRadialDimensionMode, DrawingSheetDto, DrawingSheetFormat, DrawingSheetOrientation,
    DrawingStandard, DrawingTemplateDto, DrawingTitleBlockDto, DrawingToleranceNoteDto,
    DrawingTolerancePreset, DrawingTopologyAnchorRefDto, DrawingViewAlignment, DrawingViewDto,
    DrawingViewKind,
};
pub use dto::{
    err_json, ok_json, AddConstraintResult, AddLineResult, Arc3PointRequest, ArcCenterRequest,
    BeginSketchRequest, BreakRequest, ChamferRequest, CircleMode, CircleRequest,
    CircularPatternRequest, ConstraintBatchRequest, ConstraintDesc, ConstraintDto,
    DeleteDimensionRequest, DeleteEntitiesRequest, DeleteEntityRequest, DeleteEntityResult,
    DimensionDto, DimensionRequest, DofDto, DragPhase, EditDimensionRequest, EndSketchResult,
    EntityDesc, EntityDto, EvalExpressionRequest, EvalExpressionResult, ExtendRequest,
    FaceSketchOrigin, FilletPreviewDto, FilletRequest, Inference, LockedCircleRequest,
    LockedRectangleRequest, LockedSegmentRequest, MidpointLineRequest, MirrorRequest,
    MoveCopyRequest, MoveDimensionRequest, MovePointRequest, MovePointResult, OffsetPreviewDto,
    OffsetRequest, PointRequest, PolygonRequest, PreviewCurve, PreviewDto, ProjectVisibilityDto,
    RectangleMode, RectangleRequest, RectangularPatternRequest, ReferenceMidpointDto, ScaleRequest,
    SegmentRequest, SetDimensionStyleRequest, SetGridSnapRequest, SetGridStepRequest, SketchDto,
    SlotMode, SlotRequest, SnapTarget, SplineRequest, ToggleFixBatchRequest, ToolResult,
    TrimPreviewDto, TrimRequest, UndoResult,
};
pub use entity::{Entity, EntityId};
pub use expr::{
    eval_expression, parse as parse_expression, referenced_idents, Ast, ExprError,
    Func as ExpressionFunction, Op as ExpressionOperator,
};
pub use geometry::Vec2;
pub use manager::SketchManager;
pub use params::{ParamId, ParamKind, ParamTable, Parameter};
pub use plane::{FaceId, OriginPlane, PlaneBasis, PlaneError, PlaneRef};
pub use session::{SessionError, SketchSession};
pub use sketch::{DofReport, Sketch, SketchSnapshot, SolveError};
pub use solver::Analysis;
