//! nbcad-core — noBS CAD document model.
//!
//! Owns the in-memory representation of a CAD document: its unit settings,
//! the browser tree shown in the UI, and the parametric feature tree. The
//! Tauri shell exchanges snapshots of this model with the frontend via
//! [`DocumentDto`].

mod appearance;
mod browser;
mod document;
mod dto;
mod feature;
mod ids;
mod plane;
mod units;

pub use appearance::{
    BodyAppearance, Rgba8, DEFAULT_BODY_COLOR, DEFAULT_BRAND, DEFAULT_FILAMENT_DIAMETER_MM,
    DEFAULT_FILAMENT_TYPE, DEFAULT_MATERIAL_NAME,
};
pub use browser::{BrowserNode, BrowserNodeKind, NodeId};
pub use document::Document;
pub use dto::DocumentDto;
pub use feature::{Feature, FeatureId, FeatureKind, FeatureStatus, FeatureTree};
pub use ids::{BodyId, EdgeId, FaceId};
pub use plane::{OriginPlane, PlaneBasis, PlaneError, PlaneRef};
pub use units::{DimensionStyle, DocumentSettings, UnitSystem};
