//! Compatibility re-exports. Plane references and stable face ids moved to
//! `nbcad-core` in M2 so sketches and solids share one contract.

pub use nbcad_core::{FaceId, OriginPlane, PlaneBasis, PlaneError, PlaneRef};
